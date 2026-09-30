//! Finding the other device: a waiting device announces itself over mDNS (the way printers do) and the
//! other looks for it.
//!
//! The announcement gives away as little as it can. A device waiting to pair gives the code's first two
//! digits (which aren't secret). A device waiting to sync gives a random value and a tag made from it and
//! the device's key: a paired device, which has the key, can tell it's the one it wants, while to anyone else
//! it's a new random name each time, so the device can't be followed from one network to the next.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use mdns_sd::{ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

use super::store::hex_encode;
use super::{is_local, random_bytes, Error};

const SERVICE: &str = "_mnemax._tcp.local.";
/// How long to look for the other device before giving up.
const FIND_TIME: Duration = Duration::from_secs(8);

/// Stops announcing when dropped.
pub struct Announcement {
    daemon: ServiceDaemon,
    fullname: String,
}

impl Drop for Announcement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}

pub fn announce_pairing(port: u16, nameplate: u8) -> Result<Announcement, Error> {
    announce(port, [("m", "pair".to_string()), ("p", format!("{nameplate:02}"))])
}

pub fn announce_sync(port: u16, public_key: &[u8]) -> Result<Announcement, Error> {
    let nonce = hex_encode(&random_bytes::<8>()?);
    let tag = tag(public_key, &nonce);
    announce(port, [("m", "sync".to_string()), ("n", nonce), ("t", tag)])
}

fn announce<const N: usize>(port: u16, props: [(&str, String); N]) -> Result<Announcement, Error> {
    let daemon = ServiceDaemon::new().map_err(|_| Error::Network)?;
    let name = format!("mnemax-{}", hex_encode(&random_bytes::<6>()?));
    let mut txt: HashMap<String, String> = props.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    txt.insert("v".into(), "1".into());
    let info = ServiceInfo::new(SERVICE, &name, &format!("{name}.local."), "", port, txt)
        .map_err(|_| Error::Network)?
        .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    daemon.register(info).map_err(|_| Error::Network)?;
    Ok(Announcement { daemon, fullname })
}

/// Where the device showing a code with this nameplate is waiting.
pub async fn find_pairing(nameplate: u8) -> Result<Vec<SocketAddr>, Error> {
    let nameplate = format!("{nameplate:02}");
    find(|s| prop(s, "m") == Some("pair") && prop(s, "p") == Some(nameplate.as_str())).await
}

/// Where the paired device with this key is waiting.
pub async fn find_peer(peer_key: &[u8]) -> Result<Vec<SocketAddr>, Error> {
    find(|s| {
        prop(s, "m") == Some("sync")
            && matches!((prop(s, "n"), prop(s, "t")), (Some(n), Some(t)) if n.len() <= 32 && t == tag(peer_key, n))
    })
    .await
}

async fn find(wanted: impl Fn(&ResolvedService) -> bool) -> Result<Vec<SocketAddr>, Error> {
    let daemon = ServiceDaemon::new().map_err(|_| Error::Network)?;
    let events = daemon.browse(SERVICE).map_err(|_| Error::Network)?;
    let found = tokio::time::timeout(FIND_TIME, async {
        while let Ok(event) = events.recv_async().await {
            let ServiceEvent::ServiceResolved(service) = event else { continue };
            if prop(&service, "v") != Some("1") || !wanted(&service) {
                continue;
            }
            let addrs = addresses(&service);
            if !addrs.is_empty() {
                return Some(addrs);
            }
        }
        None
    })
    .await;
    let _ = daemon.stop_browse(SERVICE);
    let _ = daemon.shutdown();
    found.ok().flatten().ok_or(Error::NotFound)
}

/// The service's IPv4 addresses on the local network (the listener only takes IPv4).
fn addresses(service: &ResolvedService) -> Vec<SocketAddr> {
    let mut addrs: Vec<SocketAddr> = service
        .get_addresses()
        .iter()
        .map(|ip| ip.to_ip_addr())
        .filter(|ip| matches!(ip, IpAddr::V4(_)) && is_local(*ip))
        .map(|ip| SocketAddr::new(ip, service.get_port()))
        .collect();
    addrs.sort();
    addrs
}

fn prop<'a>(service: &'a ResolvedService, key: &str) -> Option<&'a str> {
    service.get_property_val_str(key)
}

/// 8 bytes of BLAKE2s over the key and the random value, in hex.
fn tag(public_key: &[u8], nonce: &str) -> String {
    use blake2::{Blake2s256, Digest};
    let digest = Blake2s256::new()
        .chain_update(b"mnemax sync tag")
        .chain_update(public_key)
        .chain_update(nonce.as_bytes())
        .finalize();
    hex_encode(&digest[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    // Needs a network interface with multicast: run with `cargo test -- --ignored`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn finds_an_announced_device_by_its_key_or_nameplate() {
        let key = [9u8; 32];
        let _sync = announce_sync(40001, &key).unwrap();
        let _pair = announce_pairing(40002, 42).unwrap();
        let found = find_peer(&key).await.unwrap();
        assert!(found.iter().all(|a| a.port() == 40001), "{found:?}");
        let found = find_pairing(42).await.unwrap();
        assert!(found.iter().all(|a| a.port() == 40002), "{found:?}");
        assert!(matches!(find_peer(&[8u8; 32]).await, Err(Error::NotFound)));
    }

    #[test]
    fn a_tag_only_matches_its_own_key_and_value() {
        let (key, other) = ([1u8; 32], [2u8; 32]);
        assert_eq!(tag(&key, "abcd"), tag(&key, "abcd"));
        assert_ne!(tag(&key, "abcd"), tag(&other, "abcd"));
        assert_ne!(tag(&key, "abcd"), tag(&key, "abce"));
        assert_eq!(tag(&key, "abcd").len(), 16);
    }
}
