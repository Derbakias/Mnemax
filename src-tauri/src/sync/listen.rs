//! Waiting for paired devices to connect and sync.
//!
//! A device listens only if it has a paired device that connects to it (it showed the code when they
//! paired), and only while the page says so (see src/sync-context.tsx).
//!
//! Each connection is handled on its own, a few at a time at most, so a stranger who connects and says
//! nothing can't block a real device. Strangers' failures only go in the log, never on screen.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpStream;
use tokio::sync::Semaphore;

use super::address::{is_local, SYNC_PORT};
use super::commands::{listen_on, note_name, text, Failure};
use super::exchange;
use super::store::Peer;
use super::trace::Trace;
use super::wire::{self, Purpose};
use super::{now_ms, Error, PrivateKey, SyncState};

/// How many connections are handled at the same time. More are dropped straight away.
const AT_ONCE: usize = 4;
/// After a failure to take a connection, a short wait before trying again, so it can't spin.
const RETRY_TIME: Duration = Duration::from_millis(500);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ListenEvent {
    /// A paired device synced: the rounds it sent, for the page to check and save.
    Synced { peer: Peer, rounds: Vec<Value> },
    /// What the listener is doing, for the log.
    Step { text: String },
}

/// Starts waiting for paired devices (until `sync_stop`), handing them `rounds`.
#[tauri::command]
pub async fn sync_listen(app: AppHandle, rounds: Vec<Value>, on_event: Channel<ListenEvent>) -> Result<(), Failure> {
    let state = app.state::<SyncState>();
    state.stop_listening().await;
    *state.rounds.lock().unwrap_or_else(|e| e.into_inner()) = rounds;
    let events = on_event.clone();
    let trace = Trace::new(move |text| {
        let _ = events.send(ListenEvent::Step { text });
    });
    let (private_key, _) = state.me().map_err(text)?;
    let private_key = Arc::new(private_key);
    let listener = listen_on(SYNC_PORT).await.map_err(text)?;
    trace.step(format!("Waiting for paired devices on port {SYNC_PORT}."));
    let task_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let slots = Arc::new(Semaphore::new(AT_ONCE));
        loop {
            let (stream, addr) = match listener.accept().await {
                Ok(accepted) => accepted,
                Err(e) => {
                    trace.step(format!("Couldn't take a connection ({e})."));
                    tokio::time::sleep(RETRY_TIME).await;
                    continue;
                }
            };
            if !is_local(addr.ip()) {
                continue;
            }
            let Ok(slot) = slots.clone().try_acquire_owned() else {
                trace.step(format!("Too many connections at once: dropped {addr}."));
                continue;
            };
            let (app, key, events, trace) = (task_app.clone(), private_key.clone(), on_event.clone(), trace.clone());
            tauri::async_runtime::spawn(async move {
                let _slot = slot;
                answer(&app, stream, &key, &events, &trace).await;
            });
        }
    });
    *state.listening.lock().unwrap_or_else(|e| e.into_inner()) = Some(task);
    Ok(())
}

/// One device that connected: syncs with it if it's a paired one.
async fn answer(
    app: &AppHandle,
    mut stream: TcpStream,
    key: &PrivateKey,
    events: &Channel<ListenEvent>,
    trace: &Trace,
) {
    if let Err(e) = wire::check_opening(&mut stream, Purpose::Sync).await {
        trace.step(format!("Ignored a connection: {}.", e.detail()));
        return;
    }
    let state = app.state::<SyncState>();
    let is_paired = |k: &[u8]| state.is_paired(k);
    let rounds = || state.rounds.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // This device's name as it is now: it may have been renamed while listening.
    let my_name = state.with_store(|s| Ok(s.name().to_string())).unwrap_or_default();
    let synced = match exchange::answer(stream, key, &my_name, is_paired, rounds, trace).await {
        Ok(synced) => synced,
        Err(e) => {
            trace.step(format!("A sync with a device that connected failed: {e} ({}).", e.detail()));
            return;
        }
    };
    note_name(&state, &synced.key, synced.name, trace);
    let saved = state.with_store(|s| {
        s.synced(&synced.key, now_ms())?;
        s.peer(&synced.key).cloned().ok_or(Error::UnknownPeer)
    });
    match saved {
        Ok(peer) => {
            trace.step(format!("Synced with {:?}.", peer.name));
            let _ = events.send(ListenEvent::Synced { peer, rounds: synced.rounds });
        }
        Err(e) => trace.step(format!("Didn't keep what it sent: {e}.")),
    }
}

/// The rounds to hand out from now on (after the page saved new ones).
#[tauri::command]
pub fn sync_rounds(state: State<'_, SyncState>, rounds: Vec<Value>) {
    *state.rounds.lock().unwrap_or_else(|e| e.into_inner()) = rounds;
}

#[tauri::command]
pub async fn sync_stop(state: State<'_, SyncState>) -> Result<(), Failure> {
    state.stop_listening().await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security_settings_have_not_changed() {
        // At most this many connections at once: more are dropped. Update it here too if it changes on purpose.
        assert_eq!(AT_ONCE, 4);
    }
}
