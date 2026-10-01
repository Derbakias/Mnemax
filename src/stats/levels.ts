// Difficulty-aware stats. Rounds are only comparable when they were played with the same setup, so every
// round belongs to a *mode* (N + active streams + speed). Across modes, a *level score* puts rounds on one
// scale: difficulty × accuracy, in "dual N-back at Normal speed" units.

import { DEFAULT_SPEED, speedOf, speedPreset } from '../game/config';
import { summarizeRound } from '../game/scoring';
import { roundDurationMs } from '../lib/stats';
import type { GameSettings, RoundResult, SpeedId, StreamId } from '../game/types';
import { STREAM_IDS } from '../game/types';

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export interface Mode {
  key: string;
  nLevel: number;
  streams: StreamId[];
  /** The speed level, whatever its timing was: rounds stay comparable when a level's timing changes. */
  speed: SpeedId;
}

export function modeOf(settings: GameSettings): Mode {
  const streams = STREAM_IDS.filter((s) => settings.activeStreams[s]);
  const speed = speedOf(settings).id;
  return { key: `${settings.nLevel}|${streams.join('+')}|${speed}`, nLevel: settings.nLevel, streams, speed };
}

export function roundMode(round: RoundResult): Mode {
  return modeOf(round.settings);
}

// ---------------------------------------------------------------------------
// Difficulty and level score
// ---------------------------------------------------------------------------

/** Each stream beyond the first adds half of a single stream's load. */
const EXTRA_STREAM_WEIGHT = 0.5;
/** Two streams (dual N-back) is the reference, so its factor is 1. */
const REFERENCE_STREAMS = 2;

export function streamFactor(streamCount: number): number {
  const load = (k: number) => 1 + EXTRA_STREAM_WEIGHT * (Math.max(1, k) - 1);
  return load(streamCount) / load(REFERENCE_STREAMS);
}

/** Normal speed is the reference (1); less time to answer counts for more, more for less (square-root scale).
 *  From the level's current timing, so a level is worth the same in every round. */
export function speedFactor(speed: SpeedId): number {
  return Math.sqrt(speedPreset(DEFAULT_SPEED).answerMs / speedPreset(speed).answerMs);
}

/** Difficulty of a mode in "dual N-back at Normal speed" units: dual 2-back at Normal is 2. */
export function modeDifficulty(mode: Mode): number {
  return mode.nLevel * streamFactor(mode.streams.length) * speedFactor(mode.speed);
}

/**
 * A round's level score: its mode's difficulty scaled by accuracy (chance-corrected, so guessing scores 0).
 * A perfect dual 2-back round at Normal speed scores 2.
 */
export function roundLevel(round: RoundResult): number {
  return modeDifficulty(roundMode(round)) * summarizeRound(round).overallAccuracy;
}

/** Rounds averaged into the level line; one lucky or bad round shouldn't move it much. */
export const LEVEL_WINDOW = 10;

export interface LevelPoint {
  round: RoundResult;
  finishedAt: number;
  score: number;
  /** Average score of this round and the ones before it (up to LEVEL_WINDOW). */
  level: number;
  /** How many rounds `level` averages. */
  windowSize: number;
}

/** Level points in chronological order (input is newest first, as stored). */
export function levelHistory(rounds: RoundResult[]): LevelPoint[] {
  const chronological = [...rounds].reverse();
  const scores = chronological.map(roundLevel);
  return chronological.map((round, i) => {
    const window = scores.slice(Math.max(0, i - LEVEL_WINDOW + 1), i + 1);
    return {
      round,
      finishedAt: round.finishedAt,
      score: scores[i],
      level: window.reduce((a, b) => a + b, 0) / window.length,
      windowSize: window.length,
    };
  });
}

export interface LevelSummary {
  current: number;
  /** Change since the last round played at least 7 days ago; null without such a round. */
  weekChange: number | null;
  /** Highest level over a full window (or over all rounds, while there are fewer than LEVEL_WINDOW). */
  best: number;
}

const WEEK_MS = 7 * 86400000;

export function levelSummary(history: LevelPoint[], now = Date.now()): LevelSummary | null {
  if (history.length === 0) {
    return null;
  }
  const current = history[history.length - 1].level;
  const weekAgo = [...history].reverse().find((p) => p.finishedAt <= now - WEEK_MS);
  const fullWindow = Math.min(LEVEL_WINDOW, history.length);
  const best = Math.max(...history.filter((p) => p.windowSize >= fullWindow).map((p) => p.level));
  return { current, weekChange: weekAgo ? current - weekAgo.level : null, best };
}

// ---------------------------------------------------------------------------
// Per-mode summaries
// ---------------------------------------------------------------------------

// TODO: move to a config
/** Rounds averaged for a mode's "recent" accuracy. */
export const RECENT_ROUNDS = 5;
/** A mode counts as mastered at this recent accuracy (%), over at least MASTERY_MIN_ROUNDS rounds. */
export const MASTERY_ACCURACY = 80;
export const MASTERY_MIN_ROUNDS = 3;

export interface ModeSummary {
  mode: Mode;
  difficulty: number;
  /** Newest first, like the stored list. */
  rounds: RoundResult[];
  lastPlayed: number;
  /** Average accuracy (%) of the last RECENT_ROUNDS rounds. */
  recentAccuracy: number;
  bestAccuracy: number;
  mastered: boolean;
}

/** One entry per mode played, most recently played first. */
export function summarizeModes(rounds: RoundResult[]): ModeSummary[] {
  const byKey = new Map<string, { mode: Mode; rounds: RoundResult[] }>();
  for (const round of rounds) {
    const mode = roundMode(round);
    const entry = byKey.get(mode.key) ?? { mode, rounds: [] };
    entry.rounds.push(round);
    byKey.set(mode.key, entry);
  }
  const summaries: ModeSummary[] = [];
  for (const { mode, rounds: modeRounds } of byKey.values()) {
    const sorted = [...modeRounds].sort((a, b) => b.finishedAt - a.finishedAt);
    const accuracies = sorted.map((r) => summarizeRound(r).overallAccuracy * 100);
    const recent = accuracies.slice(0, RECENT_ROUNDS);
    const recentAccuracy = recent.reduce((a, b) => a + b, 0) / recent.length;
    summaries.push({
      mode,
      difficulty: modeDifficulty(mode),
      rounds: sorted,
      lastPlayed: sorted[0].finishedAt,
      recentAccuracy,
      bestAccuracy: Math.max(...accuracies),
      mastered: sorted.length >= MASTERY_MIN_ROUNDS && recentAccuracy >= MASTERY_ACCURACY,
    });
  }
  return summaries.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

// ---------------------------------------------------------------------------
// Per-day totals (time played vs performance)
// ---------------------------------------------------------------------------

export interface DayStats {
  /** Local midnight of the day. */
  day: number;
  playedMs: number;
  rounds: number;
  avgLevel: number;
  bestLevel: number;
  /** Average accuracy (%) of the day's rounds. */
  avgAccuracy: number;
  modes: number;
}

export function startOfDay(time: number): number {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** One entry per day with at least one round, oldest first. */
export function dailyStats(rounds: RoundResult[]): DayStats[] {
  const byDay = new Map<number, RoundResult[]>();
  for (const round of rounds) {
    const day = startOfDay(round.finishedAt);
    const list = byDay.get(day) ?? [];
    list.push(round);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, list]) => {
      const levels = list.map(roundLevel);
      const accuracies = list.map((r) => summarizeRound(r).overallAccuracy * 100);
      return {
        day,
        playedMs: list.reduce((sum, r) => sum + roundDurationMs(r), 0),
        rounds: list.length,
        avgLevel: levels.reduce((a, b) => a + b, 0) / levels.length,
        bestLevel: Math.max(...levels),
        avgAccuracy: accuracies.reduce((a, b) => a + b, 0) / accuracies.length,
        modes: new Set(list.map((r) => roundMode(r).key)).size,
      };
    });
}
