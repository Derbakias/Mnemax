// TODO: Needs test cases

import { isTauri } from '@tauri-apps/api/core';

import type { RoundResult } from '@/game/types';

export function statsFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `mnemax-stats-${date}.json`;
}

export function buildStatsJson(rounds: RoundResult[]): string {
  return JSON.stringify(
    {
      app: 'mnemax',
      version: 1,
      exportedAt: new Date().toISOString(),
      rounds,
    },
    null,
    2,
  );
}

const isAndroid = () => /android/i.test(navigator.userAgent);

// Android's picker filters by MIME type, and shared/downloaded .json files are
// often tagged application/octet-stream, so don't filter there.
const JSON_FILTERS = () => (isAndroid() ? undefined : [{ name: 'JSON', extensions: ['json'] }]);

/** Returns false when the user cancelled. */
export async function exportStats(json: string, filename: string): Promise<boolean> {
  if (!isTauri()) {
    downloadStatsWeb(json, filename);
    return true;
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await save({ defaultPath: filename, filters: JSON_FILTERS() });
  if (path == null) return false;
  await writeTextFile(path, json);
  return true;
}

function downloadStatsWeb(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function pickStatsFileText(): Promise<string | null> {
  if (!isTauri()) return pickWebFileText();
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const path = await open({ multiple: false, directory: false, filters: JSON_FILTERS() });
  if (path == null) return null;
  return readTextFile(path);
}

function pickWebFileText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// TODO: needs better sanitisation
export function parseStatsPayload(text: string): RoundResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const candidate = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed != null && Array.isArray((parsed as { rounds?: unknown }).rounds)
      ? (parsed as { rounds: unknown[] }).rounds
      : null;
  if (!candidate) {
    throw new Error('No "rounds" array found in that file.');
  }
  const rounds = candidate.filter(isValidRound);
  if (rounds.length === 0) {
    throw new Error('No valid rounds found in that file.');
  }
  return rounds;
}

function isValidRound(value: unknown): value is RoundResult {
  // TODO: only check if it's an object, not what it's inside
  if (typeof value !== 'object' || value == null) return false;
  const round = value as Partial<RoundResult>;
  return (
    typeof round.id === 'string' &&
    round.id.length > 0 &&
    typeof round.finishedAt === 'number' &&
    Number.isFinite(round.finishedAt) &&
    Array.isArray(round.trials) &&
    typeof round.settings === 'object' &&
    round.settings != null
  );
}

// TODO: feature idea -> add also local sync on the same network for the stats to make it easier
