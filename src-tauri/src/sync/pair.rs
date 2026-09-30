//! Pairing: two devices in one person's hands learn each other's key, once.
//!
//! One device shows a 6-digit code (and a QR code with it, for a phone to scan) and waits; the other has it
//! typed in or scanned, and they connect (either way round, see `wire::meet`). The two devices run SPAKE2 on
//! the code: someone watching the network learns nothing they could test guesses against, and someone
//! connecting with a guess gets one try (one in a million), since a waiting device takes a single attempt and
//! then stops, and a code only works for 30 seconds. The SPAKE2 key then keys a Noise XXpsk0 handshake, which
//! swaps the devices' permanent keys: a device that didn't have the code can't finish it, and, since the key is
//! mixed in from the first message, can't read the keys either, even by getting between the two devices. A
//! device's key stays known to its paired devices only, which keeps its sync announcements unreadable to anyone
//! else (see `discovery`).
//!
//! Both screens then show the other device's name and a 4-digit check number from the handshake, and the
//! device is only saved once both people said yes.
//!
//! Nothing on the network says which waiting device a code belongs to (that would take digits from the
//! secret), so if two people pair on the same network at the same moment, one try may reach the wrong device
//! and use up its code; that person makes a new one.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::store::check_name;
use super::trace::Trace;
use super::wire::{self, Purpose, Requests, Secure};
use super::{random_below, Error, PAIR_PARAMS};

/// How long a pairing code works for: long enough to type 6 digits or scan them, and no longer.
pub const CODE_LIFETIME: Duration = Duration::from_secs(30);
/// From the code being tried to the two devices showing the check number.
const HANDSHAKE_TIME: Duration = Duration::from_secs(15);
/// How long each person has to say yes.
const ANSWER_TIME: Duration = Duration::from_secs(120);
const PROLOGUE: &[u8] = b"mnemax pair v3";
/// SPAKE2's message: a side byte and a curve point.
const SPAKE_MSG_LEN: usize = 33;
const CODE_DIGITS: usize = 6;
/// What the QR code holds, before the code: so a phone can tell a Mnemax QR code from any other.
const QR_PREFIX: &str = "mnemax:pair:";

/// Six random digits, all secret.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PairCode(u32);

impl PairCode {
    pub fn random() -> Result<Self, Error> {
        Ok(Self(random_below(1_000_000)?))
    }

    /// Six digits, as typed (spaces are ignored).
    pub fn parse(text: &str) -> Option<Self> {
        let digits: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        if digits.len() != CODE_DIGITS || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(Self(digits.parse().ok()?))
    }

    /// What the QR code shows: the code, marked as Mnemax's.
    pub fn qr_text(&self) -> String {
        format!("{QR_PREFIX}{self}")
    }

    fn password(&self) -> Password {
        Password::new(format!("mnemax pair v2:{self}"))
    }
}

impl std::fmt::Display for PairCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:06}", self.0)
    }
}

/// This device, as pairing needs it.
pub struct Me<'a> {
    pub private_key: &'a [u8],
    pub name: &'a str,
}

/// The other device, once both people said yes.
#[derive(Debug)]
pub struct Paired {
    pub key: Vec<u8>,
    pub name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello {
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Answer {
    accept: bool,
}

/// Waits for the device that has the code: its connection in, or its request for one out (see
/// `wire::meet`). A connection that doesn't open like a pairing one (a port scan, say) is dropped and the code
/// stays good; the first one that tries the code uses it up, right or wrong.
pub async fn host(
    listener: &TcpListener,
    requests: &mut impl Requests,
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
    trace: &Trace,
) -> Result<Paired, Error> {
    trace.step(format!("Waiting up to {} s for the other device…", CODE_LIFETIME.as_secs()));
    let stream = timeout(CODE_LIFETIME, wire::meet(listener, Purpose::Pair, requests, trace))
        .await
        .map_err(|_| {
            trace.step(format!("No device tried the code in {} s.", CODE_LIFETIME.as_secs()));
            Error::CodeExpired
        })??;
    pair(stream, false, code, me, on_check, answer, trace).await
}

/// Pairs with the device showing the code, over a connection to it opened for pairing (by either device).
pub async fn join(
    stream: TcpStream,
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
    trace: &Trace,
) -> Result<Paired, Error> {
    pair(stream, true, code, me, on_check, answer, trace).await
}

async fn pair(
    mut stream: TcpStream,
    initiator: bool,
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
    trace: &Trace,
) -> Result<Paired, Error> {
    let (mut chan, key, name, check) = timeout(HANDSHAKE_TIME, async {
        trace.step("Checking the code with the other device (SPAKE2)…");
        let psk = spake(&mut stream, initiator, code).await?;
        trace.step("Starting the encrypted handshake…");
        let builder = snow::Builder::new(PAIR_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(me.private_key)
            .and_then(|b| b.psk(0, &psk))
            .and_then(|b| b.prologue(PROLOGUE))
            .map_err(|_| Error::Handshake)?;
        let hs = if initiator { builder.build_initiator() } else { builder.build_responder() }
            .map_err(|_| Error::Handshake)?;
        let hs = wire::handshake(&mut stream, hs, true, |_| Ok(())).await?;
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let check = check_number(hs.get_handshake_hash());
        let mut chan = Secure::new(stream, hs)?;
        trace.step("Handshake done. Swapping device names…");
        chan.send_json(&Hello { name: me.name.to_string() }).await?;
        let hello: Hello = chan.recv_json(1024).await?;
        let name = check_name(&hello.name).map_err(|_| Error::Protocol("bad device name"))?;
        Ok::<_, Error>((chan, key, name, check))
    })
    .await
    .map_err(|_| {
        trace.step(format!("The other device stopped answering for {} s.", HANDSHAKE_TIME.as_secs()));
        Error::TimedOut
    })?
    .map_err(|e| match e {
        Error::Handshake => {
            trace.step("The handshake failed: the two devices had different codes.");
            Error::WrongCode
        }
        // The joining device finishes its part of the handshake first, so it may only learn the code was
        // wrong when the other one hangs up.
        Error::Io(e) if initiator => {
            trace.step(format!("The other device hung up during the handshake ({e}): most likely a different code."));
            Error::WrongCode
        }
        e => e,
    })?;

    trace.step(format!("The other device is {name:?}; check number {check}. Waiting for both answers…"));
    on_check(&name, &check);
    let agreed = timeout(ANSWER_TIME, agree(&mut chan, answer, trace)).await.map_err(|_| {
        trace.step(format!("No answer from both people in {} s.", ANSWER_TIME.as_secs()));
        Error::TimedOut
    })?;
    agreed?;
    trace.step("Both said yes.");
    Ok(Paired { key, name })
}

/// Swaps SPAKE2 messages; both devices end with the same key only if they had the same code.
async fn spake(stream: &mut TcpStream, initiator: bool, code: PairCode) -> Result<[u8; 32], Error> {
    let (a, b) = (Identity::new(b"mnemax pair a"), Identity::new(b"mnemax pair b"));
    let (state, msg) = if initiator {
        Spake2::<Ed25519Group>::start_a(&code.password(), &a, &b)
    } else {
        Spake2::<Ed25519Group>::start_b(&code.password(), &a, &b)
    };
    // Neither message depends on the other, so both send first.
    wire::write_frame(stream, &msg).await?;
    let theirs = wire::read_frame(stream).await?;
    if theirs.len() != SPAKE_MSG_LEN {
        return Err(Error::Protocol("bad pairing message"));
    }
    let key = state.finish(&theirs).map_err(|_| Error::Protocol("bad pairing message"))?;
    key.try_into().map_err(|_| Error::Protocol("bad pairing key"))
}

/// Both people's answers: this device's comes from the screen, the other's over the connection, in either
/// order. A no from either side ends it on both.
async fn agree(chan: &mut Secure, mut answer: oneshot::Receiver<bool>, trace: &Trace) -> Result<(), Error> {
    enum First {
        Mine(bool),
        Theirs,
    }
    let first = tokio::select! {
        mine = &mut answer => First::Mine(mine.unwrap_or(false)),
        ready = chan.readable() => { ready?; First::Theirs }
    };
    let (mine, theirs) = match first {
        First::Mine(mine) => {
            trace.step(if mine { "This device said yes." } else { "This device said no." });
            chan.send_json(&Answer { accept: mine }).await?;
            if !mine {
                return Err(Error::Declined);
            }
            let theirs: Answer = chan.recv_json(64).await?;
            trace.step(if theirs.accept { "The other device said yes." } else { "The other device said no." });
            (mine, theirs.accept)
        }
        First::Theirs => {
            let theirs: Answer = chan.recv_json(64).await?;
            trace.step(if theirs.accept { "The other device said yes." } else { "The other device said no." });
            if !theirs.accept {
                return Err(Error::Declined);
            }
            let mine = answer.await.unwrap_or(false);
            trace.step(if mine { "This device said yes." } else { "This device said no." });
            chan.send_json(&Answer { accept: mine }).await?;
            (mine, theirs.accept)
        }
    };
    if mine && theirs {
        Ok(())
    } else {
        Err(Error::Declined)
    }
}

/// Four digits both devices work out from the handshake, for the people to compare.
fn check_number(handshake_hash: &[u8]) -> String {
    use blake2::{Blake2s256, Digest};
    let digest = Blake2s256::new().chain_update(b"mnemax check").chain_update(handshake_hash).finalize();
    let n = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 10_000;
    format!("{n:04}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::{trace, SYNC_PARAMS};
    use std::net::SocketAddr;
    use tokio::io::AsyncWriteExt;
    use tokio::sync::mpsc;

    fn keypair() -> snow::Keypair {
        snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
    }

    fn answer(yes: bool) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        tx.send(yes).unwrap();
        rx
    }

    /// A host that no device asks to connect out.
    fn no_requests() -> mpsc::Receiver<Vec<SocketAddr>> {
        mpsc::channel(1).1
    }

    /// The joining device, connecting to the host.
    async fn join_at(addr: SocketAddr, code: PairCode, keys: &snow::Keypair, says: bool) -> Result<Paired, Error> {
        let stream = wire::open(&[addr], Purpose::Pair, Trace::off()).await?;
        let me = Me { private_key: &keys.private, name: "Phone" };
        join(stream, code, me, |_, _| {}, answer(says), Trace::off()).await
    }

    #[derive(Clone, Copy, Debug)]
    enum Way {
        /// The joining device connects to the host.
        In,
        /// The joining device can't: it asks, and the host connects to it.
        Out,
    }

    /// Runs a host and a joiner against each other; the joiner uses `typed` as its code.
    async fn run(
        way: Way,
        code: PairCode,
        typed: PairCode,
        host_says: bool,
        joiner_says: bool,
    ) -> (Result<Paired, Error>, Result<Paired, Error>, Vec<String>) {
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let host_addr = listener.local_addr().unwrap();
        let (ask, mut requests) = mpsc::channel(1);
        let checks = std::sync::Mutex::new(Vec::new());
        let (host_trace, join_trace) = (Trace::off(), Trace::off());
        let joining = async {
            let stream = match way {
                Way::In => wire::open(&[host_addr], Purpose::Pair, join_trace).await?,
                Way::Out => {
                    let own = TcpListener::bind("127.0.0.1:0").await.unwrap();
                    ask.send(vec![own.local_addr().unwrap()]).await.unwrap();
                    wire::accept(&own, Purpose::Pair, join_trace).await?
                }
            };
            join(
                stream,
                typed,
                Me { private_key: &join_keys.private, name: "Phone" },
                |_, check| checks.lock().unwrap().push(check.to_string()),
                answer(joiner_says),
                join_trace,
            )
            .await
        };
        let (hosted, joined) = tokio::join!(
            host(
                &listener,
                &mut requests,
                code,
                Me { private_key: &host_keys.private, name: "Laptop" },
                |_, check| checks.lock().unwrap().push(check.to_string()),
                answer(host_says),
                host_trace,
            ),
            joining,
        );
        if let (Ok(h), Ok(j)) = (&hosted, &joined) {
            assert_eq!(h.key, join_keys.public);
            assert_eq!(j.key, host_keys.public);
        }
        (hosted, joined, checks.into_inner().unwrap())
    }

    #[tokio::test]
    async fn pairs_with_the_right_code_either_way() {
        for way in [Way::In, Way::Out] {
            let code = PairCode::random().unwrap();
            let (hosted, joined, checks) = run(way, code, code, true, true).await;
            assert_eq!(hosted.unwrap().name, "Phone", "{way:?}");
            assert_eq!(joined.unwrap().name, "Laptop", "{way:?}");
            assert_eq!(checks.len(), 2);
            assert_eq!(checks[0], checks[1], "both screens show the same check number");
        }
    }

    #[tokio::test]
    async fn a_wrong_code_fails_on_both_devices_either_way() {
        let code = PairCode::parse("815307").unwrap();
        let typed = PairCode::parse("815308").unwrap();
        for way in [Way::In, Way::Out] {
            let (hosted, joined, checks) = run(way, code, typed, true, true).await;
            assert!(matches!(hosted, Err(Error::WrongCode)), "{way:?} {hosted:?}");
            assert!(matches!(joined, Err(Error::WrongCode)), "{way:?} {joined:?}");
            assert!(checks.is_empty(), "no one is asked to confirm");
        }
    }

    #[tokio::test]
    async fn the_log_says_why_pairing_failed() {
        let code = PairCode::random().unwrap();
        let wrong = PairCode((code.0 + 1) % 1_000_000);
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let ((host_trace, host_steps), (join_trace, join_steps)) = (trace::kept(), trace::kept());
        let stray = async {
            // A connection that isn't Mnemax's, then the device with the wrong code.
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
            drop(s);
            let stream = wire::open(&[addr], Purpose::Pair, &join_trace).await.unwrap();
            let me = Me { private_key: &join_keys.private, name: "Phone" };
            join(stream, wrong, me, |_, _| {}, answer(true), &join_trace).await
        };
        let mut requests = no_requests();
        let me = Me { private_key: &host_keys.private, name: "Laptop" };
        let _ = tokio::join!(host(&listener, &mut requests, code, me, |_, _| {}, answer(true), &host_trace), stray);
        let (hosted, joined) = (host_steps.lock().unwrap(), join_steps.lock().unwrap());
        assert!(hosted.iter().any(|s| s.contains("not a Mnemax connection")), "{hosted:?}");
        assert!(hosted.iter().any(|s| s.contains("different codes")), "{hosted:?}");
        assert!(joined.iter().any(|s| s.starts_with(&format!("Connected to {addr}"))), "{joined:?}");
        assert!(joined.iter().any(|s| s.contains("different code")), "{joined:?}");
    }

    #[tokio::test]
    async fn a_no_on_either_device_saves_nothing() {
        let code = PairCode::random().unwrap();
        for way in [Way::In, Way::Out] {
            for (host_says, joiner_says) in [(false, true), (true, false), (false, false)] {
                let (hosted, joined, _) = run(way, code, code, host_says, joiner_says).await;
                assert!(matches!(hosted, Err(Error::Declined)), "{hosted:?}");
                assert!(matches!(joined, Err(Error::Declined)), "{joined:?}");
            }
        }
    }

    #[tokio::test]
    async fn a_code_is_used_up_by_one_wrong_try() {
        let code = PairCode::random().unwrap();
        let wrong = PairCode((code.0 + 1) % 1_000_000);
        let keys = keypair();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (other, phone, mut requests) = (keypair(), keypair(), no_requests());
        let hosted = host(
            &listener,
            &mut requests,
            code,
            Me { private_key: &keys.private, name: "Laptop" },
            |_, _| {},
            answer(true),
            Trace::off(),
        );
        let (hosted, _) = tokio::join!(hosted, join_at(addr, wrong, &other, true));
        assert!(matches!(hosted, Err(Error::WrongCode)));
        // The host has stopped: the right code now finds no one taking it.
        let late = timeout(Duration::from_secs(2), join_at(addr, code, &phone, true)).await;
        assert!(!matches!(late, Ok(Ok(_))));
    }

    #[tokio::test(start_paused = true)]
    async fn a_code_stops_working_after_30_seconds() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let keys = keypair();
        let started = tokio::time::Instant::now();
        let hosted = host(
            &listener,
            &mut no_requests(),
            PairCode::random().unwrap(),
            Me { private_key: &keys.private, name: "Laptop" },
            |_, _| {},
            answer(true),
            Trace::off(),
        )
        .await;
        assert!(matches!(hosted, Err(Error::CodeExpired)), "{hosted:?}");
        assert_eq!(started.elapsed(), CODE_LIFETIME);
    }

    #[tokio::test]
    async fn a_stray_connection_leaves_the_code_working() {
        let code = PairCode::random().unwrap();
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let stray = async {
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
            drop(s);
            join_at(addr, code, &join_keys, true).await
        };
        let mut requests = no_requests();
        let (hosted, joined) = tokio::join!(
            host(
                &listener,
                &mut requests,
                code,
                Me { private_key: &host_keys.private, name: "Laptop" },
                |_, _| {},
                answer(true),
                Trace::off(),
            ),
            stray
        );
        assert_eq!(hosted.unwrap().name, "Phone");
        assert_eq!(joined.unwrap().name, "Laptop");
    }

    #[tokio::test]
    async fn a_request_to_a_dead_address_leaves_the_code_working() {
        // An old request whose device is gone: the host tries it, fails, and keeps waiting.
        let code = PairCode::random().unwrap();
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let dead = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap();
        let (ask, mut requests) = mpsc::channel(1);
        ask.send(vec![dead]).await.unwrap();
        let (hosted, joined) = tokio::join!(
            host(
                &listener,
                &mut requests,
                code,
                Me { private_key: &host_keys.private, name: "Laptop" },
                |_, _| {},
                answer(true),
                Trace::off(),
            ),
            join_at(addr, code, &join_keys, true)
        );
        assert_eq!(hosted.unwrap().name, "Phone");
        assert_eq!(joined.unwrap().name, "Laptop");
    }

    #[test]
    fn reads_and_writes_codes() {
        let code = PairCode::parse("815307").unwrap();
        assert_eq!(code.to_string(), "815307");
        assert_eq!(PairCode::parse(" 815 307 "), Some(code));
        assert_eq!(PairCode::parse("000001").unwrap().to_string(), "000001");
        assert_eq!(code.qr_text(), "mnemax:pair:815307");
        assert!(PairCode::parse("81530").is_none());
        assert!(PairCode::parse("8153077").is_none());
        assert!(PairCode::parse("815-307").is_none());
        assert!(PairCode::parse("8a5307").is_none());
        assert!(PairCode::parse("８15307").is_none(), "only ASCII digits");
    }

    #[test]
    fn random_codes_vary() {
        let codes: std::collections::HashSet<String> =
            (0..50).map(|_| PairCode::random().unwrap().to_string()).collect();
        assert!(codes.len() > 45);
    }
}
