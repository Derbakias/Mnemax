import {
  BLANK_MS,
  DEFAULT_MATCH_COUNT,
  DEFAULT_SPEED,
  MAX_N,
  MIN_N,
  SPEED_PRESETS,
  TRIALS_PER_ROUND,
} from '@/config/game';
import type { GameSettings, SpeedId, SpeedPreset, StreamId } from './types';
import { STREAM_IDS } from './types';

/** How long the box shows in a trial: all of it except the fixed blank at the end. */
export function stimulusVisibleMs(trialDurationMs: number): number {
  return Math.max(0, trialDurationMs - BLANK_MS);
}

export function speedPreset(id: SpeedId): SpeedPreset {
  return SPEED_PRESETS.find((p) => p.id === id) ?? speedPreset(DEFAULT_SPEED);
}

/** The preset with the trial length nearest this one. */
function speedPresetFor(ms: number): SpeedPreset {
  let best = SPEED_PRESETS[0];
  for (const preset of SPEED_PRESETS) {
    if (Math.abs(preset.ms - ms) < Math.abs(best.ms - ms)) {
      best = preset;
    }
  }
  return best;
}

function isSpeedId(value: unknown): value is SpeedId {
  return SPEED_PRESETS.some((p) => p.id === value);
}

/** The speed of saved settings (a round's too): their level, or for ones saved before the level was, the
 *  level nearest their trial length. */
export function speedOf(settings: Partial<Pick<GameSettings, 'speed' | 'trialDurationMs'>>): SpeedPreset {
  if (isSpeedId(settings.speed)) {
    return speedPreset(settings.speed);
  }
  const ms = settings.trialDurationMs;
  return typeof ms === 'number' && Number.isFinite(ms) ? speedPresetFor(ms) : speedPreset(DEFAULT_SPEED);
}

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
    activeStreams[stream] = raw?.activeStreams
      ? raw.activeStreams[stream] === true
      : stream === 'position' || stream === 'audio';
    if (activeStreams[stream]) {
      anyActive = true;
    }
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
