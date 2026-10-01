// TODO: Needs test cases

import { isTauri } from '@tauri-apps/api/core';

import { checkRound } from '@/game/round-check';
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
  if (path == null) {
    return false;
  }
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

/** Far above what 500 rounds take (8 MB at most); a bigger file isn't an export, and reading it could stall the app. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const tooBig = () => new Error('That file is too big to be a stats export.');

/** Its size is checked before it's read, so a huge file is never loaded. */
export async function pickStatsFileText(): Promise<string | null> {
  if (!isTauri()) {
    return pickWebFileText();
  }
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile, stat } = await import('@tauri-apps/plugin-fs');
  const path = await open({ multiple: false, directory: false, filters: JSON_FILTERS() });
  if (path == null) {
    return null;
  }
  if ((await stat(path)).size > MAX_FILE_BYTES) {
    throw tooBig();
  }
  return readTextFile(path);
}

function pickWebFileText(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        reject(tooBig());
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

/** The file's rounds that pass every check, and how many didn't. */
export function parseStatsPayload(text: string): { rounds: RoundResult[]; skipped: number } {
  if (text.length > MAX_FILE_BYTES) {
    throw tooBig();
  }
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
  const now = Date.now();
  const rounds = candidate.flatMap((value) => checkRound(value, now) ?? []);
  if (rounds.length === 0) {
    throw new Error('No valid rounds found in that file.');
  }
  return { rounds, skipped: candidate.length - rounds.length };
}
