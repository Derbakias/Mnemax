use super::*;
use crate::sync::vault::TestVault;

const VAULT: &TestVault = &TestVault { key: 1 };
const PHONE: [u8; 32] = [7; 32];

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mnemax-sync-store-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn keeps_its_key_and_devices_between_starts() {
    let dir = temp_dir("reopen");
    let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
    let key = store.private_key();
    store.add_peer(&PHONE, "Phone", Some("192.168.1.20".into()), 1000).unwrap();
    store.synced(&PHONE, 2000).unwrap();

    let again = Store::open(&dir, "Other name", VAULT).unwrap();
    assert_eq!(again.private_key(), key);
    assert_eq!(again.name(), "Laptop");
    let peer = again.peer(&PHONE).unwrap();
    assert_eq!(peer.last_sync_at, Some(2000));
    assert_eq!(peer.address.as_deref(), Some("192.168.1.20"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn pairing_again_keeps_the_history_and_takes_the_new_address() {
    let dir = temp_dir("reconnect");
    let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
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
    let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
    store.add_peer(&PHONE, "Phone", None, 1000).unwrap();
    store.forget(&PHONE).unwrap();
    assert!(store.peer(&PHONE).is_none());
    assert!(Store::open(&dir, "Laptop", VAULT).unwrap().peers().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_failed_save_changes_nothing_and_a_retry_saves() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("failed-save");
    let mut store = Store::open(&dir, "Laptop", VAULT).unwrap();
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
    assert!(Store::open(&dir, "Laptop", VAULT).unwrap().peers().is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn never_writes_the_secret_key_unlocked() {
    let dir = temp_dir("sealed");
    let store = Store::open(&dir, "Laptop", VAULT).unwrap();
    let text = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(!text.contains(&hex_encode(&store.private_key())), "{text}");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn replaces_a_file_from_when_the_key_was_kept_unlocked() {
    let dir = temp_dir("clear-key");
    fs::create_dir_all(&dir).unwrap();
    let key = hex_encode(&[1; 32]);
    let old = format!(r#"{{"privateKey":"{key}","publicKey":"{key}","name":"Laptop","peers":[]}}"#);
    fs::write(dir.join(FILE), old).unwrap();
    let store = Store::open(&dir, "Other", VAULT).unwrap();
    assert_eq!(store.name(), "Other", "a new start");
    let everything: String =
        fs::read_dir(&dir).unwrap().map(|f| fs::read_to_string(f.unwrap().path()).unwrap_or_default()).collect();
    assert!(!everything.contains(&key), "the old key is gone from every file");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn starts_again_with_a_key_locked_on_another_device() {
    let dir = temp_dir("elsewhere");
    let first = Store::open(&dir, "Laptop", &TestVault { key: 2 }).unwrap().private_key();
    let store = Store::open(&dir, "Other", VAULT).unwrap();
    assert_ne!(store.private_key(), first);
    assert_eq!(store.name(), "Other");
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
    assert!(matches!(Store::open(&dir, "Laptop", &Locked), Err(Error::KeyStore(_))));
    assert!(!dir.join(FILE).exists(), "no file without a locked key");
    let key = Store::open(&dir, "Laptop", VAULT).unwrap().private_key();
    let before = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(matches!(Store::open(&dir, "Laptop", &Locked), Err(Error::KeyStore(_))));
    assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), before);
    assert_eq!(Store::open(&dir, "Laptop", VAULT).unwrap().private_key(), key);
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
    for bad in ["   ", &"x".repeat(41), "a\u{0}b", "line\nbreak"] {
        assert!(check_name(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn hex_round_trips() {
    assert_eq!(hex_decode(&hex_encode(&[0, 1, 254, 255])).unwrap(), vec![0, 1, 254, 255]);
    assert!(hex_decode("abc").is_none());
    assert!(hex_decode("zz").is_none());
}
