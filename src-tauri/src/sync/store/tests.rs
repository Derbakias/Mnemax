use super::*;
use crate::sync::vault::TestVault;

const VAULT: &TestVault = &TestVault { key: 1 };
const PHONE: [u8; 32] = [7; 32];

/// Opens the store and unlocks its key, as pairing does.
fn unlocked(dir: &Path, name: &str, vault: &dyn Vault) -> (Store, Zeroizing<Vec<u8>>) {
    let mut store = Store::open(dir, name).unwrap();
    let key = store.unlock(vault).unwrap();
    (store, key)
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mnemax-sync-store-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn keeps_its_key_and_devices_between_starts() {
    let dir = temp_dir("reopen");
    let (mut store, key) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", Some("192.168.1.20".into()), 1000).unwrap();
    store.synced(&PHONE, 2000).unwrap();

    let (again, same_key) = unlocked(&dir, "Other name", VAULT);
    assert_eq!(same_key, key);
    assert_eq!(again.name(), "Laptop");
    let peer = again.peer(&PHONE).unwrap();
    assert_eq!(peer.last_sync_at, Some(2000));
    assert_eq!(peer.address.as_deref(), Some("192.168.1.20"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pairing_again_keeps_the_history_and_takes_the_new_address() {
    let dir = temp_dir("reconnect");
    let (mut store, _) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", Some("192.168.1.20".into()), 1000).unwrap();
    store.synced(&PHONE, 2000).unwrap();
    let peer = store.add_peer(&PHONE, "Phone 2", Some("192.168.1.31".into()), 4000).unwrap();
    assert_eq!((peer.paired_at, peer.last_sync_at), (1000, Some(2000)));
    assert_eq!((peer.name.as_str(), peer.address.as_deref()), ("Phone 2", Some("192.168.1.31")));
    assert_eq!(store.peers().len(), 1);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn forgets_a_device_for_good() {
    let dir = temp_dir("forget");
    let (mut store, _) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    store.forget(&PHONE).unwrap();
    assert!(store.peer(&PHONE).is_none());
    assert!(Store::open(&dir, "Laptop").unwrap().peers().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_failed_save_changes_nothing_and_a_retry_saves() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("failed-save");
    let (mut store, _) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    // A folder that can't be written to: the save fails.
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = store.forget(&PHONE);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    if failed.is_ok() {
        return; // Running as root: permissions don't stop the save, so there's nothing to check.
    }
    assert!(store.peer(&PHONE).is_some(), "memory still matches the file");
    store.forget(&PHONE).unwrap();
    assert!(Store::open(&dir, "Laptop").unwrap().peers().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_file_it_cant_read_is_left_alone() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("unreadable");
    let (mut store, _) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    let before = fs::read_to_string(dir.join(FILE)).unwrap();
    fs::set_permissions(dir.join(FILE), fs::Permissions::from_mode(0o000)).unwrap();
    let opened = Store::open(&dir, "Laptop");
    fs::set_permissions(dir.join(FILE), fs::Permissions::from_mode(0o600)).unwrap();
    if opened.is_ok() {
        return; // Running as root: permissions don't stop the read, so there's nothing to check.
    }
    assert!(matches!(opened, Err(Error::Storage(_))));
    assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), before, "the paired devices are still there");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn shows_the_devices_without_asking_the_key_store() {
    let dir = temp_dir("no-key-store");
    let (mut store, _) = unlocked(&dir, "Laptop", VAULT);
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    // Opening, renaming and forgetting never take a vault: only `unlock` does.
    let mut store = Store::open(&dir, "Other").unwrap();
    assert_eq!(store.name(), "Laptop");
    store.set_name("Desk").unwrap();
    store.forget(&PHONE).unwrap();
    // Without a file yet, nothing is written just by looking.
    let empty = temp_dir("no-key-store-empty");
    assert_eq!(Store::open(&empty, "Laptop").unwrap().name(), "Laptop");
    assert!(!empty.join(FILE).exists());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn never_writes_the_secret_key_unlocked() {
    let dir = temp_dir("sealed");
    let (_, key) = unlocked(&dir, "Laptop", VAULT);
    let text = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(!text.contains(&hex_encode(&key)), "{text}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn replaces_a_file_from_when_the_key_was_kept_unlocked() {
    let dir = temp_dir("clear-key");
    fs::create_dir_all(&dir).unwrap();
    let key = hex_encode(&[1; 32]);
    let old = format!(r#"{{"privateKey":"{key}","publicKey":"{key}","name":"Laptop","peers":[]}}"#);
    fs::write(dir.join(FILE), old).unwrap();
    let (_, new_key) = unlocked(&dir, "Other", VAULT);
    assert_ne!(hex_encode(&new_key), key, "a new key");
    let everything: String =
        fs::read_dir(&dir).unwrap().map(|f| fs::read_to_string(f.unwrap().path()).unwrap_or_default()).collect();
    assert!(!everything.contains(&key), "the old key is gone from every file");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn starts_again_with_a_key_locked_on_another_device_and_keeps_a_copy() {
    let dir = temp_dir("elsewhere");
    let (mut store, first) = unlocked(&dir, "Laptop", &TestVault { key: 2 });
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    let before = fs::read_to_string(dir.join(FILE)).unwrap();
    let (store, key) = unlocked(&dir, "Other", VAULT);
    assert_ne!(key, first);
    assert!(store.peers().is_empty(), "devices paired with the old key have to pair again");
    assert_eq!(fs::read_to_string(dir.join("sync.json.lost")).unwrap(), before);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn changes_nothing_while_the_key_store_is_locked() {
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
    let mut store = Store::open(&dir, "Laptop").unwrap();
    assert!(matches!(store.unlock(&Locked), Err(Error::KeyStore(_))));
    assert!(!dir.join(FILE).exists(), "no file without a locked key");
    let (_, key) = unlocked(&dir, "Laptop", VAULT);
    let before = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(matches!(Store::open(&dir, "Laptop").unwrap().unlock(&Locked), Err(Error::KeyStore(_))));
    assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), before);
    assert_eq!(unlocked(&dir, "Laptop", VAULT).1, key);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn sets_a_broken_file_aside_and_starts_again() {
    let dir = temp_dir("broken");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "{not json").unwrap();
    assert_eq!(unlocked(&dir, "Laptop", VAULT).1.len(), 32);
    assert_eq!(fs::read_to_string(dir.join("sync.json.broken")).unwrap(), "{not json");
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn only_this_user_can_read_the_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("mode");
    unlocked(&dir, "Laptop", VAULT);
    assert_eq!(fs::metadata(dir.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn checks_names() {
    assert_eq!(check_name("  Tom's phone ").unwrap(), "Tom's phone");
    assert_eq!(check_name("Tom's 📱").unwrap(), "Tom's 📱");
    for bad in ["   ", &"x".repeat(41), "a\u{0}b", "line\nbreak", "Lap\u{200b}top", "evil\u{202e}txt.exe", "\u{2066}x"]
    {
        assert!(check_name(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn hex_round_trips() {
    assert_eq!(hex_decode(&hex_encode(&[0, 1, 254, 255])).unwrap(), vec![0, 1, 254, 255]);
    assert!(hex_decode("abc").is_none());
    assert!(hex_decode("zz").is_none());
}
