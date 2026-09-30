//! Finding the other device: a waiting device announces itself over mDNS (the way printers do) and the
//! other looks for it.
//!
//! When the device that looks can't connect to the one that waits (a computer's firewall blocks connections
//! coming in, but not going out), it announces a request instead, and the waiting device, which watches for
//! requests, connects to it. So only one of the two has to take connections coming in: a phone and a
//! computer behind a firewall still find each other.
//!
//! Only pairing is visible on the network, and only while a device shows or enters a code: it's announced as
//! Mnemax (`_mnemax._tcp`), with nothing of the code. Syncing never says Mnemax: a waiting device announces
//! itself under a service name made from its key and the hour, and a sync request under one made from the
//! key of the device it's for. The key is only known to the devices paired with it (it's never sent in the
//! clear), so to anyone else it's a meaningless name, new every hour: they can't tell it's Mnemax, whose it
//! is, or follow a device from one network to the next. Nothing else goes in the announcement.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mdns_sd::{ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

use super::store::hex_encode;
use super::trace::Trace;
use super::wire::list;
use super::{is_local, random_bytes, Error};

const PAIR_SERVICE: &str = "_mnemax._tcp.local.";
/// How long to look for the other device before asking it to connect instead.
const FIND_TIME: Duration = Duration::from_secs(5);
/// After the first match, how long to wait for more: an old announcement that was never withdrawn (the app
/// was killed, say) looks the same as the live one, so all of them are tried.
const GATHER_TIME: Duration = Duration::from_millis(500);
/// How long a stopping announcement waits for its goodbye to go out.
const GOODBYE_TIME: Duration = Duration::from_secs(1);
/// How long a sync service name lasts before the next one.
const WINDOW: Duration = Duration::from_secs(60 * 60);
/// Letters in a sync service name: the most mDNS allows (15), about 70 bits.
const SECRET_LETTERS: usize = 15;

const SYNC_LABEL: &[u8] = b"mnemax sync service";
const REQUEST_LABEL: &[u8] = b"mnemax request service";

/// Where an announcement goes, and what a watch looks for.
#[derive(Clone)]
enum Name {
    /// Pairing: the one visible name, with the kind of announcement (`pair` or `join`) inside.
    Pairing(&'static str),
    /// Syncing: a name made from a device's key and the hour.
    Secret { label: &'static [u8], key: Vec<u8> },
}

impl Name {
    /// The names to announce under in `window`: the hours either side too, so a device whose clock is a
    /// little off still finds this one.
    fn announced(&self, window: u64) -> Vec<String> {
        match self {
            Name::Pairing(_) => vec![PAIR_SERVICE.to_string()],
            Name::Secret { label, key } => {
                [window.saturating_sub(1), window, window + 1].iter().map(|&w| secret_service(label, key, w)).collect()
            }
        }
    }

    /// The name to look for in `window`.
    fn looked_for(&self, window: u64) -> String {
        match self {
            Name::Pairing(_) => PAIR_SERVICE.to_string(),
            Name::Secret { label, key } => secret_service(label, key, window),
        }
    }

    fn txt(&self) -> HashMap<String, String> {
        match self {
            Name::Pairing(kind) => HashMap::from([("m".into(), kind.to_string()), ("v".into(), "1".into())]),
            Name::Secret { .. } => HashMap::new(),
        }
    }

    fn matches(&self, service: &ResolvedService) -> bool {
        match self {
            Name::Pairing(kind) => prop(service, "v") == Some("1") && prop(service, "m") == Some(kind),
            // Only the devices that know the key could have announced under this name.
            Name::Secret { .. } => true,
        }
    }

    /// How long until the name changes (never, for pairing).
    fn lasts(&self) -> Option<Duration> {
        match self {
            Name::Pairing(_) => None,
            Name::Secret { .. } => Some(until_next_window()),
        }
    }
}

/// The service name for a key in one window: lowercase letters only, as mDNS wants.
fn secret_service(label: &[u8], key: &[u8], window: u64) -> String {
    use blake2::{Blake2s256, Digest};
    let digest = Blake2s256::new().chain_update(label).chain_update(key).chain_update(window.to_be_bytes()).finalize();
    let letters: String = digest[..SECRET_LETTERS].iter().map(|b| char::from(b'a' + b % 26)).collect();
    format!("_{letters}._tcp.local.")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn window_now() -> u64 {
    now_secs() / WINDOW.as_secs()
}

fn until_next_window() -> Duration {
    Duration::from_secs(WINDOW.as_secs() - now_secs() % WINDOW.as_secs())
}

/// Stops announcing when dropped.
pub struct Announcement {
    /// Dropping it ends the thread that keeps the announcement up.
    _stop: mpsc::Sender<()>,
}

/// This device waits to pair: the other one connects to it.
pub fn announce_pairing(port: u16) -> Result<Announcement, Error> {
    announce(Name::Pairing("pair"), port)
}

/// This device has a code but couldn't connect: the device showing it should connect here.
pub fn announce_join(port: u16) -> Result<Announcement, Error> {
    announce(Name::Pairing("join"), port)
}

/// This device waits for its paired devices to sync.
pub fn announce_sync(port: u16, public_key: &[u8]) -> Result<Announcement, Error> {
    announce(Name::Secret { label: SYNC_LABEL, key: public_key.to_vec() }, port)
}

/// This device wants to sync with `peer_key` but couldn't connect: that device should connect here.
pub fn announce_request(port: u16, peer_key: &[u8]) -> Result<Announcement, Error> {
    announce(Name::Secret { label: REQUEST_LABEL, key: peer_key.to_vec() }, port)
}

/// Announces under `name` until the announcement is dropped, moving to the next names every hour.
fn announce(name: Name, port: u16) -> Result<Announcement, Error> {
    let daemon = ServiceDaemon::new().map_err(|_| Error::Network)?;
    let mut window = window_now();
    let mut registered = register(&daemon, &name, window, port)?;
    let (stop, stopped) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        loop {
            let waited = match name.lasts() {
                Some(wait) => stopped.recv_timeout(wait),
                None => stopped.recv().map_err(mpsc::RecvTimeoutError::from),
            };
            if !matches!(waited, Err(mpsc::RecvTimeoutError::Timeout)) {
                break;
            }
            if window_now() != window {
                window = window_now();
                unregister(&daemon, std::mem::take(&mut registered), Duration::ZERO);
                // Nothing to report to if it fails: the paired devices won't find this one until it's back.
                registered = register(&daemon, &name, window, port).unwrap_or_default();
            }
        }
        // Withdraw it (so other devices drop it now, not when it would expire), then stop.
        unregister(&daemon, registered, GOODBYE_TIME);
        let _ = daemon.shutdown();
    });
    Ok(Announcement { _stop: stop })
}

/// Registers the announcements for `window`, each with a new random instance and host name; gives their full
/// names.
fn register(daemon: &ServiceDaemon, name: &Name, window: u64, port: u16) -> Result<Vec<String>, Error> {
    let mut registered = Vec::new();
    for service in name.announced(window) {
        let instance = hex_encode(&random_bytes::<6>()?);
        let info = ServiceInfo::new(&service, &instance, &format!("{instance}.local."), "", port, name.txt())
            .map_err(|_| Error::Network)?
            .enable_addr_auto();
        registered.push(info.get_fullname().to_string());
        daemon.register(info).map_err(|_| Error::Network)?;
    }
    Ok(registered)
}

/// Withdraws the announcements, waiting up to `wait` for the goodbyes to go out.
fn unregister(daemon: &ServiceDaemon, fullnames: Vec<String>, wait: Duration) {
    let done: Vec<_> = fullnames.iter().filter_map(|f| daemon.unregister(f).ok()).collect();
    let deadline = std::time::Instant::now() + wait;
    for d in done {
        let _ = d.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()));
    }
}

/// Where devices showing a code are waiting.
pub async fn find_pairing(trace: &Trace) -> Result<Vec<SocketAddr>, Error> {
    trace.step("Looking for a device showing a code…");
    find(Watch::new(Name::Pairing("pair"))?, trace).await
}

/// Where the paired device with this key is waiting.
pub async fn find_peer(peer_key: &[u8], trace: &Trace) -> Result<Vec<SocketAddr>, Error> {
    trace.step("Looking for the device (Mnemax open on it)…");
    find(Watch::new(Name::Secret { label: SYNC_LABEL, key: peer_key.to_vec() })?, trace).await
}

/// Requests from devices that have a code and couldn't connect.
pub fn watch_joins() -> Result<Watch, Error> {
    Watch::new(Name::Pairing("join"))
}

/// Requests to sync with this device (the key is this device's), from devices that couldn't connect.
pub fn watch_requests(public_key: &[u8]) -> Result<Watch, Error> {
    Watch::new(Name::Secret { label: REQUEST_LABEL, key: public_key.to_vec() })
}

async fn find(mut watch: Watch, trace: &Trace) -> Result<Vec<SocketAddr>, Error> {
    let Ok(Some(mut addrs)) = tokio::time::timeout(FIND_TIME, watch.next()).await else {
        trace.step(format!("Found nothing in {} s.", FIND_TIME.as_secs()));
        return Err(Error::NotFound);
    };
    trace.step(format!("Found it at {}.", list(&addrs)));
    while let Ok(Some(more)) = tokio::time::timeout(GATHER_TIME, watch.next()).await {
        // Another announcement: a second device, or an old one that was never withdrawn.
        trace.step(format!("Also found one at {}.", list(&more)));
        addrs.extend(more.into_iter().filter(|a| !addrs.contains(a)).collect::<Vec<_>>());
    }
    Ok(addrs)
}

/// Looks for announcements under a name, each one once, moving to the next name every hour. Stops looking when
/// dropped.
pub struct Watch {
    daemon: ServiceDaemon,
    name: Name,
    window: u64,
    service: String,
    events: mdns_sd::Receiver<ServiceEvent>,
    seen: HashSet<String>,
}

impl Watch {
    fn new(name: Name) -> Result<Self, Error> {
        let daemon = ServiceDaemon::new().map_err(|_| Error::Network)?;
        let window = window_now();
        let service = name.looked_for(window);
        let events = daemon.browse(&service).map_err(|_| Error::Network)?;
        Ok(Self { daemon, name, window, service, events, seen: HashSet::new() })
    }

    /// The addresses of the next matching announcement not seen before.
    pub async fn next(&mut self) -> Option<Vec<SocketAddr>> {
        loop {
            if window_now() != self.window {
                self.window = window_now();
                let _ = self.daemon.stop_browse(&self.service);
                self.service = self.name.looked_for(self.window);
                self.events = self.daemon.browse(&self.service).ok()?;
            }
            // Pairing names never change; a day stands for never.
            let lasts = self.name.lasts().unwrap_or(Duration::from_secs(24 * 60 * 60));
            let event = tokio::select! {
                event = self.events.recv_async() => event.ok()?,
                _ = tokio::time::sleep(lasts) => continue,
            };
            let ServiceEvent::ServiceResolved(service) = event else { continue };
            if !self.name.matches(&service) || self.seen.contains(&service.fullname) {
                continue;
            }
            let addrs = addresses(&service);
            if !addrs.is_empty() {
                self.seen.insert(service.fullname.clone());
                return Some(addrs);
            }
        }
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        let _ = self.daemon.stop_browse(&self.service);
        let _ = self.daemon.shutdown();
    }
}

/// The service's IPv4 addresses on the local network (the listeners only take IPv4), the ones on this
/// device's own networks first: those are the ones most likely to answer.
fn addresses(service: &ResolvedService) -> Vec<SocketAddr> {
    let mut addrs: Vec<SocketAddr> = service
        .get_addresses()
        .iter()
        .map(|ip| ip.to_ip_addr())
        .filter(|ip| matches!(ip, IpAddr::V4(_)) && is_local(*ip))
        .map(|ip| SocketAddr::new(ip, service.get_port()))
        .collect();
    let mine = own_networks();
    addrs.sort_by_key(|a| (!mine.iter().any(|n| n.contains(a.ip())), *a));
    addrs
}

/// One of this device's IPv4 networks.
pub struct Network {
    pub interface: String,
    pub ip: std::net::Ipv4Addr,
    netmask: std::net::Ipv4Addr,
}

impl Network {
    fn contains(&self, ip: IpAddr) -> bool {
        let IpAddr::V4(ip) = ip else { return false };
        let mask = u32::from(self.netmask);
        u32::from(ip) & mask == u32::from(self.ip) & mask
    }
}

/// This device's IPv4 networks that are up, loopback left out.
pub fn own_networks() -> Vec<Network> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| i.is_oper_up() && !i.is_loopback())
        .filter_map(|i| match i.addr {
            if_addrs::IfAddr::V4(v4) => Some(Network { interface: i.name, ip: v4.ip, netmask: v4.netmask }),
            _ => None,
        })
        .collect()
}

fn prop<'a>(service: &'a ResolvedService, key: &str) -> Option<&'a str> {
    service.get_property_val_str(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Needs a network interface with multicast: run with `cargo test -- --ignored`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn finds_an_announced_device_by_its_key_or_as_pairing() {
        let key = [9u8; 32];
        let _sync = announce_sync(40001, &key).unwrap();
        let _pair = announce_pairing(40002).unwrap();
        let found = find_peer(&key, Trace::off()).await.unwrap();
        assert!(found.iter().all(|a| a.port() == 40001), "{found:?}");
        // Every device that's pairing is found (other tests may be pairing too): this one is among them.
        let found = find_pairing(Trace::off()).await.unwrap();
        assert!(found.iter().any(|a| a.port() == 40002), "{found:?}");
        assert!(matches!(find_peer(&[8u8; 32], Trace::off()).await, Err(Error::NotFound)));
    }

    // Needs a network interface with multicast: run with `cargo test -- --ignored`.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn sees_only_the_requests_meant_for_it() {
        let (me, other) = ([5u8; 32], [6u8; 32]);
        let mut requests = watch_requests(&me).unwrap();
        let _for_other = announce_request(40003, &other).unwrap();
        let _for_me = announce_request(40004, &me).unwrap();
        let _join = announce_join(40005).unwrap();
        let found = tokio::time::timeout(FIND_TIME, requests.next()).await.unwrap().unwrap();
        assert!(found.iter().all(|a| a.port() == 40004), "{found:?}");
        let mut joins = watch_joins().unwrap();
        let found = tokio::time::timeout(FIND_TIME, joins.next()).await.unwrap().unwrap();
        assert!(found.iter().all(|a| a.port() == 40005), "{found:?}");
    }

    #[test]
    fn tells_which_addresses_are_on_a_network() {
        let home = Network {
            interface: "wlan0".into(),
            ip: "192.168.1.103".parse().unwrap(),
            netmask: "255.255.255.0".parse().unwrap(),
        };
        assert!(home.contains("192.168.1.199".parse().unwrap()));
        assert!(!home.contains("192.168.2.199".parse().unwrap()));
        assert!(!home.contains("172.17.0.1".parse().unwrap()));
        assert!(!home.contains("::1".parse().unwrap()));
    }

    #[test]
    fn a_sync_name_is_a_valid_service_that_gives_nothing_away() {
        let (key, other) = ([1u8; 32], [2u8; 32]);
        let name = secret_service(SYNC_LABEL, &key, 480_000);
        assert_eq!(name, secret_service(SYNC_LABEL, &key, 480_000));
        let letters = name.strip_prefix('_').and_then(|n| n.strip_suffix("._tcp.local.")).unwrap();
        assert_eq!(letters.len(), SECRET_LETTERS);
        assert!(letters.chars().all(|c| c.is_ascii_lowercase()), "{name}");
        assert!(!name.contains("mnemax"));
        // Another key, another hour, or a request: another name.
        assert_ne!(name, secret_service(SYNC_LABEL, &other, 480_000));
        assert_ne!(name, secret_service(SYNC_LABEL, &key, 480_001));
        assert_ne!(name, secret_service(REQUEST_LABEL, &key, 480_000));
        // mDNS takes it.
        let info = ServiceInfo::new(&name, "0a1b2c3d4e5f", "0a1b2c3d4e5f.local.", "", 40000, HashMap::new());
        assert!(info.is_ok());
    }

    #[test]
    fn a_device_announces_the_hours_either_side_of_the_one_looked_for() {
        let name = Name::Secret { label: SYNC_LABEL, key: vec![3u8; 32] };
        let announced = name.announced(480_000);
        for window in [479_999, 480_000, 480_001] {
            assert!(announced.contains(&name.looked_for(window)));
        }
        assert!(!announced.contains(&name.looked_for(480_002)));
        assert!(name.txt().is_empty());
        assert_eq!(Name::Pairing("pair").announced(480_000), vec![PAIR_SERVICE.to_string()]);
    }
}
