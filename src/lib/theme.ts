import { useMemo, useSyncExternalStore } from 'react';

// The palette lives in src/styles/index.css (its @theme block); this reads the colours that are drawn in JS
// (SVG attributes, chart lines, accuracy colours) from there, so there is one place to change them.
const NAMES = {
  text: 'text',
  background: 'background',
  backgroundElement: 'background-element',
  backgroundSelected: 'background-selected',
  textSecondary: 'text-secondary',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const;

export type ThemeColor = keyof typeof NAMES;
export type Theme = Record<ThemeColor, string>;

function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  // The build may write a colour short (#fa0) or as a name (orange). A canvas gives those (and rgb()) back
  // as #rrggbb, the one form the charts can fade (withAlpha). Keep the palette in hex, rgb() or names:
  // newer forms like oklch() come back unchanged, and the charts would draw them without fading.
  const canvas = document.createElement('canvas').getContext('2d');
  const theme = {} as Theme;
  for (const key of Object.keys(NAMES) as ThemeColor[]) {
    const color = style.getPropertyValue(`--color-${NAMES[key]}`).trim();
    if (canvas && CSS.supports('color', color)) {
      canvas.fillStyle = color;
      theme[key] = String(canvas.fillStyle);
    } else {
      theme[key] = color;
    }
  }
  return theme;
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => (darkQuery().matches ? 'dark' : 'light'));
}

// Read again when the phone switches between light and dark, so an open chart picks up the new colours.
export function useTheme(): Theme {
  const scheme = useColorScheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scheme: the colours in the CSS change with it.
  return useMemo(() => readTheme(), [scheme]);
}

export function accuracyColor(pct: number, theme: Theme): string {
  if (pct >= 90) {
    return theme.success;
  }
  if (pct >= 70) {
    return theme.warning;
  }
  return theme.danger;
}
