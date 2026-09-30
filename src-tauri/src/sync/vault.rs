//! Where this device's private sync key is kept: sealed in `sync.json`, and only the system's own key store
//! can open it. The key that seals it never leaves that store:
//!
//! - Android: an AES key in the Android Keystore (in the phone's secure hardware where it has one), which no
//!   app can read out and which isn't backed up or moved to a new phone.
//! - macOS, Windows and Linux: a random key in the Keychain, the Credential Manager or the Secret Service
//!   (GNOME Keyring, KWallet), which keeps it encrypted with the user's login.
//!
//! So a copy of `sync.json` anywhere else (a backup, another computer) can't be opened, and there's no
//! fallback that keeps the key in the clear: without the key store, sync doesn't start.

use std::fmt;

/// Why a sealed key can't be opened.
#[derive(Debug, PartialEq)]
pub enum VaultError {
    /// The key store can't be reached right now (locked, or not running): try again later, change nothing.
    Unavailable(String),
    /// The key that sealed it is gone, or it doesn't open with this device's: it never will.
    Lost,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::Unavailable(why) => write!(f, "the key store isn't available ({why})"),
            VaultError::Lost => f.write_str("the key that sealed it is gone"),
        }
    }
}

pub trait Vault: Send + Sync {
    /// Seals `secret` so that only this device's key store can open it.
    fn seal(&self, secret: &[u8]) -> Result<Vec<u8>, VaultError>;
    fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, VaultError>;
}

/// Mixed into every seal, so a sealed value can't be passed off as anything else.
const PURPOSE: &[u8] = b"mnemax sync private key v1";

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use desktop::SystemVault;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
    use zeroize::Zeroizing;

    use super::{Vault, VaultError, PURPOSE};
    use crate::sync::random_bytes;

    /// Under this name in the system's key store.
    const SERVICE: &str = "app.mnemax";
    const ACCOUNT: &str = "sync key";
    const NONCE_LEN: usize = 12;

    /// ChaCha20-Poly1305 with a key held by the system's key store.
    pub struct SystemVault;

    impl SystemVault {
        fn entry() -> Result<keyring::Entry, VaultError> {
            keyring::Entry::new(SERVICE, ACCOUNT).map_err(unavailable)
        }

        /// The key store's key; with `create`, a new one if there's none yet.
        fn key(create: bool) -> Result<Zeroizing<Vec<u8>>, VaultError> {
            let entry = Self::entry()?;
            match entry.get_secret() {
                Ok(key) if key.len() == 32 => Ok(Zeroizing::new(key)),
                Ok(_) if !create => Err(VaultError::Lost),
                Err(keyring::Error::NoEntry) if !create => Err(VaultError::Lost),
                Ok(_) | Err(keyring::Error::NoEntry) => {
                    let key = Zeroizing::new(random_bytes::<32>().map_err(unavailable)?.to_vec());
                    entry.set_secret(&key).map_err(unavailable)?;
                    Ok(key)
                }
                Err(e) => Err(unavailable(e)),
            }
        }
    }

    impl Vault for SystemVault {
        fn seal(&self, secret: &[u8]) -> Result<Vec<u8>, VaultError> {
            let key = Self::key(true)?;
            let nonce = random_bytes::<NONCE_LEN>().map_err(unavailable)?;
            let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
            let sealed = cipher
                .encrypt(Nonce::from_slice(&nonce), Payload { msg: secret, aad: PURPOSE })
                .map_err(|_| VaultError::Unavailable("couldn't encrypt".into()))?;
            Ok([&nonce[..], &sealed].concat())
        }

        fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
            if sealed.len() < NONCE_LEN {
                return Err(VaultError::Lost);
            }
            let key = Self::key(false)?;
            let (nonce, sealed) = sealed.split_at(NONCE_LEN);
            ChaCha20Poly1305::new(Key::from_slice(&key))
                .decrypt(Nonce::from_slice(nonce), Payload { msg: sealed, aad: PURPOSE })
                .map_err(|_| VaultError::Lost)
        }
    }

    fn unavailable(e: impl std::fmt::Display) -> VaultError {
        VaultError::Unavailable(e.to_string())
    }
}

#[cfg(target_os = "android")]
pub use android::KeystoreVault;

#[cfg(target_os = "android")]
mod android {
    use serde::{Deserialize, Serialize};
    use tauri::plugin::{mobile::PluginInvokeError, PluginHandle};

    use super::{Vault, VaultError, PURPOSE};
    use crate::sync::store::{hex_decode, hex_encode};

    /// AES-GCM with a key in the Android Keystore (see KeyVaultPlugin.kt).
    pub struct KeystoreVault(pub PluginHandle<tauri::Wry>);

    #[derive(Serialize)]
    struct Args {
        data: String,
        purpose: String,
    }

    #[derive(Deserialize)]
    struct Reply {
        data: String,
    }

    impl KeystoreVault {
        fn run(&self, command: &str, data: &[u8]) -> Result<Vec<u8>, VaultError> {
            let args = Args { data: hex_encode(data), purpose: hex_encode(PURPOSE) };
            match self.0.run_mobile_plugin::<Reply>(command, args) {
                Ok(reply) => hex_decode(&reply.data).ok_or(VaultError::Lost),
                Err(PluginInvokeError::InvokeRejected(e)) if e.code.as_deref() == Some("lost") => {
                    Err(VaultError::Lost)
                }
                Err(e) => Err(VaultError::Unavailable(e.to_string())),
            }
        }
    }

    impl Vault for KeystoreVault {
        fn seal(&self, secret: &[u8]) -> Result<Vec<u8>, VaultError> {
            self.run("seal", secret)
        }

        fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
            self.run("open", sealed)
        }
    }
}

/// No key store on iOS yet: sync doesn't start there.
#[cfg(target_os = "ios")]
pub struct NoVault;

#[cfg(target_os = "ios")]
impl Vault for NoVault {
    fn seal(&self, _secret: &[u8]) -> Result<Vec<u8>, VaultError> {
        Err(VaultError::Unavailable("not on iOS yet".into()))
    }

    fn open(&self, _sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
        Err(VaultError::Unavailable("not on iOS yet".into()))
    }
}

/// A vault for tests: the secret scrambled with a one-byte key, which goes in front so another key can tell
/// it isn't its own. Not a real seal.
#[cfg(test)]
pub struct TestVault {
    pub key: u8,
}

#[cfg(test)]
impl Vault for TestVault {
    fn seal(&self, secret: &[u8]) -> Result<Vec<u8>, VaultError> {
        Ok(std::iter::once(self.key).chain(secret.iter().map(|b| b ^ 0x5a ^ self.key)).collect())
    }

    fn open(&self, sealed: &[u8]) -> Result<Vec<u8>, VaultError> {
        match sealed.split_first() {
            Some((&key, secret)) if key == self.key => Ok(secret.iter().map(|b| b ^ 0x5a ^ self.key).collect()),
            _ => Err(VaultError::Lost),
        }
    }
}

#[cfg(all(test, not(any(target_os = "android", target_os = "ios"))))]
mod tests {
    use super::*;

    // Uses this computer's real key store (it may ask to unlock it): run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn seals_with_the_system_key_store() {
        let vault = SystemVault;
        let secret = [42u8; 32];
        let sealed = vault.seal(&secret).unwrap();
        assert!(!sealed.windows(32).any(|w| w == secret), "the key isn't in the sealed value");
        assert_eq!(vault.open(&sealed).unwrap(), secret);
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(vault.open(&tampered), Err(VaultError::Lost));
    }
}
