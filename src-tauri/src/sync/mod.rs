//! Local sync: your games (rounds) travel between your own devices on the same Wi-Fi.
//!
//! - Two devices sync only after they were paired, once, with a code (see `pair`).
//! - The device that showed the code waits for connections; the other one remembers its address and
//!   connects to it (see `commands` and `listen`).
//! - Only devices on the home network are let in, and everything after the handshake is encrypted (see `wire`).
//! - Syncing only ever adds rounds (see `exchange`), and the page checks every round before saving it.
//! - The secret key never leaves Rust, and on disk it's always locked by the system's key store (see `vault`).

mod address;
mod commands;
mod error;
mod exchange;
mod listen;
mod pair;
mod store;
mod trace;
mod vault;
mod wire;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::Manager;

pub use commands::*;
pub use error::Error;
pub use listen::*;
use store::Store;

/// The encrypted handshakes: one for pairing (locked with the code), one for syncing (with known keys).
pub const PAIR_PARAMS: &str = "Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s";
pub const SYNC_PARAMS: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";

/// The secret key, wiped from memory when it's no longer used.
pub type PrivateKey = zeroize::Zeroizing<Vec<u8>>;

pub fn random_bytes<const N: usize>() -> Result<[u8; N], Error> {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).map_err(|_| Error::Random)?;
    Ok(bytes)
}

/// A random number from 0 up to (not including) `n`, every one equally likely.
pub fn random_below(n: u32) -> Result<u32, Error> {
    // Numbers from the last, incomplete run of `n` would come up a little more often, so they're drawn again.
    let limit = u32::MAX - u32::MAX % n;
    loop {
        let x = u32::from_be_bytes(random_bytes()?);
        if x < limit {
            return Ok(x % n);
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Everything sync keeps while the app runs.
pub struct SyncState {
    dir: PathBuf,
    vault: Box<dyn vault::Vault>,
    /// Opened the first time it's needed (the key store may ask to be unlocked), and tried again after a failure.
    store: Mutex<Option<Store>>,
    /// The rounds a device that syncs with this one gets. The page keeps it up to date while listening.
    rounds: Arc<Mutex<Vec<Value>>>,
    pairing: Mutex<Option<JoinHandle<()>>>,
    listening: Mutex<Option<JoinHandle<()>>>,
}

impl SyncState {
    fn new(dir: &Path, vault: Box<dyn vault::Vault>) -> Self {
        Self {
            dir: dir.to_path_buf(),
            vault,
            store: Mutex::default(),
            rounds: Arc::default(),
            pairing: Mutex::default(),
            listening: Mutex::default(),
        }
    }

    fn with_store<T>(&self, f: impl FnOnce(&mut Store) -> Result<T, Error>) -> Result<T, Error> {
        let mut guard = self.store.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            let store = Store::open(&self.dir, store::default_device_name(), self.vault.as_ref())
                .inspect_err(|e| eprintln!("sync: can't open the sync settings: {e} ({})", e.detail()))?;
            *guard = Some(store);
        }
        f(guard.as_mut().expect("opened above"))
    }

    /// This device's secret key and name.
    fn me(&self) -> Result<(PrivateKey, String), Error> {
        self.with_store(|s| Ok((s.private_key(), s.name().to_string())))
    }

    fn is_paired(&self, key: &[u8]) -> bool {
        self.with_store(|s| Ok(s.peer(key).is_some())).unwrap_or(false)
    }

    /// Stops a pairing, and waits until it has let go of its port.
    async fn stop_pairing(&self) {
        let task = self.pairing.lock().unwrap_or_else(|e| e.into_inner()).take();
        stop(task).await;
    }

    async fn stop_listening(&self) {
        let task = self.listening.lock().unwrap_or_else(|e| e.into_inner()).take();
        stop(task).await;
    }
}

async fn stop(task: Option<JoinHandle<()>>) {
    if let Some(task) = task {
        task.abort();
        let _ = task.await;
    }
}

/// Sets up sync with this system's key store.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("mnemax-sync")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let vault = Box::new(vault::KeystoreVault(_api.register_android_plugin("app.mnemax", "KeyVaultPlugin")?));
            #[cfg(target_os = "ios")]
            let vault = Box::new(vault::NoVault);
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            let vault = Box::new(vault::SystemVault);
            let dir = app.path().app_data_dir()?;
            app.manage(SyncState::new(&dir, vault));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_numbers_stay_below_the_limit() {
        assert!((0..1000).all(|_| random_below(7).unwrap() < 7));
    }
}
