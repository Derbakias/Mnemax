//! The commands the page calls: pairing, syncing with a device, renaming and forgetting.
//!
//! They're all `async`, so they never run on the window's own thread: the first one may wait for the key
//! store to be unlocked, and the window mustn't freeze meanwhile.

use std::net::SocketAddr;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;

use super::address::{own_address, parse_home, PAIR_PORT, SYNC_PORT};
use super::exchange;
use super::pair::{self, Me, PairCode};
use super::store::{hex_decode, Peer};
use super::trace::Trace;
use super::wire::{self, Purpose};
use super::{now_ms, Error, SyncState};

/// What the commands take and give. Raise it with every change to them, together with `SYNC_API` in
/// src/sync.ts: during development the page reloads by itself but Rust only when the app is rebuilt, and an
/// old Rust side would be misunderstood.
const API_VERSION: u32 = 5;
/// What a pairing QR code starts with, so the phone can tell it's Mnemax's.
const QR_PREFIX: &str = "mnemax:pair:";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    api: u32,
    name: String,
    peers: Vec<Peer>,
}

/// A failed command, as the page gets it: a short name for the error and the message to show.
#[derive(Debug, Serialize)]
pub struct Failure {
    code: &'static str,
    message: String,
}

type CommandResult<T> = Result<T, Failure>;

/// Turns an error into what the page shows. Only real faults (a broken connection, storage, the key store) also
/// go to the terminal; everyday ones, like a wrong code or a device that's switched off, are only on the page.
pub fn text(e: Error) -> Failure {
    if matches!(e, Error::Io(_) | Error::Protocol(_) | Error::Storage(_) | Error::KeyStore(_)) {
        eprintln!("sync: {}", e.detail());
    }
    Failure { code: e.code(), message: e.to_string() }
}

/// Like `text`, and also notes the failure in the step-by-step log.
fn fail(trace: &Trace, e: Error) -> Failure {
    trace.step(format!("Failed: {e} ({})", e.detail()));
    text(e)
}

fn status(state: &SyncState) -> Result<Status, Error> {
    state.with_store(|s| Ok(Status { api: API_VERSION, name: s.name().to_string(), peers: s.peers().to_vec() }))
}

/// Opens a port for other devices to connect to.
pub async fn listen_on(port: u16) -> Result<TcpListener, Error> {
    TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::AddrInUse => Error::PortInUse(port),
        _ => Error::Io(e),
    })
}

/// Keeps the name a device goes by now, if it changed.
pub fn note_name(state: &SyncState, key: &[u8], name: Option<String>, trace: &Trace) {
    let Some(name) = name else { return };
    if let Err(e) = state.with_store(|s| s.rename_peer(key, &name)) {
        trace.step(format!("Couldn't save its new name ({}).", e.detail()));
    }
}

#[tauri::command]
pub async fn sync_status(state: State<'_, SyncState>) -> CommandResult<Status> {
    status(&state).map_err(text)
}

#[tauri::command]
pub async fn sync_rename(state: State<'_, SyncState>, name: String) -> CommandResult<Status> {
    state.with_store(|s| s.set_name(&name)).map_err(text)?;
    status(&state).map_err(text)
}

/// Forgets the device `key` (hex) on this device. It can't sync with this one any more.
#[tauri::command]
pub async fn sync_forget(state: State<'_, SyncState>, key: String) -> CommandResult<Status> {
    let key = hex_decode(&key).ok_or(Error::UnknownPeer).map_err(text)?;
    state.with_store(|s| s.forget(&key)).map_err(text)?;
    status(&state).map_err(text)
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PairEvent {
    Paired { peer: Peer },
    /// Nobody tried the code in time.
    Expired,
    Failed { message: String },
    /// What pairing is doing, for the log.
    Step { text: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShownCode {
    /// This device's address, like `192.168.1.20`.
    address: String,
    /// The 9 digits.
    code: String,
    /// The address and code together, as in the QR code: for the Copy button.
    text: String,
    /// How long the code works.
    seconds: u64,
    qr: Qr,
}

/// A QR code for the page to draw: `size` × `size` squares, row by row, `1` for a dark one.
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

/// Shows a code: waits for the other device to connect, and returns the address and code to show.
#[tauri::command]
pub async fn pair_start(app: AppHandle, on_event: Channel<PairEvent>) -> CommandResult<ShownCode> {
    let state = app.state::<SyncState>();
    state.stop_pairing().await;
    let trace = pair_trace(&on_event);
    let (private_key, name) = state.me().map_err(|e| fail(&trace, e))?;
    let address = own_address().ok_or(Error::NoNetwork).map_err(|e| fail(&trace, e))?;
    trace.step(format!("This device: {name:?} at {address}. Showing a code."));
    let code = PairCode::random().map_err(|e| fail(&trace, e))?;
    let text = format!("{QR_PREFIX}{address}:{code}");
    let qr = qr(&text).map_err(|e| fail(&trace, e))?;
    let listener = listen_on(PAIR_PORT).await.map_err(|e| fail(&trace, e))?;
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = pair::host(&listener, code, Me { private_key: &private_key, name: &name }, &trace).await;
        // The device that showed the code waits for the other one, so it doesn't keep an address.
        finish_pairing(&task_app, result, None, &on_event, &trace);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
    let seconds = pair::CODE_LIFETIME.as_secs();
    Ok(ShownCode { address: address.to_string(), code: code.to_string(), text, seconds, qr })
}

/// Pairs with the device at `address` showing `code`. How it goes comes through `on_event`.
#[tauri::command]
pub async fn pair_join(
    app: AppHandle,
    address: String,
    code: String,
    on_event: Channel<PairEvent>,
) -> CommandResult<()> {
    let state = app.state::<SyncState>();
    state.stop_pairing().await;
    let trace = pair_trace(&on_event);
    let code = PairCode::parse(&code).ok_or(Error::BadCode).map_err(|e| fail(&trace, e))?;
    let ip = parse_home(&address).map_err(|e| fail(&trace, e))?;
    let (private_key, name) = state.me().map_err(|e| fail(&trace, e))?;
    trace.step(format!("This device: {name:?}. Pairing with the device at {ip}."));
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = async {
            let stream = wire::open(SocketAddr::from((ip, PAIR_PORT)), Purpose::Pair, &trace)
                .await
                .map_err(|e| if matches!(e, Error::Unreachable) { Error::NobodyThere } else { e })?;
            pair::join(stream, code, Me { private_key: &private_key, name: &name }, &trace).await
        }
        .await;
        // This device connected, so it keeps the address to connect to again for every sync.
        finish_pairing(&task_app, result, Some(ip.to_string()), &on_event, &trace);
    });
    *state.pairing.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
    Ok(())
}

#[tauri::command]
pub async fn pair_cancel(state: State<'_, SyncState>) -> CommandResult<()> {
    state.stop_pairing().await;
    Ok(())
}

fn pair_trace(events: &Channel<PairEvent>) -> Trace {
    let events = events.clone();
    Trace::new(move |text| {
        let _ = events.send(PairEvent::Step { text });
    })
}

fn finish_pairing(
    app: &AppHandle,
    result: Result<pair::Paired, Error>,
    address: Option<String>,
    events: &Channel<PairEvent>,
    trace: &Trace,
) {
    let state = app.state::<SyncState>();
    let saved = result.and_then(|p| state.with_store(|s| s.add_peer(&p.key, &p.name, address, now_ms())));
    let event = match saved {
        Ok(peer) => {
            trace.step(format!("Paired with {:?}.", peer.name));
            PairEvent::Paired { peer }
        }
        Err(Error::CodeExpired) => PairEvent::Expired,
        Err(e) => PairEvent::Failed { message: fail(trace, e).message },
    };
    let _ = events.send(event);
}

#[derive(Serialize)]
pub struct SyncOutcome {
    /// The rounds the other device sent, for the page to check and save.
    rounds: Vec<Value>,
}

/// Connects to the paired device `key` (hex) and syncs. `rounds` are this device's rounds.
#[tauri::command]
pub async fn sync_now(
    state: State<'_, SyncState>,
    key: String,
    rounds: Vec<Value>,
    on_step: Channel<String>,
) -> CommandResult<SyncOutcome> {
    let trace = Trace::new(move |text| {
        let _ = on_step.send(text);
    });
    let key = hex_decode(&key).ok_or(Error::UnknownPeer).map_err(|e| fail(&trace, e))?;
    let peer = state.with_store(|s| Ok(s.peer(&key).cloned())).map_err(|e| fail(&trace, e))?;
    // Only a device this one connects to has an address; the others connect here by themselves.
    let Some((peer, Some(address))) = peer.map(|p| (p.clone(), p.address)) else {
        return Err(fail(&trace, Error::UnknownPeer));
    };
    // The saved address is checked again, like a typed one.
    let ip = parse_home(&address).map_err(|e| fail(&trace, e))?;
    let (private_key, name) = state.me().map_err(|e| fail(&trace, e))?;
    trace.step(format!("This device: {name:?}. Syncing with {:?} at {ip}.", peer.name));
    let synced = async {
        let stream = wire::open(SocketAddr::from((ip, SYNC_PORT)), Purpose::Sync, &trace).await?;
        exchange::initiate(stream, &private_key, &key, &name, &rounds, || state.is_paired(&key), &trace).await
    }
    .await;
    let synced = synced.map_err(|e| fail(&trace, e))?;
    // Forgotten while syncing: what it sent isn't kept.
    if !state.is_paired(&key) {
        return Err(fail(&trace, Error::UnknownPeer));
    }
    note_name(&state, &key, synced.name, &trace);
    state.with_store(|s| s.synced(&key, now_ms())).map_err(|e| fail(&trace, e))?;
    trace.step(format!("Synced with {:?}.", peer.name));
    Ok(SyncOutcome { rounds: synced.rounds })
}
