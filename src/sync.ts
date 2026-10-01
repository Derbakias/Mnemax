// Sync with your other devices: the page's side. The network, the keys and pairing all live in Rust
// (src-tauri/src/sync). This file passes rounds to Rust, and checks and saves the rounds it brings back.

import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

import { checkRound } from '@/game/round-check';
import { loadRounds, mergeRounds } from '@/storage';

export interface SyncPeer {
  /** The device's public key, in hex: what identifies it. */
  key: string;
  name: string;
  /** Where this device connects to it. Null when it's the other device that connects here. */
  address: string | null;
  pairedAt: number;
  lastSyncAt: number | null;
}

/**
 * The version of the Rust commands this page talks to: must match API_VERSION in src-tauri/src/sync/commands.rs.
 * During development this page reloads by itself but Rust only when the app is rebuilt.
 */
export const SYNC_API = 5;

export interface SyncStatus {
  api?: number;
  /** This device's name, as paired devices see it. */
  name: string;
  peers: SyncPeer[];
}

/** A message if the Rust side is from another version of the app. */
export function apiMismatch(status: SyncStatus): string | null {
  return status.api === SYNC_API ? null : 'Sync is out of date. Restart or update the app.';
}

export type PairEvent =
  | { kind: 'paired'; peer: SyncPeer }
  /** Nobody tried the code in time. */
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  /** What pairing is doing, for the log. */
  | { kind: 'step'; text: string };

/** A QR code to draw: `size` × `size` squares, row by row, `1` for a dark one. */
export interface Qr {
  size: number;
  modules: string;
}

export interface ShownCode {
  /** This device's address, like 192.168.1.20. */
  address: string;
  /** The 9 digits. */
  code: string;
  /** The address and code together, for the Copy button. */
  text: string;
  /** How long the code works. */
  seconds: number;
  qr: Qr;
}

export type ListenEvent =
  | { kind: 'synced'; peer: SyncPeer; rounds: unknown[] }
  /** What the listener is doing, for the log. */
  | { kind: 'step'; text: string };

/** An iPhone or iPad. An iPad says it's a Mac, but a Mac has no touch screen. */
const isIos = (): boolean =>
  /iphone|ipad/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** A phone or tablet: the app sleeps in the background, and it scans QR codes with the system's scanner. */
export const isPhone = (): boolean => /android/i.test(navigator.userAgent) || isIos();

/**
 * Sync needs the app (a browser can't open network connections). Not on iPhone or iPad yet: it still needs a way
 * to lock the secret key in the keychain there.
 */
export const syncAvailable = (): boolean => isTauri() && !isIos();

/** A failed sync command: a short name for the error, and the message to show. */
export interface SyncFailure {
  code: string;
  message: string;
}

/** Which error a sync command failed with. */
export function failureCode(error: unknown): string | null {
  return typeof error === 'object' && error != null && 'code' in error ? String((error as SyncFailure).code) : null;
}

function channel<T>(onEvent: (event: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onEvent;
  return ch;
}

export const syncStatus = () => invoke<SyncStatus>('sync_status');
export const renameDevice = (name: string) => invoke<SyncStatus>('sync_rename', { name });
/** Forgets the device on this device only. */
export const forgetDevice = (key: string) => invoke<SyncStatus>('sync_forget', { key });

/** Shows a code and waits for the other device; how it goes comes through `onEvent`. */
export const startPairing = (onEvent: (event: PairEvent) => void) =>
  invoke<ShownCode>('pair_start', { onEvent: channel(onEvent) });

/** Pairs with the device at `address` that shows `code`; how it goes comes through `onEvent`. */
export const joinPairing = (address: string, code: string, onEvent: (event: PairEvent) => void) =>
  invoke<void>('pair_join', { address, code, onEvent: channel(onEvent) });

export const cancelPairing = () => invoke<void>('pair_cancel');

/** Lets paired devices connect and sync until `stopListening`. */
export async function startListening(onEvent: (event: ListenEvent) => void): Promise<void> {
  await invoke('sync_listen', { rounds: await loadRounds(), onEvent: channel(onEvent) });
}

export const stopListening = () => invoke<void>('sync_stop');

/** Hands the listener the rounds as they are now, after they changed. */
export async function updateListeningRounds(): Promise<void> {
  await invoke('sync_rounds', { rounds: await loadRounds() });
}

export interface SyncResult {
  added: number;
  /** Rounds that failed the check and weren't saved. */
  skipped: number;
}

/** Connects to a paired device and syncs with it; `onStep` hears what it's doing. */
export async function syncWith(key: string, onStep: (text: string) => void): Promise<SyncResult> {
  const rounds = await loadRounds();
  const outcome = await invoke<unknown>('sync_now', { key, rounds, onStep: channel(onStep) });
  // Anything but the expected shape is an error, never a guess.
  if (typeof outcome === 'object' && outcome != null && Array.isArray((outcome as { rounds?: unknown }).rounds)) {
    return saveReceived((outcome as { rounds: unknown[] }).rounds);
  }
  throw new Error("The app's sync answered in a way this page doesn't know. Restart the app.");
}

/** Checks the rounds another device sent, the same way as an imported file's, and saves the new ones. */
export async function saveReceived(received: unknown[]): Promise<SyncResult> {
  const now = Date.now();
  const rounds = received.flatMap((value) => checkRound(value, now) ?? []);
  const { added } = await mergeRounds(rounds);
  return { added, skipped: received.length - rounds.length };
}

/** The address and code in a scanned QR code or pasted text (`mnemax:pair:192.168.1.20:482913057`), or null. */
export function readPairingText(text: string): { address: string; code: string } | null {
  const match = /^mnemax:pair:(\d{1,3}(?:\.\d{1,3}){3}):(\d{9})$/.exec(text.trim());
  return match ? { address: match[1], code: match[2] } : null;
}

/** `482913057` → `482-913-057`, easier to read and type. */
export const groupCode = (code: string): string => code.replace(/(\d{3})(?=\d)/g, '$1-');

/**
 * Tidies an address as it's typed (`before` → `typed`), adding the dot by itself when the number before it can't
 * get longer: after 3 digits, after a number over 25 (one more digit would pass 255), or after a single 0. Other
 * times the person types the dot, since 10 could still become 100. Deleting never adds a dot back.
 */
export function typeAddress(before: string, typed: string): string {
  const parts: string[] = [];
  for (const piece of typed.replace(/[^\d.]/g, '').split('.')) {
    // A fourth digit in a row starts the next number.
    let rest = piece;
    do {
      parts.push(rest.slice(0, 3));
      rest = rest.slice(3);
    } while (rest);
  }
  // No empty numbers (from two dots in a row, or a dot first), except the one just started.
  const numbers = parts.filter((p, i) => p !== '' || i === parts.length - 1).slice(0, 4);
  const last = numbers[numbers.length - 1] ?? '';
  const complete = last.length === 3 || Number(last) > 25 || last === '0';
  const addDot = typed.length > before.length && numbers.length < 4 && last !== '' && complete;
  return numbers.join('.') + (addDot ? '.' : '');
}

/** Tidies a code as it's typed: digits only, at most 9, with a dash after each 3 (kept while deleting too). */
export function typeCode(before: string, typed: string): string {
  const digits = typed.replace(/\D/g, '').slice(0, 9);
  const atDash = digits.length === 3 || digits.length === 6;
  const addDash = atDash && (typed.length > before.length || typed.endsWith('-'));
  return groupCode(digits) + (addDash ? '-' : '');
}

/**
 * Phones: opens the camera behind the page (the page shows its own frame and Cancel button over it) until it finds a
 * QR code. Resolves with its text, or null if the scan was cancelled.
 */
export async function scanQr(): Promise<string | null> {
  const scanner = await import('@tauri-apps/plugin-barcode-scanner');
  let permission = await scanner.checkPermissions();
  if (permission !== 'granted') permission = await scanner.requestPermissions();
  if (permission !== 'granted') {
    throw new Error("Mnemax needs the camera to scan the code. Allow it in the phone's settings, or type the code.");
  }
  try {
    return (await scanner.scan({ formats: [scanner.Format.QRCode], windowed: true })).content;
  } catch (error) {
    if (String(error).includes('cancelled')) return null;
    throw error;
  }
}

export async function cancelScan(): Promise<void> {
  const scanner = await import('@tauri-apps/plugin-barcode-scanner');
  await scanner.cancel();
}
