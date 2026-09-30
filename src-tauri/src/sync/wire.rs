//! What goes over the TCP connection: a short opening that says what the connection is for, the Noise
//! handshake, then messages encrypted and authenticated by it.
//!
//! Every frame is a 2-byte length and up to 65535 bytes (Noise's own limit). A message longer than one frame
//! is split over several; its first frame starts with the message's length, which the reader checks against
//! a limit before taking in anything more.

use serde::{de::DeserializeOwned, Serialize};
use snow::{HandshakeState, TransportState};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::Error;

/// The start of every connection: the app and the protocol version, then what the connection is for.
const OPENING: &[u8; 7] = b"MNEMAX1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    Pair = 1,
    Sync = 2,
}

const MAX_FRAME: usize = 65535;
/// Noise adds a 16-byte tag to each encrypted frame.
const MAX_CHUNK: usize = MAX_FRAME - 16;
/// Sent in the clear by a device whose handshake failed, so the other one can say why instead of just
/// seeing the connection close. It proves nothing (anyone could send it); it only picks the error message.
/// No Noise message is a single byte, so it can't be mistaken for one.
const HANDSHAKE_FAILED: u8 = 0xff;

/// How long to wait for a connection to one address.
const CONNECT_TIME: std::time::Duration = std::time::Duration::from_secs(5);

/// Connects to the first of the device's addresses that answers.
pub async fn connect_any(addrs: &[std::net::SocketAddr]) -> Result<TcpStream, Error> {
    for addr in addrs {
        if let Ok(Ok(stream)) = tokio::time::timeout(CONNECT_TIME, TcpStream::connect(addr)).await {
            return Ok(stream);
        }
    }
    Err(Error::NotFound)
}

pub async fn write_opening(stream: &mut TcpStream, purpose: Purpose) -> Result<(), Error> {
    let mut opening = OPENING.to_vec();
    opening.push(purpose as u8);
    stream.write_all(&opening).await?;
    Ok(())
}

pub async fn read_opening(stream: &mut TcpStream) -> Result<Purpose, Error> {
    let mut opening = [0u8; OPENING.len() + 1];
    stream.read_exact(&mut opening).await?;
    if &opening[..OPENING.len()] != OPENING {
        return Err(Error::Protocol("not a Mnemax connection"));
    }
    match opening[OPENING.len()] {
        1 => Ok(Purpose::Pair),
        2 => Ok(Purpose::Sync),
        _ => Err(Error::Protocol("unknown connection purpose")),
    }
}

pub async fn write_frame(stream: &mut TcpStream, data: &[u8]) -> Result<(), Error> {
    let len = u16::try_from(data.len()).map_err(|_| Error::Protocol("frame too big"))?;
    let mut frame = Vec::with_capacity(2 + data.len());
    frame.extend_from_slice(&len.to_be_bytes());
    frame.extend_from_slice(data);
    stream.write_all(&frame).await?;
    Ok(())
}

pub async fn read_frame(stream: &mut TcpStream) -> Result<Vec<u8>, Error> {
    let len = stream.read_u16().await? as usize;
    let mut frame = vec![0u8; len];
    stream.read_exact(&mut frame).await?;
    Ok(frame)
}

/// Runs the handshake to its end. `after_read` sees the state after each message from the other device, so
/// it can stop the handshake (say, on a key it doesn't know) before this device answers.
pub async fn handshake(
    stream: &mut TcpStream,
    mut hs: HandshakeState,
    mut after_read: impl FnMut(&HandshakeState) -> Result<(), Error>,
) -> Result<HandshakeState, Error> {
    let mut buf = vec![0u8; MAX_FRAME];
    while !hs.is_handshake_finished() {
        if hs.is_my_turn() {
            let n = hs.write_message(&[], &mut buf).map_err(|_| Error::Handshake)?;
            write_frame(stream, &buf[..n]).await?;
        } else {
            let msg = read_frame(stream).await?;
            if msg == [HANDSHAKE_FAILED] {
                return Err(Error::Handshake);
            }
            if hs.read_message(&msg, &mut buf).is_err() {
                // Best effort: the other device learns the handshake failed rather than just seeing a close.
                let _ = write_frame(stream, &[HANDSHAKE_FAILED]).await;
                return Err(Error::Handshake);
            }
            after_read(&hs)?;
        }
    }
    Ok(hs)
}

/// A connection after its handshake: every message is encrypted and authenticated.
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
        let mut out = vec![0u8; MAX_FRAME];
        for chunk in plain.chunks(MAX_CHUNK) {
            let n = self.noise.write_message(chunk, &mut out).map_err(|_| Error::Handshake)?;
            write_frame(&mut self.stream, &out[..n]).await?;
        }
        Ok(())
    }

    /// The next message, if it's no longer than `max_len` bytes.
    pub async fn recv(&mut self, max_len: usize) -> Result<Vec<u8>, Error> {
        let mut plain = vec![0u8; MAX_FRAME];
        let n = self.read_chunk(&mut plain).await?;
        if n < 4 {
            return Err(Error::Protocol("message without a length"));
        }
        let len = u32::from_be_bytes([plain[0], plain[1], plain[2], plain[3]]) as usize;
        if len > max_len {
            return Err(Error::Protocol("message too big"));
        }
        let mut msg = Vec::with_capacity(len);
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
        let frame = read_frame(&mut self.stream).await?;
        // The other device can still say its handshake failed: the one that sends the last handshake message
        // has finished by the time the other finds it doesn't check out.
        if frame == [HANDSHAKE_FAILED] {
            return Err(Error::Handshake);
        }
        self.noise.read_message(&frame, plain).map_err(|_| Error::Protocol("message failed its check"))
    }

    pub async fn send_json<T: Serialize>(&mut self, value: &T) -> Result<(), Error> {
        let json = serde_json::to_vec(value).map_err(|_| Error::Protocol("unsendable message"))?;
        self.send(&json).await
    }

    pub async fn recv_json<T: DeserializeOwned>(&mut self, max_len: usize) -> Result<T, Error> {
        let json = self.recv(max_len).await?;
        serde_json::from_slice(&json).map_err(|_| Error::Protocol("message in the wrong shape"))
    }

    /// Resolves once there's something to read (or the connection closed), without reading it, so it can
    /// race with something else and lose without dropping half a message.
    pub async fn readable(&self) -> Result<(), Error> {
        let mut byte = [0u8; 1];
        self.stream.peek(&mut byte).await?;
        Ok(())
    }
}
