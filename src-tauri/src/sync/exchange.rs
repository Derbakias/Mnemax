//! Syncing: two paired devices swap the rounds each is missing, or one tells the other it unpaired it.
//!
//! The device that asks knows the other's key (from pairing) and runs a Noise IK handshake with it, whichever
//! of the two opened the connection. The first handshake message carries its key, encrypted to the other
//! device; the other device checks it against its paired devices and hangs up without answering if it isn't
//! one. After the handshake the asking device says what it wants: to sync (each side then sends the ids of the
//! rounds it has, then the rounds the other lacks), or to unpair (the other device removes it too).
//!
//! A device forgotten on the other side that hasn't been told yet still gets through the handshake, so it
//! knows the answer is really from that device, and the answer is only that it was unpaired: no rounds. Only
//! the paired device itself can unpair this one, never anyone else on the network.
//!
//! Only adding: nothing here can change or remove a round. The rounds that come in are checked again in full
//! by the page before they're saved, the same way an imported file is.

use std::collections::HashSet;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::store::{check_name, hex_encode, Standing};
use super::trace::Trace;
use super::wire::{self, Secure};
use super::{Error, SYNC_PARAMS};

/// A whole sync, from connecting to the last round.
pub const SYNC_TIME: Duration = Duration::from_secs(60);
/// How long a device that connects has to show it's a paired device (the handshake): a paired device takes
/// milliseconds, so anyone else can't hold this one up for long.
const PROVE_TIME: Duration = Duration::from_secs(5);
const PROLOGUE: &[u8] = b"mnemax sync v3";
/// The ask and the reply: a word and a device name (40 characters, up to 4 bytes each).
const MAX_ASK_BYTES: usize = 512;
/// More ids than a device keeps rounds (500), with room to spare.
const MAX_IDS: usize = 2000;
const MAX_ID_CHARS: usize = 64;
/// 500 rounds take at most about 4 MB as sent.
const MAX_ROUNDS_BYTES: usize = 16 * 1024 * 1024;
const MAX_IDS_BYTES: usize = MAX_IDS * (MAX_ID_CHARS + 3) + 64;

/// What the asking device wants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Want {
    Sync,
    Unpair,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ask {
    want: Want,
    /// The asking device's name now, so a rename reaches the other device.
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Reply {
    /// False once the answering device has unpaired the asking one: it forgot it earlier, or it just did
    /// as asked.
    paired: bool,
    /// The answering device's name now (empty when it isn't paired any more).
    name: String,
}

/// How it went for the device that asked.
#[derive(Debug, PartialEq)]
pub enum Asked {
    /// The rounds this device didn't have, and the other device's name now (None if it wasn't a valid one).
    Synced(Vec<Value>, Option<String>),
    /// The other device has unpaired this one (earlier, or just now as asked).
    Unpaired,
}

/// How it went for the device that answered, and the asking device's key.
#[derive(Debug, PartialEq)]
pub enum Answered {
    /// The rounds this device didn't have, and the other device's name now (None if it wasn't a valid one).
    Synced(Vec<u8>, Vec<Value>, Option<String>),
    /// A device forgotten here, now told so.
    ToldForgotten(Vec<u8>),
    /// A paired device unpaired this one: it should go here too.
    Unpaired(Vec<u8>),
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

/// Asks a paired device for `want`, over a connection to it opened for syncing (by either device): this
/// device starts the handshake, with the key it expects. `mine` are this device's rounds, for a sync.
pub async fn initiate(
    mut stream: TcpStream,
    private_key: &[u8],
    peer_key: &[u8],
    my_name: &str,
    want: Want,
    mine: &[Value],
    trace: &Trace,
) -> Result<Asked, Error> {
    timeout(SYNC_TIME, async {
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.remote_public_key(peer_key))
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_initiator())
            .map_err(|_| Error::Handshake)?;
        trace.step(format!("Starting the encrypted handshake with device {}…", short_key(peer_key)));
        let hs = wire::handshake(&mut stream, hs, false, |_| Ok(())).await.map_err(|e| {
            match &e {
                Error::UnknownThere => trace.step("The other device doesn't have this one as paired."),
                // A device waiting to sync hangs up without a word on a connection it can't place.
                Error::Io(e) if hung_up(e) => trace.step(
                    "The other device hung up without answering: it isn't the device paired with this one, or it \
                     has another version of the app.",
                ),
                Error::OtherVersion(theirs) => trace.step(format!(
                    "The other device has sync version {theirs}, this one {}.",
                    wire::PROTOCOL
                )),
                Error::Handshake => trace.step(
                    "The other device ended the handshake: it isn't the device paired with this one, or it has an \
                     older version of the app.",
                ),
                e => trace.step(format!("The connection broke during the handshake ({}).", e.detail())),
            }
            match e {
                Error::Handshake => Error::Refused,
                Error::Io(e) if hung_up(&e) => Error::Refused,
                e => e,
            }
        })?;
        trace.step("Handshake done.");
        let mut chan = Secure::new(stream, hs)?;
        chan.send_json(&Ask { want, name: my_name.to_string() }).await?;
        let reply: Reply = chan.recv_json(MAX_ASK_BYTES).await?;
        if !reply.paired {
            trace.step(match want {
                Want::Unpair => "The other device removed this one too.",
                Want::Sync => "The other device had unpaired this one: it sends no rounds.",
            });
            return Ok(Asked::Unpaired);
        }
        if want == Want::Unpair {
            return Err(Error::Protocol("still paired after asking to unpair"));
        }
        let name = their_name(&reply.name, trace);
        Ok(Asked::Synced(swap(&mut chan, mine, true, trace).await?, name))
    })
    .await
    .map_err(|_| {
        trace.step(format!("The sync didn't finish in {} s.", SYNC_TIME.as_secs()));
        Error::TimedOut
    })?
}

/// Answers a device that asks something, over a connection opened for syncing (by either device).
/// `standing` decides on the other device's key before this one says anything: an unknown one gets nothing
/// at all, a forgotten one only that it was unpaired. `mine` gives this device's rounds, for a sync.
pub async fn answer(
    mut stream: TcpStream,
    private_key: &[u8],
    my_name: &str,
    standing: impl Fn(&[u8]) -> Standing,
    mine: impl FnOnce() -> Vec<Value>,
    trace: &Trace,
) -> Result<Answered, Error> {
    timeout(SYNC_TIME, async {
        let hs = snow::Builder::new(SYNC_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(private_key)
            .and_then(|b| b.prologue(PROLOGUE))
            .and_then(|b| b.build_responder())
            .map_err(|_| Error::Handshake)?;
        let mut seen = Standing::Unknown;
        let handshake = wire::handshake(&mut stream, hs, false, |hs| {
            let Some(key) = hs.get_remote_static() else { return Err(Error::Handshake) };
            seen = standing(key);
            match seen {
                Standing::Paired => trace.step(format!("Device {} is paired with this one.", short_key(key))),
                Standing::Forgotten => {
                    trace.step(format!("Device {} was forgotten here: telling it so.", short_key(key)))
                }
                Standing::Unknown => {
                    trace.step(format!("Device {} isn't paired with this one: hanging up.", short_key(key)));
                    return Err(Error::NotPaired);
                }
            }
            Ok(())
        });
        let hs = timeout(PROVE_TIME, handshake)
            .await
            .unwrap_or_else(|_| {
                let secs = PROVE_TIME.as_secs();
                trace.step(format!("The device that connected didn't finish the handshake in {secs} s."));
                Err(Error::TimedOut)
            })
            .inspect_err(|e| {
                if !matches!(e, Error::NotPaired | Error::TimedOut) {
                    trace.step(format!("The handshake failed ({}).", e.detail()));
                }
            })?;
        trace.step("Handshake done.");
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let mut chan = Secure::new(stream, hs)?;
        let ask: Ask = chan.recv_json(MAX_ASK_BYTES).await?;
        match (seen, ask.want) {
            (Standing::Forgotten, _) => {
                chan.send_json(&Reply { paired: false, name: String::new() }).await?;
                Ok(Answered::ToldForgotten(key))
            }
            (_, Want::Unpair) => {
                trace.step("The other device unpaired this one: removing it here too.");
                chan.send_json(&Reply { paired: false, name: String::new() }).await?;
                Ok(Answered::Unpaired(key))
            }
            (_, Want::Sync) => {
                chan.send_json(&Reply { paired: true, name: my_name.to_string() }).await?;
                let name = their_name(&ask.name, trace);
                let received = swap(&mut chan, &mine(), false, trace).await?;
                Ok(Answered::Synced(key, received, name))
            }
        }
    })
    .await
    .map_err(|_| {
        trace.step(format!("The sync didn't finish in {} s.", SYNC_TIME.as_secs()));
        Error::TimedOut
    })?
}

/// The other device's name as it sent it, if it's a valid one (a bad one keeps the old name here).
fn their_name(name: &str, trace: &Trace) -> Option<String> {
    let name = check_name(name).ok();
    if name.is_none() {
        trace.step("The other device sent a name that isn't valid: keeping the one this device has.");
    }
    name
}

/// The connection closed on this device.
fn hung_up(e: &std::io::Error) -> bool {
    use std::io::ErrorKind::{ConnectionAborted, ConnectionReset, UnexpectedEof};
    matches!(e.kind(), UnexpectedEof | ConnectionReset | ConnectionAborted)
}

/// The start of a key, enough to tell devices apart in the log.
fn short_key(key: &[u8]) -> String {
    hex_encode(&key[..key.len().min(4)])
}

/// The ids first, then the rounds. The device that asked sends each first, so the two never wait on each other.
async fn swap(chan: &mut Secure, mine: &[Value], connecting: bool, trace: &Trace) -> Result<Vec<Value>, Error> {
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
        trace.step("The other device's list of rounds isn't valid.");
        return Err(Error::Protocol("bad round ids"));
    }
    let their_ids: HashSet<&str> = theirs.ids.iter().map(String::as_str).collect();
    let send = Rounds {
        rounds: mine.iter().filter(|r| round_id(r).is_some_and(|id| !their_ids.contains(id))).cloned().collect(),
    };
    trace.step(format!(
        "This device has {}, the other {}. Sending the {} it's missing…",
        rounds(my_ids.len()),
        their_ids.len(),
        send.rounds.len()
    ));
    let received: Rounds = if connecting {
        chan.send_json(&send).await?;
        chan.recv_json(MAX_ROUNDS_BYTES).await?
    } else {
        let received = chan.recv_json(MAX_ROUNDS_BYTES).await?;
        chan.send_json(&send).await?;
        received
    };
    if received.rounds.len() > MAX_IDS {
        trace.step(format!("The other device sent {}, more than a device keeps.", rounds(received.rounds.len())));
        return Err(Error::Protocol("too many rounds"));
    }
    // Only rounds this device lacks and the other said it had, each once.
    let mut wanted: HashSet<&str> = their_ids.difference(&my_ids).copied().collect();
    let sent = received.rounds.len();
    let kept: Vec<Value> =
        received.rounds.into_iter().filter(|r| round_id(r).is_some_and(|id| wanted.remove(id))).collect();
    if kept.len() < sent {
        trace.step(format!("Received {}; kept the {} this device asked for.", rounds(sent), kept.len()));
    } else {
        trace.step(format!("Received {}.", rounds(sent)));
    }
    Ok(kept)
}

/// `1 round`, `3 rounds`.
fn rounds(n: usize) -> String {
    format!("{n} round{}", if n == 1 { "" } else { "s" })
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
    use crate::sync::trace;
    use crate::sync::wire::Purpose;
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

    #[derive(Clone, Copy, Debug)]
    enum Way {
        /// The device that asks connects to the other.
        In,
        /// It can't: the other connects to it (after its request).
        Out,
    }

    /// The device that asks (`asker`, for `want`) and the one answering. The answering one gives the asker's
    /// key `standing` (any other key is unknown to it); the asking one expects to reach `expected`.
    #[allow(clippy::too_many_arguments)]
    async fn run(
        way: Way,
        answerer: &snow::Keypair,
        asker: &snow::Keypair,
        standing: Standing,
        expected: Vec<u8>,
        want: Want,
        answering_has: Vec<Value>,
        asking_has: Vec<Value>,
    ) -> (Result<Answered, Error>, Result<Asked, Error>) {
        let answering_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let asking_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (answering_addr, asking_addr) =
            (answering_listener.local_addr().unwrap(), asking_listener.local_addr().unwrap());
        let standing_of = |k: &[u8]| if k == asker.public.as_slice() { standing } else { Standing::Unknown };
        let answering = async {
            let stream = match way {
                Way::In => wire::accept(&answering_listener, Purpose::Sync, Trace::off()).await.unwrap(),
                Way::Out => wire::open(&[asking_addr], Purpose::Sync, Trace::off()).await.unwrap(),
            };
            answer(stream, &answerer.private, "Laptop", standing_of, || answering_has, Trace::off()).await
        };
        let asking = async {
            let stream = match way {
                Way::In => wire::open(&[answering_addr], Purpose::Sync, Trace::off()).await.unwrap(),
                Way::Out => wire::accept(&asking_listener, Purpose::Sync, Trace::off()).await.unwrap(),
            };
            initiate(stream, &asker.private, &expected, "Phone", want, &asking_has, Trace::off()).await
        };
        tokio::join!(answering, asking)
    }

    async fn initiate_at(
        addr: std::net::SocketAddr,
        keys: &snow::Keypair,
        peer: &[u8],
        mine: &[Value],
    ) -> Result<Vec<Value>, Error> {
        let stream = wire::open(&[addr], Purpose::Sync, Trace::off()).await?;
        match initiate(stream, &keys.private, peer, "Phone", Want::Sync, mine, Trace::off()).await? {
            Asked::Synced(rounds, _) => Ok(rounds),
            Asked::Unpaired => panic!("unpaired"),
        }
    }

    /// The answering side of a paired device that talks the protocol by hand, up to the rounds.
    async fn paired_by_hand(listener: &TcpListener, keys: &snow::Keypair) -> Secure {
        let (mut stream, _) = listener.accept().await.unwrap();
        wire::read_opening(&mut stream, false).await.unwrap();
        let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
            .local_private_key(&keys.private)
            .unwrap()
            .prologue(PROLOGUE)
            .unwrap()
            .build_responder()
            .unwrap();
        let hs = wire::handshake(&mut stream, hs, false, |_| Ok(())).await.unwrap();
        let mut chan = Secure::new(stream, hs).unwrap();
        let _: Ask = chan.recv_json(MAX_ASK_BYTES).await.unwrap();
        chan.send_json(&Reply { paired: true, name: "Laptop".into() }).await.unwrap();
        chan
    }

    #[tokio::test]
    async fn swaps_the_rounds_each_lacks_either_way() {
        for way in [Way::In, Way::Out] {
            let (desktop, phone) = (keypair(), keypair());
            let (answered, asked) = run(
                way,
                &desktop,
                &phone,
                Standing::Paired,
                desktop.public.clone(),
                Want::Sync,
                vec![round("yesterday-1"), round("yesterday-2"), round("both")],
                vec![round("today-1"), round("both")],
            )
            .await;
            let Answered::Synced(key, desktop_got, phone_name) = answered.unwrap() else { panic!("{way:?}") };
            assert_eq!(key, phone.public);
            assert_eq!(ids(&desktop_got), ["today-1"], "{way:?}");
            assert_eq!(phone_name.as_deref(), Some("Phone"), "each learns the other's name now");
            let Asked::Synced(phone_got, desktop_name) = asked.unwrap() else { panic!("{way:?}") };
            assert_eq!(ids(&phone_got), ["yesterday-1", "yesterday-2"], "{way:?}");
            assert_eq!(desktop_name.as_deref(), Some("Laptop"));
        }
    }

    #[tokio::test]
    async fn turns_away_a_device_it_was_not_paired_with_either_way() {
        for (way, want) in [(Way::In, Want::Sync), (Way::Out, Want::Sync), (Way::In, Want::Unpair)] {
            let (desktop, stranger) = (keypair(), keypair());
            let (answered, asked) = run(
                way,
                &desktop,
                &stranger,
                Standing::Unknown,
                desktop.public.clone(),
                want,
                vec![round("mine")],
                vec![round("theirs")],
            )
            .await;
            assert!(matches!(answered, Err(Error::NotPaired)), "{way:?} {want:?} {answered:?}");
            assert!(matches!(asked, Err(Error::UnknownThere)), "{way:?} {want:?} {asked:?}");
        }
    }

    #[tokio::test]
    async fn tells_a_forgotten_device_and_gives_it_no_rounds() {
        for way in [Way::In, Way::Out] {
            let (desktop, phone) = (keypair(), keypair());
            let (answered, asked) = run(
                way,
                &desktop,
                &phone,
                Standing::Forgotten,
                desktop.public.clone(),
                Want::Sync,
                vec![round("desktop-only")],
                vec![round("phone-only")],
            )
            .await;
            assert_eq!(answered.unwrap(), Answered::ToldForgotten(phone.public.clone()), "{way:?}");
            assert_eq!(asked.unwrap(), Asked::Unpaired, "{way:?}");
        }
    }

    #[tokio::test]
    async fn a_paired_device_can_unpair_this_one() {
        let (desktop, phone) = (keypair(), keypair());
        let (answered, asked) = run(
            Way::In,
            &desktop,
            &phone,
            Standing::Paired,
            desktop.public.clone(),
            Want::Unpair,
            vec![round("desktop-only")],
            vec![],
        )
        .await;
        assert_eq!(answered.unwrap(), Answered::Unpaired(phone.public.clone()));
        assert_eq!(asked.unwrap(), Asked::Unpaired);
    }

    #[tokio::test(start_paused = true)]
    async fn a_connection_that_never_finishes_the_handshake_is_let_go_soon() {
        let desktop = keypair();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (accepted, _stranger) = tokio::join!(listener.accept(), TcpStream::connect(addr));
        let started = tokio::time::Instant::now();
        let (stream, _) = accepted.unwrap();
        let answered = answer(stream, &desktop.private, "Laptop", |_| Standing::Paired, Vec::new, Trace::off()).await;
        assert!(matches!(answered, Err(Error::TimedOut)), "{answered:?}");
        assert!(started.elapsed() < SYNC_TIME / 2, "{:?}", started.elapsed());
    }

    #[tokio::test]
    async fn a_connection_that_breaks_is_not_a_device_that_forgot_this_one() {
        let (desktop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let breaking = async {
            let (mut stream, _) = listener.accept().await.unwrap();
            wire::read_opening(&mut stream, false).await.unwrap();
            let _ = wire::read_frame(&mut stream).await.unwrap();
            drop(stream);
        };
        let asking = async {
            let stream = wire::open(&[addr], Purpose::Sync, Trace::off()).await.unwrap();
            initiate(stream, &phone.private, &desktop.public, "Phone", Want::Unpair, &[], Trace::off()).await
        };
        let (_, asked) = tokio::join!(breaking, asking);
        // A hang-up in the handshake is what a device that can't place this one does: not accepted, which
        // forgetting doesn't take as "already gone" (see `forgotten_there`).
        assert!(matches!(asked, Err(Error::Refused)), "{asked:?}");
    }

    #[tokio::test]
    async fn the_log_says_why_a_device_was_turned_away() {
        let (desktop, stranger) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let ((answering_trace, answering_steps), (asking_trace, asking_steps)) = (trace::kept(), trace::kept());
        let answering = async {
            let stream = wire::accept(&listener, Purpose::Sync, &answering_trace).await.unwrap();
            answer(stream, &desktop.private, "Laptop", |_| Standing::Unknown, Vec::new, &answering_trace).await
        };
        let asking = async {
            let stream = wire::open(&[addr], Purpose::Sync, &asking_trace).await.unwrap();
            initiate(stream, &stranger.private, &desktop.public, "Other", Want::Sync, &[], &asking_trace).await
        };
        let _ = tokio::join!(answering, asking);
        let (answered, asked) = (answering_steps.lock().unwrap(), asking_steps.lock().unwrap());
        assert!(answered.iter().any(|s| s.contains("isn't paired with this one: hanging up")), "{answered:?}");
        assert!(asked.iter().any(|s| s == "The other device doesn't have this one as paired."), "{asked:?}");
    }

    #[tokio::test]
    async fn will_not_sync_with_a_device_pretending_to_be_a_paired_one() {
        // The phone expects the desktop's key; an impostor answers with its own.
        for way in [Way::In, Way::Out] {
            let (desktop, phone, impostor) = (keypair(), keypair(), keypair());
            let (answered, asked) = run(
                way,
                &impostor,
                &phone,
                Standing::Paired,
                desktop.public.clone(),
                Want::Sync,
                vec![round("bait")],
                vec![round("secret")],
            )
            .await;
            assert!(answered.is_err(), "{way:?}");
            assert!(asked.is_err(), "{way:?}");
        }
    }

    #[tokio::test]
    async fn keeps_only_the_rounds_it_asked_for() {
        let (desktop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        // A paired device that sends more than it said it had: a round the other already has, one it never
        // mentioned, one twice, and something that isn't a round.
        let pushy = async {
            let mut chan = paired_by_hand(&listener, &desktop).await;
            let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
            chan.send_json(&Have { ids: vec!["new".into(), "shared".into()] }).await.unwrap();
            let _: Rounds = chan.recv_json(MAX_ROUNDS_BYTES).await.unwrap();
            let rounds = vec![round("new"), round("new"), round("shared"), round("unasked"), json!(42)];
            chan.send_json(&Rounds { rounds }).await.unwrap();
        };
        let mine = [round("shared")];
        let (_, got) = tokio::join!(pushy, initiate_at(addr, &phone, &desktop.public, &mine));
        assert_eq!(ids(&got.unwrap()), ["new"]);
    }

    #[tokio::test]
    async fn a_bad_or_huge_id_list_is_refused_before_any_rounds() {
        // A paired device is still not trusted to send a well-formed list: a junk id, or more ids than a
        // device could ever hold, is refused on sight, before this device sends or takes any rounds.
        for bad in [vec!["ok".to_string(), "not a round id!".to_string()], vec!["r".to_string(); MAX_IDS + 1]] {
            let (desktop, phone) = (keypair(), keypair());
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let liar = async {
                let mut chan = paired_by_hand(&listener, &desktop).await;
                let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
                chan.send_json(&Have { ids: bad }).await.unwrap();
                // It must never be asked for rounds after a bad list.
                let after = tokio::time::timeout(std::time::Duration::from_millis(300), chan.recv(MAX_ROUNDS_BYTES)).await;
                assert!(after.is_err() || after.unwrap().is_err(), "no rounds should be exchanged");
            };
            let mine = [round("mine")];
            let (_, got) = tokio::join!(liar, initiate_at(addr, &phone, &desktop.public, &mine));
            assert!(matches!(got, Err(Error::Protocol("bad round ids"))), "{got:?}");
        }
    }

    #[tokio::test]
    async fn refuses_a_message_over_the_limit() {
        let (desktop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let flooding = async {
            let mut chan = paired_by_hand(&listener, &desktop).await;
            let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
            // Far more ids than allowed: refused on the length alone.
            let _ = chan.send(&vec![b' '; MAX_IDS_BYTES + 1]).await;
        };
        let (_, got) = tokio::join!(flooding, initiate_at(addr, &phone, &desktop.public, &[]));
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
