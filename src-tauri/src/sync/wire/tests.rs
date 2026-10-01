use super::*;
use crate::sync::SYNC_PARAMS;

/// Both ends of a connection on this computer.
async fn two_ends() -> (TcpStream, TcpStream) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (connected, accepted) = tokio::join!(TcpStream::connect(addr), listener.accept());
    (connected.unwrap(), accepted.unwrap().0)
}

#[tokio::test]
async fn reads_back_its_own_opening() {
    let (mut out, mut inn) = two_ends().await;
    write_opening(&mut out, Purpose::Sync).await.unwrap();
    assert!(check_opening(&mut inn, Purpose::Sync).await.is_ok());
}

#[tokio::test]
async fn a_pairing_device_hears_the_other_has_another_version() {
    let (mut out, mut inn) = two_ends().await;
    out.write_all(b"MNEMAX\x09\x01").await.unwrap();
    assert!(matches!(check_opening(&mut inn, Purpose::Pair).await, Err(Error::OtherVersion(9))));
    // The device that connected hears our version instead of a handshake.
    assert!(matches!(read_piece(&mut out).await, Err(Error::OtherVersion(PROTOCOL))));
}

#[tokio::test]
async fn a_device_waiting_to_sync_says_nothing_to_strangers() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let waiting = async {
        // Only the last connection gets through.
        timeout(Duration::from_secs(5), accept(&listener, Purpose::Sync, Trace::off())).await.unwrap().unwrap()
    };
    let strangers = async {
        for opening in [&b"GET / HTTP/1.1\r\n"[..], b"MNEMAX\x09\x02", b"MNEMAX\x06\x01"] {
            let mut stranger = TcpStream::connect(addr).await.unwrap();
            stranger.write_all(opening).await.unwrap();
            // Closed (or reset) without a single byte back.
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
async fn a_failed_sync_handshake_gets_nothing_back() {
    let (mut stranger, mut waiting) = two_ends().await;
    let keys = snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap();
    let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
        .local_private_key(&keys.private)
        .unwrap()
        .build_responder()
        .unwrap();
    write_piece(&mut stranger, &[7u8; 96]).await.unwrap();
    let (result, back) = tokio::join!(handshake(&mut waiting, hs, false, |_| Ok(())), async {
        let mut back = [0u8; 1];
        timeout(Duration::from_millis(300), stranger.read(&mut back)).await
    });
    assert!(matches!(result, Err(Error::Handshake)));
    drop(waiting);
    assert!(!matches!(back, Ok(Ok(1))), "the stranger was sent something");
}

#[test]
fn security_settings_have_not_changed() {
    // If one of these changes on purpose, update it here too, so the change is easy to see in review.
    assert_eq!(OPENING_TIME, Duration::from_secs(5));
    assert_eq!(CONNECT_TIME, Duration::from_secs(3));
    assert_eq!(MAX_PIECE, 65535);
}
