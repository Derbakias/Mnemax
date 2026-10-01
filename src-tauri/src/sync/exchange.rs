//! Syncing: two paired devices swap the rounds each one is missing.
//!
//! The device that connects knows the other's public key from pairing, and starts an encrypted handshake
//! (Noise IK) that only the right device can answer. Its first message carries its own key, encrypted; the
//! other device checks that key against its paired devices and hangs up without a word if it isn't one.
//!
//! Then each device sends its name, then the list of round ids it has, then the rounds the other one lacks.
//! Nothing here can change or delete a round, and the page checks every round again before saving it.

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::store::{check_name, hex_encode};
use super::trace::Trace;
use super::wire::{self, Secure};
use super::{Error, SYNC_PARAMS};

/// A whole sync, from connecting to the last round.
const SYNC_TIME: Duration = Duration::from_secs(60);
/// How long a device that connects here has to prove it's a paired device. A real one takes milliseconds,
/// so a stranger can't keep this device busy for long.
const PROVE_TIME: Duration = Duration::from_secs(5);
const PROLOGUE: &[u8] = b"mnemax sync v4";
/// A name: 40 characters at most, 4 bytes each at most, plus a little room.
const MAX_NAME_BYTES: usize = 512;
/// More ids than a device keeps rounds (500), with room to spare.
const MAX_IDS: usize = 2000;
const MAX_ID_CHARS: usize = 64;
const MAX_IDS_BYTES: usize = MAX_IDS * (MAX_ID_CHARS + 3) + 64;
/// 500 rounds take about 4 MB at most.
const MAX_ROUNDS_BYTES: usize = 16 * 1024 * 1024;

/// What a sync brought: who it was with, the rounds this device was missing, and the other device's name
/// (None if the name it sent wasn't a valid one).
#[derive(Debug, PartialEq)]
pub struct Synced {
    pub key: Vec<u8>,
    pub rounds: Vec<Value>,
    pub name: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Name {
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Have {
    ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rounds {
    rounds: Vec<Value>,
}

/// The device that connected: syncs with the paired device `peer_key`. `mine` are this device's rounds.
/// `still_paired` is asked again just before rounds are sent, in case the device was forgotten meanwhile.
pub async fn initiate(
    mut stream: TcpStream,
    private_key: &[u8],
    peer_key: &[u8],
    my_name: &str,
    mine: &[Value],
    still_paired: impl Fn() -> bool + Sync,
    trace: &Trace,
) -> Result<Synced, Error> {
    let steps = async {
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.remote_public_key(peer_key))
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_initiator())
            .map_err(|_| Error::Handshake)?;
        trace.step(format!("Starting the encrypted handshake with device {}…", short_key(peer_key)));
        let hs = wire::handshake(&mut stream, hs, false, |_| Ok(())).await.map_err(|e| match e {
            // A device hangs up without a word on anyone it doesn't know. So does a device that isn't the
            // one we paired with but now has its address, or one with another version.
            Error::Handshake => Error::Refused,
            Error::Io(e) if hung_up(&e) => Error::Refused,
            e => e,
        })?;
        trace.step("Handshake done.");
        let mut chan = Secure::new(stream, hs)?;
        chan.send_json(&Name { name: my_name.to_string() }).await?;
        let theirs: Name = chan.recv_json(MAX_NAME_BYTES).await?;
        let rounds = swap(&mut chan, mine, true, &still_paired, trace).await?;
        Ok(Synced { key: peer_key.to_vec(), rounds, name: their_name(&theirs.name, trace) })
    };
    timeout(SYNC_TIME, steps).await.map_err(|_| {
        trace.step(format!("The sync didn't finish in {} s.", SYNC_TIME.as_secs()));
        Error::TimedOut
    })?
}

/// The device that was connected to: finds out who it is, then syncs. `is_paired` decides on the other
/// device's key before this one says anything: a key it doesn't know gets nothing at all.
pub async fn answer(
    mut stream: TcpStream,
    private_key: &[u8],
    my_name: &str,
    is_paired: impl Fn(&[u8]) -> bool + Sync,
    mine: impl FnOnce() -> Vec<Value>,
    trace: &Trace,
) -> Result<Synced, Error> {
    // Proving who it is covers the handshake and its first message, so a recorded first message played
    // back by someone else is let go after a few seconds too.
    let prove = async {
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_responder())
            .map_err(|_| Error::Handshake)?;
        let hs = wire::handshake(&mut stream, hs, false, |hs| {
            let key = hs.get_remote_static().ok_or(Error::Handshake)?;
            if is_paired(key) {
                Ok(())
            } else {
                trace.step(format!("Device {} isn't paired with this one: hanging up.", short_key(key)));
                Err(Error::NotPaired)
            }
        })
        .await?;
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let mut chan = Secure::new(stream, hs)?;
        let theirs: Name = chan.recv_json(MAX_NAME_BYTES).await?;
        Ok::<_, Error>((chan, key, theirs))
    };
    let (mut chan, key, theirs) = timeout(PROVE_TIME, prove).await.map_err(|_| {
        trace.step(format!("The device that connected didn't prove who it is in {} s.", PROVE_TIME.as_secs()));
        Error::TimedOut
    })??;
    trace.step(format!("Device {} is paired with this one.", short_key(&key)));
    let steps = async {
        chan.send_json(&Name { name: my_name.to_string() }).await?;
        let rounds = swap(&mut chan, &mine(), false, &|| is_paired(&key), trace).await?;
        Ok(Synced { key: key.clone(), rounds, name: their_name(&theirs.name, trace) })
    };
    timeout(SYNC_TIME, steps).await.map_err(|_| {
        trace.step(format!("The sync didn't finish in {} s.", SYNC_TIME.as_secs()));
        Error::TimedOut
    })?
}

/// Swaps the lists of ids first, then the rounds. The device that connected sends first each time, so the
/// two never wait on each other.
async fn swap(
    chan: &mut Secure,
    mine: &[Value],
    connected: bool,
    still_paired: &(dyn Fn() -> bool + Sync),
    trace: &Trace,
) -> Result<Vec<Value>, Error> {
    let my_ids: HashSet<&str> = mine.iter().filter_map(round_id).collect();
    let have = Have { ids: my_ids.iter().map(|id| id.to_string()).collect() };
    let theirs: Have = if connected {
        chan.send_json(&have).await?;
        chan.recv_json(MAX_IDS_BYTES).await?
    } else {
        let theirs = chan.recv_json(MAX_IDS_BYTES).await?;
        chan.send_json(&have).await?;
        theirs
    };
    if theirs.ids.len() > MAX_IDS || !theirs.ids.iter().all(|id| is_round_id(id)) {
        return Err(Error::Protocol("bad round ids"));
    }
    if !still_paired() {
        trace.step("The device was forgotten during the sync: sending it nothing.");
        return Err(Error::UnknownPeer);
    }
    let their_ids: HashSet<&str> = theirs.ids.iter().map(String::as_str).collect();
    let missing = mine.iter().filter(|r| round_id(r).is_some_and(|id| !their_ids.contains(id)));
    let send = Rounds { rounds: missing.cloned().collect() };
    trace.step(format!(
        "This device has {}, the other {}. Sending the {} it's missing…",
        rounds(my_ids.len()),
        their_ids.len(),
        send.rounds.len()
    ));
    let received: Rounds = if connected {
        chan.send_json(&send).await?;
        chan.recv_json(MAX_ROUNDS_BYTES).await?
    } else {
        let received = chan.recv_json(MAX_ROUNDS_BYTES).await?;
        chan.send_json(&send).await?;
        received
    };
    if received.rounds.len() > MAX_IDS {
        return Err(Error::Protocol("too many rounds"));
    }
    // Keep only rounds this device lacks and the other said it had, each once.
    let mut wanted: HashSet<&str> = their_ids.difference(&my_ids).copied().collect();
    let sent = received.rounds.len();
    let kept: Vec<Value> =
        received.rounds.into_iter().filter(|r| round_id(r).is_some_and(|id| wanted.remove(id))).collect();
    trace.step(format!("Received {}; kept {}.", rounds(sent), kept.len()));
    Ok(kept)
}

/// The other device's name, if it's a valid one (otherwise we keep the name we had).
fn their_name(name: &str, trace: &Trace) -> Option<String> {
    let name = check_name(name).ok();
    if name.is_none() {
        trace.step("The other device sent a name that isn't valid: keeping the one this device has.");
    }
    name
}

/// The other side closed the connection.
fn hung_up(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::{ConnectionAborted, ConnectionReset, UnexpectedEof};
    matches!(e.kind(), UnexpectedEof | ConnectionReset | ConnectionAborted)
}

/// The start of a key: enough to tell devices apart in the log.
fn short_key(key: &[u8]) -> String {
    hex_encode(&key[..key.len().min(4)])
}

/// `1 round`, `3 rounds`.
fn rounds(n: usize) -> String {
    format!("{n} round{}", if n == 1 { "" } else { "s" })
}

fn round_id(round: &Value) -> Option<&str> {
    round.as_object()?.get("id")?.as_str().filter(|id| is_round_id(id))
}

/// The same rule as the page's round check: 1 to 64 letters, digits and `._:-`.
fn is_round_id(id: &str) -> bool {
    (1..=MAX_ID_CHARS).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}

#[cfg(test)]
mod attack_tests;
#[cfg(test)]
mod tests;
