import { COLOR_PALETTE, DIGITS, GRID_CELLS, MAX_N, MIN_N, SPEED_PRESETS, TRIALS_PER_ROUND } from './config';
import type { GameSettings, RoundResult, SpeedId, StreamId, StreamOutcome, TrialRecord, TrialStimulus } from './types';
import { STREAM_IDS } from './types';

// Rounds that come from outside the app (an imported file, another device) are checked field by field and
// copied into fresh objects, so a round that gets in has exactly the shape the app draws, and nothing else.

/** Round ids as the app makes them (`round-<ms>`), with room for older formats. */
const ROUND_ID = /^[A-Za-z0-9._:-]{1,64}$/;
/** Nothing was played before this, so an earlier finish time is a broken round. */
const EARLIEST_FINISH_MS = Date.UTC(2020, 0, 1);
/** A little room for a device whose clock runs ahead. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
/** Longer than any trial or round could run. */
const MAX_TRIAL_MS = 60 * 1000;
const MAX_ROUND_MS = 24 * 60 * 60 * 1000;
const OUTCOMES: StreamOutcome[] = ['hit', 'falseAlarm', 'miss', 'correctRejection'];

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isNumIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** A value for every stream, each passing `check`; null if any is missing or wrong. */
function perStream<T>(value: unknown, check: (v: unknown) => v is T): Record<StreamId, T> | null {
  if (!isObj(value)) {
    return null;
  }
  const out = {} as Record<StreamId, T>;
  for (const stream of STREAM_IDS) {
    const v = value[stream];
    if (!check(v)) {
      return null;
    }
    out[stream] = v;
  }
  return out;
}

/** The streams that have a value, each passing `check`; null if one that's there is wrong. */
function someStreams<T>(value: unknown, check: (v: unknown) => v is T): Partial<Record<StreamId, T>> | null {
  if (!isObj(value)) {
    return null;
  }
  const out: Partial<Record<StreamId, T>> = {};
  for (const stream of STREAM_IDS) {
    const v = value[stream];
    if (v === undefined) {
      continue;
    }
    if (!check(v)) {
      return null;
    }
    out[stream] = v;
  }
  return out;
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isOutcome = (v: unknown): v is StreamOutcome => OUTCOMES.includes(v as StreamOutcome);
const isResponseMs = (v: unknown): v is number => isNumIn(v, 0, MAX_TRIAL_MS);
const isMatchCount = (v: unknown): v is number => isIntIn(v, 0, TRIALS_PER_ROUND);

function checkSettings(value: unknown): GameSettings | null {
  if (!isObj(value)) {
    return null;
  }
  const activeStreams = perStream(value.activeStreams, isBool);
  const matchCounts = perStream(value.matchCounts, isMatchCount);
  const { nLevel, speed, trialDurationMs } = value;
  if (!activeStreams || !Object.values(activeStreams).some(Boolean) || !matchCounts) {
    return null;
  }
  if (!isIntIn(nLevel, MIN_N, MAX_N) || !isNumIn(trialDurationMs, 1, MAX_TRIAL_MS)) {
    return null;
  }
  // Rounds saved before the level was have no speed; the app works it out from the trial length.
  if (speed !== undefined && !SPEED_PRESETS.some((p) => p.id === speed)) {
    return null;
  }
  return { activeStreams, nLevel, speed: speed as SpeedId, trialDurationMs, matchCounts };
}

function checkStimulus(value: unknown): TrialStimulus | null {
  if (!isObj(value)) {
    return null;
  }
  const { position, color, number, letter } = value;
  if (!isIntIn(position, 0, GRID_CELLS - 1) || !isIntIn(color, 0, COLOR_PALETTE.length - 1)) {
    return null;
  }
  if (!DIGITS.includes(number as number) || typeof letter !== 'string' || !/^[A-Z]$/.test(letter)) {
    return null;
  }
  return { position, color, number: number as number, letter };
}

function checkTrial(value: unknown): TrialRecord | null {
  if (!isObj(value)) {
    return null;
  }
  const stimulus = checkStimulus(value.stimulus);
  const isMatch = perStream(value.isMatch, isBool);
  const responded = someStreams(value.responded, isBool);
  const outcome = someStreams(value.outcome, isOutcome);
  if (!isIntIn(value.index, 0, TRIALS_PER_ROUND - 1) || !stimulus || !isMatch || !responded || !outcome) {
    return null;
  }
  const trial: TrialRecord = { index: value.index, stimulus, isMatch, responded, outcome };
  if (value.responseTimesMs !== undefined) {
    const responseTimesMs = someStreams(value.responseTimesMs, isResponseMs);
    if (!responseTimesMs) {
      return null;
    }
    trial.responseTimesMs = responseTimesMs;
  }
  return trial;
}

/**
 * A copy of the round with only the fields the app knows, or null if any of them is missing, the wrong type
 * or out of range. `now` bounds the finish time (a round can't finish in the future).
 */
export function checkRound(value: unknown, now = Date.now()): RoundResult | null {
  if (!isObj(value)) {
    return null;
  }
  const { id, finishedAt, durationMs, stopped } = value;
  if (typeof id !== 'string' || !ROUND_ID.test(id)) {
    return null;
  }
  if (!isIntIn(finishedAt, EARLIEST_FINISH_MS, now + FUTURE_SLACK_MS)) {
    return null;
  }
  const settings = checkSettings(value.settings);
  if (!settings || !Array.isArray(value.trials) || value.trials.length > TRIALS_PER_ROUND) {
    return null;
  }
  const trials: TrialRecord[] = [];
  const seen = new Set<number>();
  for (const raw of value.trials) {
    const trial = checkTrial(raw);
    if (!trial || seen.has(trial.index)) {
      return null;
    }
    seen.add(trial.index);
    trials.push(trial);
  }
  const round: RoundResult = { id, finishedAt, settings, trials };
  if (durationMs !== undefined) {
    if (!isNumIn(durationMs, 0, MAX_ROUND_MS)) {
      return null;
    }
    round.durationMs = durationMs;
  }
  if (stopped !== undefined) {
    if (!isBool(stopped)) {
      return null;
    }
    round.stopped = stopped;
  }
  return round;
}
