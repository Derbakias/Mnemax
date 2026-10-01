// How stats are worked out and shown: levels, mastery, estimates, counts and dates. Change them here.

// Dates and counts

/**
 * The language dates are written in, the same on every device whatever the system is set to: 1 Oct 2026,
 * 15:00.
 */
// TODO: Add in the settings
export const DATE_LOCALE = 'en-GB';
/** How big counts are shortened: 1.2K, 3M, 4B. */
export const COUNT_UNITS: [suffix: string, size: number][] = [
  ['K', 1e3],
  ['M', 1e6],
  ['B', 1e9],
];

// Play time

/** Old rounds saved without their length count as this lead-in plus their trials. */
export const COUNTDOWN_MS = 2100;

// Levels

/** Each stream beyond the first adds half of a single stream's load. */
export const EXTRA_STREAM_WEIGHT = 0.5;
/** Two streams (dual N-back) is the reference, so its factor is 1. */
export const REFERENCE_STREAMS = 2;
/** Rounds averaged into the level line; one lucky or bad round shouldn't move it much. */
export const LEVEL_WINDOW = 10;

// Modes

/** Rounds averaged for a mode's "recent" accuracy. */
export const RECENT_ROUNDS = 5;
/** A mode counts as mastered at this recent accuracy (%), over at least MASTERY_MIN_ROUNDS rounds. */
export const MASTERY_ACCURACY = 80;
export const MASTERY_MIN_ROUNDS = 3;

// Time to 100%

/** Current accuracy is the average of this many latest rounds (the chart's "Avg of 10" line). */
export const ESTIMATE_CURRENT_WINDOW = 10;
/** Accuracy counts as 100% from here (it rounds to 100). */
export const PERFECT_ACCURACY = 99.5;
/** The learning curve must fit at least this much better than a flat line to count as progress. */
export const MIN_FIT_GAIN = 0.02;
/** Learning rates tried, per hour of play: 0.01 to 100, log-spaced. */
export const LEARNING_RATES = Array.from({ length: 401 }, (_, i) => 0.01 * 10 ** (i / 100));

// Daily target

/** The daily play target in settings, in minutes: lowest, highest, and the step between. */
export const MIN_DAILY_TARGET_MINUTES = 5;
export const MAX_DAILY_TARGET_MINUTES = 120;
export const STEP_DAILY_TARGET_MINUTES = 5;
