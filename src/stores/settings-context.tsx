import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clampSettings, defaultSettings } from '../game/config';
import type { GameSettings, SpeedId, StreamId } from '../game/types';
import { clampPrefs, defaultPrefs, normalizeKey, type AppPrefs, type ButtonLayout } from '../lib/prefs';
import { loadPrefs, loadSettings, savePrefs, saveSettings } from '../lib/storage';

interface SettingsContextValue {
  settings: GameSettings;
  prefs: AppPrefs;
  ready: boolean;
  toggleStream: (stream: StreamId, active: boolean) => void;
  setNLevel: (n: number) => void;
  setSpeed: (speed: SpeedId) => void;
  setMatchCount: (stream: StreamId, count: number) => void;
  setButtonLayout: (layout: ButtonLayout) => void;
  setSwipeAnswers: (on: boolean) => void;
  setDailyTargetMinutes: (minutes: number) => void;
  setShowTrialTimer: (show: boolean) => void;
  setAutoSync: (on: boolean) => void;
  /** Turns a tutorial aid on or off; turning off the only one left on turns the other one on instead. */
  setTutorialAid: (aid: 'tutorialHistory' | 'tutorialSolution', on: boolean) => void;
  /** Assigns `key` to `stream`; a stream that already had that key takes over `stream`'s old one. */
  setKeyBinding: (stream: StreamId, key: string) => void;
  resetDefaults: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<GameSettings>(() => defaultSettings());
  const [prefs, setPrefs] = useState<AppPrefs>(() => defaultPrefs());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSettings(), loadPrefs()]).then(([loadedSettings, loadedPrefs]) => {
      if (!cancelled) {
        setSettings(loadedSettings);
        setPrefs(loadedPrefs);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<SettingsContextValue>(() => {
    const apply = (next: GameSettings) => {
      setSettings(next);
      saveSettings(next);
    };
    const applyPrefs = (next: AppPrefs) => {
      setPrefs(next);
      savePrefs(next);
    };
    return {
      settings,
      prefs,
      ready,
      toggleStream: (stream, active) => {
        const streams = { ...settings.activeStreams, [stream]: active };
        const anyActive = Object.values(streams).some(Boolean);
        if (!anyActive) {
          return;
        }
        apply(clampSettings({ ...settings, activeStreams: streams }));
      },
      setNLevel: (n) => apply(clampSettings({ ...settings, nLevel: n })),
      setSpeed: (speed) => apply(clampSettings({ ...settings, speed })),
      setMatchCount: (stream, count) =>
        apply(
          clampSettings({
            ...settings,
            matchCounts: { ...settings.matchCounts, [stream]: count },
          }),
        ),
      setButtonLayout: (layout) => applyPrefs(clampPrefs({ ...prefs, buttonLayout: layout })),
      setSwipeAnswers: (on) => applyPrefs(clampPrefs({ ...prefs, swipeAnswers: on })),
      setDailyTargetMinutes: (minutes) => applyPrefs(clampPrefs({ ...prefs, dailyTargetMinutes: minutes })),
      setShowTrialTimer: (show) => applyPrefs(clampPrefs({ ...prefs, showTrialTimer: show })),
      setAutoSync: (on) => applyPrefs(clampPrefs({ ...prefs, autoSync: on })),
      setTutorialAid: (aid, on) => {
        const next = { ...prefs, [aid]: on };
        // One always stays on, so switching off the last one hands over to the other.
        if (!next.tutorialHistory && !next.tutorialSolution) {
          next[aid === 'tutorialHistory' ? 'tutorialSolution' : 'tutorialHistory'] = true;
        }
        applyPrefs(clampPrefs(next));
      },
      setKeyBinding: (stream, key) => {
        const normalized = normalizeKey(key);
        const keyBindings = { ...prefs.keyBindings };
        const holder = (Object.keys(keyBindings) as StreamId[]).find((s) => keyBindings[s] === normalized);
        if (holder && holder !== stream) {
          keyBindings[holder] = keyBindings[stream];
        }
        keyBindings[stream] = normalized;
        applyPrefs(clampPrefs({ ...prefs, keyBindings }));
      },
      resetDefaults: () => {
        apply(defaultSettings());
        applyPrefs(defaultPrefs());
      },
    };
  }, [settings, prefs, ready]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return ctx;
}
