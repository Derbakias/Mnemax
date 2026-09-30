//! Local sync: rounds pass between one person's own devices on the same network.
//!
//! - A device only syncs with devices it was paired with (see `pair`): pairing takes a one-time code shown on
//!   one device and typed on the other, and a yes on both.
//! - Nothing listens unless the Sync page is open: pairing waits at most 2 minutes, syncing 10.
//! - Connections are plain TCP with a binary opening, not HTTP, so a web page in a browser can't reach them.
//!   Connections from outside the local network are dropped.
//! - Everything after the handshake is encrypted and authenticated. Messages have size limits, and parsing
//!   is strict.
//! - Syncing only ever adds rounds (see `exchange`). It never touches settings or files, and the page checks
//!   every round that comes in before saving it.
//! - The private key never leaves Rust: the page gets names and public keys only.

mod discovery;
mod exchange;
mod pair;
mod store;
mod wire;

use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use pair::{Me, PairCode};
use store::{hex_decode, Peer, Store};
use wire::Purpose;

pub const PAIR_PARAMS: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";
pub const SYNC_PARAMS: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
/// How long the Sync page listens for paired devices before it stops on its own.
const LISTEN_TIME: Duration = Duration::from_secs(10 * 60);
/// How long a new connection has to say what it's for.
const OPENING_TIME: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    TimedOut,
    /// The other side broke the protocol; the text is for logs.
    Protocol(&'static str),
    /// Keys or code didn't check out.
    Handshake,
    WrongCode,
    CodeExpired,
    BadCode,
    Declined,
    /// A device this one isn't paired with tried to sync.
    NotPaired,
    /// The device this one tried to sync with hung up during the handshake: it isn't paired with this one.
    Refused,
    NotFound,
    Network,
    BadName,
    UnknownPeer,
    Storage(String),
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Error::Io(_) => "The connection to the other device broke.",
            Error::TimedOut => "The other device took too long to answer.",
            Error::Protocol(_) | Error::Handshake => "The other device sent something unexpected.",
            Error::WrongCode => "That code didn't match. Start pairing again to get a new code.",
            Error::CodeExpired => "The code ran out. Start pairing again to get a new code.",
            Error::BadCode => "A pairing code has 8 digits.",
            Error::Declined => "Pairing was cancelled on one of the devices.",
            Error::NotPaired => "A device that isn't paired with this one tried to sync. Pair them first.",
            Error::Refused => "The other device didn't accept this one. Pair them again.",
            Error::NotFound => {
                "Couldn't find the other device. Check that both are on the same Wi-Fi, with the Sync page open."
            }
            Error::Network => "Couldn't use the network.",
            Error::BadName => "A device name has 1 to 40 characters.",
            Error::UnknownPeer => "That device isn't paired with this one.",
            Error::Storage(_) => "Couldn't save the sync settings.",
        })
    }
}

/// Addresses on the local network (and this machine): the only ones a listener answers.
pub fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_local(IpAddr::V4(v4)),
            None => {
                let first = v6.segments()[0];
                v6.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
            }
        },
    }
}

pub fn random_bytes<const N: usize>() -> Result<[u8; N], Error> {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).map_err(|_| Error::Network)?;
    Ok(bytes)
}

/// A uniform random number below `n`.
pub fn random_below(n: u32) -> Result<u32, Error> {
    // Numbers from the last, incomplete run of `n` would come up more often, so they're drawn again.
    let limit = u32::MAX - u32::MAX % n;
    loop {
        let x = u32::from_be_bytes(random_bytes()?);
        if x < limit {
            return Ok(x % n);
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PairEvent {
    /// Both devices show this: the other's name and the check number, for a yes or no.
    Check { name: String, check: String },
    Paired { peer: Peer },
    Failed { message: String },
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ListenEvent {
    /// A paired device synced: the rounds it sent, for the page to check and save.
    Synced { peer: Peer, rounds: Vec<Value> },
    Failed { message: String },
    /// Stopped listening after `LISTEN_TIME`.
    Stopped,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    name: String,
    peers: Vec<Peer>,
}

struct Pairing {
    task: JoinHandle<()>,
    answer: Option<oneshot::Sender<bool>>,
}

pub struct SyncState {
    store: Mutex<Result<Store, String>>,
    /// The rounds a device that syncs with this one gets: set by the page while it listens.
    rounds: Arc<Mutex<Vec<Value>>>,
    pairing: Mutex<Option<Pairing>>,
    listening: Mutex<Option<JoinHandle<()>>>,
}

impl SyncState {
    pub fn open(dir: &Path) -> Self {
        let store = Store::open(dir, store::default_device_name()).map_err(|e| format!("{e:?}"));
        if let Err(e) = &store {
            eprintln!("sync: can't open the sync settings: {e}");
        }
        Self {
            store: Mutex::new(store),
            rounds: Arc::default(),
            pairing: Mutex::default(),
            listening: Mutex::default(),
        }
    }

    fn with_store<T>(&self, f: impl FnOnce(&mut Store) -> Result<T, Error>) -> Result<T, Error> {
        let mut guard = self.store.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Ok(store) => f(store),
            Err(e) => Err(Error::Storage(e.clone())),
        }
    }

    fn status(&self) -> Result<Status, Error> {
        self.with_store(|s| Ok(Status { name: s.name().to_string(), peers: s.peers().to_vec() }))
    }

    fn me(&self) -> Result<(Vec<u8>, Vec<u8>, String), Error> {
        self.with_store(|s| Ok((s.private_key(), s.public_key(), s.name().to_string())))
    }

    fn stop_pairing(&self) {
        if let Some(pairing) = self.pairing.lock().unwrap_or_else(|e| e.into_inner()).take() {
            pairing.task.abort();
        }
    }

    fn stop_listening(&self) {
        if let Some(task) = self.listening.lock().unwrap_or_else(|e| e.into_inner()).take() {
            task.abort();
        }
    }
}

type CommandResult<T> = Result<T, String>;

/// The message for the page; the details behind the vaguer ones go to the log.
fn text(e: Error) -> String {
    match &e {
        Error::Io(detail) => eprintln!("sync: connection: {detail}"),
        Error::Protocol(detail) => eprintln!("sync: protocol: {detail}"),
        Error::Storage(detail) => eprintln!("sync: storage: {detail}"),
        _ => {}
    }
    e.to_string()
}

#[tauri::command]
pub fn sync_status(state: State<'_, SyncState>) -> CommandResult<Status> {
    state.status().map_err(text)
}

#[tauri::command]
pub fn sync_rename(state: State<'_, SyncState>, name: String) -> CommandResult<Status> {
    state.with_store(|s| s.set_name(&name)).map_err(text)?;
    state.status().map_err(text)
}

#[tauri::command]
pub fn sync_forget(state: State<'_, SyncState>, key: String) -> CommandResult<Status> {
    state.with_store(|s| s.forget(&key)).map_err(text)?;
    state.status().map_err(text)
}

/// Starts waiting for the other device, and returns the code to type on it.
#[tauri::command]
pub async fn pair_start(app: AppHandle, on_event: Channel<PairEvent>) -> CommandResult<String> {
    let state = app.state::<SyncState>();
    state.stop_pairing();
    let (private_key, _, name) = state.me().map_err(text)?;
    let code = PairCode::random().map_err(text)?;
    let listener = TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| text(e.into()))?;
    let port = listener.local_addr().map_err(|e| text(e.into()))?.port();
    let multicast = multicast::hold(&app);
    let announcement = discovery::announce_pairing(port, code.nameplate).map_err(text)?;
    let (answer, answered) = oneshot::channel();
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _keep = (announcement, multicast);
        let events = on_event.clone();
        let result = pair::host(
            &listener,
            code,
            Me { private_key: &private_key, name: &name },
            |name, check| {
                let _ = events.send(PairEvent::Check { name: name.into(), check: check.into() });
            },
            answered,
        )
        .await;
        finish_pairing(&task_app, result, &on_event);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pairing { task, answer: Some(answer) });
    Ok(code.to_string())
}

/// Finds the device showing `code` and pairs with it. Progress comes through `on_event`.
#[tauri::command]
pub fn pair_join(app: AppHandle, code: String, on_event: Channel<PairEvent>) -> CommandResult<()> {
    let state = app.state::<SyncState>();
    state.stop_pairing();
    let code = PairCode::parse(&code).ok_or_else(|| text(Error::BadCode))?;
    let (private_key, _, name) = state.me().map_err(text)?;
    let (answer, answered) = oneshot::channel();
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let events = on_event.clone();
        let result = async {
            let addrs = {
                let _multicast = multicast::hold(&task_app);
                discovery::find_pairing(code.nameplate).await?
            };
            pair::join(
                &addrs,
                code,
                Me { private_key: &private_key, name: &name },
                |name, check| {
                    let _ = events.send(PairEvent::Check { name: name.into(), check: check.into() });
                },
                answered,
            )
            .await
        }
        .await;
        finish_pairing(&task_app, result, &on_event);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pairing { task, answer: Some(answer) });
    Ok(())
}

fn finish_pairing(app: &AppHandle, result: Result<pair::Paired, Error>, events: &Channel<PairEvent>) {
    let state = app.state::<SyncState>();
    let event = match result.and_then(|p| state.with_store(|s| s.add_peer(&p.key, &p.name, now_ms()))) {
        Ok(peer) => PairEvent::Paired { peer },
        Err(e) => PairEvent::Failed { message: text(e) },
    };
    let _ = events.send(event);
}

/// This person's yes or no to the device and check number on screen.
#[tauri::command]
pub fn pair_answer(state: State<'_, SyncState>, accept: bool) {
    let mut pairing = state.pairing.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(answer) = pairing.as_mut().and_then(|p| p.answer.take()) {
        let _ = answer.send(accept);
    }
}

#[tauri::command]
pub fn pair_cancel(state: State<'_, SyncState>) {
    state.stop_pairing();
}

/// Waits for paired devices to sync, handing them `rounds`, until `sync_stop` or `LISTEN_TIME`.
#[tauri::command]
pub async fn sync_listen(app: AppHandle, rounds: Vec<Value>, on_event: Channel<ListenEvent>) -> CommandResult<()> {
    let state = app.state::<SyncState>();
    state.stop_listening();
    *state.rounds.lock().unwrap_or_else(|e| e.into_inner()) = rounds;
    let (private_key, public_key, _) = state.me().map_err(text)?;
    let listener = TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| text(e.into()))?;
    let port = listener.local_addr().map_err(|e| text(e.into()))?.port();
    let multicast = multicast::hold(&app);
    let announcement = discovery::announce_sync(port, &public_key).map_err(text)?;
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _keep = (announcement, multicast);
        let state = task_app.state::<SyncState>();
        let stop = tokio::time::sleep(LISTEN_TIME);
        tokio::pin!(stop);
        loop {
            let accepted = tokio::select! {
                _ = &mut stop => {
                    let _ = on_event.send(ListenEvent::Stopped);
                    return;
                }
                accepted = listener.accept() => accepted,
            };
            let Ok((mut stream, addr)) = accepted else { continue };
            if !is_local(addr.ip()) {
                continue;
            }
            // One device at a time: the next waits until this one is done.
            match tokio::time::timeout(OPENING_TIME, wire::read_opening(&mut stream)).await {
                Ok(Ok(Purpose::Sync)) => {}
                _ => continue,
            }
            let is_paired = |key: &[u8]| state.with_store(|s| Ok(s.peer(key).is_some())).unwrap_or(false);
            let rounds = || state.rounds.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let event = match exchange::answer(stream, &private_key, is_paired, rounds).await {
                Ok((key, rounds)) => {
                    let _ = state.with_store(|s| s.synced(&key, now_ms()));
                    match state.with_store(|s| Ok(s.peer(&key).cloned())) {
                        Ok(Some(peer)) => ListenEvent::Synced { peer, rounds },
                        _ => continue,
                    }
                }
                Err(e) => ListenEvent::Failed { message: text(e) },
            };
            let _ = on_event.send(event);
        }
    });
    *state.listening.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
    Ok(())
}

/// The rounds to hand out from now on (after the page saved new ones).
#[tauri::command]
pub fn sync_rounds(state: State<'_, SyncState>, rounds: Vec<Value>) {
    *state.rounds.lock().unwrap_or_else(|e| e.into_inner()) = rounds;
}

#[tauri::command]
pub fn sync_stop(state: State<'_, SyncState>) {
    state.stop_listening();
}

/// Syncs with the paired device `key` (hex), which must be listening. Returns the rounds it sent.
#[tauri::command]
pub async fn sync_now(app: AppHandle, key: String, rounds: Vec<Value>) -> CommandResult<Vec<Value>> {
    let state = app.state::<SyncState>();
    let peer_key = hex_decode(&key).ok_or_else(|| text(Error::UnknownPeer))?;
    if !state.with_store(|s| Ok(s.peer(&peer_key).is_some())).map_err(text)? {
        return Err(text(Error::UnknownPeer));
    }
    let (private_key, _, _) = state.me().map_err(text)?;
    let addrs = {
        let _multicast = multicast::hold(&app);
        discovery::find_peer(&peer_key).await.map_err(text)?
    };
    let received = exchange::connect(&addrs, &private_key, &peer_key, &rounds).await.map_err(text)?;
    state.with_store(|s| s.synced(&peer_key, now_ms())).map_err(text)?;
    Ok(received)
}

/// Android drops the multicast packets mDNS uses unless an app holds a multicast lock, so sync holds one
/// while it announces or looks for a device (see MulticastPlugin.kt). Elsewhere this does nothing.
mod multicast {
    use tauri::AppHandle;

    pub struct Hold {
        #[cfg(target_os = "android")]
        handle: Option<tauri::plugin::PluginHandle<tauri::Wry>>,
    }

    #[cfg(target_os = "android")]
    pub struct Handle(pub tauri::plugin::PluginHandle<tauri::Wry>);

    #[cfg(target_os = "android")]
    pub fn hold(app: &AppHandle) -> Hold {
        use tauri::Manager;
        let handle = app.try_state::<Handle>().map(|h| h.0.clone());
        if let Some(h) = &handle {
            if let Err(e) = h.run_mobile_plugin::<()>("acquire", ()) {
                eprintln!("sync: no multicast lock: {e}");
            }
        }
        Hold { handle }
    }

    #[cfg(not(target_os = "android"))]
    pub fn hold(_app: &AppHandle) -> Hold {
        Hold {}
    }

    #[cfg(target_os = "android")]
    impl Drop for Hold {
        fn drop(&mut self) {
            if let Some(h) = &self.handle {
                let _ = h.run_mobile_plugin::<()>("release", ());
            }
        }
    }
}

/// Sets up sync: its state, and on Android the multicast lock.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("mnemax-sync")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(multicast::Handle(_api.register_android_plugin("app.mnemax", "MulticastPlugin")?));
            let dir = app.path().app_data_dir()?;
            app.manage(SyncState::open(&dir));
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_addresses_count_as_local() {
        for ip in ["192.168.1.20", "10.0.0.5", "172.16.3.4", "169.254.1.1", "127.0.0.1", "::1", "fe80::1", "fd00::1"] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "100.64.0.1", "2001:db8::1", "::ffff:8.8.8.8"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
        assert!(is_local("::ffff:192.168.1.2".parse().unwrap()));
    }

    // The whole flow over the real network, as two devices would run it: find and pair, then find and sync.
    // Needs a network interface with multicast: run with `cargo test -- --ignored`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn two_devices_pair_then_sync_over_the_network() {
        let keys = || snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap();
        let (desktop, phone) = (keys(), keys());
        let answer = || {
            let (tx, rx) = oneshot::channel();
            tx.send(true).unwrap();
            rx
        };

        // Pairing: the desktop shows a code, the phone finds it by the nameplate.
        let code = PairCode::random().unwrap();
        let listener = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let _shown = discovery::announce_pairing(listener.local_addr().unwrap().port(), code.nameplate).unwrap();
        let me = Me { private_key: &desktop.private, name: "Desktop" };
        let hosting = pair::host(&listener, code, me, |_, _| {}, answer());
        let joining = async {
            let addrs = discovery::find_pairing(code.nameplate).await.unwrap();
            pair::join(&addrs, code, Me { private_key: &phone.private, name: "Phone" }, |_, _| {}, answer()).await
        };
        let (hosted, joined) = tokio::join!(hosting, joining);
        let (phone_seen, desktop_seen) = (hosted.unwrap(), joined.unwrap());
        assert_eq!(phone_seen.key, phone.public);
        assert_eq!(desktop_seen.key, desktop.public);

        // Syncing: the desktop listens, the phone finds it by its key.
        let listener = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let _listening = discovery::announce_sync(listener.local_addr().unwrap().port(), &desktop.public).unwrap();
        let answering = async {
            let (mut stream, addr) = listener.accept().await.unwrap();
            assert!(is_local(addr.ip()));
            assert_eq!(wire::read_opening(&mut stream).await.unwrap(), Purpose::Sync);
            let desktop_rounds = vec![serde_json::json!({ "id": "round-1" })];
            exchange::answer(stream, &desktop.private, |k| k == phone_seen.key.as_slice(), || desktop_rounds).await
        };
        let connecting = async {
            let addrs = discovery::find_peer(&desktop_seen.key).await.unwrap();
            let phone_rounds = [serde_json::json!({ "id": "round-2" })];
            exchange::connect(&addrs, &phone.private, &desktop_seen.key, &phone_rounds).await
        };
        let (answered, connected) = tokio::join!(answering, connecting);
        assert_eq!(answered.unwrap().1, vec![serde_json::json!({ "id": "round-2" })]);
        assert_eq!(connected.unwrap(), vec![serde_json::json!({ "id": "round-1" })]);
    }

    #[test]
    fn random_numbers_stay_below_the_limit() {
        assert!((0..1000).all(|_| random_below(7).unwrap() < 7));
    }
}
