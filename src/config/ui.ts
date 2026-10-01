// How the screens look and feel: splash timing, swipe, dropdowns, the loader, icons and keys. Change them here.
import type { IconName } from '@/components/ui/icon';
import type { StreamId, StreamOutcome } from '@/game/types';

// Splash

/**
 * The startup screen shows for a random time in this range (ms), and in any case until the settings are
 * loaded and the Play and Stats screens have loaded and drawn the saved rounds.
 */
export const SPLASH_MIN_MS = 1500;
export const SPLASH_MAX_MS = 2500;
/** Matches the fade-out transition of .splash in index.css. */
export const SPLASH_FADE_MS = 250;

// Swipe and trail

/**
 * Swipe: where three or four buttons meet, a slide corner to corner would clip the corners of the other two. A
 * square around each meeting point, this fraction of the smaller button side each way, doesn't count for any
 * button, so a slide through the middle only answers the button it comes out in.
 */
export const SWIPE_DEAD_ZONE = 0.3;
/** Swipe: a fast slide is checked every 4 px along its path, so it can't skip past a button. */
export const SWIPE_STEP = 4;
/** How long the swipe trail takes to fade once the finger lifts, in ms. */
export const TRAIL_FADE_MS = 250;
/** The trail's width, in CSS px. */
export const TRAIL_WIDTH = 7;

// Dropdowns

/** Gap kept between the panel and the window edge (or the tab bar). */
export const DROPDOWN_EDGE_MARGIN = 12;
/** The panel's offset from the chip (`top: calc(100% + 8px)` in CSS). */
export const DROPDOWN_PANEL_GAP = 8;

// Loader

/** The outer cells of the 3×3 grid in clockwise order, starting top-left. */
export const LOADER_CLOCKWISE = [0, 1, 2, 5, 8, 7, 6, 3];
/** One lap round the grid. */
export const LOADER_LAP_MS = 1600;

// Settings

/** How long the tick on the reset button stays up. */
export const RESET_CONFIRM_MS = 2000;

// Icons

/** The icon for each stream, as on the Play screen's answer buttons. */
export const STREAM_ICONS: Record<StreamId, IconName> = {
  position: 'grid-outline',
  color: 'color-palette-outline',
  number: 'calculator-outline',
  audio: 'volume-high-outline',
};

/** The round tables' key symbols (✓ 〇 ✕ ■), as icons: see OUTCOME_HIT in the icons. */
export const OUTCOME_ICONS: Record<StreamOutcome, IconName> = {
  hit: 'outcome-hit',
  correctRejection: 'outcome-no-match',
  miss: 'outcome-miss',
  falseAlarm: 'outcome-false',
};

// Keys

/** The key that answers each stream, until changed in Settings. */
export const DEFAULT_KEY_BINDINGS: Record<StreamId, string> = { position: 'F', color: 'D', number: 'J', audio: 'K' };
