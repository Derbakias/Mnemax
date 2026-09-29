import type { GameSettings, SpeedId, StreamId, StreamOutcome } from './types';
import { STREAM_IDS } from './types';

export const NEUTRAL_COLOR = '#64B5F6';

export const TRIALS_PER_ROUND = 20;
export const MIN_N = 1;
export const MAX_N = 10;
export const GRID_CELLS = 9;
export const GRID_CENTER_INDEX = 4;
// All nine boxes, the centre one too.
export const POSITION_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const POSITION_ARROWS: Record<number, string> = {
  0: '↖',
  1: '↑',
  2: '↗',
  3: '←',
  4: '•',
  5: '→',
  6: '↙',
  7: '↓',
  8: '↘',
};
// The box shows for most of each trial; the short blank that follows marks the next trial, so a repeat
// in the same cell still reads as a new trial. Difficulty comes from the trial speed.
export const BLANK_MS = 400;

/** How long the box shows in a trial: all of it except the fixed blank at the end. */
export function stimulusVisibleMs(trialDurationMs: number): number {
  return Math.max(0, trialDurationMs - BLANK_MS);
}

// TODO: Find better colour combinations
export const COLOR_PALETTE = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00'];
/** Each palette colour's name, for screen readers where a swatch shows it. */
export const COLOR_NAMES = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
/**
 * A deeper shade of each palette colour (and of the neutral one), for the lit box's 3D edge and the digit's
 * shadow. Hand-picked rather than the colour darkened with black, which turns yellow a muddy olive: yellow
 * gets amber instead.
 */
export const COLOR_SHADES = ['#B71C1C', '#1565C0', '#2E7D32', '#F9A825', '#6A1B9A', '#E65100'];
export const NEUTRAL_SHADE = '#1976D2';

export const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export interface SpeedPreset {
  id: SpeedId;
  label: string;
  /** How long the box shows, which is the time to answer. */
  answerMs: number;
  /** The whole trial: the answer time and the blank after it. */
  ms: number;
}

function preset(id: SpeedId, label: string, answerMs: number): SpeedPreset {
  return { id, label, answerMs, ms: answerMs + BLANK_MS };
}

// The speed levels, fastest first. Their timings can change: settings and rounds save the level, not the
// time, so a round stays at its level.
export const SPEED_PRESETS: SpeedPreset[] = [
  preset('veryFast', 'Very fast', 1000),
  preset('fast', 'Fast', 1500),
  preset('normal', 'Normal', 2500),
  preset('slow', 'Slow', 3200),
  preset('verySlow', 'Very slow', 4000),
];
export const DEFAULT_SPEED: SpeedId = 'normal';

export function speedPreset(id: SpeedId): SpeedPreset {
  return SPEED_PRESETS.find((p) => p.id === id) ?? speedPreset(DEFAULT_SPEED);
}

/** The preset with the trial length nearest this one. */
function speedPresetFor(ms: number): SpeedPreset {
  let best = SPEED_PRESETS[0];
  for (const preset of SPEED_PRESETS) {
    if (Math.abs(preset.ms - ms) < Math.abs(best.ms - ms)) best = preset;
  }
  return best;
}

function isSpeedId(value: unknown): value is SpeedId {
  return SPEED_PRESETS.some((p) => p.id === value);
}

/** The speed of saved settings (a round's too): their level, or for ones saved before the level was, the
 *  level nearest their trial length. */
export function speedOf(settings: Partial<Pick<GameSettings, 'speed' | 'trialDurationMs'>>): SpeedPreset {
  if (isSpeedId(settings.speed)) return speedPreset(settings.speed);
  const ms = settings.trialDurationMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? speedPresetFor(ms) : speedPreset(DEFAULT_SPEED);
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
  // The trial length always follows the level, so saved settings pick up a change of its timing.
  const speed = speedOf(raw ?? {});

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

  return { activeStreams, nLevel, speed: speed.id, trialDurationMs: speed.ms, matchCounts };
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
