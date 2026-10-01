use super::*;
use crate::sync::{trace, SYNC_PARAMS};
use std::net::SocketAddr;
use tokio::io::AsyncWriteExt;

fn keypair() -> snow::Keypair {
    snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
}

/// The joining device: connects to the device showing the code and tries `code`.
async fn join_at(addr: SocketAddr, code: PairCode, keys: &snow::Keypair) -> Result<Paired, Error> {
    let stream = wire::open(addr, Purpose::Pair, Trace::off()).await?;
    join(stream, code, Me { private_key: &keys.private, name: "Phone" }, Trace::off()).await
}

/// One device shows `code`, the other types `typed`.
async fn run(code: PairCode, typed: PairCode) -> (Result<Paired, Error>, Result<Paired, Error>) {
    let (host_keys, join_keys) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let me = Me { private_key: &host_keys.private, name: "Laptop" };
    let (hosted, joined) = tokio::join!(host(&listener, code, me, Trace::off()), join_at(addr, typed, &join_keys));
    if let (Ok(h), Ok(j)) = (&hosted, &joined) {
        assert_eq!(h.key, join_keys.public);
        assert_eq!(j.key, host_keys.public);
    }
    (hosted, joined)
}

#[tokio::test]
async fn pairs_with_the_right_code() {
    let code = PairCode::random().unwrap();
    let (hosted, joined) = run(code, code).await;
    assert_eq!(hosted.unwrap().name, "Phone");
    assert_eq!(joined.unwrap().name, "Laptop");
}

#[tokio::test]
async fn a_wrong_code_fails_on_both_devices() {
    let (code, typed) = (PairCode::parse("815307001").unwrap(), PairCode::parse("815307002").unwrap());
    let (hosted, joined) = run(code, typed).await;
    assert!(matches!(hosted, Err(Error::WrongCode)), "{hosted:?}");
    assert!(matches!(joined, Err(Error::WrongCode)), "{joined:?}");
}

#[tokio::test]
async fn a_code_is_used_up_by_one_wrong_try() {
    let code = PairCode::random().unwrap();
    let wrong = PairCode((code.0 + 1) % 1_000_000_000);
    let (keys, other) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let me = Me { private_key: &keys.private, name: "Laptop" };
    let (hosted, _) = tokio::join!(host(&listener, code, me, Trace::off()), join_at(addr, wrong, &other));
    assert!(matches!(hosted, Err(Error::WrongCode)));
    // The waiting device has stopped: now even the right code gets nowhere.
    let late = timeout(Duration::from_secs(2), join_at(addr, code, &keypair())).await;
    assert!(!matches!(late, Ok(Ok(_))));
}

#[tokio::test(start_paused = true)]
async fn a_code_stops_working_after_a_minute() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let keys = keypair();
    let started = tokio::time::Instant::now();
    let me = Me { private_key: &keys.private, name: "Laptop" };
    let hosted = host(&listener, PairCode::random().unwrap(), me, Trace::off()).await;
    assert!(matches!(hosted, Err(Error::CodeExpired)), "{hosted:?}");
    assert_eq!(started.elapsed(), CODE_LIFETIME);
}

#[tokio::test]
async fn a_stray_connection_leaves_the_code_working() {
    let code = PairCode::random().unwrap();
    let (host_keys, join_keys) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (host_trace, host_steps) = trace::kept();
    let stray = async {
        let mut s = TcpStream::connect(addr).await.unwrap();
        s.write_all(b"GET / HTTP/1.1\r\n\r\n").await.unwrap();
        drop(s);
        join_at(addr, code, &join_keys).await
    };
    let me = Me { private_key: &host_keys.private, name: "Laptop" };
    let (hosted, joined) = tokio::join!(host(&listener, code, me, &host_trace), stray);
    assert_eq!(hosted.unwrap().name, "Phone");
    assert_eq!(joined.unwrap().name, "Laptop");
    let steps = host_steps.lock().unwrap();
    assert!(steps.iter().any(|s| s.contains("not a Mnemax connection")), "{steps:?}");
}

#[test]
fn reads_and_writes_codes() {
    let code = PairCode::parse("815307042").unwrap();
    assert_eq!(code.to_string(), "815307042");
    assert_eq!(PairCode::parse(" 815 307 042 "), Some(code));
    assert_eq!(PairCode::parse("000000001").unwrap().to_string(), "000000001");
    for bad in ["81530704", "8153070421", "815-307-042", "8a5307042", "８15307042"] {
        assert!(PairCode::parse(bad).is_none(), "{bad}");
    }
}

#[test]
fn random_codes_vary() {
    let codes: std::collections::HashSet<String> = (0..50).map(|_| PairCode::random().unwrap().to_string()).collect();
    assert!(codes.len() > 45);
}

#[test]
fn security_settings_have_not_changed() {
    // If one of these changes on purpose, update it here too, so the change is easy to see in review.
    assert_eq!(CODE_DIGITS, 9);
    assert_eq!(CODE_LIFETIME, Duration::from_secs(60));
    assert_eq!(HANDSHAKE_TIME, Duration::from_secs(15));
    assert_eq!(crate::sync::PAIR_PARAMS, "Noise_XXpsk0_25519_ChaChaPoly_BLAKE2s");
    assert_eq!(crate::sync::SYNC_PARAMS, "Noise_IK_25519_ChaChaPoly_BLAKE2s");
    // Codes are spread over all billion values, not a smaller range.
    assert!((0..200).any(|_| PairCode::random().unwrap().0 >= 900_000_000));
}
