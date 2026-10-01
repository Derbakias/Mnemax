//! How bytes travel between two devices.
//!
//! 1. The device that connects sends a short opening: "MNEMAX", the version, and whether it's here to pair or
//!    to sync. Anything else (a port scan, a web browser) is dropped without a word.
//! 2. Both run the encrypted handshake (Noise), which proves who is on the other end. The opening is mixed into
//!    it, so someone in between who changes the opening makes the handshake fail.
//! 3. After that, every message is encrypted and sealed: a changed byte is noticed and the connection dropped.
//!
//! Each piece on the wire is a 2-byte length and at most 64 KB. Longer messages are cut into pieces; the
//! first piece says how long the whole message is, and the reader refuses it if that's over its limit.

use std::net::SocketAddr;
use std::time::Duration;

use serde::{de::DeserializeOwned, Serialize};
use snow::{HandshakeState, TransportState};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::address::is_local;
use super::trace::Trace;
use super::Error;

/// The version of what devices say to each other. Raise it with any change to that, so two devices with
/// different versions say "update both" instead of failing in a confusing way.
pub const PROTOCOL: u8 = 7;
/// Every connection starts with these bytes.
const MAGIC: &[u8; 6] = b"MNEMAX";
/// Sent (unencrypted) by a device showing a pairing code when the other device has another version. It
/// proves nothing; it only picks a clearer error message. No other piece is two bytes long.
const OTHER_VERSION: u8 = 0xfd;
/// Sent (unencrypted) when a pairing handshake fails, so the other device can say "wrong code" instead of
/// "connection broke". It proves nothing either. Never sent when syncing: strangers get silence.
const HANDSHAKE_FAILED: u8 = 0xff;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    Pair = 1,
    Sync = 2,
}

const MAX_PIECE: usize = 65535;
/// The encryption adds 16 bytes to each piece.
const MAX_CHUNK: usize = MAX_PIECE - 16;
/// On a local network a connection takes milliseconds; 3 seconds means nobody is there.
const CONNECT_TIME: Duration = Duration::from_secs(3);
/// How long a new connection has to send its opening. A real device sends it right after connecting.
pub const OPENING_TIME: Duration = Duration::from_secs(1);

/// Connects to the other device and says what for.
pub async fn open(addr: SocketAddr, purpose: Purpose, trace: &Trace) -> Result<TcpStream, Error> {
    trace.step(format!("Connecting to {addr}…"));
    match timeout(CONNECT_TIME, TcpStream::connect(addr)).await {
        Ok(Ok(mut stream)) => {
            write_opening(&mut stream, purpose).await?;
            trace.step(format!("Connected to {addr}."));
            Ok(stream)
        }
        Ok(Err(e)) => {
            trace.step(format!("Couldn't connect to {addr}: {e}."));
            Err(Error::Unreachable)
        }
        Err(_) => {
            trace.step(format!("No answer from {addr} in {} s.", CONNECT_TIME.as_secs()));
            Err(Error::Unreachable)
        }
    }
}

/// Waits for the first connection from the local network that opens for `purpose`. Others are dropped.
pub async fn accept(listener: &TcpListener, purpose: Purpose, trace: &Trace) -> Result<TcpStream, Error> {
    loop {
        let (mut stream, addr) = listener.accept().await?;
        if !is_local(addr.ip()) {
            trace.step(format!("Ignored {addr}: not on the local network."));
            continue;
        }
        match check_opening(&mut stream, purpose).await {
            Ok(()) => {
                trace.step(format!("{addr} connected."));
                return Ok(stream);
            }
            // Only someone pairing is told about a version difference; when syncing, strangers get nothing.
            Err(Error::OtherVersion(theirs)) if purpose == Purpose::Pair => {
                trace.step(format!("{addr} has sync version {theirs}, this device {PROTOCOL}."));
                return Err(Error::OtherVersion(theirs));
            }
            Err(e) => trace.step(format!("Ignored {addr}: {}.", e.detail())),
        }
    }
}

/// Reads the opening of a new connection (1 second at most) and checks it's Mnemax, our version, and here
/// for `purpose`.
pub async fn check_opening(stream: &mut TcpStream, purpose: Purpose) -> Result<(), Error> {
    let mut opening = [0u8; OPENING_LEN];
    timeout(OPENING_TIME, stream.read_exact(&mut opening)).await.map_err(|_| Error::TimedOut)??;
    if &opening[..MAGIC.len()] != MAGIC {
        return Err(Error::Protocol("not a Mnemax connection"));
    }
    let version = opening[MAGIC.len()];
    if version != PROTOCOL {
        if purpose == Purpose::Pair {
            let _ = write_piece(stream, &[OTHER_VERSION, PROTOCOL]).await;
        }
        return Err(Error::OtherVersion(version));
    }
    if opening[MAGIC.len() + 1] != purpose as u8 {
        return Err(Error::Protocol("connected for something else"));
    }
    Ok(())
}

const OPENING_LEN: usize = MAGIC.len() + 2;

/// The opening for `purpose`: "MNEMAX", the version and the purpose.
pub const fn opening(purpose: Purpose) -> [u8; OPENING_LEN] {
    let [a, b, c, d, e, f] = *MAGIC;
    [a, b, c, d, e, f, PROTOCOL, purpose as u8]
}

pub async fn write_opening(stream: &mut TcpStream, purpose: Purpose) -> Result<(), Error> {
    stream.write_all(&opening(purpose)).await?;
    Ok(())
}

pub async fn write_piece(stream: &mut TcpStream, data: &[u8]) -> Result<(), Error> {
    let len = u16::try_from(data.len()).map_err(|_| Error::Protocol("piece too big"))?;
    let mut piece = Vec::with_capacity(2 + data.len());
    piece.extend_from_slice(&len.to_be_bytes());
    piece.extend_from_slice(data);
    stream.write_all(&piece).await?;
    Ok(())
}

pub async fn read_piece(stream: &mut TcpStream) -> Result<Vec<u8>, Error> {
    let len = stream.read_u16().await? as usize;
    let mut piece = vec![0u8; len];
    stream.read_exact(&mut piece).await?;
    if let [OTHER_VERSION, version] = piece[..] {
        return Err(Error::OtherVersion(version));
    }
    Ok(piece)
}

/// Runs the encrypted handshake to the end. `check` looks at the other device after each of its messages and
/// can stop the handshake (say, for a key it doesn't know) before this device answers. With `say_failure`
/// (pairing only), a message that doesn't check out is answered with `HANDSHAKE_FAILED`.
pub async fn handshake(
    stream: &mut TcpStream,
    mut hs: HandshakeState,
    say_failure: bool,
    mut check: impl FnMut(&HandshakeState) -> Result<(), Error>,
) -> Result<HandshakeState, Error> {
    let mut buf = vec![0u8; MAX_PIECE];
    while !hs.is_handshake_finished() {
        if hs.is_my_turn() {
            let n = hs.write_message(&[], &mut buf).map_err(|_| Error::Handshake)?;
            write_piece(stream, &buf[..n]).await?;
        } else {
            let msg = read_piece(stream).await?;
            if msg == [HANDSHAKE_FAILED] {
                return Err(Error::Handshake);
            }
            if hs.read_message(&msg, &mut buf).is_err() {
                if say_failure {
                    let _ = write_piece(stream, &[HANDSHAKE_FAILED]).await;
                }
                return Err(Error::Handshake);
            }
            check(&hs)?;
        }
    }
    Ok(hs)
}

/// A connection after the handshake: every message is encrypted and sealed.
pub struct Secure {
    stream: TcpStream,
    noise: TransportState,
}

impl Secure {
    pub fn new(stream: TcpStream, hs: HandshakeState) -> Result<Self, Error> {
        let noise = hs.into_transport_mode().map_err(|_| Error::Handshake)?;
        Ok(Self { stream, noise })
    }

    pub async fn send(&mut self, msg: &[u8]) -> Result<(), Error> {
        let len = u32::try_from(msg.len()).map_err(|_| Error::Protocol("message too big"))?;
        let mut plain = Vec::with_capacity(4 + msg.len());
        plain.extend_from_slice(&len.to_be_bytes());
        plain.extend_from_slice(msg);
        let mut out = vec![0u8; MAX_PIECE];
        for chunk in plain.chunks(MAX_CHUNK) {
            let n = self.noise.write_message(chunk, &mut out).map_err(|_| Error::Handshake)?;
            write_piece(&mut self.stream, &out[..n]).await?;
        }
        Ok(())
    }

    /// The next message, refused if it says it's longer than `max_len` bytes.
    pub async fn recv(&mut self, max_len: usize) -> Result<Vec<u8>, Error> {
        let mut plain = vec![0u8; MAX_PIECE];
        let n = self.read_chunk(&mut plain).await?;
        if n < 4 {
            return Err(Error::Protocol("message without a length"));
        }
        let len = u32::from_be_bytes([plain[0], plain[1], plain[2], plain[3]]) as usize;
        if len > max_len {
            return Err(Error::Protocol("message too big"));
        }
        // Room for one piece at first, not for what the message says it will be: until it really arrives,
        // that's only a claim.
        let mut msg = Vec::with_capacity(len.min(MAX_PIECE));
        msg.extend_from_slice(&plain[4..n]);
        while msg.len() < len {
            let n = self.read_chunk(&mut plain).await?;
            msg.extend_from_slice(&plain[..n]);
        }
        if msg.len() != len {
            return Err(Error::Protocol("message longer than it said"));
        }
        Ok(msg)
    }

    async fn read_chunk(&mut self, plain: &mut [u8]) -> Result<usize, Error> {
        let piece = read_piece(&mut self.stream).await?;
        // The device that sends the last handshake message finishes first, so it can still hear that the
        // other one found the handshake didn't check out.
        if piece == [HANDSHAKE_FAILED] {
            return Err(Error::Handshake);
        }
        self.noise.read_message(&piece, plain).map_err(|_| Error::Protocol("message failed its check"))
    }

    pub async fn send_json<T: Serialize>(&mut self, value: &T) -> Result<(), Error> {
        let json = serde_json::to_vec(value).map_err(|_| Error::Protocol("unsendable message"))?;
        self.send(&json).await
    }

    pub async fn recv_json<T: DeserializeOwned>(&mut self, max_len: usize) -> Result<T, Error> {
        let json = self.recv(max_len).await?;
        serde_json::from_slice(&json).map_err(|_| Error::Protocol("message in the wrong shape"))
    }
}

#[cfg(test)]
mod tests;
