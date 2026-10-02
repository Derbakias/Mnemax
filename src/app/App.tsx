import { useCallback, useEffect, useState } from 'react';

import { GridLoader } from '@/components/ui/grid-loader';
import { SPLASH_FADE_MS, SPLASH_MAX_MS, SPLASH_MIN_MS } from '@/config/ui';
import { Icon, type IconName } from '@/components/ui/icon';
import { appCopy } from '@/copy/app';
import { PlayScreen, type PlayStage } from '@/play/play-screen';
import { SettingsScreen } from '@/settings/settings-screen';
import { StatsScreen } from '@/stats/stats-screen';
import { useSettingsStore } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import { preloadSpeech } from '@/lib/speech';

type Tab = 'play' | 'stats' | 'settings';

const TABS: { id: Tab; icon: IconName }[] = [
  { id: 'play', icon: 'play-circle-outline' },
  { id: 'stats', icon: 'stats-chart-outline' },
  { id: 'settings', icon: 'settings-outline' },
];

type SplashState = 'showing' | 'fading' | 'gone';

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  // A round takes the whole screen: no tab bar while it runs. When it's paused the tab bar comes back over
  // the bottom of the screen, without moving the game under it.
  const [playStage, setPlayStage] = useState<PlayStage>('start');
  const tabBarHidden = tab === 'play' && playStage === 'playing';
  const tabBarOverlay = tab === 'play' && playStage === 'paused';
  const settingsReady = useSettingsStore((s) => s.ready);
  const [splash, setSplash] = useState<SplashState>('showing');
  const [minTimeDone, setMinTimeDone] = useState(false);
  const [playReady, setPlayReady] = useState(false);
  const [statsReady, setStatsReady] = useState(false);
  const onPlayReady = useCallback(() => setPlayReady(true), []);
  const onStatsReady = useCallback(() => setStatsReady(true), []);
  // The letter clips, decoded before the first round so its first trial isn't silent.
  const [audioReady, setAudioReady] = useState(false);
  const dataReady = settingsReady && playReady && statsReady && audioReady;

  // Sync needs to know when the Settings tab is open and when a round is being played (see src/sync/sync-auto.ts).
  useEffect(() => {
    useSyncStore.getState().setScreen({ settingsActive: tab === 'settings', playing: playStage === 'playing' });
  }, [tab, playStage]);

  useEffect(() => {
    // Settles on failure too (letters then load on Play), so the startup screen can't hang on it.
    preloadSpeech().finally(() => setAudioReady(true));
  }, []);

  // Startup: a game-like moment, while the screens load their data behind the startup screen.
  useEffect(() => {
    const delay = SPLASH_MIN_MS + Math.random() * (SPLASH_MAX_MS - SPLASH_MIN_MS);
    const timer = setTimeout(() => setMinTimeDone(true), delay);
    return () => clearTimeout(timer);
  }, []);

  // Two steps: fade once everything is ready, then remove it when the fade has finished. (One effect doing
  // both cancelled its own removal timer, since switching to 'fading' re-ran it.)
  useEffect(() => {
    if (splash === 'showing' && minTimeDone && dataReady) {
      setSplash('fading');
    }
  }, [splash, minTimeDone, dataReady]);
  useEffect(() => {
    if (splash !== 'fading') {
      return;
    }
    const timer = setTimeout(() => setSplash('gone'), SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [splash]);

  // All screens stay mounted (like the Expo tab navigator) so a running round survives tab switches.
  return (
    // Buttons don't take focus from a mouse click or tap (Tab still reaches them): a focused button,
    // like the Play button or the Play tab, would catch the answer keys, so arrow keys moved focus and
    // showed a focus ring instead of answering. Only buttons: sliders and inputs still need the press.
    <div
      className="app"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          e.preventDefault();
        }
      }}
    >
      <main className="screen play-screen" hidden={tab !== 'play'}>
        {/* Keyboard shortcuts stay off under the startup screen, so Space can't start a round behind it. */}
        <PlayScreen active={tab === 'play' && splash === 'gone'} onReady={onPlayReady} onStageChange={setPlayStage} />
      </main>
      <main className="screen stats-screen" hidden={tab !== 'stats'}>
        <StatsScreen onReady={onStatsReady} />
      </main>
      <main className="screen" hidden={tab !== 'settings'}>
        <SettingsScreen active={tab === 'settings'} />
      </main>
      <nav className={tabBarOverlay ? 'tab-bar overlay' : 'tab-bar'} hidden={tabBarHidden}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'tab on' : 'tab'}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={24} />
            <span>{appCopy.tabs[t.id]}</span>
          </button>
        ))}
      </nav>
      {splash !== 'gone' && (
        <div className={splash === 'fading' ? 'splash fading' : 'splash'}>
          <GridLoader label="Loading" size="large" />
          <span className="splash-title">{appCopy.splashTitle}</span>
        </div>
      )}
    </div>
  );
}
