import { create } from 'zustand';

import { clampSettings, defaultSettings } from '@/game/rules';
import type { GameSettings, SpeedId, StreamId } from '@/game/types';
import { clampPrefs, defaultPrefs, normalizeKey, type AppPrefs, type ButtonLayout } from '@/lib/prefs';
import { loadPrefs, loadSettings, savePrefs, saveSettings } from '@/lib/storage';

interface SettingsState {
  settings: GameSettings;
  prefs: AppPrefs;
  ready: boolean;
  /** Reads the saved settings and prefs once, then marks them ready. */
  load: () => Promise<void>;
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

// The first load, kept so a second call waits for the same one instead of loading again.
let loading: Promise<void> | null = null;

export const useSettingsStore = create<SettingsState>()((set, get) => {
  const apply = (next: GameSettings) => {
    set({ settings: next });
    saveSettings(next);
  };
  const applyPrefs = (next: AppPrefs) => {
    set({ prefs: next });
    savePrefs(next);
  };
  return {
    settings: defaultSettings(),
    prefs: defaultPrefs(),
    ready: false,
    load: () => {
      loading ??= Promise.all([loadSettings(), loadPrefs()]).then(([settings, prefs]) => {
        set({ settings, prefs, ready: true });
      });
      return loading;
    },
    toggleStream: (stream, active) => {
      const { settings } = get();
      const streams = { ...settings.activeStreams, [stream]: active };
      const anyActive = Object.values(streams).some(Boolean);
      if (!anyActive) {
        return;
      }
      apply(clampSettings({ ...settings, activeStreams: streams }));
    },
    setNLevel: (n) => apply(clampSettings({ ...get().settings, nLevel: n })),
    setSpeed: (speed) => apply(clampSettings({ ...get().settings, speed })),
    setMatchCount: (stream, count) => {
      const { settings } = get();
      apply(clampSettings({ ...settings, matchCounts: { ...settings.matchCounts, [stream]: count } }));
    },
    setButtonLayout: (layout) => applyPrefs(clampPrefs({ ...get().prefs, buttonLayout: layout })),
    setSwipeAnswers: (on) => applyPrefs(clampPrefs({ ...get().prefs, swipeAnswers: on })),
    setDailyTargetMinutes: (minutes) => applyPrefs(clampPrefs({ ...get().prefs, dailyTargetMinutes: minutes })),
    setShowTrialTimer: (show) => applyPrefs(clampPrefs({ ...get().prefs, showTrialTimer: show })),
    setAutoSync: (on) => applyPrefs(clampPrefs({ ...get().prefs, autoSync: on })),
    setTutorialAid: (aid, on) => {
      const next = { ...get().prefs, [aid]: on };
      // One always stays on, so switching off the last one hands over to the other.
      if (!next.tutorialHistory && !next.tutorialSolution) {
        next[aid === 'tutorialHistory' ? 'tutorialSolution' : 'tutorialHistory'] = true;
      }
      applyPrefs(clampPrefs(next));
    },
    setKeyBinding: (stream, key) => {
      const { prefs } = get();
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
});
