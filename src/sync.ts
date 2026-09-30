// Local sync with the user's other devices: the page's side. The network, the keys and the pairing all live
// in Rust (src-tauri/src/sync); this passes rounds to it and checks and saves the ones it brings back.

import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

import { checkRound } from '@/game/round-check';
import { loadRounds, mergeRounds } from '@/storage';

export interface SyncPeer {
  /** The device's public key, in hex. */
  key: string;
  name: string;
  pairedAt: number;
  lastSyncAt: number | null;
}

/**
 * What the sync commands take and give: must match API_VERSION in src-tauri/src/sync/mod.rs. In development
 * this page reloads on its own but the Rust side only when the app is rebuilt, and a page talking to older
 * commands would misread their answers.
 */
export const SYNC_API = 3;

export interface SyncStatus {
  /** The Rust side's SYNC_API (missing from builds before it had one). */
  api?: number;
  /** This device's name, as paired devices see it. */
  name: string;
  peers: SyncPeer[];
}

/** Why the Rust side can't be used from this page, if it can't. */
export function apiMismatch(status: SyncStatus): string | null {
  return status.api === SYNC_API
    ? null
    : "Sync functionality is outdated. Restart/update the app to the latest version.";
}

export type PairEvent =
  | { kind: 'check'; name: string; check: string }
  | { kind: 'paired'; peer: SyncPeer }
  /** No device tried the code in time: it no longer works. */
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  /** What the pairing is doing, for the Details view. */
  | { kind: 'step'; text: string };

/** A QR code to draw: `size` × `size` modules, row by row, `1` for a dark one. */
export interface Qr {
  size: number;
  modules: string;
}

export interface ShownCode {
  /** The 6 digits to type on the other device. */
  code: string;
  /** How long the code works for. */
  seconds: number;
  /** The same code, for a phone to scan. */
  qr: Qr;
}

export type ListenEvent =
  | { kind: 'synced'; peer: SyncPeer; rounds: unknown[] }
  /** A paired device unpaired this one, so it's gone here too. */
  | { kind: 'unpaired'; name: string }
  | { kind: 'failed'; message: string }
  /** What the listener is doing, for the Details view. */
  | { kind: 'step'; text: string };

/** Only the app has the network access sync needs, not a plain browser. */
export const syncAvailable = (): boolean => isTauri();

export const syncStatus = () => invoke<SyncStatus>('sync_status');
export const renameDevice = (name: string) => invoke<SyncStatus>('sync_rename', { name });
/** A failed sync command: the message to show, and which error it was. */
export interface SyncFailure {
  code: string;
  message: string;
}

/** Which error a sync command failed with, if it was one. */
export function failureCode(error: unknown): string | null {
  return typeof error === 'object' && error != null && 'code' in error ? String((error as SyncFailure).code) : null;
}

/** `both`: the other device removed this one, then this one removed it; `alreadyGone`: it no longer knew it. */
export type Forgot = 'both' | 'alreadyGone';

/**
 * Forgets the device on both sides: first it removes this device, then this one removes it. Fails, changing
 * nothing, if it can't be reached. `onStep` hears what it's doing.
 */
export async function forgetDevice(key: string, onStep: (text: string) => void): Promise<Forgot> {
  const forgot = await invoke<unknown>('sync_forget', { key, onStep: channel(onStep) });
  if (forgot === 'both' || forgot === 'alreadyGone') return forgot;
  throw new Error("The app's sync answered in a way this page doesn't know. Restart the app.");
}

/** Forgets a device that can't be reached (lost, say) on this side only; it's told if it ever tries to sync. */
export const forgetDeviceHere = (key: string) => invoke<SyncStatus>('sync_forget_here', { key });

function channel<T>(onEvent: (event: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onEvent;
  return ch;
}

/** Waits for the other device; resolves with the code to type or scan on it. */
export const startPairing = (onEvent: (event: PairEvent) => void) =>
  invoke<ShownCode>('pair_start', { onEvent: channel(onEvent) });

/** Looks for the device showing `code` and pairs with it; how it goes comes through `onEvent`. */
export const joinPairing = (code: string, onEvent: (event: PairEvent) => void) =>
  invoke<void>('pair_join', { code, onEvent: channel(onEvent) });

export const answerPairing = (accept: boolean) => invoke<void>('pair_answer', { accept });
export const cancelPairing = () => invoke<void>('pair_cancel');

/** Lets paired devices sync with this one until `stopListening`. */
export async function startListening(onEvent: (event: ListenEvent) => void): Promise<void> {
  await invoke('sync_listen', { rounds: await loadRounds(), onEvent: channel(onEvent) });
}

export const stopListening = () => invoke<void>('sync_stop');

/** What a listening device hands out, after the saved rounds changed. */
export async function updateListeningRounds(): Promise<void> {
  await invoke('sync_rounds', { rounds: await loadRounds() });
}

export interface SyncResult {
  added: number;
  /** Rounds that failed the check and weren't saved. */
  skipped: number;
}

/**
 * Syncs with a paired device that has Mnemax open; `onStep` hears what it's doing. Null if that device had
 * unpaired this one (it's then gone here too). `quick` (automatic syncs) gives up at once if the device isn't
 * announcing itself, rather than asking it to connect back.
 */
export async function syncWith(
  key: string,
  onStep: (text: string) => void,
  quick = false,
): Promise<SyncResult | null> {
  const rounds = await loadRounds();
  const outcome = await invoke<unknown>('sync_now', { key, rounds, quick, onStep: channel(onStep) });
  // Only an answer that says so counts as unpaired: anything unexpected is an error, never a conclusion.
  if (isObject(outcome) && outcome.kind === 'unpaired') return null;
  if (isObject(outcome) && outcome.kind === 'synced' && Array.isArray(outcome.rounds)) {
    return saveReceived(outcome.rounds);
  }
  throw new Error("The app's sync answered in a way this page doesn't know. Restart the app.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** Checks the rounds another device sent, the same way as an imported file's, and saves the new ones. */
export async function saveReceived(received: unknown[]): Promise<SyncResult> {
  const now = Date.now();
  const rounds = received.flatMap((value) => checkRound(value, now) ?? []);
  const { added } = await mergeRounds(rounds);
  return { added, skipped: received.length - rounds.length };
}

/** A phone (or tablet): the app is put to sleep in the background, and it has a camera to scan with. */
export const isPhone = (): boolean => /android|iphone|ipad/i.test(navigator.userAgent);

/** Phones can scan the QR code another device shows; computers type the code. */
export const canScan = (): boolean => isTauri() && isPhone();

/** The code in a QR code another device shows, or null if it isn't a Mnemax pairing code. */
export function codeFromQr(text: string): string | null {
  return /^mnemax:pair:(\d{6})$/.exec(text.trim())?.[1] ?? null;
}

/**
 * Opens the camera behind the page (the page shows its own frame and Cancel button over it, see
 * ScanOverlay) until a QR code is found. Resolves with its text, or null if the scan was cancelled.
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
