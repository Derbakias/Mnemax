use super::*;
use crate::sync::wire::Purpose;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::net::SocketAddr;
use tokio::net::TcpListener;

pub fn keypair() -> snow::Keypair {
    snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
}

pub fn round(id: &str) -> Value {
    json!({ "id": id, "finishedAt": 1, "settings": {}, "trials": [] })
}

fn ids(rounds: &[Value]) -> Vec<&str> {
    let mut ids: Vec<&str> = rounds.iter().filter_map(round_id).collect();
    ids.sort();
    ids
}

/// A phone (`asker`) connects to a laptop (`answerer`), expecting the laptop's key to be `expected`. The
/// laptop knows only `paired` as a paired device.
async fn run(
    answerer: &snow::Keypair,
    asker: &snow::Keypair,
    paired: &[u8],
    expected: &[u8],
    laptop_has: Vec<Value>,
    phone_has: Vec<Value>,
) -> (Result<Synced, Error>, Result<Synced, Error>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let answering = async {
        let stream = wire::accept(&listener, Purpose::Sync, Trace::off()).await.unwrap();
        answer(stream, &answerer.private, "Laptop", |k| k == paired, || laptop_has, Trace::off()).await
    };
    let asking = async {
        let stream = wire::open(addr, Purpose::Sync, Trace::off()).await.unwrap();
        initiate(stream, &asker.private, expected, "Phone", &phone_has, || true, Trace::off()).await
    };
    tokio::join!(answering, asking)
}

/// The phone's side against a laptop that's driven by hand in the test, up to the rounds.
async fn phone_syncs(
    addr: SocketAddr,
    phone: &snow::Keypair,
    laptop: &[u8],
    mine: &[Value],
) -> Result<Vec<Value>, Error> {
    let stream = wire::open(addr, Purpose::Sync, Trace::off()).await?;
    Ok(initiate(stream, &phone.private, laptop, "Phone", mine, || true, Trace::off()).await?.rounds)
}

/// A paired laptop that speaks the protocol by hand, so a test can make it misbehave after the handshake.
async fn laptop_by_hand(listener: &TcpListener, keys: &snow::Keypair) -> Secure {
    let (mut stream, _) = listener.accept().await.unwrap();
    wire::check_opening(&mut stream, Purpose::Sync).await.unwrap();
    let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
        .local_private_key(&keys.private)
        .unwrap()
        .prologue(PROLOGUE)
        .unwrap()
        .build_responder()
        .unwrap();
    let hs = wire::handshake(&mut stream, hs, false, |_| Ok(())).await.unwrap();
    let mut chan = Secure::new(stream, hs).unwrap();
    let _: Name = chan.recv_json(MAX_NAME_BYTES).await.unwrap();
    chan.send_json(&Name { name: "Laptop".into() }).await.unwrap();
    let _: Have = chan.recv_json(MAX_IDS_BYTES).await.unwrap();
    chan
}

#[tokio::test]
async fn swaps_the_rounds_each_one_lacks() {
    let (laptop, phone) = (keypair(), keypair());
    let laptop_has = vec![round("yesterday-1"), round("yesterday-2"), round("both")];
    let phone_has = vec![round("today-1"), round("both")];
    let (answered, asked) = run(&laptop, &phone, &phone.public, &laptop.public, laptop_has, phone_has).await;
    let (answered, asked) = (answered.unwrap(), asked.unwrap());
    assert_eq!(answered.key, phone.public);
    assert_eq!(ids(&answered.rounds), ["today-1"]);
    assert_eq!(answered.name.as_deref(), Some("Phone"));
    assert_eq!(ids(&asked.rounds), ["yesterday-1", "yesterday-2"]);
    assert_eq!(asked.name.as_deref(), Some("Laptop"));
}

#[tokio::test]
async fn turns_away_a_device_it_is_not_paired_with() {
    let (laptop, stranger) = (keypair(), keypair());
    let (answered, asked) = run(&laptop, &stranger, &[0; 32], &laptop.public, vec![round("mine")], vec![]).await;
    assert!(matches!(answered, Err(Error::NotPaired)), "{answered:?}");
    assert!(matches!(asked, Err(Error::Refused)), "{asked:?}");
}

#[tokio::test]
async fn will_not_sync_with_a_device_pretending_to_be_the_paired_one() {
    // The phone expects the laptop's key; an impostor at the laptop's address has its own.
    let (laptop, phone, impostor) = (keypair(), keypair(), keypair());
    let (answered, asked) = run(&impostor, &phone, &phone.public, &laptop.public, vec![], vec![round("secret")]).await;
    assert!(answered.is_err());
    assert!(asked.is_err());
}

#[tokio::test]
async fn sends_nothing_to_a_device_forgotten_during_the_sync() {
    let (laptop, phone) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // Paired at the handshake, forgotten by the time the rounds would go out.
    let checks = AtomicUsize::new(0);
    let is_paired = |_: &[u8]| checks.fetch_add(1, Ordering::SeqCst) == 0;
    let answering = async {
        let stream = wire::accept(&listener, Purpose::Sync, Trace::off()).await.unwrap();
        answer(stream, &laptop.private, "Laptop", is_paired, || vec![round("secret")], Trace::off()).await
    };
    let (answered, asked) = tokio::join!(answering, phone_syncs(addr, &phone, &laptop.public, &[]));
    assert!(matches!(answered, Err(Error::UnknownPeer)), "{answered:?}");
    assert!(asked.is_err(), "the phone got {asked:?}");
}

#[tokio::test(start_paused = true)]
async fn a_connection_that_never_proves_itself_is_let_go_soon() {
    let laptop = keypair();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (accepted, _stranger) = tokio::join!(listener.accept(), TcpStream::connect(addr));
    let started = tokio::time::Instant::now();
    let answered = answer(accepted.unwrap().0, &laptop.private, "Laptop", |_| true, Vec::new, Trace::off()).await;
    assert!(matches!(answered, Err(Error::TimedOut)), "{answered:?}");
    assert_eq!(started.elapsed(), PROVE_TIME);
}

#[tokio::test]
async fn keeps_only_the_rounds_it_asked_for() {
    let (laptop, phone) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    // A paired device that sends more than it said it had: one we have, one it never mentioned, one twice,
    // and something that isn't a round.
    let pushy = async {
        let mut chan = laptop_by_hand(&listener, &laptop).await;
        chan.send_json(&Have { ids: vec!["new".into(), "shared".into()] }).await.unwrap();
        let _: Rounds = chan.recv_json(MAX_ROUNDS_BYTES).await.unwrap();
        let rounds = vec![round("new"), round("new"), round("shared"), round("unasked"), json!(42)];
        chan.send_json(&Rounds { rounds }).await.unwrap();
    };
    let mine = [round("shared")];
    let (_, got) = tokio::join!(pushy, phone_syncs(addr, &phone, &laptop.public, &mine));
    assert_eq!(ids(&got.unwrap()), ["new"]);
}

#[tokio::test]
async fn refuses_a_bad_or_huge_id_list_before_any_rounds() {
    for bad in [vec!["ok".to_string(), "not a round id!".to_string()], vec!["r".to_string(); MAX_IDS + 1]] {
        let (laptop, phone) = (keypair(), keypair());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let liar = async {
            let mut chan = laptop_by_hand(&listener, &laptop).await;
            chan.send_json(&Have { ids: bad }).await.unwrap();
            // After a bad list, no rounds may come.
            let after = timeout(Duration::from_millis(300), chan.recv(MAX_ROUNDS_BYTES)).await;
            assert!(after.is_err() || after.unwrap().is_err(), "no rounds should be sent");
        };
        let mine = [round("mine")];
        let (_, got) = tokio::join!(liar, phone_syncs(addr, &phone, &laptop.public, &mine));
        assert!(matches!(got, Err(Error::Protocol("bad round ids"))), "{got:?}");
    }
}

#[tokio::test]
async fn refuses_a_message_over_the_limit() {
    let (laptop, phone) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let flooding = async {
        let mut chan = laptop_by_hand(&listener, &laptop).await;
        let _ = chan.send(&vec![b' '; MAX_IDS_BYTES + 1]).await;
    };
    let (_, got) = tokio::join!(flooding, phone_syncs(addr, &phone, &laptop.public, &[]));
    assert!(matches!(got, Err(Error::Protocol("message too big"))), "{got:?}");
}

#[test]
fn round_ids_follow_the_page_rule() {
    assert!(is_round_id("round-1759233600000"));
    assert!(is_round_id("a.b_c:d-e"));
    for bad in ["", &"r".repeat(65), "round 1", "round-ü"] {
        assert!(!is_round_id(bad), "{bad}");
    }
}

#[test]
fn security_settings_have_not_changed() {
    // If one of these changes on purpose, update it here too, so the change is easy to see in review.
    assert_eq!(PROVE_TIME, Duration::from_secs(5));
    assert_eq!(SYNC_TIME, Duration::from_secs(60));
    assert_eq!(MAX_NAME_BYTES, 512);
    assert_eq!(MAX_IDS, 2000);
    assert_eq!(MAX_ID_CHARS, 64);
    assert_eq!(MAX_ROUNDS_BYTES, 16 * 1024 * 1024);
}
