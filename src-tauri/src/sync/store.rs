//! This device's sync settings, kept in `sync.json` in the app's private folder: its secret key (locked, see
//! `vault`), its public key, its name, and the devices paired with it.
//!
//! Only Rust reads and writes this file. The page never sees the secret key.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::vault::{Vault, VaultError};
use super::{Error, SYNC_PARAMS};

const FILE: &str = "sync.json";
pub const MAX_NAME_CHARS: usize = 40;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    /// The device's public key, in hex. This is what identifies it; the name is only a label.
    pub key: String,
    pub name: String,
    /// Where to reach it, like `192.168.1.20`, if this device is the one that connects. None if this device
    /// is the one that waits (it showed the code when they paired).
    #[serde(default)]
    pub address: Option<String>,
    pub paired_at: u64,
    pub last_sync_at: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFile {
    /// The secret key, locked by the system's key store, in hex. Empty until a key is first needed. Early test
    /// builds kept the key unlocked instead; such a file reads with this empty, so it's replaced (and the
    /// unlocked key with it).
    #[serde(default)]
    sealed_key: String,
    #[serde(default)]
    public_key: String,
    name: String,
    peers: Vec<Peer>,
}

pub struct Store {
    dir: PathBuf,
    data: SyncFile,
    /// Unlocked the first time it's needed (see `unlock`), then kept here while the app runs.
    private_key: Option<Zeroizing<Vec<u8>>>,
}

impl Store {
    /// Reads the file, without touching the key store, so just looking at the paired devices never asks for a
    /// password. With no file yet, starts empty (nothing is saved until something changes). A file that isn't
    /// valid is kept aside as `sync.json.broken`. Any other reading problem (no permission, say) changes
    /// nothing and fails, so the paired devices aren't lost over it.
    pub fn open(dir: &Path, default_name: &str) -> Result<Self, Error> {
        let path = dir.join(FILE);
        let data = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<SyncFile>(&bytes) {
                Ok(data) => Some(data),
                Err(_) => {
                    eprintln!("sync: {FILE} isn't valid: keeping it as {FILE}.broken and starting again");
                    set_aside(dir, "broken")?;
                    None
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(Error::Storage(format!("can't read {FILE}: {e}"))),
        };
        let data = data.unwrap_or_else(|| SyncFile {
            sealed_key: String::new(),
            public_key: String::new(),
            name: default_name.to_string(),
            peers: Vec::new(),
        });
        Ok(Self { dir: dir.to_path_buf(), data, private_key: None })
    }

    /// This device's secret key, unlocked by the key store (which may ask for a password). Only pairing and
    /// syncing need it. If there's no key yet, or the key store can't unlock this one (the file was copied
    /// from another device, say), makes a new one: paired devices then have to pair again. The old file is
    /// kept as `sync.json.lost` first, in case the key store only lost it for now.
    ///
    /// If the key store can't be reached right now (locked), nothing changes and this fails.
    pub fn unlock(&mut self, vault: &dyn Vault) -> Result<Zeroizing<Vec<u8>>, Error> {
        if let Some(key) = &self.private_key {
            return Ok(key.clone());
        }
        let had_key = !self.data.sealed_key.is_empty();
        if had_key {
            match hex_decode(&self.data.sealed_key).map(|sealed| vault.open(&sealed).map(Zeroizing::new)) {
                Some(Ok(key)) if key.len() == 32 => {
                    self.private_key = Some(key.clone());
                    return Ok(key);
                }
                Some(Err(VaultError::Unavailable(why))) => return Err(Error::KeyStore(why)),
                _ => eprintln!("sync: the key store can't unlock this file's key: keeping it as {FILE}.lost"),
            }
        }
        let keys = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .generate_keypair()
            .map_err(|_| Error::Storage("couldn't make a key".into()))?;
        let private_key = Zeroizing::new(keys.private);
        let sealed = vault.seal(&private_key).map_err(|e| match e {
            VaultError::Unavailable(why) => Error::KeyStore(why),
            VaultError::Lost => Error::KeyStore("couldn't lock the key".into()),
        })?;
        if had_key {
            set_aside(&self.dir, "lost")?;
        }
        // Devices paired with the old key can't sync with the new one.
        self.change(|data| {
            data.sealed_key = hex_encode(&sealed);
            data.public_key = hex_encode(&keys.public);
            data.peers.clear();
        })?;
        self.private_key = Some(private_key.clone());
        Ok(private_key)
    }

    pub fn name(&self) -> &str {
        &self.data.name
    }

    pub fn peers(&self) -> &[Peer] {
        &self.data.peers
    }

    pub fn peer(&self, key: &[u8]) -> Option<&Peer> {
        let key = hex_encode(key);
        self.data.peers.iter().find(|p| p.key == key)
    }

    pub fn set_name(&mut self, name: &str) -> Result<(), Error> {
        let name = check_name(name)?;
        self.change(|data| data.name = name)
    }

    /// Saves a newly paired device. If it was paired before (Reconnect), keeps its history and updates its
    /// name and address.
    pub fn add_peer(&mut self, key: &[u8], name: &str, address: Option<String>, now: u64) -> Result<Peer, Error> {
        let key = hex_encode(key);
        let name = check_name(name)?;
        let peer = match self.data.peers.iter().find(|p| p.key == key) {
            Some(old) => Peer { name, address, ..old.clone() },
            None => Peer { key: key.clone(), name, address, paired_at: now, last_sync_at: None },
        };
        let saved = peer.clone();
        self.change(|data| {
            data.peers.retain(|p| p.key != key);
            data.peers.push(peer);
        })?;
        Ok(saved)
    }

    /// Removes a device from this one. It can't sync with this device any more.
    pub fn forget(&mut self, key: &[u8]) -> Result<(), Error> {
        let key = hex_encode(key);
        self.change(|data| data.peers.retain(|p| p.key != key))
    }

    /// Keeps the name the device goes by now (it sends it with every sync).
    pub fn rename_peer(&mut self, key: &[u8], name: &str) -> Result<(), Error> {
        let name = check_name(name)?;
        self.change_peer(key, |peer| peer.name = name)
    }

    pub fn synced(&mut self, key: &[u8], now: u64) -> Result<(), Error> {
        self.change_peer(key, |peer| peer.last_sync_at = Some(now))
    }

    fn change_peer(&mut self, key: &[u8], f: impl FnOnce(&mut Peer)) -> Result<(), Error> {
        let key = hex_encode(key);
        self.change(|data| {
            if let Some(peer) = data.peers.iter_mut().find(|p| p.key == key) {
                f(peer);
            }
        })
    }

    /// Makes a change on a copy and saves the copy. Only once it's saved does it replace what's in memory, so
    /// a failed save changes nothing anywhere (and trying again really tries again).
    fn change(&mut self, f: impl FnOnce(&mut SyncFile)) -> Result<(), Error> {
        let mut next = self.data.clone();
        f(&mut next);
        fs::create_dir_all(&self.dir).map_err(|e| Error::Storage(e.to_string()))?;
        save(&self.dir.join(FILE), &next)?;
        self.data = next;
        Ok(())
    }
}

/// Writes a new file and then moves it into place, so a crash halfway can't leave half a file.
fn save(path: &Path, data: &SyncFile) -> Result<(), Error> {
    let json = serde_json::to_string_pretty(data).map_err(|e| Error::Storage(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    write_private(&tmp, json.as_bytes()).map_err(|e| Error::Storage(e.to_string()))?;
    fs::rename(&tmp, path).map_err(|e| Error::Storage(e.to_string()))
}

/// Keeps the file as `sync.json.<what>` before it's replaced. If that fails, nothing is replaced.
fn set_aside(dir: &Path, what: &str) -> Result<(), Error> {
    fs::rename(dir.join(FILE), dir.join(format!("{FILE}.{what}")))
        .map_err(|e| Error::Storage(format!("can't keep {FILE} aside: {e}")))
}

/// Writes a file only this user can read (on Android the app's folder is already private), and makes sure it
/// reached the disk.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// A device name: trimmed, 1 to 40 characters, nothing invisible. Invisible characters could make one name
/// look like another, or turn the text around it backwards.
pub fn check_name(name: &str) -> Result<String, Error> {
    let name = name.trim();
    let chars = name.chars().count();
    if chars == 0 || chars > MAX_NAME_CHARS || name.chars().any(|c| c.is_control() || is_invisible(c)) {
        return Err(Error::BadName);
    }
    Ok(name.to_string())
}

/// Characters that take no space or change the writing direction (Unicode's "format" characters).
fn is_invisible(c: char) -> bool {
    matches!(c,
        '\u{ad}' | '\u{61c}' | '\u{180e}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{206f}' | '\u{feff}' | '\u{fff9}'..='\u{fffb}' | '\u{e0000}'..='\u{e007f}')
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
mod tests;
