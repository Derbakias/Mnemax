//! Local sync: rounds pass between one person's own devices on the same network.
//!
//! - A device only syncs with devices it was paired with (see `pair`): pairing takes a one-time code shown on
//!   one device and typed on the other, and a yes on both.
//! - Nothing listens unless the app is open with a paired device (or showing a pairing code, 30 seconds at
//!   most); on a phone, only while the app is on screen. The page decides (see src/sync-context.tsx).
//! - Connections are plain TCP with a binary opening, not HTTP, so a web page in a browser can't reach them.
//!   Connections from outside the local network are dropped.
//! - Everything after the handshake is encrypted and authenticated. Messages have size limits, and parsing
//!   is strict.
//! - Syncing only ever adds rounds (see `exchange`). It never touches settings or files, and the page checks
//!   every round that comes in before saving it.
//! - The private key never leaves Rust: the page gets names and public keys only. On disk it's only ever
//!   sealed by the system's key store (see `vault`), and the file is left out of Android's backups.

mod attack;
mod discovery;
mod exchange;
mod pair;
mod store;
mod trace;
mod vault;
mod wire;

use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;

use pair::{Me, PairCode};
use exchange::{Answered, Asked, Want};
use store::{hex_decode, Peer, Standing, Store};
use trace::Trace;
use wire::Purpose;

pub const PAIR_PARAMS: &str = "Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s";
pub const SYNC_PARAMS: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
/// How long the listener waits after failing to take a connection, before it tries again.
const LISTEN_RETRY_TIME: Duration = Duration::from_millis(500);
/// How long a device that couldn't connect waits for the other to connect to it instead.
const REVERSE_TIME: Duration = Duration::from_secs(10);

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
    /// The device this one tried to sync with ended the handshake: another device answered, or an older
    /// version of the app.
    Refused,
    /// The device this one tried to reach said it doesn't have this one as paired.
    UnknownThere,
    /// The other device has this protocol version, not this one's.
    OtherVersion(u8),
    NotFound,
    /// Found, but neither device could connect to the other.
    Unreachable,
    Network,
    BadName,
    UnknownPeer,
    Storage(String),
    /// The system's key store, which holds the key to the private key, can't be reached.
    KeyStore(String),
}

impl Error {
    /// Which error it is, for the page.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::TimedOut => "timedOut",
            Error::Protocol(_) => "protocol",
            Error::Handshake => "handshake",
            Error::WrongCode => "wrongCode",
            Error::CodeExpired => "codeExpired",
            Error::BadCode => "badCode",
            Error::Declined => "declined",
            Error::NotPaired => "notPaired",
            Error::Refused => "refused",
            Error::UnknownThere => "unknownThere",
            Error::OtherVersion(_) => "otherVersion",
            Error::NotFound => "notFound",
            Error::Unreachable => "unreachable",
            Error::Network => "network",
            Error::BadName => "badName",
            Error::UnknownPeer => "unknownPeer",
            Error::Storage(_) => "storage",
            Error::KeyStore(_) => "keyStore",
        }
    }

    /// What went wrong underneath, for the log.
    pub fn detail(&self) -> String {
        match self {
            Error::Io(e) => e.to_string(),
            Error::Protocol(what) => (*what).to_string(),
            Error::Storage(what) | Error::KeyStore(what) => what.clone(),
            e => e.to_string(),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Error::OtherVersion(theirs) = self {
            let which = if *theirs < wire::PROTOCOL { "an older" } else { "a newer" };
            return write!(
                f,
                "The other device has {which} version of Mnemax's sync ({theirs}; this device has {}). Update the \
                 app on both devices.",
                wire::PROTOCOL
            );
        }
        f.write_str(match self {
            Error::OtherVersion(_) => unreachable!("written above"),
            Error::Io(_) => "The connection to the other device broke.",
            Error::TimedOut => "The other device took too long to answer.",
            Error::Protocol(_) | Error::Handshake => "The other device sent something unexpected.",
            Error::WrongCode => "That code didn't match. Start pairing again to get a new code.",
            Error::CodeExpired => "The code ran out. Make a new one.",
            Error::BadCode => "A pairing code has 6 digits.",
            Error::Declined => "Pairing was cancelled on one of the devices.",
            Error::NotPaired => "A device that isn't paired with this one tried to sync. Pair them first.",
            Error::Refused => {
                "The other device didn't accept this one. Check both have the latest version, or pair them again."
            }
            Error::UnknownThere => "The other device no longer has this one as paired. Pair them again to sync.",
            Error::NotFound => {
                "Couldn't find the other device. Open Mnemax on it, on the same Wi-Fi."
            }
            Error::Unreachable => {
                "Found the other device, but couldn't connect to it. If both are computers, one of them needs to \
                 let Mnemax through its firewall."
            }
            Error::Network => "Couldn't use the network.",
            Error::BadName => "A device name has 1 to 40 characters.",
            Error::UnknownPeer => "That device isn't paired with this one.",
            Error::Storage(_) => "Couldn't save the sync settings.",
            Error::KeyStore(_) => {
                "Couldn't reach this device's key store (the keyring or keychain), which keeps sync's key safe. If \
                 it's locked, unlock it and try again."
            }
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
    /// No device tried the code in time: it no longer works.
    Expired,
    Failed { message: String },
    /// What the pairing is doing, for the Details view.
    Step { text: String },
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ListenEvent {
    /// A paired device synced: the rounds it sent, for the page to check and save.
    Synced { peer: Peer, rounds: Vec<Value> },
    Failed { message: String },
    /// A paired device unpaired this one, so it's gone here too.
    Unpaired { name: String },
    /// What the listener is doing, for the Details view.
    Step { text: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `API_VERSION`, for the page to check it matches.
    api: u32,
    name: String,
    peers: Vec<Peer>,
}

/// What the sync commands take and give. Raise it with every change to them (and `SYNC_API` in src/sync.ts):
/// in development the page reloads on its own but this side only when the app is rebuilt, and a page talking
/// to older commands misreads their answers.
const API_VERSION: u32 = 3;

struct Pairing {
    task: JoinHandle<()>,
    answer: Option<oneshot::Sender<bool>>,
}

pub struct SyncState {
    dir: PathBuf,
    vault: Box<dyn vault::Vault>,
    /// Opened on first use (the key store may ask to be unlocked); tried again after a failure.
    store: Mutex<Option<Store>>,
    /// The rounds a device that syncs with this one gets: set by the page while it listens.
    rounds: Arc<Mutex<Vec<Value>>>,
    pairing: Mutex<Option<Pairing>>,
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

    fn status(&self) -> Result<Status, Error> {
        self.with_store(|s| Ok(Status { api: API_VERSION, name: s.name().to_string(), peers: s.peers().to_vec() }))
    }

    /// This device's private key, public key and name.
    fn me(&self) -> Result<(PrivateKey, Vec<u8>, String), Error> {
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

/// A failed command as the page gets it: the message to show, and a code for what to offer next (say, to
/// forget a device that no longer knows this one).
#[derive(Debug, Serialize)]
pub struct Failure {
    code: &'static str,
    message: String,
}

type CommandResult<T> = Result<T, Failure>;
/// Wiped from memory when dropped.
type PrivateKey = zeroize::Zeroizing<Vec<u8>>;

/// The failure for the page; the details behind the vaguer ones go to the log.
fn text(e: Error) -> Failure {
    match &e {
        Error::Io(detail) => eprintln!("sync: connection: {detail}"),
        Error::Protocol(detail) => eprintln!("sync: protocol: {detail}"),
        Error::Storage(detail) => eprintln!("sync: storage: {detail}"),
        Error::KeyStore(detail) => eprintln!("sync: key store: {detail}"),
        _ => {}
    }
    Failure { code: e.code(), message: e.to_string() }
}

/// Async so it runs off the main thread: the first call opens the store, and the key store may ask to be
/// unlocked.
#[tauri::command]
pub async fn sync_status(state: State<'_, SyncState>) -> CommandResult<Status> {
    state.status().map_err(text)
}

#[tauri::command]
pub fn sync_rename(state: State<'_, SyncState>, name: String) -> CommandResult<Status> {
    state.with_store(|s| s.set_name(&name)).map_err(text)?;
    state.status().map_err(text)
}

/// How forgetting went, when both devices now have each other unpaired.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Forgot {
    /// The other device removed this one, then this one removed it.
    Both,
    /// The other device no longer knew this one (it forgot it earlier, or lost its sync settings).
    AlreadyGone,
}

/// Forgets the device `key` (hex) on both sides: first has it remove this device, then removes it here. If it
/// can't be reached, nothing changes and this fails (see `sync_forget_here` for a device that's gone for
/// good). `on_step` hears what it's doing, for the Details view.
#[tauri::command]
pub async fn sync_forget(app: AppHandle, key: String, on_step: Channel<String>) -> CommandResult<Forgot> {
    let trace = Trace::new(move |text| {
        let _ = on_step.send(text);
    });
    let state = app.state::<SyncState>();
    let peer_key = hex_decode(&key).ok_or_else(|| fail(&trace, Error::UnknownPeer))?;
    let peer = state.with_store(|s| Ok(s.peer(&peer_key).cloned())).map_err(|e| fail(&trace, e))?;
    let peer = peer.ok_or_else(|| fail(&trace, Error::UnknownPeer))?;
    let (private_key, _, name) = state.me().map_err(|e| fail(&trace, e))?;
    let what = format!("Forgetting {:?}: first it removes this device, then this one removes it.", peer.name);
    begin(&trace, &name, &what);
    let asked = async {
        let stream = {
            let _multicast = multicast::hold(&app, &trace);
            let found = discovery::find_peer(&peer_key, &trace).await;
            let request = |port| discovery::announce_request(port, &peer_key);
            reach(found, Purpose::Sync, request, &trace).await?
        };
        exchange::initiate(stream, &private_key, &peer_key, &name, Want::Unpair, &[], &trace).await
    }
    .await;
    let forgot = match forgotten_there(asked) {
        Ok(forgot) => forgot,
        Err(e) => {
            trace.step(format!("{:?} didn't remove this device: it stays paired on both.", peer.name));
            return Err(fail(&trace, e));
        }
    };
    state.with_store(|s| s.unpaired_by(&peer_key)).map_err(|e| fail(&trace, e))?;
    trace.step(format!("Removed {:?} here.", peer.name));
    Ok(forgot)
}

/// Keeps the name the other device goes by now; its key stays what identifies it.
fn note_name(state: &SyncState, key: &[u8], name: Option<String>, trace: &Trace) {
    let Some(name) = name else { return };
    let before = state.with_store(|s| Ok(s.peer(key).map(|p| p.name.clone()))).ok().flatten();
    if before.as_deref() == Some(name.as_str()) {
        return;
    }
    match state.with_store(|s| s.rename_peer(key, &name)) {
        Ok(()) => trace.step(format!("{:?} is now called {name:?}.", before.unwrap_or_default())),
        Err(e) => trace.step(format!("Couldn't save its new name ({}).", e.detail())),
    }
}

/// Whether asking the other device to unpair left it without this one: only then does this one remove it.
/// A broken connection or no answer leaves both paired, so the two never disagree.
fn forgotten_there(asked: Result<Asked, Error>) -> Result<Forgot, Error> {
    match asked {
        Ok(_) => Ok(Forgot::Both),
        // It said it doesn't know this device: nothing to remove there.
        Err(Error::UnknownThere) => Ok(Forgot::AlreadyGone),
        Err(e) => Err(e),
    }
}

/// Forgets the device `key` (hex) on this side only, for one that can't be reached (lost, or its app gone): it's
/// told the next time it tries to sync with this device, and gets no rounds.
#[tauri::command]
pub fn sync_forget_here(state: State<'_, SyncState>, key: String) -> CommandResult<Status> {
    state.with_store(|s| s.forget(&key, now_ms())).map_err(text)?;
    state.status().map_err(text)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShownCode {
    /// The 6 digits to type on the other device.
    code: String,
    /// How long the code works for.
    seconds: u64,
    qr: Qr,
}

/// A QR code for the page to draw: `size` × `size` modules, row by row, `1` for a dark one.
#[derive(Serialize)]
pub struct Qr {
    size: usize,
    modules: String,
}

fn qr(text: &str) -> Result<Qr, Error> {
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|_| Error::Protocol("can't make the QR code"))?;
    let modules = code.to_colors().iter().map(|c| if *c == qrcode::Color::Dark { '1' } else { '0' }).collect();
    Ok(Qr { size: code.width(), modules })
}

/// Starts waiting for the other device, and returns the code to type on it (or scan).
#[tauri::command]
pub async fn pair_start(app: AppHandle, on_event: Channel<PairEvent>) -> CommandResult<ShownCode> {
    let state = app.state::<SyncState>();
    state.stop_pairing();
    let trace = pair_trace(&on_event);
    let (private_key, _, name) = state.me().map_err(|e| fail(&trace, e))?;
    begin(&trace, &name, "Showing a code.");
    let code = PairCode::random().map_err(|e| fail(&trace, e))?;
    let listener = TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| fail(&trace, e.into()))?;
    let port = listener.local_addr().map_err(|e| fail(&trace, e.into()))?.port();
    let multicast = multicast::hold(&app, &trace);
    let announcement = discovery::announce_pairing(port).map_err(|e| fail(&trace, e))?;
    trace.step(format!("Announced on the network as waiting to pair, on port {port}."));
    let mut joins = discovery::watch_joins().map_err(|e| fail(&trace, e))?;
    let (answer, answered) = oneshot::channel();
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _keep = (announcement, multicast);
        let events = on_event.clone();
        let result = pair::host(
            &listener,
            &mut joins,
            code,
            Me { private_key: &private_key, name: &name },
            |name, check| {
                let _ = events.send(PairEvent::Check { name: name.into(), check: check.into() });
            },
            answered,
            &trace,
        )
        .await;
        finish_pairing(&task_app, result, &on_event, &trace);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pairing { task, answer: Some(answer) });
    let qr = qr(&code.qr_text()).map_err(text)?;
    Ok(ShownCode { code: code.to_string(), seconds: pair::CODE_LIFETIME.as_secs(), qr })
}

/// Finds the device showing `code` and pairs with it. Progress comes through `on_event`.
#[tauri::command]
pub fn pair_join(app: AppHandle, code: String, on_event: Channel<PairEvent>) -> CommandResult<()> {
    let state = app.state::<SyncState>();
    state.stop_pairing();
    let trace = pair_trace(&on_event);
    let code = PairCode::parse(&code).ok_or_else(|| fail(&trace, Error::BadCode))?;
    let (private_key, _, name) = state.me().map_err(|e| fail(&trace, e))?;
    begin(&trace, &name, "Pairing with the device showing the code.");
    let (answer, answered) = oneshot::channel();
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let events = on_event.clone();
        let result = async {
            let stream = {
                let _multicast = multicast::hold(&task_app, &trace);
                let found = discovery::find_pairing(&trace).await;
                reach(found, Purpose::Pair, discovery::announce_join, &trace).await?
            };
            pair::join(
                stream,
                code,
                Me { private_key: &private_key, name: &name },
                |name, check| {
                    let _ = events.send(PairEvent::Check { name: name.into(), check: check.into() });
                },
                answered,
                &trace,
            )
            .await
        }
        .await;
        finish_pairing(&task_app, result, &on_event, &trace);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pairing { task, answer: Some(answer) });
    Ok(())
}

/// A connection to the other device, opened for `purpose`: out to where it was `found`, or, if that fails (a
/// firewall on its side, most likely), in from it, after announcing a `request` for it to connect here.
async fn reach(
    found: Result<Vec<SocketAddr>, Error>,
    purpose: Purpose,
    request: impl FnOnce(u16) -> Result<discovery::Announcement, Error>,
    trace: &Trace,
) -> Result<TcpStream, Error> {
    let found = match found {
        Ok(addrs) => addrs,
        Err(Error::NotFound) => Vec::new(),
        Err(e) => return Err(e),
    };
    if let Ok(stream) = wire::open(&found, purpose, trace).await {
        return Ok(stream);
    }
    let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
    let port = listener.local_addr()?.port();
    let _request = request(port)?;
    trace.step(format!(
        "Asked the other device to connect here instead, on port {port}; waiting up to {} s…",
        REVERSE_TIME.as_secs()
    ));
    match timeout(REVERSE_TIME, wire::accept(&listener, purpose, trace)).await {
        Ok(stream) => stream,
        Err(_) => {
            trace.step(format!("The other device didn't connect here in {} s.", REVERSE_TIME.as_secs()));
            Err(if found.is_empty() { Error::NotFound } else { Error::Unreachable })
        }
    }
}

/// A trace that shows on the page as pairing steps.
fn pair_trace(events: &Channel<PairEvent>) -> Trace {
    let events = events.clone();
    Trace::new(move |text| {
        let _ = events.send(PairEvent::Step { text });
    })
}

/// The first step of every pairing or sync: this device and its networks, since which network each device
/// is on is the first thing to check when they can't find each other.
fn begin(trace: &Trace, name: &str, what: &str) {
    let networks: Vec<String> =
        discovery::own_networks().iter().map(|n| format!("{} ({})", n.ip, n.interface)).collect();
    let networks = if networks.is_empty() { "no network".to_string() } else { networks.join(", ") };
    trace.step(format!("This device: {name:?} at {networks}. {what}"));
}

/// Logs a failure with what went wrong underneath, and gives the failure for the page.
fn fail(trace: &Trace, e: Error) -> Failure {
    trace.step(format!("Failed: {e} ({})", e.detail()));
    text(e)
}

fn finish_pairing(
    app: &AppHandle,
    result: Result<pair::Paired, Error>,
    events: &Channel<PairEvent>,
    trace: &Trace,
) {
    let state = app.state::<SyncState>();
    let event = match result.and_then(|p| state.with_store(|s| s.add_peer(&p.key, &p.name, now_ms()))) {
        Ok(peer) => {
            trace.step(format!("Paired with {:?}.", peer.name));
            PairEvent::Paired { peer }
        }
        Err(Error::CodeExpired) => PairEvent::Expired,
        Err(e) => PairEvent::Failed { message: fail(trace, e).message },
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

/// Waits for paired devices to sync, handing them `rounds`, until `sync_stop`.
#[tauri::command]
pub async fn sync_listen(app: AppHandle, rounds: Vec<Value>, on_event: Channel<ListenEvent>) -> CommandResult<()> {
    let state = app.state::<SyncState>();
    state.stop_listening();
    *state.rounds.lock().unwrap_or_else(|e| e.into_inner()) = rounds;
    let trace = {
        let events = on_event.clone();
        Trace::new(move |text| {
            let _ = events.send(ListenEvent::Step { text });
        })
    };
    let (private_key, public_key, name) = state.me().map_err(|e| fail(&trace, e))?;
    begin(&trace, &name, "Waiting for paired devices to sync.");
    let listener = TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| fail(&trace, e.into()))?;
    let port = listener.local_addr().map_err(|e| fail(&trace, e.into()))?.port();
    let multicast = multicast::hold(&app, &trace);
    let announcement = discovery::announce_sync(port, &public_key).map_err(|e| fail(&trace, e))?;
    trace.step(format!("Announced on the network for paired devices, on port {port}."));
    let mut requests = discovery::watch_requests(&public_key).map_err(|e| fail(&trace, e))?;
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _keep = (announcement, multicast);
        let state = task_app.state::<SyncState>();
        loop {
            // A paired device connecting in, or asking this one to connect out (see `wire::meet`). One device
            // at a time: the next waits until this one is done.
            let met = wire::meet(&listener, Purpose::Sync, &mut requests, &trace).await;
            let stream = match met {
                Ok(stream) => stream,
                Err(e) => {
                    trace.step(format!("Couldn't take a connection ({}).", e.detail()));
                    // The listener now runs as long as the app is open: an error that keeps coming back (out of
                    // file handles, say) mustn't spin.
                    tokio::time::sleep(LISTEN_RETRY_TIME).await;
                    continue;
                }
            };
            let standing = |key: &[u8]| state.with_store(|s| Ok(s.standing(key))).unwrap_or(Standing::Unknown);
            let rounds = || state.rounds.lock().unwrap_or_else(|e| e.into_inner()).clone();
            // This device's name as it is now: it may have been renamed while listening.
            let my_name = state.with_store(|s| Ok(s.name().to_string())).unwrap_or_default();
            let event = match exchange::answer(stream, &private_key, &my_name, standing, rounds, &trace).await {
                Ok(Answered::ToldForgotten(key)) => {
                    let name = state.with_store(|s| Ok(s.forgotten(&key).map(|f| f.name.clone()))).ok().flatten();
                    match state.with_store(|s| s.told(&key)) {
                        Ok(()) => trace.step(format!("Told {:?} it was unpaired.", name.unwrap_or_default())),
                        Err(e) => trace.step(format!("Couldn't note it was told ({}).", e.detail())),
                    }
                    continue;
                }
                Ok(Answered::Unpaired(key)) => match state.with_store(|s| s.unpaired_by(&key)) {
                    Ok(Some(peer)) => {
                        trace.step(format!("{:?} unpaired this device: removed it here too.", peer.name));
                        ListenEvent::Unpaired { name: peer.name }
                    }
                    Ok(None) => continue,
                    Err(e) => ListenEvent::Failed { message: fail(&trace, e).message },
                },
                Ok(Answered::Synced(key, rounds, name)) => {
                    note_name(&state, &key, name, &trace);
                    if let Err(e) = state.with_store(|s| s.synced(&key, now_ms())) {
                        trace.step(format!("Couldn't save when it last synced ({}).", e.detail()));
                    }
                    match state.with_store(|s| Ok(s.peer(&key).cloned())) {
                        Ok(Some(peer)) => {
                            trace.step(format!("Synced with {:?}.", peer.name));
                            ListenEvent::Synced { peer, rounds }
                        }
                        _ => {
                            trace.step("The device was forgotten during the sync: its rounds are dropped.");
                            continue;
                        }
                    }
                }
                Err(e) => ListenEvent::Failed { message: fail(&trace, e).message },
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

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyncOutcome {
    /// The rounds the other device sent.
    Synced { rounds: Vec<Value> },
    /// The other device had unpaired this one, so it's gone here too.
    Unpaired,
}

/// Syncs with the paired device `key` (hex), which must be listening (Mnemax open on it). `quick` (automatic
/// syncs) gives up at once if it isn't announcing itself.
#[tauri::command]
pub async fn sync_now(
    app: AppHandle,
    key: String,
    rounds: Vec<Value>,
    quick: bool,
    on_step: Channel<String>,
) -> CommandResult<SyncOutcome> {
    let trace = Trace::new(move |text| {
        let _ = on_step.send(text);
    });
    let state = app.state::<SyncState>();
    let peer_key = hex_decode(&key).ok_or_else(|| fail(&trace, Error::UnknownPeer))?;
    let peer = state.with_store(|s| Ok(s.peer(&peer_key).cloned())).map_err(|e| fail(&trace, e))?;
    let peer = peer.ok_or_else(|| fail(&trace, Error::UnknownPeer))?;
    let (private_key, _, name) = state.me().map_err(|e| fail(&trace, e))?;
    begin(&trace, &name, &format!("Syncing with {:?}.", peer.name));
    let stream = {
        let _multicast = multicast::hold(&app, &trace);
        let found = discovery::find_peer(&peer_key, &trace).await;
        // An automatic sync that doesn't see the device announcing at all takes it that it isn't open, rather
        // than asking it to connect back and waiting.
        if quick && matches!(found, Err(Error::NotFound)) {
            trace.step(format!("{:?} isn't open on this network now.", peer.name));
            return Err(text(Error::NotFound));
        }
        let request = |port| discovery::announce_request(port, &peer_key);
        reach(found, Purpose::Sync, request, &trace).await.map_err(|e| fail(&trace, e))?
    };
    let asked = exchange::initiate(stream, &private_key, &peer_key, &name, Want::Sync, &rounds, &trace)
        .await
        .map_err(|e| fail(&trace, e))?;
    match asked {
        Asked::Synced(rounds, their_name) => {
            note_name(&state, &peer_key, their_name, &trace);
            state.with_store(|s| s.synced(&peer_key, now_ms())).map_err(|e| fail(&trace, e))?;
            trace.step(format!("Synced with {:?}.", peer.name));
            Ok(SyncOutcome::Synced { rounds })
        }
        Asked::Unpaired => {
            state.with_store(|s| s.unpaired_by(&peer_key)).map_err(|e| fail(&trace, e))?;
            trace.step(format!("{:?} had unpaired this device: removed it here too.", peer.name));
            Ok(SyncOutcome::Unpaired)
        }
    }
}

/// Android drops the multicast packets mDNS uses unless an app holds a multicast lock, so sync holds one
/// while it announces or looks for a device (see MulticastPlugin.kt). Elsewhere this does nothing.
mod multicast {
    use tauri::AppHandle;

    use super::trace::Trace;

    pub struct Hold {
        #[cfg(target_os = "android")]
        handle: Option<tauri::plugin::PluginHandle<tauri::Wry>>,
    }

    #[cfg(target_os = "android")]
    pub struct Handle(pub tauri::plugin::PluginHandle<tauri::Wry>);

    #[cfg(target_os = "android")]
    pub fn hold(app: &AppHandle, trace: &Trace) -> Hold {
        use tauri::Manager;
        let handle = app.try_state::<Handle>().map(|h| h.0.clone());
        match &handle {
            Some(h) => match h.run_mobile_plugin::<()>("acquire", ()) {
                Ok(()) => trace.step("Holding Android's multicast lock, to hear the other device."),
                Err(e) => trace.step(format!("Couldn't take Android's multicast lock ({e}): may not hear it.")),
            },
            None => trace.step("Android's multicast lock isn't set up: may not hear the other device."),
        }
        Hold { handle }
    }

    #[cfg(not(target_os = "android"))]
    pub fn hold(_app: &AppHandle, _trace: &Trace) -> Hold {
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

/// Sets up sync: its state with the system's key store, and on Android the multicast lock.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("mnemax-sync")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            app.manage(multicast::Handle(_api.register_android_plugin("app.mnemax", "MulticastPlugin")?));
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
    fn only_local_addresses_count_as_local() {
        for ip in ["192.168.1.20", "10.0.0.5", "172.16.3.4", "169.254.1.1", "127.0.0.1", "::1", "fe80::1", "fd00::1"] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "100.64.0.1", "2001:db8::1", "::ffff:8.8.8.8"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
        assert!(is_local("::ffff:192.168.1.2".parse().unwrap()));
    }

    // The whole flow over the real network, as two devices would run it: pairing with the phone connecting
    // to the desktop, then syncing the other way round, as when the desktop's firewall turns the phone away:
    // the phone asks over mDNS and the desktop connects to it.
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

        // Pairing: the desktop shows a code, the phone finds it and connects.
        let code = PairCode::random().unwrap();
        let listener = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let _shown = discovery::announce_pairing(listener.local_addr().unwrap().port()).unwrap();
        let mut joins = discovery::watch_joins().unwrap();
        let me = Me { private_key: &desktop.private, name: "Desktop" };
        let hosting = pair::host(&listener, &mut joins, code, me, |_, _| {}, answer(), Trace::off());
        let joining = async {
            let (trace, steps) = trace::kept();
            let found = discovery::find_pairing(&trace).await;
            let stream = reach(found, Purpose::Pair, discovery::announce_join, &trace).await?;
            let me = Me { private_key: &phone.private, name: "Phone" };
            let paired = pair::join(stream, code, me, |_, _| {}, answer(), &trace).await;
            let steps = steps.lock().unwrap();
            assert!(steps.iter().any(|s| s.starts_with("Found it at ")), "{steps:?}");
            assert!(steps.iter().any(|s| s == "Both said yes."), "{steps:?}");
            paired
        };
        let (hosted, joined) = tokio::join!(hosting, joining);
        let (phone_seen, desktop_seen) = (hosted.unwrap(), joined.unwrap());
        assert_eq!(phone_seen.key, phone.public);
        assert_eq!(desktop_seen.key, desktop.public);

        // Syncing: the desktop listens; the phone "can't reach it", so it asks and the desktop connects out.
        let listener = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
        let _listening = discovery::announce_sync(listener.local_addr().unwrap().port(), &desktop.public).unwrap();
        let mut requests = discovery::watch_requests(&desktop.public).unwrap();
        let answering = async {
            let stream = wire::meet(&listener, Purpose::Sync, &mut requests, Trace::off()).await.unwrap();
            let desktop_rounds = vec![serde_json::json!({ "id": "round-1" })];
            let standing = |k: &[u8]| if k == phone_seen.key.as_slice() { Standing::Paired } else { Standing::Unknown };
            exchange::answer(stream, &desktop.private, "Desktop", standing, || desktop_rounds, Trace::off()).await
        };
        let asking = async {
            let (trace, steps) = trace::kept();
            let unreachable = Err(Error::NotFound);
            let request = |port| discovery::announce_request(port, &desktop_seen.key);
            let stream = reach(unreachable, Purpose::Sync, request, &trace).await?;
            let phone_rounds = [serde_json::json!({ "id": "round-2" })];
            let (desktop_key, sync) = (&desktop_seen.key, Want::Sync);
            let synced = exchange::initiate(stream, &phone.private, desktop_key, "Phone", sync, &phone_rounds, &trace);
            let synced = synced.await;
            let steps = steps.lock().unwrap();
            assert!(steps.iter().any(|s| s.starts_with("Asked the other device to connect here")), "{steps:?}");
            assert!(steps.iter().any(|s| s == "Received 1 round."), "{steps:?}");
            synced
        };
        let (answered, asked) = tokio::join!(answering, asking);
        let desktop_got = vec![serde_json::json!({ "id": "round-2" })];
        let phone_name = Some("Phone".to_string());
        assert_eq!(answered.unwrap(), Answered::Synced(phone.public.clone(), desktop_got, phone_name));
        let desktop_name = Some("Desktop".to_string());
        let phone_got = vec![serde_json::json!({ "id": "round-1" })];
        assert_eq!(asked.unwrap(), Asked::Synced(phone_got, desktop_name));
    }

    #[test]
    fn forgets_here_only_once_the_other_device_is_done() {
        assert!(matches!(forgotten_there(Ok(Asked::Unpaired)), Ok(Forgot::Both)));
        assert!(matches!(forgotten_there(Err(Error::UnknownThere)), Ok(Forgot::AlreadyGone)));
        let broke = std::io::Error::from(std::io::ErrorKind::ConnectionReset);
        for e in [Error::Io(broke), Error::NotFound, Error::Unreachable, Error::TimedOut, Error::Refused] {
            assert!(forgotten_there(Err(e)).is_err());
        }
    }

    #[test]
    fn makes_a_square_qr_code() {
        let code = qr("mnemax:pair:815307").unwrap();
        assert_eq!(code.modules.len(), code.size * code.size);
        assert!(code.modules.contains('1') && code.modules.contains('0'));
        assert!(code.modules.bytes().all(|b| b == b'0' || b == b'1'));
    }

    #[test]
    fn random_numbers_stay_below_the_limit() {
        assert!((0..1000).all(|_| random_below(7).unwrap() < 7));
    }
}
