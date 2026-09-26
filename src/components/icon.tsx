import {
  add,
  calculatorOutline,
  checkmarkCircle,
  colorPaletteOutline,
  flash,
  refreshOutline,
  gridOutline,
  informationCircleOutline,
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
  volumeHighOutline,
} from 'ionicons/icons';

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
  'color-palette-outline': inline(colorPaletteOutline),
  'counter-clockwise': COUNTER_CLOCKWISE,
  flash: inline(flash),
  'grid-outline': inline(gridOutline),
  'information-circle-outline': inline(informationCircleOutline),
  'locate-outline': inline(locateOutline),
  pause: inline(pause),
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
  'volume-high-outline': inline(volumeHighOutline),
};

export type IconName = keyof typeof ICONS;

/** Without `size`, the icon takes its size from CSS. */
export function Icon({ name, size, color }: { name: IconName; size?: number; color?: string }) {
  return (
    <span
      className="icon"
      aria-hidden
      style={{ width: size, height: size, color }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
