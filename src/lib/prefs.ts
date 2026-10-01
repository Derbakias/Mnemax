// App preferences that don't affect the game itself, so they're kept out of GameSettings
// (which is copied into every saved round).

import type { StreamId } from '../game/types';
import { STREAM_IDS } from '../game/types';
import { DEFAULT_KEY_BINDINGS } from '@/config/ui';

// The answer buttons always sit under the grid: two per row, or one per row. (Earlier builds also had
// columns beside the grid, 'right' and 'left'; those saved choices now read as 'grid'.)
export type ButtonLayout = 'grid' | 'rows';

const BUTTON_LAYOUTS: ButtonLayout[] = ['grid', 'rows'];

export interface AppPrefs {
  buttonLayout: ButtonLayout;
  /** Two per row only: press a button and slide over others to answer them too. */
  swipeAnswers: boolean;
  dailyTargetMinutes: number;
  /** A bar under the round progress that fills over each trial. */
  showTrialTimer: boolean;
  /** The key that answers each stream: a character (stored upper-case) or an arrow key's name. */
  keyBindings: Record<StreamId, string>;
  /**
   * What tutorial mode shows: the trials from N back to the current one (the N-back one outlined when it matches), and
   * the answer, by outlining the buttons of the streams that match. At least one is always on.
   */
  tutorialHistory: boolean;
  tutorialSolution: boolean;
  /** Sync with paired devices by itself while the app is open (see src/stores/sync-context.tsx). */
  autoSync: boolean;
}

const ARROW_LABELS: Record<string, string> = { ArrowLeft: '←', ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓' };

/** A KeyboardEvent key in the form bindings are stored and compared in: characters upper-cased. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Keys that can answer a stream: any printable character except Space (start, pause and resume),
 * or an arrow key.
 */
export function isBindableKey(key: string): boolean {
  return (key.length === 1 && key !== ' ') || key in ARROW_LABELS;
}

/** How a bound key is shown: the character itself, or an arrow symbol. */
export function keyLabel(key: string): string {
  return ARROW_LABELS[key] ?? key;
}

function clampKeyBindings(raw: unknown): Record<StreamId, string> {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_KEY_BINDINGS };
  }
  const out = {} as Record<StreamId, string>;
  for (const stream of STREAM_IDS) {
    const key = (raw as Record<string, unknown>)[stream];
    if (typeof key !== 'string' || !isBindableKey(key)) {
      return { ...DEFAULT_KEY_BINDINGS };
    }
    out[stream] = normalizeKey(key);
  }
  // Two streams on one key would make that key ambiguous.
  return new Set(Object.values(out)).size === STREAM_IDS.length ? out : { ...DEFAULT_KEY_BINDINGS };
}

// TODO: move to a config
export const MIN_DAILY_TARGET_MINUTES = 5;
export const MAX_DAILY_TARGET_MINUTES = 120;
export const STEP_DAILY_TARGET_MINUTES = 5;

export function clampPrefs(raw: Partial<AppPrefs> | null | undefined): AppPrefs {
  const minutes = raw?.dailyTargetMinutes;
  const dailyTargetMinutes =
    typeof minutes === 'number' && Number.isFinite(minutes)
      ? Math.min(MAX_DAILY_TARGET_MINUTES, Math.max(MIN_DAILY_TARGET_MINUTES, Math.round(minutes)))
      : 10;
  const tutorialSolution = raw?.tutorialSolution === true;
  return {
    buttonLayout: BUTTON_LAYOUTS.includes(raw?.buttonLayout as ButtonLayout)
      ? (raw?.buttonLayout as ButtonLayout)
      : 'grid',
    swipeAnswers: raw?.swipeAnswers === true,
    dailyTargetMinutes,
    showTrialTimer: raw?.showTrialTimer !== false,
    keyBindings: clampKeyBindings(raw?.keyBindings),
    tutorialHistory: raw?.tutorialHistory !== false || !tutorialSolution,
    tutorialSolution,
    autoSync: raw?.autoSync !== false,
  };
}

export function defaultPrefs(): AppPrefs {
  return clampPrefs(null);
}
