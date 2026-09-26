import { useSyncExternalStore } from 'react';

// Same palette as the old expo app index.css mirrors these as CSS variables;
// this object is for values computed in JS (SVG attributes, accuracy colors).
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    accent: '#1E88E5',
    success: '#43A047',
    warning: '#FB8C00',
    danger: '#E53935',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#64B5F6',
    success: '#66BB6A',
    warning: '#FFA726',
    danger: '#EF5350',
  },
} as const;

export type Theme = (typeof Colors)['light'] | (typeof Colors)['dark'];
export type ThemeColor = keyof typeof Colors.light;

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribe(onChange: () => void) {
  const query = darkQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useColorScheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, () => (darkQuery().matches ? 'dark' : 'light'));
}

export function useTheme(): Theme {
  return Colors[useColorScheme()];
}

export function accuracyColor(pct: number, theme: Theme): string {
  if (pct >= 90) return theme.success;
  if (pct >= 70) return theme.warning;
  return theme.danger;
}
