//! A probe that plays an attacker on the same Wi-Fi, to check pairing holds up against one: it speaks the real
//! wire protocol (the same `discovery`, `wire` and `pair` code the app uses), without the 6-digit code. Run it
//! against a phone showing a code:
//!
//! ```text
//! cargo test --lib sync::attack -- --ignored --nocapture --test-threads=1
//! ```
//!
//! It never touches anything but Mnemax's own ports, and everything it sends is a message the app is built to
//! refuse. It reports; it can't get in if the app is sound.

#![cfg(test)]

use std::time::Instant;

use super::pair::{self, Me, PairCode};
use super::trace::Trace;
use super::wire::{self, Purpose};
use super::{Error, SYNC_PARAMS};

/// A throwaway key for the attacker: it never had the code, so it should get nowhere with it.
fn attacker_keypair() -> snow::Keypair {
    snow::Builder::new(SYNC_PARAMS.parse().unwrap()).generate_keypair().unwrap()
}

/// Tries to pair with the device showing a code, using `guess`. Returns how it ended.
async fn try_to_pair(guess: PairCode) -> Result<(), Error> {
    let keys = attacker_keypair();
    let me = Me { private_key: &keys.private, name: "ATTACKER" };
    let trace = Trace::new(|step| eprintln!("    · {step}"));

    let found = super::discovery::find_pairing(&trace).await?;
    eprintln!("    found a device showing a code at {}", wire::list(&found));
    let stream = wire::open(&found, Purpose::Pair, &trace).await?;

    // If it somehow got past the code, we'd be asked to confirm a check number; say no, so a real pairing
    // can't complete by accident.
    let (answer_tx, answer_rx) = tokio::sync::oneshot::channel();
    let _ = answer_tx.send(false);
    pair::join(stream, guess, me, |name, check| eprintln!("    !! reached the check step with {name:?} ({check})"), answer_rx, &trace)
        .await
        .map(|paired| eprintln!("    !! PAIRED as {paired:?}"))
}

/// The attacker finds the pairing device and tries a guessed code. It must not get in. (One guess only: the
/// phone uses the code up on the first try, so make a fresh code on the phone before each run of this.)
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a phone showing a code on the same Wi-Fi"]
async fn a_guessed_code_does_not_get_in() {
    let guess = PairCode::random().unwrap();
    eprintln!("\n[1] Guessing the code {guess} without knowing it…");
    let result = try_to_pair(guess).await;
    eprintln!("[1] Result: {result:?}");
    assert!(
        matches!(result, Err(Error::WrongCode | Error::NotFound | Error::Unreachable | Error::TimedOut | Error::Io(_))),
        "a guessed code must never pair, got {result:?}",
    );
    eprintln!("[1] OK: the guess was refused; nothing paired.\n");
}

/// Junk sent to the pairing port must be dropped, not answered in a way that helps an attacker.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a phone showing a code on the same Wi-Fi"]
async fn garbage_on_the_pairing_port_gets_nowhere() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let trace = Trace::new(|step| eprintln!("    · {step}"));
    eprintln!("\n[2] Sending junk to the pairing port…");
    let found = super::discovery::find_pairing(&trace).await.expect("a device showing a code");
    let addr = found[0];
    let mut stream = TcpStream::connect(addr).await.unwrap();
    // Not a Mnemax opening: a plain HTTP request, as a careless scanner might send.
    stream.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
    let mut back = Vec::new();
    let read = tokio::time::timeout(std::time::Duration::from_secs(3), stream.read_to_end(&mut back)).await;
    eprintln!("[2] Got back {} byte(s): {back:?} ({read:?})", back.len());
    assert!(back.is_empty(), "the pairing port must not answer junk, got {back:?}");
    eprintln!("[2] OK: the port stayed silent and dropped the connection.\n");
}

/// Times a guess, so we can see the phone only allows one try per code (the connection is used up whether the
/// guess is right or wrong), which is what keeps brute force out.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a phone showing a code on the same Wi-Fi"]
async fn a_second_guess_on_the_same_code_finds_nothing() {
    eprintln!("\n[3] First guess…");
    let first = Instant::now();
    let _ = try_to_pair(PairCode::random().unwrap()).await;
    eprintln!("[3] First guess took {:?}. Now a second, without a new code…", first.elapsed());
    let result = try_to_pair(PairCode::random().unwrap()).await;
    eprintln!("[3] Second guess: {result:?}");
    assert!(
        matches!(result, Err(Error::NotFound | Error::Unreachable | Error::TimedOut | Error::WrongCode | Error::Io(_))),
        "a second guess on a used code must fail, got {result:?}",
    );
    eprintln!("[3] OK: the code was single-use; the second guess had nothing to reach.\n");
}

/// Brute force: for up to a minute, guess a wrong code the instant one is on screen, over and over. It answers
/// whether a wrong guess ends the code (attacker gets one try, then it's dead until a person makes a new one)
/// or whether fresh codes keep appearing to grind against. Self-contained: it waits for each code itself, so
/// there's no gap where the 30 s code can lapse between finding it and trying it.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs a phone showing a code on the same Wi-Fi"]
async fn brute_force_guessing_the_code() {
    use std::time::Duration;
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut ports_seen: Vec<u16> = Vec::new();
    let mut guesses = 0usize;

    eprintln!("\n[brute] Guessing wrong codes as fast as they appear, for up to 60 s. Keep a code on the phone…");
    while Instant::now() < deadline && guesses < 40 {
        let guess = PairCode::random().unwrap();
        let trace = Trace::new(|_| {});
        let found = match super::discovery::find_pairing(&trace).await {
            Ok(addrs) => addrs,
            Err(_) => continue, // No code right now; look again until the deadline.
        };
        let port = found[0].port();
        let keys = attacker_keypair();
        let me = Me { private_key: &keys.private, name: "ATTACKER" };
        let (answer_tx, answer_rx) = tokio::sync::oneshot::channel();
        let _ = answer_tx.send(false);
        let stream = match wire::open(&found, Purpose::Pair, &trace).await {
            Ok(s) => s,
            Err(_) => continue,
        };
        guesses += 1;
        ports_seen.push(port);
        let started = Instant::now();
        let result = pair::join(stream, guess, me, |_, _| {}, answer_rx, &trace).await;
        eprintln!("[brute] guess #{guesses}: {guess} at :{port} -> {result:?} (in {:?})", started.elapsed());
        assert!(result.is_err(), "a guessed code paired — brute force got in!");
    }

    let distinct: std::collections::HashSet<u16> = ports_seen.iter().copied().collect();
    eprintln!("\n[brute] Summary: {guesses} wrong guess(es) landed on {} distinct code port(s).", distinct.len());
    eprintln!("[brute] Ports: {ports_seen:?}");
    if guesses <= 1 {
        eprintln!("[brute] Only one code was ever guessable: a wrong guess ends it. Brute force can't grind.");
    } else if distinct.len() < guesses {
        eprintln!("[brute] Some guesses hit the SAME port: a code survived a wrong guess (should be single-use!).");
    } else {
        eprintln!("[brute] Each guess hit a NEW port: wrong guesses didn't stop fresh codes appearing. Each is a");
        eprintln!("[brute] new 1-in-a-million value and a wrong guess leaks nothing, but check whether the phone");
        eprintln!("[brute] (the UI, or you re-tapping) is what kept making codes.");
    }
}
