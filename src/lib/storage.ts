import * as AsyncStorage from './kv';

import {
  MAX_ROUNDS,
  PREFS_KEY,
  ROUNDS_KEY,
  ROUND_IN_PROGRESS_FILE,
  ROUND_IN_PROGRESS_KEY,
  SETTINGS_KEY,
} from '@/config/storage';
import { clampSettings } from '@/game/rules';
import type { GameSettings, RoundResult } from '../game/types';
import { clampPrefs, type AppPrefs } from './prefs';

/** Fired on `window` whenever the saved rounds change (a round saved, an import, a clear). */
export const ROUNDS_CHANGED_EVENT = 'mnemax:rounds-changed';

function notifyRoundsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUNDS_CHANGED_EVENT));
  }
}

/**
 * Fired on `window` when a round played on this device is saved (not when rounds come from a file or another
 * device), so sync can pass it on without syncing again over rounds it just got.
 */
export const ROUND_PLAYED_EVENT = 'mnemax:round-played';

/** Calls `onPlayed` after a round played on this device is saved; returns the unsubscribe function. */
export function onRoundPlayed(onPlayed: () => void): () => void {
  window.addEventListener(ROUND_PLAYED_EVENT, onPlayed);
  return () => window.removeEventListener(ROUND_PLAYED_EVENT, onPlayed);
}

/** Calls `onChange` after every change to the saved rounds; returns the unsubscribe function. */
export function onRoundsChanged(onChange: () => void): () => void {
  window.addEventListener(ROUNDS_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(ROUNDS_CHANGED_EVENT, onChange);
}

export async function loadSettings(): Promise<GameSettings> {
  try {
    const json = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!json) {
      return clampSettings(null);
    }
    return clampSettings(JSON.parse(json));
  } catch {
    return clampSettings(null);
  }
}

export async function saveSettings(settings: GameSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // persistence failure is non-fatal
  }
}

export async function loadPrefs(): Promise<AppPrefs> {
  try {
    const json = await AsyncStorage.getItem(PREFS_KEY);
    return clampPrefs(json ? JSON.parse(json) : null);
  } catch {
    return clampPrefs(null);
  }
}

export async function savePrefs(prefs: AppPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // persistence failure is non-fatal
  }
}

export async function loadRounds(): Promise<RoundResult[]> {
  try {
    const json = await AsyncStorage.getItem(ROUNDS_KEY);
    if (!json) {
      return [];
    }
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Every change to the saved rounds reads them, changes them, and writes them back. Two at the same time (a
// round ending while a sync saves, say) would each write their own copy, and one change would be lost. So
// they wait in line: each one starts only after the one before has finished.
let roundsLine: Promise<unknown> = Promise.resolve();

function inLine<T>(change: () => Promise<T>): Promise<T> {
  const done = roundsLine.then(change, change);
  roundsLine = done.catch(() => {});
  return done;
}

export function appendRound(round: RoundResult): Promise<RoundResult[]> {
  return inLine(async () => {
    const rounds = await loadRounds();
    const next = [round, ...rounds].slice(0, MAX_ROUNDS);
    try {
      await AsyncStorage.setItem(ROUNDS_KEY, JSON.stringify(next));
    } catch {
      // persistence failure is non-fatal
    }
    notifyRoundsChanged();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ROUND_PLAYED_EVENT));
    }
    return next;
  });
}

export function clearRounds(): Promise<void> {
  return inLine(async () => {
    try {
      await AsyncStorage.removeItem(ROUNDS_KEY);
    } catch {
      // non-fatal
    }
    notifyRoundsChanged();
  });
}

/** Newest first; rounds that finished at the same time go by id, so every device keeps the same 500. */
function newestFirst(a: RoundResult, b: RoundResult): number {
  return b.finishedAt - a.finishedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Adds the rounds whose id isn't saved yet; a saved round is never changed. A round with the id of one already
 * saved (or earlier in `incoming`) is dropped. Past 500 the oldest rounds go, as when a round is played.
 */
export function mergeRounds(incoming: RoundResult[]): Promise<{ added: number }> {
  return inLine(() => mergeNow(incoming));
}

async function mergeNow(incoming: RoundResult[]): Promise<{ added: number }> {
  const existing = await loadRounds();
  const knownIds = new Set(existing.map((r) => r.id));
  const fresh = incoming.filter((r) => {
    if (knownIds.has(r.id)) {
      return false;
    }
    knownIds.add(r.id);
    return true;
  });
  if (fresh.length === 0) {
    return { added: 0 };
  }
  const merged = [...fresh, ...existing].sort(newestFirst).slice(0, MAX_ROUNDS);
  // Only the ones still there after the cap: older ones than the newest 500 aren't kept.
  const freshIds = new Set(fresh.map((r) => r.id));
  const added = merged.filter((r) => freshIds.has(r.id)).length;
  if (added === 0) {
    return { added: 0 };
  }
  try {
    await AsyncStorage.setItem(ROUNDS_KEY, JSON.stringify(merged));
  } catch {
    // persistence failure is non-fatal
  }
  notifyRoundsChanged();
  return { added };
}

// The round being played is saved after every trial, so a round the app closed in the middle of (quit,
// crash, or Android killing it in the background) is still recorded, as stopped, on the next start.

export async function saveRoundInProgress(round: RoundResult): Promise<void> {
  try {
    await AsyncStorage.setItem(ROUND_IN_PROGRESS_KEY, JSON.stringify(round), ROUND_IN_PROGRESS_FILE);
  } catch (error) {
    // Non-fatal: the round goes on; only recovery after a crash is lost.
    console.warn('Could not save the round in progress', error);
  }
}

export async function clearRoundInProgress(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ROUND_IN_PROGRESS_KEY, ROUND_IN_PROGRESS_FILE);
  } catch (error) {
    // Non-fatal: a leftover is ignored at the next start, since that round is already in the history.
    console.warn('Could not clear the round in progress', error);
  }
}

/** Saves a round left unfinished by the last run as stopped (if there is one). Call once at startup. */
export async function recoverRoundInProgress(): Promise<void> {
  let round: RoundResult | null = null;
  try {
    const json = await AsyncStorage.getItem(ROUND_IN_PROGRESS_KEY, ROUND_IN_PROGRESS_FILE);
    round = json ? JSON.parse(json) : null;
  } catch (error) {
    // unreadable: nothing to recover
    console.warn('Could not recover the round in progress', error);
  }
  if (round && typeof round.id === 'string') {
    const rounds = await loadRounds();
    if (!rounds.some((r) => r.id === round.id)) {
      await appendRound({ ...round, stopped: true });
    }
  }
  await clearRoundInProgress();
}
