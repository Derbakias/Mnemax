//! Pairing: two of your devices learn each other's secret-key "fingerprint" (public key), once.
//!
//! One device shows its address and a 9-digit code, and waits. The other connects to that address and both
//! check the code with SPAKE2, a method that never sends the code itself: someone listening learns nothing
//! they could test guesses against, and someone guessing gets one try (one chance in a billion), because
//! the waiting device takes only one attempt and the code stops working after a minute.
//!
//! The result of SPAKE2 then locks an encrypted handshake (Noise XXpsk0) in which the two devices swap their
//! public keys and names. A device without the code can't finish it, or even read the keys.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::store::check_name;
use super::trace::Trace;
use super::wire::{self, Purpose, Secure};
use super::{random_below, Error, PAIR_PARAMS};

/// How long a code works: enough to scan it or type it, and no longer.
pub const CODE_LIFETIME: Duration = Duration::from_secs(60);
/// From the first message to the end of pairing.
const HANDSHAKE_TIME: Duration = Duration::from_secs(15);
const PROLOGUE: &[u8] = b"mnemax pair v4";
/// A SPAKE2 message is always 33 bytes.
const SPAKE_MSG_LEN: usize = 33;
const CODE_DIGITS: usize = 9;

/// Nine random digits, all secret.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PairCode(u32);

impl PairCode {
    pub fn random() -> Result<Self, Error> {
        Ok(Self(random_below(1_000_000_000)?))
    }

    /// Nine digits, as typed. Spaces are ignored.
    pub fn parse(text: &str) -> Option<Self> {
        let digits: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        if digits.len() != CODE_DIGITS || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        Some(Self(digits.parse().ok()?))
    }

    fn password(&self) -> Password {
        Password::new(format!("mnemax pair v4:{self}"))
    }
}

impl std::fmt::Display for PairCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:09}", self.0)
    }
}

/// This device, as pairing needs it.
pub struct Me<'a> {
    pub private_key: &'a [u8],
    pub name: &'a str,
}

/// The other device, once paired.
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

/// The device showing the code: waits for the other one to connect. The first connection that tries the
/// code uses it up, right or wrong. Connections that aren't Mnemax pairing ones are ignored.
pub async fn host(listener: &TcpListener, code: PairCode, me: Me<'_>, trace: &Trace) -> Result<Paired, Error> {
    trace.step(format!("Waiting up to {} s for the other device…", CODE_LIFETIME.as_secs()));
    let stream = timeout(CODE_LIFETIME, wire::accept(listener, Purpose::Pair, trace)).await.map_err(|_| {
        trace.step(format!("No device tried the code in {} s.", CODE_LIFETIME.as_secs()));
        Error::CodeExpired
    })??;
    pair(stream, false, code, me, trace).await
}

/// The device the code was typed into: pairs over a connection it opened to the device showing the code.
pub async fn join(stream: TcpStream, code: PairCode, me: Me<'_>, trace: &Trace) -> Result<Paired, Error> {
    pair(stream, true, code, me, trace).await
}

async fn pair(
    mut stream: TcpStream,
    joining: bool,
    code: PairCode,
    me: Me<'_>,
    trace: &Trace,
) -> Result<Paired, Error> {
    let steps = async {
        trace.step("Checking the code with the other device…");
        let psk = spake(&mut stream, joining, code).await?;
        trace.step("Starting the encrypted handshake…");
        let builder = snow::Builder::new(PAIR_PARAMS.parse().expect("valid Noise params"))
            .local_private_key(me.private_key)
            .and_then(|b| b.psk(0, &psk))
            .and_then(|b| b.prologue(PROLOGUE))
            .map_err(|_| Error::Handshake)?;
        let hs = if joining { builder.build_initiator() } else { builder.build_responder() }
            .map_err(|_| Error::Handshake)?;
        let hs = wire::handshake(&mut stream, hs, true, |_| Ok(())).await?;
        let key = hs.get_remote_static().ok_or(Error::Handshake)?.to_vec();
        let mut chan = Secure::new(stream, hs)?;
        trace.step("Handshake done. Swapping device names…");
        chan.send_json(&Hello { name: me.name.to_string() }).await?;
        let hello: Hello = chan.recv_json(1024).await?;
        let name = check_name(&hello.name).map_err(|_| Error::Protocol("bad device name"))?;
        Ok(Paired { key, name })
    };
    let paired = timeout(HANDSHAKE_TIME, steps).await.map_err(|_| {
        trace.step(format!("The other device stopped answering for {} s.", HANDSHAKE_TIME.as_secs()));
        Error::TimedOut
    })?;
    paired.map_err(|e| match e {
        Error::Handshake => {
            trace.step("The handshake failed: the two devices had different codes.");
            Error::WrongCode
        }
        // The joining device finishes its part first, so it may only learn the code was wrong when the
        // other one hangs up.
        Error::Io(e) if joining => {
            trace.step(format!("The other device hung up ({e}): most likely a different code."));
            Error::WrongCode
        }
        e => e,
    })
}

/// Swaps SPAKE2 messages. Both devices end up with the same secret only if they had the same code.
async fn spake(stream: &mut TcpStream, joining: bool, code: PairCode) -> Result<[u8; 32], Error> {
    let (a, b) = (Identity::new(b"mnemax pair a"), Identity::new(b"mnemax pair b"));
    let (state, msg) = if joining {
        Spake2::<Ed25519Group>::start_a(&code.password(), &a, &b)
    } else {
        Spake2::<Ed25519Group>::start_b(&code.password(), &a, &b)
    };
    // Neither message depends on the other, so both send first.
    wire::write_piece(stream, &msg).await?;
    let theirs = wire::read_piece(stream).await?;
    if theirs.len() != SPAKE_MSG_LEN {
        return Err(Error::Protocol("bad pairing message"));
    }
    let key = state.finish(&theirs).map_err(|_| Error::Protocol("bad pairing message"))?;
    key.try_into().map_err(|_| Error::Protocol("bad pairing key"))
}

#[cfg(test)]
mod tests;
