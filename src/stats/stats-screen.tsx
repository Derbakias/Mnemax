import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ActivityCalendar } from '@/stats/activity-calendar';
import { statsCopy } from '@/copy/stats';
import { Count } from '@/stats/count';
import { DailyTimeChart } from '@/stats/daily-time-chart';
import { GridLoader } from '@/components/ui/grid-loader';
import { HudDropdown } from '@/components/ui/hud-dropdown';
import { Icon, type IconName } from '@/components/ui/icon';
import { LevelChart } from '@/stats/level-chart';
import { ModeBadge } from '@/stats/mode-badge';
import { ProgressChart } from '@/stats/progress-chart';
import { RoundHistoryList } from '@/components/rounds/round-history-list';
import { Section } from '@/components/ui/section';
import { AccuracyHeading, OutcomeHeading, StreamName } from '@/components/rounds/stream-table';
import { ChartZoomActions } from '@/components/charts/uplot-chart';
import { useChartZoom } from '@/components/charts/zoom';
import type { RoundResult } from '@/game/types';
import { DATE_LOCALE } from '@/config/stats';
import { levelHistory, levelSummary, modeOf, summarizeModes, type ModeSummary } from '@/stats/levels';
import { useSettings } from '@/stores/settings-context';
import { aggregateStreams, collectionSummary, formatDuration } from '@/lib/stats';
import { clearRounds, loadRounds, onRoundsChanged } from '@/lib/storage';
import { useSync } from '@/stores/sync-context';
import { accuracyColor, useTheme, type Theme } from '@/lib/theme';

/** `onReady` fires once the saved rounds have loaded and the stats have been drawn with them. */
export function StatsScreen({ onReady }: { onReady?: () => void }) {
  const theme = useTheme();
  const { settings } = useSettings();
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  // False until the saved rounds have loaded once, so "play a few rounds" doesn't flash up first.
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const paired = (useSync().status?.peers.length ?? 0) > 0;
  // Each chart's zoom lives here, so its crosshair switch and Reset zoom can go in the section header.
  const levelZoom = useChartZoom();
  const modeZoom = useChartZoom();
  const timeZoom = useChartZoom();

  // Load when the app starts (behind the startup screen, so the tab is ready when opened) and after every
  // change to the saved rounds: a round finishing (even while this tab is open), an import or a clear.
  useEffect(() => {
    let cancelled = false;
    const reload = () =>
      loadRounds().then((r) => {
        if (cancelled) {
          return;
        }
        setRounds(r);
        setLoaded(true);
      });
    reload();
    const unsubscribe = onRoundsChanged(reload);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Effects run after the render is on screen, so this fires once the loaded stats are drawn.
  useEffect(() => {
    if (loaded) {
      onReady?.();
    }
  }, [loaded, onReady]);

  const history = useMemo(() => levelHistory(rounds), [rounds]);
  const level = levelSummary(history);
  const modes = useMemo(() => summarizeModes(rounds), [rounds]);
  const summary = collectionSummary(rounds);

  // The mode shown in detail: the one picked, else the one played most recently (modes are sorted that way).
  const currentKey = modeOf(settings).key;
  const selected = modes.find((m) => m.mode.key === selectedKey) ?? modes[0];
  const selectedTags = [
    selected?.mode.key === modes[0]?.mode.key && 'Last played',
    selected?.mode.key === currentKey && 'Current mode',
  ].filter(Boolean);
  // Every stream, the ones this mode doesn't use too, so the table keeps its height from mode to mode.
  const streamAgg = useMemo(() => (selected ? aggregateStreams(selected.rounds) : []), [selected]);
  // Another mode's chart starts unzoomed, so its section header shouldn't offer Reset zoom.
  const selectedModeKey = selected?.mode.key;
  const { reset: resetModeZoom } = modeZoom;
  useEffect(() => resetModeZoom(), [selectedModeKey, resetModeZoom]);

  const onClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    await clearRounds();
    setRounds([]);
    setConfirmClear(false);
  };

  if (!loaded) {
    return (
      <div className="content stats">
        <GridLoader label="Loading stats" />
      </div>
    );
  }

  if (rounds.length === 0 || !level || !selected) {
    return (
      <div className="content stats">
        <p className="t-default secondary empty-state">{statsCopy.empty}</p>
      </div>
    );
  }

  return (
    <div className="content stats">
      <div className="summary-row">
        <StatTile
          icon="trending-up-outline"
          label="Level"
          value={level.current.toFixed(2)}
          sub={
            level.weekChange != null ? (
              <span className={level.weekChange >= 0 ? 'good' : 'bad'}>
                {level.weekChange >= 0 ? '▲ +' : '▼ '}
                {level.weekChange.toFixed(2)} in 7 days
              </span>
            ) : undefined
          }
        />
        <StatTile
          icon="trophy-outline"
          label="Best level"
          value={level.best.toFixed(2)}
          sub={
            level.best - level.current < 0.005 ? (
              <span className="good">At your best</span>
            ) : (
              `${(level.best - level.current).toFixed(2)} above level`
            )
          }
        />
        <StatTile
          icon="layers-outline"
          label="Rounds played"
          value={String(summary.totalRounds)}
          sub={`in ${modes.length} ${modes.length === 1 ? 'mode' : 'modes'}`}
        />
        <StatTile
          icon="time-outline"
          label="Time played"
          value={formatDuration(summary.totalTimeMs)}
          sub={`${formatDuration(summary.totalTimeMs / summary.totalRounds)} per round`}
        />
      </div>

      <Section title={statsCopy.level.title} action={<ChartZoomActions zoom={levelZoom} />} info={statsCopy.level.info}>
        <div className="panel panel-pad">
          <LevelChart history={history} zoom={levelZoom} />
        </div>
      </Section>

      <Section
        title={statsCopy.byMode.title}
        action={<ChartZoomActions zoom={modeZoom} />}
        info={statsCopy.byMode.info}
      >
        <div className="mode-picker-row">
          <div className="mode-picker">
            <HudDropdown
              label="Mode"
              chip={
                <>
                  <ModeBadge mode={selected.mode} />
                  <span aria-hidden>▾</span>
                </>
              }
            >
              {(close) => (
                <div className="mode-options">
                  {modes.map((m) => (
                    <button
                      key={m.mode.key}
                      type="button"
                      className={m.mode.key === selected.mode.key ? 'mode-option on' : 'mode-option'}
                      onClick={() => {
                        setSelectedKey(m.mode.key);
                        close();
                      }}
                    >
                      <ModeBadge mode={m.mode} aligned />
                      <span className="t-code secondary">
                        {m.rounds.length} {m.rounds.length === 1 ? 'round' : 'rounds'} · {shortDate(m.lastPlayed)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </HudDropdown>
          </div>
          {selectedTags.length > 0 && <span className="t-small secondary">{selectedTags.join(' · ')}</span>}
        </div>

        <div className="panel panel-pad">
          <ProgressChart
            key={selected.mode.key}
            rounds={selected.rounds}
            streams={selected.mode.streams}
            zoom={modeZoom}
          />
        </div>

        <div className="panel stream-table">
          <div className="stream-table-row header t-code">
            <span>Stream</span>
            <AccuracyHeading />
            <OutcomeHeading outcome="hit" label="Matched" />
            <OutcomeHeading outcome="miss" label="Missed" />
            <OutcomeHeading outcome="falseAlarm" label="False" />
          </div>
          {streamAgg.map((a) =>
            a.roundsPlayed > 0 ? (
              <div key={a.stream} className="stream-table-row">
                <StreamName stream={a.stream} />
                <span className="t-code" style={{ color: accuracyColor(a.accuracy * 100, theme) }}>
                  {Math.round(a.accuracy * 100)}%
                </span>
                <Count className="t-code good" value={a.hits} label="matched" />
                <Count className="t-code bad" value={a.misses} label="missed" />
                <Count className="t-code bad" value={a.falseAlarms} label="false matches" />
              </div>
            ) : (
              <div key={a.stream} className="stream-table-row off">
                <StreamName stream={a.stream} />
                <span className="visually-hidden">not in this mode</span>
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="t-code" aria-hidden>
                    –
                  </span>
                ))}
              </div>
            ),
          )}
        </div>
      </Section>

      <Section title={statsCopy.modesPlayed.title} info={statsCopy.modesPlayed.info(theme.warning)}>
        <ModesTable modes={modes} selectedKey={selected.mode.key} onSelect={setSelectedKey} theme={theme} />
      </Section>

      <Section title={statsCopy.activity.title} info={statsCopy.activity.info}>
        <div className="panel panel-pad">
          <ActivityCalendar rounds={rounds} />
        </div>
      </Section>

      <Section
        title={statsCopy.timePlayed.title}
        action={<ChartZoomActions zoom={timeZoom} />}
        info={statsCopy.timePlayed.info}
      >
        <div className="panel panel-pad">
          <DailyTimeChart rounds={rounds} zoom={timeZoom} />
        </div>
      </Section>

      <Section
        title={statsCopy.roundHistory.title}
        info={statsCopy.roundHistory.info}
        action={
          <button
            type="button"
            className="text-button t-small"
            style={{ color: confirmClear ? theme.danger : theme.textSecondary }}
            onClick={onClear}
          >
            {confirmClear
              ? paired
                ? statsCopy.roundHistory.confirmClearPaired
                : statsCopy.roundHistory.confirmClear
              : statsCopy.roundHistory.clear}
          </button>
        }
      >
        <div className="panel panel-pad">
          <RoundHistoryList rounds={rounds} />
        </div>
      </Section>
    </div>
  );
}

function ModesTable({
  modes,
  selectedKey,
  onSelect,
  theme,
}: {
  modes: ModeSummary[];
  selectedKey: string;
  onSelect: (key: string) => void;
  theme: Theme;
}) {
  return (
    <div className="panel mode-table">
      <div className="mode-row header t-code">
        <span>N</span>
        <span>Streams</span>
        <span>Speed</span>
        <span>Rounds</span>
        <span>Recent</span>
        <span />
        <span className="best">Best</span>
      </div>
      {modes.map((m) => (
        <button
          key={m.mode.key}
          type="button"
          className={m.mode.key === selectedKey ? 'mode-row on' : 'mode-row'}
          onClick={() => onSelect(m.mode.key)}
        >
          <ModeBadge mode={m.mode} aligned />
          <Count className="t-code" value={m.rounds.length} label="rounds" />
          <span className="t-code" style={{ color: accuracyColor(m.recentAccuracy, theme) }}>
            {Math.round(m.recentAccuracy)}%
          </span>
          <span className="t-code mastered" title={m.mastered ? 'Mastered' : undefined}>
            {m.mastered && <Icon name="star-tight" />}
          </span>
          <span className="t-code best">{Math.round(m.bestAccuracy)}%</span>
        </button>
      ))}
    </div>
  );
}

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
  });
}

/** A headline number, with an icon beside its label. */
function StatTile({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="panel stat-tile">
      <div className="stat-tile-head">
        <span className="stat-tile-icon">
          <Icon name={icon} size={18} />
        </span>
        <span className="t-small secondary stat-tile-label">{label}</span>
      </div>
      <span className="stat-tile-value">{value}</span>
      <span className="t-small secondary stat-tile-sub">{sub}</span>
    </div>
  );
}
