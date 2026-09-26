import type { GameSettings, StreamId, StreamOutcome } from './types';
import { STREAM_IDS } from './types';

export const NEUTRAL_COLOR = '#64B5F6';

export const TRIALS_PER_ROUND = 20;
export const MIN_N = 1;
export const MAX_N = 10;
export const GRID_CELLS = 9;
export const GRID_CENTER_INDEX = 4;
export const POSITION_CELLS = [0, 1, 2, 3, 5, 6, 7, 8];
export const POSITION_ARROWS: Record<number, string> = {
  0: '↖',
  1: '↑',
  2: '↗',
  3: '←',
  5: '→',
  6: '↙',
  7: '↓',
  8: '↘',
};
// The box shows for most of each trial; the short blank that follows marks the next trial, so a repeat
// in the same cell still reads as a new trial. Difficulty comes from the trial speed.
export const BLANK_MS = 500;

/** How long the box shows in a trial: all of it except the fixed blank at the end. */
export function stimulusVisibleMs(trialDurationMs: number): number {
  return Math.max(0, trialDurationMs - BLANK_MS);
}

// TODO: Find better colour combinations
export const COLOR_PALETTE = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00'];

export const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface SpeedPreset {
  label: string;
  ms: number;
}

// Trial speed is one of these presets, fastest first; anything else (e.g. saved by an older version) snaps
// to the nearest.
export const SPEED_PRESETS: SpeedPreset[] = [
  { label: 'Very fast', ms: 800 },
  { label: 'Fast', ms: 1000 },
  { label: 'Normal', ms: 1200 },
  { label: 'Slow', ms: 2000 },
  { label: 'Very slow', ms: 3000 },
];
export const DEFAULT_TRIAL_MS = 1200;

export function speedPresetFor(ms: number): SpeedPreset {
  let best = SPEED_PRESETS[0];
  for (const preset of SPEED_PRESETS) {
    if (Math.abs(preset.ms - ms) < Math.abs(best.ms - ms)) best = preset;
  }
  return best;
}

export const DEFAULT_MATCH_COUNT = 6;

export function maxMatchesFor(nLevel: number): number {
  return TRIALS_PER_ROUND - nLevel;
}

const STREAM_IDS_TYPED: StreamId[] = STREAM_IDS;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampSettings(raw: Partial<GameSettings> | null | undefined): GameSettings {
  const nLevel = clampInt(raw?.nLevel, MIN_N, MAX_N, 2);
  const rawMs = raw?.trialDurationMs;
  const trialDurationMs = speedPresetFor(
    typeof rawMs === 'number' && Number.isFinite(rawMs) ? rawMs : DEFAULT_TRIAL_MS,
  ).ms;

  const activeStreams = {} as Record<StreamId, boolean>;
  let anyActive = false;
  for (const stream of STREAM_IDS_TYPED) {
    activeStreams[stream] = raw?.activeStreams ? raw.activeStreams[stream] === true : stream === 'position' || stream === 'audio';
    if (activeStreams[stream]) anyActive = true;
  }
  if (!anyActive) {
    activeStreams.position = true;
  }

  const matchCounts = {} as Record<StreamId, number>;
  for (const stream of STREAM_IDS_TYPED) {
    const fallback = DEFAULT_MATCH_COUNT;
    matchCounts[stream] = clampInt(raw?.matchCounts?.[stream], 0, maxMatchesFor(nLevel), fallback);
  }

  return { activeStreams, nLevel, trialDurationMs, matchCounts };
}

export function defaultSettings(): GameSettings {
  return clampSettings(null);
}

export const OUTCOME_GLYPHS: Record<StreamOutcome, string> = {
  hit: '✓',
  falseAlarm: '■',
  miss: '✕',
  correctRejection: '〇',
};
