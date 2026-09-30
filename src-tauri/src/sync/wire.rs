//! What goes over the TCP connection: a short opening that says what the connection is for, the Noise
//! handshake, then messages encrypted and authenticated by it.
//!
//! Every frame is a 2-byte length and up to 65535 bytes (Noise's own limit). A message longer than one frame
//! is split over several; its first frame starts with the message's length, which the reader checks against
//! a limit before taking in anything more.

use std::net::SocketAddr;
use std::time::Duration;

use serde::{de::DeserializeOwned, Serialize};
use snow::{HandshakeState, TransportState};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

use super::trace::Trace;
use super::{is_local, Error};

/// The version of what devices say to each other. Raise it with any change to that: a device pairing with
/// another version says which one it has, so both can ask for an update rather than fail somewhere in the
/// handshake. (A device waiting to sync says nothing to a connection it can't tell is a paired device.)
pub const PROTOCOL: u8 = 5;
/// The start of every connection, then the protocol version and what the connection is for.
const MAGIC: &[u8; 6] = b"MNEMAX";
/// Builds from before the version was a number sent the text `1` in its place; they speak version 3 or older.
const OLD_VERSION_BYTE: u8 = b'1';
/// Sent in the clear, with this device's version after it, by a device that got an opening with another
/// version. It proves nothing (anyone could send it); it only turns a failure into the right message. No other
/// frame is two bytes long.
const OTHER_VERSION: u8 = 0xfd;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    Pair = 1,
    Sync = 2,
}

impl std::fmt::Display for Purpose {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Purpose::Pair => "pairing",
            Purpose::Sync => "sync",
        })
    }
}

const MAX_FRAME: usize = 65535;
/// Noise adds a 16-byte tag to each encrypted frame.
const MAX_CHUNK: usize = MAX_FRAME - 16;
/// Sent in the clear by a device whose pairing handshake failed, so the other one can say the code was wrong
/// instead of just seeing the connection close. It proves nothing (anyone could send it); it only picks the
/// error message. No Noise message is a single byte, so it can't be mistaken for one. Never sent when syncing:
/// there, a handshake that fails is someone who isn't a paired device, and they get nothing back.
const HANDSHAKE_FAILED: u8 = 0xff;
/// Sent in the clear by a device that doesn't have the other's key as paired (only a device that knows its
/// key can get this far). Like the one above it proves nothing: it only lets the other device tell "it doesn't
/// know me" from a connection that broke, so forgetting can tell whether the other side is done.
const NOT_PAIRED: u8 = 0xfe;

/// How long to wait for a connection to one address: on a home network one takes a few milliseconds, so
/// more than this means the address isn't reachable from here.
const CONNECT_TIME: Duration = Duration::from_secs(3);
/// How long a new connection has to say what it's for.
const OPENING_TIME: Duration = Duration::from_secs(5);

/// Connects to the first of the device's addresses that answers, and says what the connection is for.
pub async fn open(addrs: &[SocketAddr], purpose: Purpose, trace: &Trace) -> Result<TcpStream, Error> {
    for addr in addrs {
        trace.step(format!("Connecting to {addr}…"));
        match timeout(CONNECT_TIME, TcpStream::connect(addr)).await {
            Ok(Ok(mut stream)) => {
                write_opening(&mut stream, purpose).await?;
                trace.step(format!("Connected to {addr}."));
                return Ok(stream);
            }
            Ok(Err(e)) => trace.step(format!("Couldn't connect to {addr}: {e}.")),
            Err(_) => trace.step(format!("No answer from {addr} in {} s.", CONNECT_TIME.as_secs())),
        }
    }
    Err(Error::Unreachable)
}

/// The next connection from the local network that opens with `purpose`. Any other (a port scan, say) is
/// dropped without a word. Only when pairing is a device with another version told so.
pub async fn accept(listener: &TcpListener, purpose: Purpose, trace: &Trace) -> Result<TcpStream, Error> {
    let tell_version = purpose == Purpose::Pair;
    loop {
        let (mut stream, addr) = listener.accept().await?;
        if !is_local(addr.ip()) {
            trace.step(format!("Ignored a connection from {addr}: not on the local network."));
            continue;
        }
        match timeout(OPENING_TIME, read_opening(&mut stream, tell_version)).await {
            Ok(Ok(opened)) if opened == purpose => {
                trace.step(format!("{addr} connected here for {purpose}."));
                return Ok(stream);
            }
            Ok(Ok(opened)) => trace.step(format!("Ignored {addr}: it connected for {opened}, not {purpose}.")),
            Ok(Err(Error::OtherVersion(theirs))) if tell_version => {
                trace.step(format!("{addr} has sync version {theirs}, this device {PROTOCOL}: told it so."));
                return Err(Error::OtherVersion(theirs));
            }
            Ok(Err(Error::OtherVersion(theirs))) => {
                trace.step(format!("Ignored {addr}: it has sync version {theirs}, this device {PROTOCOL}."))
            }
            Ok(Err(e)) => trace.step(format!("Ignored {addr}: not a Mnemax connection ({}).", e.detail())),
            Err(_) => trace.step(format!("Ignored {addr}: it said nothing for {} s.", OPENING_TIME.as_secs())),
        }
    }
}

/// Where requests to connect out come from: mDNS in the app, a channel in tests.
pub trait Requests {
    /// The addresses of the next device asking for a connection; None once there won't be more.
    async fn next(&mut self) -> Option<Vec<SocketAddr>>;
}

impl Requests for super::discovery::Watch {
    async fn next(&mut self) -> Option<Vec<SocketAddr>> {
        super::discovery::Watch::next(self).await
    }
}

impl Requests for tokio::sync::mpsc::Receiver<Vec<SocketAddr>> {
    async fn next(&mut self) -> Option<Vec<SocketAddr>> {
        self.recv().await
    }
}

/// The first connection with the other device, whichever way it comes: in, on `listener`, or out, to a
/// device that asked for one because it couldn't connect in (a firewall on this side, most likely).
pub async fn meet(
    listener: &TcpListener,
    purpose: Purpose,
    requests: &mut impl Requests,
    trace: &Trace,
) -> Result<TcpStream, Error> {
    let mut more_requests = true;
    loop {
        tokio::select! {
            stream = accept(listener, purpose, trace) => return stream,
            request = requests.next(), if more_requests => match request {
                Some(addrs) => {
                    trace.step(format!("A device asked this one to connect to it, at {}.", list(&addrs)));
                    if let Ok(stream) = open(&addrs, purpose, trace).await {
                        return Ok(stream);
                    }
                }
                None => more_requests = false,
            },
        }
    }
}

/// Addresses for the log: `a, b and c`.
pub fn list(addrs: &[SocketAddr]) -> String {
    let addrs: Vec<String> = addrs.iter().map(ToString::to_string).collect();
    match addrs.split_last() {
        None => "no address".into(),
        Some((last, [])) => last.clone(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
    }
}

pub async fn write_opening(stream: &mut TcpStream, purpose: Purpose) -> Result<(), Error> {
    let mut opening = MAGIC.to_vec();
    opening.extend_from_slice(&[PROTOCOL, purpose as u8]);
    stream.write_all(&opening).await?;
    Ok(())
}

/// What the connection is for. One from a device with another protocol version fails with
/// `Error::OtherVersion`, and if `tell_version`, is answered with this device's version (see `OTHER_VERSION`).
pub async fn read_opening(stream: &mut TcpStream, tell_version: bool) -> Result<Purpose, Error> {
    let mut opening = [0u8; MAGIC.len() + 2];
    stream.read_exact(&mut opening).await?;
    if &opening[..MAGIC.len()] != MAGIC {
        return Err(Error::Protocol("not a Mnemax connection"));
    }
    let version = match opening[MAGIC.len()] {
        OLD_VERSION_BYTE => 3,
        version => version,
    };
    if version != PROTOCOL {
        if tell_version {
            let _ = write_frame(stream, &[OTHER_VERSION, PROTOCOL]).await;
        }
        return Err(Error::OtherVersion(version));
    }
    match opening[MAGIC.len() + 1] {
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
    if let [OTHER_VERSION, version] = frame[..] {
        return Err(Error::OtherVersion(version));
    }
    Ok(frame)
}

/// Runs the handshake to its end. `after_read` sees the state after each message from the other device, so
/// it can stop the handshake (say, on a key it doesn't know) before this device answers. With `tell_failure`
/// (pairing), a message that doesn't check out is answered with `HANDSHAKE_FAILED`; otherwise with nothing.
pub async fn handshake(
    stream: &mut TcpStream,
    mut hs: HandshakeState,
    tell_failure: bool,
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
            if msg == [NOT_PAIRED] {
                return Err(Error::UnknownThere);
            }
            if hs.read_message(&msg, &mut buf).is_err() {
                if tell_failure {
                    // Best effort: the other device learns the code was wrong rather than just seeing a close.
                    let _ = write_frame(stream, &[HANDSHAKE_FAILED]).await;
                }
                return Err(Error::Handshake);
            }
            if let Err(e) = after_read(&hs) {
                if matches!(e, Error::NotPaired) {
                    let _ = write_frame(stream, &[NOT_PAIRED]).await;
                }
                return Err(e);
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Both ends of a connection over this machine.
    async fn pair_of_streams() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (connected, accepted) = tokio::join!(TcpStream::connect(addr), listener.accept());
        (connected.unwrap(), accepted.unwrap().0)
    }

    #[tokio::test]
    async fn reads_back_its_own_opening() {
        let (mut out, mut inn) = pair_of_streams().await;
        write_opening(&mut out, Purpose::Sync).await.unwrap();
        assert_eq!(read_opening(&mut inn, false).await.unwrap(), Purpose::Sync);
    }

    #[tokio::test]
    async fn both_pairing_devices_learn_the_other_has_another_version() {
        for (sent, seen) in [(&b"MNEMAX\x09\x01"[..], 9), (&b"MNEMAX1\x01"[..], 3)] {
            let (mut out, mut inn) = pair_of_streams().await;
            out.write_all(sent).await.unwrap();
            assert!(matches!(read_opening(&mut inn, true).await, Err(Error::OtherVersion(v)) if v == seen), "{seen}");
            // The device that opened hears this one's version in place of the handshake.
            assert!(matches!(read_frame(&mut out).await, Err(Error::OtherVersion(PROTOCOL))));
        }
    }

    #[tokio::test]
    async fn a_device_waiting_to_sync_says_nothing_to_a_connection_it_cant_place() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let waiting = async {
            // Only the last of these gets through.
            timeout(Duration::from_secs(5), accept(&listener, Purpose::Sync, Trace::off())).await.unwrap().unwrap()
        };
        let strangers = async {
            for opening in [&b"GET / HTTP/1.1\r\n"[..], b"MNEMAX\x09\x02", b"MNEMAX\x05\x01"] {
                let mut stranger = TcpStream::connect(addr).await.unwrap();
                stranger.write_all(opening).await.unwrap();
                // The connection is closed (or reset, with the opening left unread) without a byte back.
                let mut back = Vec::new();
                let read = stranger.read_to_end(&mut back).await;
                assert!(read.is_ok() || read.is_err_and(|e| e.kind() == std::io::ErrorKind::ConnectionReset));
                assert!(back.is_empty(), "{opening:?} got {back:?}");
            }
            let mut paired = TcpStream::connect(addr).await.unwrap();
            write_opening(&mut paired, Purpose::Sync).await.unwrap();
            paired
        };
        let (_accepted, _paired) = tokio::join!(waiting, strangers);
    }

    #[tokio::test]
    async fn the_sync_port_ignores_a_connection_opened_for_pairing() {
        // The two protocols must not cross: a connection that opens for pairing on the sync listener is
        // ignored (accept keeps waiting), so pairing messages can't be steered at a device that's only syncing.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let waiting = accept(&listener, Purpose::Sync, Trace::off());
        let intruder = async {
            let mut s = TcpStream::connect(addr).await.unwrap();
            write_opening(&mut s, Purpose::Pair).await.unwrap();
            s // held open so the connection isn't torn down while accept looks at it
        };
        let (accepted, _held) = tokio::join!(timeout(Duration::from_millis(400), waiting), intruder);
        assert!(accepted.is_err(), "a pairing connection must not be accepted on the sync port");
    }

    #[tokio::test]
    async fn a_sync_handshake_that_fails_gets_nothing_back() {
        let (mut stranger, mut waiting) = pair_of_streams().await;
        let keys = snow::Builder::new(super::super::SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap();
        let hs = snow::Builder::new(super::super::SYNC_PARAMS.parse().unwrap())
            .local_private_key(&keys.private)
            .unwrap()
            .build_responder()
            .unwrap();
        write_frame(&mut stranger, &[7u8; 96]).await.unwrap();
        let (result, back) = tokio::join!(handshake(&mut waiting, hs, false, |_| Ok(())), async {
            let mut back = [0u8; 1];
            timeout(Duration::from_millis(300), stranger.read(&mut back)).await
        });
        assert!(matches!(result, Err(Error::Handshake)));
        drop(waiting);
        assert!(!matches!(back, Ok(Ok(1))), "the stranger was sent something");
    }
}
