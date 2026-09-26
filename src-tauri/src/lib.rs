use std::fs;
use std::path::Path;

use tauri::Manager;

/// Where earlier builds kept their data, newest first: as Mnemax under `com.mnemax.app` (renamed because
/// an ID ending in `.app` clashes with macOS app bundles), and before that as `com.givenback.app`, with
/// keys starting `dualnback.`.
const OLD_LOCATIONS: [(&str, &str); 2] = [("com.mnemax.app", "mnemax.json"), ("com.givenback.app", "dualnback.json")];

/// On the first start with this app ID, copies the newest earlier data file into the data dir with its
/// keys renamed to `mnemax.`, so rounds and settings carry over. Old files are left as they were.
fn migrate_from_old_name(new_data_dir: &Path) {
    let new_file = new_data_dir.join("mnemax.json");
    if new_file.exists() {
        return;
    }
    let Some(parent) = new_data_dir.parent() else { return };
    let Some(text) = OLD_LOCATIONS
        .iter()
        .find_map(|(dir, file)| fs::read_to_string(parent.join(dir).join(file)).ok())
    else {
        return;
    };
    let Ok(serde_json::Value::Object(old)) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let renamed: serde_json::Map<String, serde_json::Value> = old
        .into_iter()
        .map(|(key, value)| match key.strip_prefix("dualnback.") {
            Some(rest) => (format!("mnemax.{rest}"), value),
            None => (key, value),
        })
        .collect();
    let Ok(json) = serde_json::to_string(&serde_json::Value::Object(renamed)) else { return };
    if fs::create_dir_all(new_data_dir).is_ok() {
        let _ = fs::write(&new_file, json);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Runs before the page loads (and so before the store is first read).
        .setup(|app| {
            if let Ok(dir) = app.path().app_data_dir() {
                migrate_from_old_name(&dir);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_old_data_with_renamed_keys_once() {
        let root = std::env::temp_dir().join(format!("mnemax-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let old_dir = root.join("com.givenback.app");
        let new_dir = root.join("app.mnemax");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(
            old_dir.join("dualnback.json"),
            r#"{"dualnback.rounds.v1":"[1,2]","dualnback.settings.v1":"{}","other":"x"}"#,
        )
        .unwrap();

        migrate_from_old_name(&new_dir);
        let migrated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(new_dir.join("mnemax.json")).unwrap()).unwrap();
        assert_eq!(migrated["mnemax.rounds.v1"], "[1,2]");
        assert_eq!(migrated["mnemax.settings.v1"], "{}");
        assert_eq!(migrated["other"], "x");
        assert!(migrated.get("dualnback.rounds.v1").is_none());
        assert!(old_dir.join("dualnback.json").exists(), "the old file is kept");

        // A second start leaves Mnemax's own data alone.
        fs::write(new_dir.join("mnemax.json"), r#"{"mnemax.rounds.v1":"[]"}"#).unwrap();
        migrate_from_old_name(&new_dir);
        assert_eq!(fs::read_to_string(new_dir.join("mnemax.json")).unwrap(), r#"{"mnemax.rounds.v1":"[]"}"#);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prefers_the_newer_mnemax_data() {
        let root = std::env::temp_dir().join(format!("mnemax-migrate-newest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for (dir, file, body) in [
            ("com.givenback.app", "dualnback.json", r#"{"dualnback.rounds.v1":"old"}"#),
            ("com.mnemax.app", "mnemax.json", r#"{"mnemax.rounds.v1":"newer"}"#),
        ] {
            fs::create_dir_all(root.join(dir)).unwrap();
            fs::write(root.join(dir).join(file), body).unwrap();
        }
        let new_dir = root.join("app.mnemax");
        migrate_from_old_name(&new_dir);
        let migrated: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(new_dir.join("mnemax.json")).unwrap()).unwrap();
        assert_eq!(migrated["mnemax.rounds.v1"], "newer");
        let _ = fs::remove_dir_all(&root);
    }
}
