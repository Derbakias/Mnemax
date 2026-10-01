//! Everything that can go wrong in sync, and the message the person sees for each.

use super::wire::PROTOCOL;

#[derive(Debug)]
pub enum Error {
    /// The connection broke.
    Io(std::io::Error),
    TimedOut,
    /// The other device sent something it shouldn't have. The text is only for the log.
    Protocol(&'static str),
    /// The encrypted handshake failed: wrong keys, or a wrong code.
    Handshake,
    WrongCode,
    CodeExpired,
    BadCode,
    /// The typed address isn't a local-network address.
    BadAddress,
    /// This device isn't on a local network, so it has no address to show.
    NoNetwork,
    /// Another program already uses this port.
    PortInUse(u16),
    /// A device that isn't paired with this one tried to sync.
    NotPaired,
    /// The other device hung up during the handshake: it doesn't know this one, or it runs another version.
    Refused,
    /// The other device runs this sync version, not ours.
    OtherVersion(u8),
    /// Nothing answered at the other device's address.
    Unreachable,
    /// While pairing: nothing answered at the address that was typed or scanned.
    NobodyThere,
    /// The system couldn't give us random numbers.
    Random,
    BadName,
    UnknownPeer,
    Storage(String),
    /// The system's key store (which guards our secret key) can't be reached.
    KeyStore(String),
}

impl Error {
    /// A short name for the error, so the page can tell them apart.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::TimedOut => "timedOut",
            Error::Protocol(_) => "protocol",
            Error::Handshake => "handshake",
            Error::WrongCode => "wrongCode",
            Error::CodeExpired => "codeExpired",
            Error::BadCode => "badCode",
            Error::BadAddress => "badAddress",
            Error::NoNetwork => "noNetwork",
            Error::PortInUse(_) => "portInUse",
            Error::NotPaired => "notPaired",
            Error::Refused => "refused",
            Error::OtherVersion(_) => "otherVersion",
            Error::Unreachable => "unreachable",
            Error::NobodyThere => "nobodyThere",
            Error::Random => "random",
            Error::BadName => "badName",
            Error::UnknownPeer => "unknownPeer",
            Error::Storage(_) => "storage",
            Error::KeyStore(_) => "keyStore",
        }
    }

    /// The technical details, for the log.
    pub fn detail(&self) -> String {
        match self {
            Error::Io(e) => e.to_string(),
            Error::Protocol(what) => (*what).to_string(),
            Error::Storage(what) | Error::KeyStore(what) => what.clone(),
            e => e.to_string(),
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        Error::Io(e)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::OtherVersion(theirs) => {
                let which = if *theirs < PROTOCOL { "an older" } else { "a newer" };
                write!(f, "The other device has {which} version of Mnemax. Update the app on both devices.")
            }
            Error::PortInUse(port) => write!(
                f,
                "Another program is using port {port}, which Mnemax needs. Close other copies of Mnemax and try again."
            ),
            _ => f.write_str(match self {
                Error::Io(_) => "The connection to the other device broke.",
                Error::TimedOut => "The other device took too long to answer.",
                Error::Protocol(_) | Error::Handshake => "The other device sent something unexpected.",
                Error::WrongCode => "That code didn't match. Make a new code and try again.",
                Error::CodeExpired => "The code ran out. Make a new one.",
                Error::BadCode => "A pairing code has 9 digits.",
                Error::BadAddress => "That address isn't on a local network. It looks like 192.168.1.20.",
                Error::NoNetwork => "This device isn't connected to a Wi\u{2011}Fi or local network.",
                Error::NotPaired => "A device that isn't paired with this one tried to sync.",
                Error::Refused => {
                    "The other device didn't accept this one. It may have forgotten this device (tap Reconnect), or \
                     have a different version of Mnemax (update both)."
                }
                Error::Unreachable => {
                    "Couldn't reach it. Check Mnemax is open on it and both devices are on the same Wi\u{2011}Fi. If it \
                     keeps failing, its address may have changed: tap Reconnect."
                }
                Error::NobodyThere => {
                    "Nothing answered at that address. Check it, and that the other device shows a code on the same \
                     Wi\u{2011}Fi."
                }
                Error::Random => "This device couldn't make a random number.",
                Error::BadName => "A device name has 1 to 40 characters, and no invisible ones.",
                Error::UnknownPeer => "That device isn't paired with this one.",
                Error::Storage(_) => "Couldn't save the sync settings.",
                Error::KeyStore(_) => {
                    "Couldn't reach this device's key store (the keyring or keychain), which keeps sync's key safe. \
                     If it's locked, unlock it and try again."
                }
                Error::OtherVersion(_) | Error::PortInUse(_) => unreachable!("written above"),
            }),
        }
    }
}
