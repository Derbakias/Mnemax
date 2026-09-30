//! Syncing: two paired devices swap the rounds each is missing.
//!
//! The connecting device knows the other's key (from pairing) and runs a Noise IK handshake with it. The
//! first handshake message carries the connecting device's key, encrypted to the other device; the other
//! device checks it against its paired devices and hangs up without answering if it isn't one. After the
//! handshake each side sends the ids of the rounds it has, then the rounds the other lacks.
//!
//! Only adding: nothing here can change or remove a round. The rounds that come in are checked again in full
//! by the page before they're saved, the same way an imported file is.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::wire::{self, Purpose, Secure};
use super::{Error, SYNC_PARAMS};

/// A whole sync, from connecting to the last round.
pub const SYNC_TIME: Duration = Duration::from_secs(60);
const PROLOGUE: &[u8] = b"mnemax sync v1";
/// More ids than a device keeps rounds (500), with room to spare.
const MAX_IDS: usize = 2000;
const MAX_ID_CHARS: usize = 64;
/// 500 rounds take at most about 4 MB as sent.
const MAX_ROUNDS_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDS_BYTES: usize = MAX_IDS * (MAX_ID_CHARS + 3) + 64;

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

/// Connects to a paired device and swaps rounds. Returns the rounds this device didn't have.
pub async fn connect(
    addrs: &[SocketAddr],
    private_key: &[u8],
    peer_key: &[u8],
    mine: &[Value],
) -> Result<Vec<Value>, Error> {
    timeout(SYNC_TIME, async {
        let mut stream = wire::connect_any(addrs).await?;
        wire::write_opening(&mut stream, Purpose::Sync).await?;
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.remote_public_key(peer_key))
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_initiator())
            .map_err(|_| Error::Handshake)?;
        // A device that doesn't know this one hangs up without a word.
        let hs = wire::handshake(&mut stream, hs, |_| Ok(())).await.map_err(|e| match e {
            Error::Io(_) | Error::Handshake => Error::Refused,
            e => e,
        })?;
        let mut chan = Secure::new(stream, hs)?;
        swap(&mut chan, mine, true).await
    })
    .await
    .map_err(|_| Error::TimedOut)?
}

/// Answers a connection that opened as a sync. `is_paired` decides on the other device's key before this one
/// says anything. Returns that key and the rounds this device didn't have.
pub async fn answer(
    mut stream: TcpStream,
    private_key: &[u8],
    is_paired: impl Fn(&[u8]) -> bool,
    mine: impl FnOnce() -> Vec<Value>,
) -> Result<(Vec<u8>, Vec<Value>), Error> {
    timeout(SYNC_TIME, async {
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_responder())
            .map_err(|_| Error::Handshake)?;
        let hs = wire::handshake(&mut stream, hs, |hs| match hs.get_remote_static() {
            Some(key) if is_paired(key) => Ok(()),
            _ => Err(Error::NotPaired),
        })
        .await?;
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let mut chan = Secure::new(stream, hs)?;
        let received = swap(&mut chan, &mine(), false).await?;
        Ok((key, received))
    })
    .await
    .map_err(|_| Error::TimedOut)?
}

/// The ids first, then the rounds. The connecting device sends each first, so the two never wait on each other.
async fn swap(chan: &mut Secure, mine: &[Value], connecting: bool) -> Result<Vec<Value>, Error> {
    let my_ids: HashSet<&str> = mine.iter().filter_map(round_id).collect();
    let have = Have { ids: my_ids.iter().map(|id| id.to_string()).collect() };
    let theirs: Have = if connecting {
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
    let their_ids: HashSet<&str> = theirs.ids.iter().map(String::as_str).collect();
    let send = Rounds {
        rounds: mine.iter().filter(|r| round_id(r).is_some_and(|id| !their_ids.contains(id))).cloned().collect(),
    };
    let received: Rounds = if connecting {
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
    // Only rounds this device lacks and the other said it had, each once.
    let mut wanted: HashSet<&str> = their_ids.difference(&my_ids).copied().collect();
    Ok(received.rounds.into_iter().filter(|r| round_id(r).is_some_and(|id| wanted.remove(id))).collect())
}

fn round_id(round: &Value) -> Option<&str> {
    round.as_object()?.get("id")?.as_str().filter(|id| is_round_id(id))
}

/// The same rule as the page's round check: letters, digits and `._:-`, 1 to 64 of them.
fn is_round_id(id: &str) -> bool {
    (1..=MAX_ID_CHARS).contains(&id.len())
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::net::TcpListener;

    fn keypair() -> snow::Keypair {
        snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
    }

    fn round(id: &str) -> Value {
        json!({ "id": id, "finishedAt": 1, "settings": {}, "trials": [] })
    }

    fn ids(rounds: &[Value]) -> Vec<&str> {
        let mut ids: Vec<&str> = rounds.iter().filter_map(round_id).collect();
        ids.sort();
        ids
    }

    /// One device answering, one connecting. `known` is the key the answering one accepts; `expected` the
    /// key the connecting one expects to reach.
    async fn run(
        answerer: &snow::Keypair,
        connecter: &snow::Keypair,
        known: Vec<u8>,
        expected: Vec<u8>,
        answering_has: Vec<Value>,
        connecting_has: Vec<Value>,
    ) -> (Result<(Vec<u8>, Vec<Value>), Error>, Result<Vec<Value>, Error>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let answering = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            assert_eq!(wire::read_opening(&mut stream).await.unwrap(), Purpose::Sync);
            answer(stream, &answerer.private, |k| k == known.as_slice(), || answering_has).await
        };
        let addrs = [addr];
        tokio::join!(answering, connect(&addrs, &connecter.private, &expected, &connecting_has))
    }

    #[tokio::test]
    async fn swaps_the_rounds_each_lacks() {
        let (desktop, phone) = (keypair(), keypair());
        let (answered, connected) = run(
            &desktop,
            &phone,
            phone.public.clone(),
            desktop.public.clone(),
            vec![round("yesterday-1"), round("yesterday-2"), round("both")],
            vec![round("today-1"), round("both")],
        )
        .await;
        let (key, desktop_got) = answered.unwrap();
        assert_eq!(key, phone.public);
        assert_eq!(ids(&desktop_got), ["today-1"]);
        assert_eq!(ids(&connected.unwrap()), ["yesterday-1", "yesterday-2"]);
    }

    #[tokio::test]
    async fn turns_away_a_device_it_was_not_paired_with() {
        let (desktop, phone, stranger) = (keypair(), keypair(), keypair());
        let (answered, connected) = run(
            &desktop,
            &stranger,
            phone.public.clone(),
            desktop.public.clone(),
            vec![round("mine")],
            vec![round("theirs")],
        )
        .await;
        assert!(matches!(answered, Err(Error::NotPaired)), "{answered:?}");
        assert!(matches!(connected, Err(Error::Refused)), "{connected:?}");
    }

    #[tokio::test]
    async fn will_not_sync_with_a_device_pretending_to_be_a_paired_one() {
        // The phone expects the desktop's key; an impostor answers with its own.
        let (desktop, phone, impostor) = (keypair(), keypair(), keypair());
        let (answered, connected) = run(
            &impostor,
            &phone,
            phone.public.clone(),
            desktop.public.clone(),
            vec![round("bait")],
            vec![round("secret")],
        )
        .await;
        assert!(answered.is_err());
        assert!(connected.is_err());
    }

    #[tokio::test]
    async fn keeps_only_the_rounds_it_asked_for() {
        let (desktop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        // A paired device that sends more than it said it had: a round the other already has, one it never
        // mentioned, one twice, and something that isn't a round.
        let pushy = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            wire::read_opening(&mut stream).await.unwrap();
            let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
                .local_private_key(&desktop.private)
                .unwrap()
                .prologue(PROLOGUE)
                .unwrap()
                .build_responder()
                .unwrap();
            let hs = wire::handshake(&mut stream, hs, |_| Ok(())).await.unwrap();
            let mut chan = Secure::new(stream, hs).unwrap();
            let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
            chan.send_json(&Have { ids: vec!["new".into(), "shared".into()] }).await.unwrap();
            let _: Rounds = chan.recv_json(MAX_ROUNDS_BYTES).await.unwrap();
            let rounds = vec![round("new"), round("new"), round("shared"), round("unasked"), json!(42)];
            chan.send_json(&Rounds { rounds }).await.unwrap();
        };
        let (addrs, mine) = ([addr], [round("shared")]);
        let (_, got) = tokio::join!(pushy, connect(&addrs, &phone.private, &desktop.public, &mine));
        assert_eq!(ids(&got.unwrap()), ["new"]);
    }

    #[tokio::test]
    async fn refuses_a_message_over_the_limit() {
        let (desktop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let flooding = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            wire::read_opening(&mut stream).await.unwrap();
            let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
                .local_private_key(&desktop.private)
                .unwrap()
                .prologue(PROLOGUE)
                .unwrap()
                .build_responder()
                .unwrap();
            let hs = wire::handshake(&mut stream, hs, |_| Ok(())).await.unwrap();
            let mut chan = Secure::new(stream, hs).unwrap();
            let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
            // Far more ids than allowed: refused on the length alone.
            let _ = chan.send(&vec![b' '; MAX_IDS_BYTES + 1]).await;
        };
        let addrs = [addr];
        let (_, got) = tokio::join!(flooding, connect(&addrs, &phone.private, &desktop.public, &[]));
        assert!(matches!(got, Err(Error::Protocol("message too big"))), "{got:?}");
    }

    #[test]
    fn round_ids_follow_the_page_rule() {
        assert!(is_round_id("round-1759233600000"));
        assert!(is_round_id("a.b_c:d-e"));
        assert!(!is_round_id(""));
        assert!(!is_round_id(&"r".repeat(65)));
        assert!(!is_round_id("round 1"));
        assert!(!is_round_id("round-ü"));
    }
}
