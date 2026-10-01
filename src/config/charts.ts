// How the charts look and behave: sizes, ranges, zoom and pan. Change them here.
import type { StreamId } from '@/game/types';
import type { Theme } from '@/lib/theme';

// Every chart

/** The time range chips above each chart: the last so many days, or all of them. */
export const CHART_RANGES: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
  { label: 'all', days: null },
];
/** The font of the numbers and dates along the axes. */
export const AXIS_FONT = '11px "Spline Sans", Inter, ui-sans-serif, system-ui, sans-serif';
/** Room between an axis's widest value and its title (or the chart's edge), in CSS pixels. */
export const AXIS_VALUE_PAD = 6;
/** Minimum room per date label on a round axis, in CSS pixels. */
export const DATE_LABEL_SPACE = 64;

// Zoom and pan

/** Fewest rounds a zoomed-in chart shows. */
export const MIN_ZOOM_ROUNDS = 3;
/** Wheel zoom step: one notch shows this share of the current range. */
export const WHEEL_ZOOM = 0.85;
/** Pixels of axis drag that stretch or shrink the range by a factor of e. */
export const AXIS_DRAG_SCALE = 150;
/** Vertical movement (px) before a click-and-hold drag starts moving the y axis too. */
export const PAN_Y_THRESHOLD = 8;
/** The y axis can be stretched to between 1/20 and 4× its fitted range. */
export const Y_MIN_SHARE = 1 / 20;
export const Y_MAX_SHARE = 4;

/** TODO:  Y_HANDLE_WIDTH only controls where the left-axis handle is placed; src/styles/index.css:2176-2178 still fixes the handle itself at 44px. Changing this config creates either a gap or overlap between the axis and its interactive strip. Apply the configured width to the handle (inline or via a CSS custom property) as well as its placement. */
/** Width of the strip over a y axis that stretches it (matches `.axis-handle.y` in CSS). */
export const Y_HANDLE_WIDTH = 44;
/** A chart ignores the wheel this long after the page scrolled, so scrolling past it doesn't zoom it. */
export const PAGE_SCROLL_GRACE_MS = 500;

// Progress chart

/** The colour of each stream's line, from the theme. */
export const STREAM_CHART_COLORS: Record<StreamId, keyof Theme> = {
  position: 'accent',
  color: 'success',
  number: 'warning',
  audio: 'danger',
};
/** The trend lines average about this many rounds. */
export const PROGRESS_ROLLING_WINDOW = 10;
/** The time-to-100% estimate (and the reaction-time rate) is noise on fewer rounds than this. */
export const RATE_MIN_ROUNDS = 20;
/** The chart's height, in CSS pixels. */
export const PROGRESS_CHART_HEIGHT = 220;
/** Longer estimates than this are shown as "100h+": that far out the pace will have changed anyway. */
export const MAX_ESTIMATE_HOURS = 100;

// Daily time chart

/** The chart's height, in CSS pixels. */
export const DAILY_TIME_CHART_HEIGHT = 240;
/** Zooming in stops at this many days across. */
export const MIN_ZOOM_DAYS = 3;
/** Top of the minutes axis: the next of these above the longest day (then whole hours). */
export const MINUTE_STEPS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
/** "all" still spans at least this many days, so a short history isn't stretched across the chart. */
export const MIN_ALL_DAYS = 7;

// Level chart

/** The chart's height, in CSS pixels. */
export const LEVEL_CHART_HEIGHT = 200;
