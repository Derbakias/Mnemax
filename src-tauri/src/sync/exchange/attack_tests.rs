//! Tests that play someone trying to break in through sync: a stranger, a recording played back, and a
//! paired device asking for more than rounds.

use std::net::SocketAddr;

use serde_json::json;
use tokio::net::TcpListener;

use super::tests::{keypair, round};
use super::*;
use crate::sync::wire::Purpose;

/// The phone's side, by hand: connects and finishes the handshake, then the test decides what it sends.
async fn phone_by_hand(addr: SocketAddr, phone: &snow::Keypair, laptop: &[u8]) -> Secure {
    let mut stream = wire::open(addr, Purpose::Sync, Trace::off()).await.unwrap();
    let hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
        .local_private_key(&phone.private)
        .unwrap()
        .remote_public_key(laptop)
        .unwrap()
        .prologue(PROLOGUE)
        .unwrap()
        .build_initiator()
        .unwrap();
    let hs = wire::handshake(&mut stream, hs, false, |_| Ok(())).await.unwrap();
    Secure::new(stream, hs).unwrap()
}

#[tokio::test]
async fn a_stranger_who_knows_the_laptops_key_still_gets_not_a_single_byte() {
    use tokio::io::AsyncReadExt;
    let (laptop, stranger) = (keypair(), keypair());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let answering = async {
        let stream = wire::accept(&listener, Purpose::Sync, Trace::off()).await.unwrap();
        answer(stream, &laptop.private, "Laptop", |_| false, || vec![round("secret")], Trace::off()).await
    };
    let stranger_side = async {
        let mut stream = wire::open(addr, Purpose::Sync, Trace::off()).await.unwrap();
        let mut hs = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
            .local_private_key(&stranger.private)
            .unwrap()
            .remote_public_key(&laptop.public)
            .unwrap()
            .prologue(PROLOGUE)
            .unwrap()
            .build_initiator()
            .unwrap();
        let mut first = vec![0u8; 1024];
        let n = hs.write_message(&[], &mut first).unwrap();
        wire::write_piece(&mut stream, &first[..n]).await.unwrap();
        let mut back = Vec::new();
        let _ = stream.read_to_end(&mut back).await;
        back
    };
    let (answered, back) = tokio::join!(answering, stranger_side);
    assert!(matches!(answered, Err(Error::NotPaired)), "{answered:?}");
    assert!(back.is_empty(), "the stranger got {} bytes", back.len());
}

#[tokio::test]
async fn a_recorded_first_message_played_back_gets_nowhere() {
    // Someone on the Wi-Fi records the first message of a real sync and sends it again from their own
    // connection. It passes the key check (it's the phone's), but they can't go on without the phone's secret
    // key: whatever they send next fails its check, and nothing is synced.
    let (laptop, phone) = (keypair(), keypair());
    let mut recorded = snow::Builder::new(SYNC_PARAMS.parse().unwrap())
        .local_private_key(&phone.private)
        .unwrap()
        .remote_public_key(&laptop.public)
        .unwrap()
        .prologue(PROLOGUE)
        .unwrap()
        .build_initiator()
        .unwrap();
    let mut first = vec![0u8; 1024];
    let n = recorded.write_message(&[], &mut first).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let answering = async {
        let stream = wire::accept(&listener, Purpose::Sync, Trace::off()).await.unwrap();
        let is_phone = |k: &[u8]| k == phone.public.as_slice();
        answer(stream, &laptop.private, "Laptop", is_phone, || vec![round("secret")], Trace::off()).await
    };
    let replaying = async {
        let mut stream = wire::open(addr, Purpose::Sync, Trace::off()).await.unwrap();
        wire::write_piece(&mut stream, &first[..n]).await.unwrap();
        let _ = wire::read_piece(&mut stream).await;
        // Without the phone's keys, the best they can do is send something made up.
        wire::write_piece(&mut stream, &[0x42; 64]).await.unwrap();
    };
    let (answered, _) = tokio::join!(answering, replaying);
    assert!(matches!(answered, Err(Error::Protocol("message failed its check"))), "{answered:?}");
}

#[tokio::test]
async fn a_paired_device_can_only_swap_rounds_never_ask_for_anything_else() {
    // Even a real paired device has no way to ask for anything but rounds: any other message is refused.
    let (laptop, phone) = (keypair(), keypair());
    for sent in [
        json!({ "name": "Phone", "run": "rm -rf /" }),
        json!({ "want": "unpair", "name": "Phone" }),
        json!({ "readFile": "/etc/passwd" }),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let answering = async {
            let stream = wire::accept(&listener, Purpose::Sync, Trace::off()).await.unwrap();
            let is_phone = |k: &[u8]| k == phone.public.as_slice();
            answer(stream, &laptop.private, "Laptop", is_phone, || vec![round("secret")], Trace::off()).await
        };
        let asking = async {
            let mut chan = phone_by_hand(addr, &phone, &laptop.public).await;
            chan.send_json(&sent).await.unwrap();
        };
        let (answered, _) = tokio::join!(answering, asking);
        assert!(matches!(answered, Err(Error::Protocol("message in the wrong shape"))), "{sent}: {answered:?}");
    }
}
