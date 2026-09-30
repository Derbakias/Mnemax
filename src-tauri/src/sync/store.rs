//! This device's sync key and name, and the devices paired with it, in `sync.json` in the app data dir.
//!
//! The file is written by Rust only: the page never sees the private key, it asks for the name and the
//! paired devices through the sync commands.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{Error, SYNC_PARAMS};

const FILE: &str = "sync.json";
pub const MAX_NAME_CHARS: usize = 40;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// The device's public key, in hex: what identifies it.
    pub key: String,
    pub name: String,
    pub paired_at: u64,
    pub last_sync_at: Option<u64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFile {
    private_key: String,
    public_key: String,
    name: String,
    peers: Vec<Peer>,
}

pub struct Store {
    path: PathBuf,
    data: SyncFile,
}

impl Store {
    /// Reads the file, or starts one with a new key. A file that can't be read is kept aside as
    /// `sync.json.broken` (the pairings in it are lost: devices have to pair again).
    pub fn open(dir: &Path, default_name: &str) -> Result<Self, Error> {
        let path = dir.join(FILE);
        if let Ok(text) = fs::read_to_string(&path) {
            match serde_json::from_str::<SyncFile>(&text) {
                Ok(data) if hex_decode(&data.private_key).is_some_and(|k| k.len() == 32) => {
                    return Ok(Self { path, data })
                }
                _ => {
                    let _ = fs::rename(&path, dir.join(format!("{FILE}.broken")));
                }
            }
        }
        let keys = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .generate_keypair()
            .map_err(|_| Error::Storage("couldn't make a key".into()))?;
        let store = Self {
            path,
            data: SyncFile {
                private_key: hex_encode(&keys.private),
                public_key: hex_encode(&keys.public),
                name: default_name.to_string(),
                peers: Vec::new(),
            },
        };
        fs::create_dir_all(dir).map_err(|e| Error::Storage(e.to_string()))?;
        store.save()?;
        Ok(store)
    }

    pub fn private_key(&self) -> Vec<u8> {
        hex_decode(&self.data.private_key).unwrap_or_default()
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

    /// Adds the device, or renames it if it was paired before.
    pub fn add_peer(&mut self, key: &[u8], name: &str, now: u64) -> Result<Peer, Error> {
        let key = hex_encode(key);
        self.data.peers.retain(|p| p.key != key);
        let peer = Peer { key, name: check_name(name)?, paired_at: now, last_sync_at: None };
        self.data.peers.push(peer.clone());
        self.save()?;
        Ok(peer)
    }

    pub fn forget(&mut self, key_hex: &str) -> Result<(), Error> {
        self.data.peers.retain(|p| p.key != key_hex);
        self.save()
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

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mnemax-sync-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn keeps_its_key_and_peers_between_starts() {
        let dir = temp_dir("reopen");
        let mut store = Store::open(&dir, "Laptop").unwrap();
        let key = store.public_key();
        assert_eq!(key.len(), 32);
        store.add_peer(&[7; 32], "Phone", 1000).unwrap();
        store.synced(&[7; 32], 2000).unwrap();

        let again = Store::open(&dir, "Other name").unwrap();
        assert_eq!(again.public_key(), key);
        assert_eq!(again.name(), "Laptop");
        assert_eq!(again.peer(&[7; 32]).unwrap().last_sync_at, Some(2000));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn forgets_a_peer() {
        let dir = temp_dir("forget");
        let mut store = Store::open(&dir, "Laptop").unwrap();
        store.add_peer(&[7; 32], "Phone", 1000).unwrap();
        store.forget(&hex_encode(&[7; 32])).unwrap();
        assert!(Store::open(&dir, "Laptop").unwrap().peers().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sets_a_broken_file_aside_and_starts_again() {
        let dir = temp_dir("broken");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE), "{not json").unwrap();
        let store = Store::open(&dir, "Laptop").unwrap();
        assert_eq!(store.private_key().len(), 32);
        assert_eq!(fs::read_to_string(dir.join("sync.json.broken")).unwrap(), "{not json");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn only_this_user_can_read_the_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("mode");
        Store::open(&dir, "Laptop").unwrap();
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
