import {
  add,
  calculatorOutline,
  checkmarkCircle,
  close,
  chevronDown,
  colorPaletteOutline,
  flash,
  refreshOutline,
  gridOutline,
  informationCircleOutline,
  layersOutline,
  locateOutline,
  pause,
  play,
  playCircleOutline,
  remove,
  school,
  schoolOutline,
  settingsOutline,
  star,
  statsChartOutline,
  stop,
  timeOutline,
  trendingUpOutline,
  trophyOutline,
  volumeHighOutline,
} from 'ionicons/icons';

import { cn } from '@/lib/cn';

const styles = {
  root: [
    'inline-flex shrink-0',
    // Same rules the <ion-icon> web component applies to its SVGs.
    '[&_svg]:size-full [&_svg]:fill-current [&_svg]:stroke-current',
    '[&_.ionicon-fill-none]:fill-none [&_.ionicon-stroke-width]:stroke-[32px]',
  ],
};

// ionicons ships each icon as an inline-SVG data URI; strip the prefix so the SVG
// can be inlined and pick up `currentColor` like @expo/vector-icons did.
const inline = (uri: string) => uri.slice(uri.indexOf(',') + 1);

// Ionicons has no bullseye; this one is drawn in its outline style (512 grid, 32px strokes).
const TARGET =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
  '<circle cx="256" cy="256" r="192" class="ionicon-fill-none ionicon-stroke-width"/>' +
  '<circle cx="256" cy="256" r="112" class="ionicon-fill-none ionicon-stroke-width"/>' +
  '<circle cx="256" cy="256" r="40"/>' +
  '</svg>';

// A solid pie with a quarter pulled out: ionicons' outline pie reads as a clock at heading size. The view box
// is cropped to the drawing, so its middle is the icon's middle.
const PIE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 12 460 460">' +
  '<path d="M256 256L464 256A208 208 0 1 1 256 48Z"/>' +
  '<path d="M284.28 227.72L284.28 19.72A208 208 0 0 1 492.28 227.72Z"/>' +
  '</svg>';

// The stream table's outcome headings (✓ ✕ ■ as in the round tables' key), drawn on a 14px grid to be shown
// at 14px, pixel for pixel: as font characters they were centred at fractions of a pixel and came out soft.
// Fill and stroke are set on the shapes themselves, over the fill and stroke every icon's SVG gets (styles.root
// above): without that, the tick came out filled in and the square outlined.
const OUTCOME_HIT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><path d="M2 7.5l3.5 3.5L12 3.5" fill="none" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const OUTCOME_MISS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><path d="M3 3l8 8M11 3l-8 8" ' +
  'fill="none" stroke-width="2" stroke-linecap="round"/></svg>';
const OUTCOME_NO_MATCH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.25" fill="none" ' +
  'stroke-width="1.75"/></svg>';
const OUTCOME_FALSE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" ' +
  'rx="1" stroke="none"/></svg>';

// Ionicons' refresh arrow, mirrored to turn anticlockwise (↺): "steps back" for the N-back level.
const refreshSvg = inline(refreshOutline);
const COUNTER_CLOCKWISE = refreshSvg
  .replace(/(<svg[^>]*>)/, '$1<g transform="translate(512 0) scale(-1 1)">')
  .replace('</svg>', '</g></svg>');

// The filled star cropped to its ink (the path spans x 16–496, y 32–480), so its box can be sized and
// aligned exactly against text.
const STAR_TIGHT = inline(star).replace("viewBox='0 0 512 512'", "viewBox='16 32 480 448'");

const ICONS = {
  add: inline(add),
  'calculator-outline': inline(calculatorOutline),
  'checkmark-circle': inline(checkmarkCircle),
  'chevron-down': inline(chevronDown),
  close: inline(close),
  'color-palette-outline': inline(colorPaletteOutline),
  'counter-clockwise': COUNTER_CLOCKWISE,
  flash: inline(flash),
  'grid-outline': inline(gridOutline),
  'information-circle-outline': inline(informationCircleOutline),
  'layers-outline': inline(layersOutline),
  'locate-outline': inline(locateOutline),
  'outcome-false': OUTCOME_FALSE,
  'outcome-hit': OUTCOME_HIT,
  'outcome-miss': OUTCOME_MISS,
  'outcome-no-match': OUTCOME_NO_MATCH,
  pause: inline(pause),
  pie: PIE,
  play: inline(play),
  'play-circle-outline': inline(playCircleOutline),
  remove: inline(remove),
  school: inline(school),
  'school-outline': inline(schoolOutline),
  'settings-outline': inline(settingsOutline),
  'stats-chart-outline': inline(statsChartOutline),
  star: inline(star),
  'star-tight': STAR_TIGHT,
  stop: inline(stop),
  target: TARGET,
  'time-outline': inline(timeOutline),
  'trending-up-outline': inline(trendingUpOutline),
  'trophy-outline': inline(trophyOutline),
  'volume-high-outline': inline(volumeHighOutline),
};

export type IconName = keyof typeof ICONS;

/** Without `size`, the icon takes its size from CSS. */
export function Icon({ name, size, color }: { name: IconName; size?: number; color?: string }) {
  return (
    // `icon` has no look of its own any more: it's the name other code uses to size and colour icons in its
    // own places (the answer buttons in src/play/response-buttons, the Play HUD's chips in src/play/hud-chips.tsx,
    // and more).
    <span
      className={cn('icon', styles.root)}
      aria-hidden
      style={{ width: size, height: size, color }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
