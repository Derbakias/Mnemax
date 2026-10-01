//! Network addresses. Sync only ever talks to devices inside the home network, never the internet.

use std::net::{IpAddr, Ipv4Addr};

use super::Error;

/// The port a device listens on while it shows a pairing code.
pub const PAIR_PORT: u16 = 47_391;
/// The port a device listens on for its paired devices to sync.
pub const SYNC_PORT: u16 = 47_392;

/// Is this a home-network address? These are the "private" ranges routers hand out (192.168.x.x, 10.x.x.x and
/// 172.16–31.x.x). They can't be reached from the internet.
pub fn is_home(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

/// Who a listening device lets in: home-network addresses, and this same computer (which tests use).
pub fn is_local(ip: IpAddr) -> bool {
    matches!(ip, IpAddr::V4(v4) if is_home(v4) || v4.is_loopback())
}

/// Reads an address the person typed or scanned, like `192.168.1.20`. Anything that isn't a home-network
/// address is refused, so a fake QR code can't send us somewhere on the internet.
pub fn parse_home(text: &str) -> Result<Ipv4Addr, Error> {
    let ip: Ipv4Addr = text.trim().parse().map_err(|_| Error::BadAddress)?;
    if is_home(ip) {
        Ok(ip)
    } else {
        Err(Error::BadAddress)
    }
}

/// This device's address on the home network, to show next to the pairing code.
pub fn own_address() -> Option<Ipv4Addr> {
    let interfaces = if_addrs::get_if_addrs().unwrap_or_default();
    let addresses = interfaces.into_iter().filter(|i| i.is_oper_up()).filter_map(|i| match i.addr {
        if_addrs::IfAddr::V4(v4) if is_home(v4.ip) => Some(v4.ip),
        _ => None,
    });
    // A computer can have several. Home Wi-Fi is nearly always 192.168.x.x or 10.x.x.x; 172.x.x.x is often
    // a virtual network inside the computer (Docker, say), so it comes last.
    addresses.min_by_key(|ip| match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        _ => 2,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_home_addresses() {
        for text in ["192.168.1.20", " 10.0.0.5 ", "172.16.3.4"] {
            assert!(parse_home(text).is_ok(), "{text}");
        }
        for text in ["8.8.8.8", "127.0.0.1", "0.0.0.0", "255.255.255.255", "169.254.1.1", "fe80::1", "", "1.2.3"] {
            assert!(matches!(parse_home(text), Err(Error::BadAddress)), "{text}");
        }
    }

    #[test]
    fn lets_in_only_local_connections() {
        for ip in ["192.168.1.20", "10.0.0.5", "127.0.0.1"] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "100.64.0.1", "::1", "::ffff:192.168.1.2"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
    }
}
