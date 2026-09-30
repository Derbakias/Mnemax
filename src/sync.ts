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

export interface SyncStatus {
  /** This device's name, as paired devices see it. */
  name: string;
  peers: SyncPeer[];
}

export type PairEvent =
  | { kind: 'check'; name: string; check: string }
  | { kind: 'paired'; peer: SyncPeer }
  | { kind: 'failed'; message: string };

export type ListenEvent =
  | { kind: 'synced'; peer: SyncPeer; rounds: unknown[] }
  | { kind: 'failed'; message: string }
  | { kind: 'stopped' };

/** Only the app has the network access sync needs, not a plain browser. */
export const syncAvailable = (): boolean => isTauri();

export const syncStatus = () => invoke<SyncStatus>('sync_status');
export const renameDevice = (name: string) => invoke<SyncStatus>('sync_rename', { name });
export const forgetDevice = (key: string) => invoke<SyncStatus>('sync_forget', { key });

function channel<T>(onEvent: (event: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onEvent;
  return ch;
}

/** Waits for the other device; resolves with the code to type on it. */
export const startPairing = (onEvent: (event: PairEvent) => void) =>
  invoke<string>('pair_start', { onEvent: channel(onEvent) });

/** Looks for the device showing `code` and pairs with it; how it goes comes through `onEvent`. */
export const joinPairing = (code: string, onEvent: (event: PairEvent) => void) =>
  invoke<void>('pair_join', { code, onEvent: channel(onEvent) });

export const answerPairing = (accept: boolean) => invoke<void>('pair_answer', { accept });
export const cancelPairing = () => invoke<void>('pair_cancel');

/** Lets paired devices sync with this one until `stopListening` (or 10 minutes). */
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

/** Syncs with a paired device that has its Sync section open. */
export async function syncWith(key: string): Promise<SyncResult> {
  const received = await invoke<unknown[]>('sync_now', { key, rounds: await loadRounds() });
  return saveReceived(received);
}

/** Checks the rounds another device sent, the same way as an imported file's, and saves the new ones. */
export async function saveReceived(received: unknown[]): Promise<SyncResult> {
  const now = Date.now();
  const rounds = received.flatMap((value) => checkRound(value, now) ?? []);
  const { added } = await mergeRounds(rounds);
  return { added, skipped: received.length - rounds.length };
}
