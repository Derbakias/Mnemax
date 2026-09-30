//! Pairing: two devices in one person's hands learn each other's key, once.
//!
//! One device shows a code (`42-815-307`) and waits; the other has it typed in and connects. The first two
//! digits only say which waiting device to connect to (they're announced on the network). The other six are
//! the secret. The two devices run SPAKE2 on the whole code: someone watching the network learns nothing
//! they could test guesses against, and someone connecting with a guess gets one try, since a waiting device
//! takes a single attempt and then stops. The SPAKE2 key then keys a Noise XXpsk3 handshake, which swaps the
//! devices' permanent keys: a device that didn't have the code can't finish it.
//!
//! Both screens then show the other device's name and a 4-digit check number from the handshake, and the
//! device is only saved once both people said yes.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;

use super::store::check_name;
use super::wire::{self, Purpose, Secure};
use super::{is_local, random_below, Error, PAIR_PARAMS};

/// How long a pairing code works for.
pub const CODE_LIFETIME: Duration = Duration::from_secs(120);
/// From the code being tried to the two devices showing the check number.
const HANDSHAKE_TIME: Duration = Duration::from_secs(15);
/// How long each person has to say yes.
const ANSWER_TIME: Duration = Duration::from_secs(120);
/// How long a new connection has to say it's a pairing one.
const OPENING_TIME: Duration = Duration::from_secs(5);
const PROLOGUE: &[u8] = b"mnemax pair v1";
/// SPAKE2's message: a side byte and a curve point.
const SPAKE_MSG_LEN: usize = 33;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PairCode {
    /// Which waiting device to connect to: announced on the network, not secret.
    pub nameplate: u8,
    secret: u32,
}

impl PairCode {
    pub fn random() -> Result<Self, Error> {
        Ok(Self { nameplate: random_below(100)? as u8, secret: random_below(1_000_000)? })
    }

    /// Eight digits; spaces, dashes and the like between them are ignored.
    pub fn parse(text: &str) -> Option<Self> {
        let digits: String = text.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
        if digits.len() != 8 || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(Self { nameplate: digits[..2].parse().ok()?, secret: digits[2..].parse().ok()? })
    }

    fn password(&self) -> Password {
        Password::new(format!("mnemax pair v1:{:02}{:06}", self.nameplate, self.secret))
    }
}

impl std::fmt::Display for PairCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:02}-{:03}-{:03}", self.nameplate, self.secret / 1000, self.secret % 1000)
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

/// Waits for the device that has the code. A connection that doesn't open like a pairing one (a port scan,
/// say) is dropped and the code stays good; the first one that tries the code uses it up, right or wrong.
pub async fn host(
    listener: &TcpListener,
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
) -> Result<Paired, Error> {
    let stream = timeout(CODE_LIFETIME, async {
        loop {
            let (mut stream, addr) = listener.accept().await?;
            if !is_local(addr.ip()) {
                continue;
            }
            if let Ok(Ok(Purpose::Pair)) = timeout(OPENING_TIME, wire::read_opening(&mut stream)).await {
                return Ok::<_, Error>(stream);
            }
        }
    })
    .await
    .map_err(|_| Error::CodeExpired)??;
    pair(stream, false, code, me, on_check, answer).await
}

/// Connects to the device showing the code, at the first of its addresses that answers.
pub async fn join(
    addrs: &[std::net::SocketAddr],
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
) -> Result<Paired, Error> {
    let mut stream = wire::connect_any(addrs).await?;
    wire::write_opening(&mut stream, Purpose::Pair).await?;
    pair(stream, true, code, me, on_check, answer).await
}

async fn pair(
    mut stream: TcpStream,
    initiator: bool,
    code: PairCode,
    me: Me<'_>,
    on_check: impl FnOnce(&str, &str),
    answer: oneshot::Receiver<bool>,
) -> Result<Paired, Error> {
    let (mut chan, key, name, check) = timeout(HANDSHAKE_TIME, async {
        let psk = spake(&mut stream, initiator, code).await?;
        let builder = snow::Builder::new(PAIR_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(me.private_key)
            .and_then(|b| b.psk(3, &psk))
            .and_then(|b| b.prologue(PROLOGUE))
            .map_err(|_| Error::Handshake)?;
        let hs = if initiator { builder.build_initiator() } else { builder.build_responder() }
            .map_err(|_| Error::Handshake)?;
        let hs = wire::handshake(&mut stream, hs, |_| Ok(())).await?;
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let check = check_number(hs.get_handshake_hash());
        let mut chan = Secure::new(stream, hs)?;
        chan.send_json(&Hello { name: me.name.to_string() }).await?;
        let hello: Hello = chan.recv_json(1024).await?;
        let name = check_name(&hello.name).map_err(|_| Error::Protocol("bad device name"))?;
        Ok::<_, Error>((chan, key, name, check))
    })
    .await
    .map_err(|_| Error::TimedOut)?
    .map_err(|e| match e {
        // A failed handshake means the two devices had different codes.
        Error::Handshake => Error::WrongCode,
        // The joining device finishes its part of the handshake first, so it may only learn the code was
        // wrong when the other one hangs up.
        Error::Io(_) if initiator => Error::WrongCode,
        e => e,
    })?;

    on_check(&name, &check);
    timeout(ANSWER_TIME, agree(&mut chan, answer)).await.map_err(|_| Error::TimedOut)??;
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
async fn agree(chan: &mut Secure, mut answer: oneshot::Receiver<bool>) -> Result<(), Error> {
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
            chan.send_json(&Answer { accept: mine }).await?;
            if !mine {
                return Err(Error::Declined);
            }
            let theirs: Answer = chan.recv_json(64).await?;
            (mine, theirs.accept)
        }
        First::Theirs => {
            let theirs: Answer = chan.recv_json(64).await?;
            if !theirs.accept {
                return Err(Error::Declined);
            }
            let mine = answer.await.unwrap_or(false);
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
    use crate::sync::SYNC_PARAMS;
    use tokio::io::AsyncWriteExt;

    fn keypair() -> snow::Keypair {
        snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
    }

    fn answer(yes: bool) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        tx.send(yes).unwrap();
        rx
    }

    /// Runs a host and a joiner against each other; the joiner uses `typed` as its code.
    async fn run(
        code: PairCode,
        typed: PairCode,
        host_says: bool,
        joiner_says: bool,
    ) -> (Result<Paired, Error>, Result<Paired, Error>, Vec<String>) {
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let checks = std::sync::Mutex::new(Vec::new());
        let addrs = [addr];
        let (hosted, joined) = tokio::join!(
            host(
                &listener,
                code,
                Me { private_key: &host_keys.private, name: "Laptop" },
                |_, check| checks.lock().unwrap().push(check.to_string()),
                answer(host_says),
            ),
            join(
                &addrs,
                typed,
                Me { private_key: &join_keys.private, name: "Phone" },
                |_, check| checks.lock().unwrap().push(check.to_string()),
                answer(joiner_says),
            ),
        );
        if let (Ok(h), Ok(j)) = (&hosted, &joined) {
            assert_eq!(h.key, join_keys.public);
            assert_eq!(j.key, host_keys.public);
        }
        (hosted, joined, checks.into_inner().unwrap())
    }

    #[tokio::test]
    async fn pairs_with_the_right_code() {
        let code = PairCode::random().unwrap();
        let (hosted, joined, checks) = run(code, code, true, true).await;
        assert_eq!(hosted.unwrap().name, "Phone");
        assert_eq!(joined.unwrap().name, "Laptop");
        assert_eq!(checks.len(), 2);
        assert_eq!(checks[0], checks[1], "both screens show the same check number");
    }

    #[tokio::test]
    async fn a_wrong_code_fails_on_both_devices() {
        let code = PairCode::parse("42-815-307").unwrap();
        let typed = PairCode::parse("42-815-308").unwrap();
        let (hosted, joined, checks) = run(code, typed, true, true).await;
        assert!(matches!(hosted, Err(Error::WrongCode)), "{hosted:?}");
        assert!(matches!(joined, Err(Error::WrongCode)), "{joined:?}");
        assert!(checks.is_empty(), "no one is asked to confirm");
    }

    #[tokio::test]
    async fn a_no_on_either_device_saves_nothing() {
        let code = PairCode::random().unwrap();
        for (host_says, joiner_says) in [(false, true), (true, false), (false, false)] {
            let (hosted, joined, _) = run(code, code, host_says, joiner_says).await;
            assert!(matches!(hosted, Err(Error::Declined)), "{hosted:?}");
            assert!(matches!(joined, Err(Error::Declined)), "{joined:?}");
        }
    }

    #[tokio::test]
    async fn a_code_is_used_up_by_one_wrong_try() {
        let code = PairCode::random().unwrap();
        let wrong = PairCode { secret: (code.secret + 1) % 1_000_000, ..code };
        let keys = keypair();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (addrs, other, phone) = ([addr], keypair(), keypair());
        let hosted = host(&listener, code, Me { private_key: &keys.private, name: "Laptop" }, |_, _| {}, answer(true));
        let guess = join(&addrs, wrong, Me { private_key: &other.private, name: "Other" }, |_, _| {}, answer(true));
        let (hosted, _) = tokio::join!(hosted, guess);
        assert!(matches!(hosted, Err(Error::WrongCode)));
        // The host has stopped: the right code now finds no one taking it.
        let late = timeout(
            Duration::from_secs(2),
            join(&addrs, code, Me { private_key: &phone.private, name: "Phone" }, |_, _| {}, answer(true)),
        )
        .await;
        assert!(!matches!(late, Ok(Ok(_))));
    }

    #[tokio::test]
    async fn a_stray_connection_leaves_the_code_working() {
        let code = PairCode::random().unwrap();
        let (host_keys, join_keys) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let addrs = [addr];
        let stray = async {
            let mut s = TcpStream::connect(addr).await.unwrap();
            s.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
            drop(s);
            join(&addrs, code, Me { private_key: &join_keys.private, name: "Phone" }, |_, _| {}, answer(true)).await
        };
        let (hosted, joined) = tokio::join!(
            host(&listener, code, Me { private_key: &host_keys.private, name: "Laptop" }, |_, _| {}, answer(true)),
            stray
        );
        assert_eq!(hosted.unwrap().name, "Phone");
        assert_eq!(joined.unwrap().name, "Laptop");
    }

    #[test]
    fn reads_and_writes_codes() {
        let code = PairCode::parse("42 815 307").unwrap();
        assert_eq!(code.to_string(), "42-815-307");
        assert_eq!(PairCode::parse("42-815-307"), Some(code));
        assert_eq!(PairCode::parse("07-000-001").unwrap().to_string(), "07-000-001");
        assert!(PairCode::parse("42-815-30").is_none());
        assert!(PairCode::parse("42-815-3077").is_none());
        assert!(PairCode::parse("42-8a5-307").is_none());
        assert!(PairCode::parse("４2-815-307").is_none(), "only ASCII digits");
    }

    #[test]
    fn random_codes_vary() {
        let codes: std::collections::HashSet<String> =
            (0..50).map(|_| PairCode::random().unwrap().to_string()).collect();
        assert!(codes.len() > 45);
    }
}
