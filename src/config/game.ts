// The game's fixed values: round length, levels, grid, colours, speeds. Change them here.
import type { SpeedId, SpeedPreset, StreamOutcome } from '@/game/types';

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

export const DEFAULT_MATCH_COUNT = 6;

export const OUTCOME_GLYPHS: Record<StreamOutcome, string> = {
  hit: '✓',
  falseAlarm: '■',
  miss: '✕',
  correctRejection: '〇',
};
