// TODO: All the info text should be in one place maybe in a state to have everything together
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ActivityCalendar } from '@/components/activity-calendar';
import { Count } from '@/components/count';
import { DailyTimeChart } from '@/components/daily-time-chart';
import { GridLoader } from '@/components/grid-loader';
import { HudDropdown } from '@/components/hud-dropdown';
import { Icon, type IconName } from '@/components/icon';
import { ChartControlsTip } from '@/components/info-tip';
import { LevelChart } from '@/components/level-chart';
import { ModeBadge } from '@/components/mode-badge';
import { ProgressChart } from '@/components/progress-chart';
import { RoundHistoryList } from '@/components/round-history-list';
import { Section } from '@/components/section';
import { AccuracyHeading, OutcomeHeading, StreamName } from '@/components/stream-table';
import { ChartZoomActions, useChartZoom } from '@/components/uplot-chart';
import type { RoundResult } from '@/game/types';
import {
  LEVEL_WINDOW,
  MASTERY_ACCURACY,
  RECENT_ROUNDS,
  levelHistory,
  levelSummary,
  modeOf,
  summarizeModes,
  type ModeSummary,
} from '@/levels';
import { useSettings } from '@/settings-context';
import { aggregateStreams, collectionSummary, DATE_LOCALE, formatDuration } from '@/stats';
import { clearRounds, loadRounds, onRoundsChanged } from '@/storage';
import { useSync } from '@/sync-context';
import { accuracyColor, useTheme, type Theme } from '@/theme';

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
        if (cancelled) return;
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
    if (loaded) onReady?.();
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
        <p className="t-default secondary empty-state">Play a few rounds to build up your stats.</p>
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

      <Section
        title="Level"
        action={<ChartZoomActions zoom={levelZoom} />}
        info={
          <>
            <p>Your overall skill, comparable across every mode.</p>
            <p>
              Each round scores <strong>difficulty × accuracy</strong>. Harder settings are worth more: a higher N, more
              streams, a faster speed.
            </p>
            <p>For example, a perfect Position + Color 2-back at Normal speed scores 2.</p>
            <p>Your level is the average of your last {LEVEL_WINDOW} rounds.</p>
            <ChartControlsTip />
          </>
        }>
        <div className="panel panel-pad">
          <LevelChart history={history} zoom={levelZoom} />
        </div>
      </Section>

      <Section
        title="By mode"
        action={<ChartZoomActions zoom={modeZoom} />}
        info={
          <>
            <p>
              A mode is one exact setup: <strong>N, streams and speed</strong>. Pick one to see how you're doing in it
              over time.
            </p>
            <p>
              <strong>Accuracy:</strong> 100% is perfect, 0% is no better than guessing.
            </p>
            <p>
              <strong>Reaction time:</strong> how quickly you press when you spot a match.
            </p>
            <p>
              <strong>Time to 100%:</strong> an estimate from how fast your accuracy has been rising. Progress slows as
              you get close to 100%, and the estimate allows for that.
            </p>
            <p>
              <strong>Matched:</strong> you pressed on a match.{" "}
              <strong>Missed:</strong> you didn't match.{" "}
              <strong>False:</strong> you pressed when there was no match.
            </p>
            <ChartControlsTip />
          </>
        }>
        <div className="mode-picker-row">
          <div className="mode-picker">
            <HudDropdown
              label="Mode"
              chip={
                <>
                  <ModeBadge mode={selected.mode} />
                  <span aria-hidden>▾</span>
                </>
              }>
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
                      }}>
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

      <Section
        title="Modes played"
        info={
          <>
            <p>Every mode you've played, most recent first. Tap one to show it in By mode.</p>
            <p>
              <strong>Recent:</strong> your average accuracy over the last {RECENT_ROUNDS} rounds.
            </p>
            <p>
              <strong>Best:</strong> your best single round.
            </p>
            <p>
              <Icon name="star" size={14} color={theme.warning} /> <strong>Mastered:</strong> {MASTERY_ACCURACY}% or
              more recently. Time to try something harder.
            </p>
          </>
        }>
        <ModesTable modes={modes} selectedKey={selected.mode.key} onSelect={setSelectedKey} theme={theme} />
      </Section>

      <Section
        title="Activity"
        info={
          <p>
            Each square is a day: the darker it is, the more rounds you played. Hover over or tap a day to see its
            count.
          </p>
        }>
        <div className="panel panel-pad">
          <ActivityCalendar rounds={rounds} />
        </div>
      </Section>

      <Section
        title="Time played vs level"
        action={<ChartZoomActions zoom={timeZoom} />}
        info={
          <>
            <p>
              <strong>Bars:</strong> minutes played each day.
            </p>
            <p>
              <strong>Dotted line:</strong> whether you're playing more or less over time.
            </p>
            <p>
              <strong>Solid line:</strong> your average level that day.
            </p>
            <ChartControlsTip />
          </>
        }>
        <div className="panel panel-pad">
          <DailyTimeChart rounds={rounds} zoom={timeZoom} />
        </div>
      </Section>

      <Section
        title="Round history"
        info={
          <p>
            Every round, newest first. Tap one to see each trial and how you answered it. Clearing deletes the rounds
            on this device only: a paired device sends them back at the next sync.
          </p>
        }
        action={
          <button
            type="button"
            className="text-button t-small"
            style={{ color: confirmClear ? theme.danger : theme.textSecondary }}
            onClick={onClear}>
            {confirmClear ? (paired ? 'Tap again (paired devices send them back)' : 'Tap again to clear') : 'Clear history'}
          </button>
        }>
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
          onClick={() => onSelect(m.mode.key)}>
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
