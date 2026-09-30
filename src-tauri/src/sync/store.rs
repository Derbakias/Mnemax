//! This device's sync key and name, and the devices paired with it, in `sync.json` in the app data dir.
//!
//! The file is written by Rust only: the page never sees the private key, it asks for the name and the
//! paired devices through the sync commands. The private key is only ever written sealed by the system's key
//! store (see `vault`); open, it stays in memory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::vault::{Vault, VaultError};
use super::{Error, SYNC_PARAMS};

const FILE: &str = "sync.json";
pub const MAX_NAME_CHARS: usize = 40;
/// Forgotten devices this device still has to tell: the oldest go past this many.
const MAX_FORGOTTEN: usize = 20;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// The device's public key, in hex: what identifies it.
    pub key: String,
    pub name: String,
    pub paired_at: u64,
    pub last_sync_at: Option<u64>,
}

/// A device forgotten here that hasn't heard yet: the next time it tries to sync, it's told this device
/// unpaired it (and gets no rounds).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forgotten {
    pub key: String,
    pub name: String,
    pub forgotten_at: u64,
}

/// What this device makes of a key in a handshake.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standing {
    Paired,
    /// Forgotten here, and not told yet.
    Forgotten,
    Unknown,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFile {
    /// The private key, sealed by the system's key store, in hex.
    #[serde(default)]
    sealed_key: String,
    /// Where builds before the key store kept the private key, in the clear. Never written.
    #[serde(default, skip_serializing)]
    private_key: Option<String>,
    public_key: String,
    name: String,
    peers: Vec<Peer>,
    /// Files from before forgetting told the other device don't have it.
    #[serde(default)]
    forgotten: Vec<Forgotten>,
}

pub struct Store {
    path: PathBuf,
    data: SyncFile,
    private_key: Zeroizing<Vec<u8>>,
}

impl Store {
    /// Reads the file and has the key store open the private key, or starts a file with a new key.
    ///
    /// Starts again (the pairings are lost: devices have to pair again) with a file that can't be read, which
    /// is kept aside as `sync.json.broken`; with one whose key the key store can no longer open (the file was
    /// copied from another device, say); and with one from before the key store, whose key was kept in the
    /// clear: that file is deleted, so the key isn't anywhere any more. When the key store can't be reached,
    /// nothing changes and it fails.
    pub fn open(dir: &Path, default_name: &str, vault: &dyn Vault) -> Result<Self, Error> {
        let path = dir.join(FILE);
        if let Ok(text) = fs::read_to_string(&path) {
            match serde_json::from_str::<SyncFile>(&text) {
                Ok(data) if data.private_key.is_some() => {
                    eprintln!("sync: the private key was kept in the clear: starting again with a new, sealed one");
                    fs::remove_file(&path).map_err(|e| Error::Storage(e.to_string()))?;
                }
                Ok(data) => match hex_decode(&data.sealed_key).map(|sealed| vault.open(&sealed).map(Zeroizing::new)) {
                    Some(Ok(private_key)) if private_key.len() == 32 => return Ok(Self { path, data, private_key }),
                    Some(Err(VaultError::Unavailable(why))) => return Err(Error::KeyStore(why)),
                    _ => eprintln!("sync: the key store can't open this file's key: starting again"),
                },
                Err(_) => {
                    let _ = fs::rename(&path, dir.join(format!("{FILE}.broken")));
                }
            }
        }
        let keys = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .generate_keypair()
            .map_err(|_| Error::Storage("couldn't make a key".into()))?;
        let private_key = Zeroizing::new(keys.private);
        let sealed = vault.seal(&private_key).map_err(|e| match e {
            VaultError::Unavailable(why) => Error::KeyStore(why),
            VaultError::Lost => Error::KeyStore("couldn't seal the key".into()),
        })?;
        let store = Self {
            path,
            data: SyncFile {
                sealed_key: hex_encode(&sealed),
                private_key: None,
                public_key: hex_encode(&keys.public),
                name: default_name.to_string(),
                peers: Vec::new(),
                forgotten: Vec::new(),
            },
            private_key,
        };
        fs::create_dir_all(dir).map_err(|e| Error::Storage(e.to_string()))?;
        store.save()?;
        Ok(store)
    }

    pub fn private_key(&self) -> Zeroizing<Vec<u8>> {
        self.private_key.clone()
    }

    pub fn public_key(&self) -> Vec<u8> {
        hex_decode(&self.data.public_key).unwrap_or_default()
    }

    pub fn name(&self) -> &str {
        &self.data.name
    }

    pub fn set_name(&mut self, name: &str) -> Result<(), Error> {
        self.data.name = check_name(name)?;
        self.save()
    }

    pub fn peers(&self) -> &[Peer] {
        &self.data.peers
    }

    pub fn peer(&self, key: &[u8]) -> Option<&Peer> {
        let key = hex_encode(key);
        self.data.peers.iter().find(|p| p.key == key)
    }

    pub fn standing(&self, key: &[u8]) -> Standing {
        let key = hex_encode(key);
        if self.data.peers.iter().any(|p| p.key == key) {
            Standing::Paired
        } else if self.data.forgotten.iter().any(|f| f.key == key) {
            Standing::Forgotten
        } else {
            Standing::Unknown
        }
    }

    /// Adds the device, or renames it if it was paired before. Paired again, it's no longer forgotten.
    pub fn add_peer(&mut self, key: &[u8], name: &str, now: u64) -> Result<Peer, Error> {
        let key = hex_encode(key);
        self.data.peers.retain(|p| p.key != key);
        self.data.forgotten.retain(|f| f.key != key);
        let peer = Peer { key, name: check_name(name)?, paired_at: now, last_sync_at: None };
        self.data.peers.push(peer.clone());
        self.save()?;
        Ok(peer)
    }

    /// Unpairs the device here, and notes it has to be told. Returns it, if it was paired.
    pub fn forget(&mut self, key_hex: &str, now: u64) -> Result<Option<Peer>, Error> {
        let Some(at) = self.data.peers.iter().position(|p| p.key == key_hex) else { return Ok(None) };
        let peer = self.data.peers.remove(at);
        self.data.forgotten.retain(|f| f.key != peer.key);
        self.data.forgotten.push(Forgotten { key: peer.key.clone(), name: peer.name.clone(), forgotten_at: now });
        if self.data.forgotten.len() > MAX_FORGOTTEN {
            self.data.forgotten.remove(0);
        }
        self.save()?;
        Ok(Some(peer))
    }

    pub fn forgotten(&self, key: &[u8]) -> Option<&Forgotten> {
        let key = hex_encode(key);
        self.data.forgotten.iter().find(|f| f.key == key)
    }

    /// The forgotten device now knows: nothing left to tell it.
    pub fn told(&mut self, key: &[u8]) -> Result<(), Error> {
        let key = hex_encode(key);
        self.data.forgotten.retain(|f| f.key != key);
        self.save()
    }

    /// The other device unpaired this one (and told it): it goes here too, with nothing to tell.
    pub fn unpaired_by(&mut self, key: &[u8]) -> Result<Option<Peer>, Error> {
        let key = hex_encode(key);
        let peer = self.data.peers.iter().position(|p| p.key == key).map(|at| self.data.peers.remove(at));
        self.data.forgotten.retain(|f| f.key != key);
        self.save()?;
        Ok(peer)
    }

    /// The name the device goes by now (it sends it with every sync). Its key stays what identifies it.
    pub fn rename_peer(&mut self, key: &[u8], name: &str) -> Result<(), Error> {
        let key = hex_encode(key);
        let name = check_name(name)?;
        match self.data.peers.iter_mut().find(|p| p.key == key) {
            Some(peer) if peer.name != name => {
                peer.name = name;
                self.save()
            }
            _ => Ok(()),
        }
    }

    pub fn synced(&mut self, key: &[u8], now: u64) -> Result<(), Error> {
        let key = hex_encode(key);
        if let Some(peer) = self.data.peers.iter_mut().find(|p| p.key == key) {
            peer.last_sync_at = Some(now);
        }
        self.save()
    }

    /// Writes a new file and moves it into place, so a crash mid-write can't leave half a file.
    fn save(&self) -> Result<(), Error> {
        let json = serde_json::to_string_pretty(&self.data).map_err(|e| Error::Storage(e.to_string()))?;
        let tmp = self.path.with_extension("json.tmp");
        write_private(&tmp, json.as_bytes()).map_err(|e| Error::Storage(e.to_string()))?;
        fs::rename(&tmp, &self.path).map_err(|e| Error::Storage(e.to_string()))
    }
}

/// Readable by this user only, where the system has such a thing (the app data dir is already private on
/// Android).
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        file.write_all(bytes)?;
        file.sync_all()
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
    }
}

/// A device name as shown to the other device: trimmed, 1 to 40 characters, no control characters.
pub fn check_name(name: &str) -> Result<String, Error> {
    let name = name.trim();
    let chars = name.chars().count();
    if chars == 0 || chars > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(Error::BadName);
    }
    Ok(name.to_string())
}

pub fn default_device_name() -> &'static str {
    match std::env::consts::OS {
        "android" => "Android phone",
        "ios" => "iPhone",
        "macos" => "Mac",
        "windows" => "Windows PC",
        "linux" => "Linux PC",
        _ => "This device",
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::vault::TestVault;

    const VAULT: &TestVault = &TestVault { key: 1 };

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mnemax-sync-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keeps_its_key_and_peers_between_starts() {
        let dir = temp_dir("reopen");
        let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
        let key = store.public_key();
        assert_eq!(key.len(), 32);
        store.add_peer(&[7; 32], "Phone", 1000).unwrap();
        store.synced(&[7; 32], 2000).unwrap();

        let again = Store::open(&dir, "Other name", VAULT).unwrap();
        assert_eq!(again.public_key(), key);
        assert_eq!(again.name(), "Laptop");
        assert_eq!(again.peer(&[7; 32]).unwrap().last_sync_at, Some(2000));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn forgets_a_peer_and_remembers_to_tell_it() {
        let dir = temp_dir("forget");
        let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
        store.add_peer(&[7; 32], "Phone", 1000).unwrap();
        assert_eq!(store.standing(&[7; 32]), Standing::Paired);
        assert_eq!(store.forget(&hex_encode(&[7; 32]), 2000).unwrap().unwrap().name, "Phone");
        let mut again = Store::open(&dir, "Laptop", VAULT).unwrap();
        assert!(again.peers().is_empty());
        assert_eq!(again.standing(&[7; 32]), Standing::Forgotten);
        again.told(&[7; 32]).unwrap();
        assert_eq!(again.standing(&[7; 32]), Standing::Unknown);
        assert_eq!(again.forget(&hex_encode(&[8; 32]), 3000).unwrap(), None, "not paired: nothing to forget");
        assert_eq!(again.standing(&[8; 32]), Standing::Unknown);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pairing_again_or_being_unpaired_clears_the_note() {
        let dir = temp_dir("forget-again");
        let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
        store.add_peer(&[7; 32], "Phone", 1000).unwrap();
        store.forget(&hex_encode(&[7; 32]), 2000).unwrap();
        store.add_peer(&[7; 32], "Phone", 3000).unwrap();
        assert_eq!(store.standing(&[7; 32]), Standing::Paired);
        assert_eq!(store.unpaired_by(&[7; 32]).unwrap().unwrap().name, "Phone");
        assert_eq!(store.standing(&[7; 32]), Standing::Unknown);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_renamed_device_keeps_its_pairing() {
        let dir = temp_dir("rename");
        let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
        store.add_peer(&[7; 32], "Android phone", 1000).unwrap();
        store.rename_peer(&[7; 32], "Android phone 1").unwrap();
        let again = Store::open(&dir, "Laptop", VAULT).unwrap();
        assert_eq!(again.peer(&[7; 32]).unwrap().name, "Android phone 1");
        assert_eq!(again.peer(&[7; 32]).unwrap().paired_at, 1000);
        assert_eq!(again.standing(&[7; 32]), Standing::Paired);
        let mut again = again;
        assert!(again.rename_peer(&[7; 32], "  ").is_err(), "not a name");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keeps_the_latest_20_to_tell() {
        let dir = temp_dir("forget-many");
        let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
        for i in 0..25u8 {
            store.add_peer(&[i; 32], "Phone", 1000).unwrap();
            store.forget(&hex_encode(&[i; 32]), 2000).unwrap();
        }
        assert_eq!(store.standing(&[4; 32]), Standing::Unknown);
        assert_eq!(store.standing(&[5; 32]), Standing::Forgotten);
        assert_eq!(store.standing(&[24; 32]), Standing::Forgotten);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_file_from_before_forgetting_told_the_other_device() {
        let dir = temp_dir("old-file");
        fs::create_dir_all(&dir).unwrap();
        let (sealed, key) = (hex_encode(&VAULT.seal(&[3; 32]).unwrap()), hex_encode(&[4; 32]));
        let old = format!(r#"{{"sealedKey":"{sealed}","publicKey":"{key}","name":"Laptop","peers":[]}}"#);
        fs::write(dir.join(FILE), old).unwrap();
        let store = Store::open(&dir, "Other", VAULT).unwrap();
        assert_eq!(store.name(), "Laptop", "the file was read, not set aside");
        assert_eq!(*store.private_key(), vec![3; 32]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn never_writes_the_private_key_in_the_clear() {
        let dir = temp_dir("sealed");
        let store = Store::open(&dir, "Laptop", VAULT).unwrap();
        let text = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(!text.contains(&hex_encode(&store.private_key())), "{text}");
        assert!(!text.contains("privateKey"), "{text}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn deletes_a_file_with_the_key_in_the_clear_and_starts_again() {
        let dir = temp_dir("clear-key");
        fs::create_dir_all(&dir).unwrap();
        let key = hex_encode(&[1; 32]);
        let old = format!(r#"{{"privateKey":"{key}","publicKey":"{key}","name":"Laptop","peers":[]}}"#);
        fs::write(dir.join(FILE), old).unwrap();
        let store = Store::open(&dir, "Other", VAULT).unwrap();
        assert_eq!(store.name(), "Other", "a new start");
        assert_ne!(*store.private_key(), vec![1; 32]);
        let everything: String = fs::read_dir(&dir)
            .unwrap()
            .map(|f| fs::read_to_string(f.unwrap().path()).unwrap_or_default())
            .collect();
        assert!(!everything.contains(&key), "the old key is gone from every file");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn starts_again_with_a_key_sealed_elsewhere() {
        let dir = temp_dir("elsewhere");
        let first = Store::open(&dir, "Laptop", &TestVault { key: 2 }).unwrap().public_key();
        let store = Store::open(&dir, "Other", VAULT).unwrap();
        assert_ne!(store.public_key(), first);
        assert_eq!(store.name(), "Other");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn changes_nothing_while_the_key_store_cant_be_reached() {
        struct Locked;
        impl Vault for Locked {
            fn seal(&self, _: &[u8]) -> Result<Vec<u8>, VaultError> {
                Err(VaultError::Unavailable("locked".into()))
            }
            fn open(&self, _: &[u8]) -> Result<Vec<u8>, VaultError> {
                Err(VaultError::Unavailable("locked".into()))
            }
        }
        let dir = temp_dir("locked");
        assert!(matches!(Store::open(&dir, "Laptop", &Locked), Err(Error::KeyStore(_))));
        assert!(!dir.join(FILE).exists(), "no file without a sealed key");
        let key = Store::open(&dir, "Laptop", VAULT).unwrap().public_key();
        let before = fs::read_to_string(dir.join(FILE)).unwrap();
        assert!(matches!(Store::open(&dir, "Laptop", &Locked), Err(Error::KeyStore(_))));
        assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), before);
        assert_eq!(Store::open(&dir, "Laptop", VAULT).unwrap().public_key(), key);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sets_a_broken_file_aside_and_starts_again() {
        let dir = temp_dir("broken");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE), "{not json").unwrap();
        let store = Store::open(&dir, "Laptop", VAULT).unwrap();
        assert_eq!(store.private_key().len(), 32);
        assert_eq!(fs::read_to_string(dir.join("sync.json.broken")).unwrap(), "{not json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_this_user_can_read_the_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        Store::open(&dir, "Laptop", VAULT).unwrap();
        assert_eq!(fs::metadata(dir.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn checks_names() {
        assert_eq!(check_name("  Tom's phone ").unwrap(), "Tom's phone");
        assert!(check_name("   ").is_err());
        assert!(check_name(&"x".repeat(41)).is_err());
        assert!(check_name("a\u{0}b").is_err());
        assert!(check_name("line\nbreak").is_err());
    }

    #[test]
    fn hex_round_trips() {
        assert_eq!(hex_decode(&hex_encode(&[0, 1, 254, 255])).unwrap(), vec![0, 1, 254, 255]);
        assert!(hex_decode("abc").is_none());
        assert!(hex_decode("zz").is_none());
    }
}
