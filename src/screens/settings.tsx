// TODO: All the info text should be in one place maybe in a state to have everything together
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/icon';
import { Section } from '@/components/section';
import { STREAM_ICONS } from '@/components/response-buttons';
import { Stepper } from '@/components/stepper';
import { BLANK_MS, MAX_N, MIN_N, SPEED_PRESETS, TRIALS_PER_ROUND, maxMatchesFor } from '@/game/config';
import type { StreamId } from '@/game/types';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import {
  MAX_DAILY_TARGET_MINUTES,
  MIN_DAILY_TARGET_MINUTES,
  STEP_DAILY_TARGET_MINUTES,
  isBindableKey,
  keyLabel,
  type ButtonLayout,
} from '@/prefs';
import { useSettings } from '@/settings-context';
import { buildStatsJson, exportStats, parseStatsPayload, pickStatsFileText, statsFilename } from '@/stats-io';
import { loadRounds, mergeRounds } from '@/storage';

// TODO: Move inside a config file to have everything together
/** How long the tick on the reset button stays up. */
const RESET_CONFIRM_MS = 2000;

const BUTTON_LAYOUTS: { id: ButtonLayout; label: string }[] = [
  { id: 'grid', label: 'Two per row' },
  { id: 'rows', label: 'One per row' },
];

export function SettingsScreen() {
  const {
    settings,
    prefs,
    toggleStream,
    setNLevel,
    setSpeed,
    setMatchCount,
    setButtonLayout,
    setSwipeAnswers,
    setDailyTargetMinutes,
    setShowTrialTimer,
    setTutorialAid,
    setKeyBinding,
    resetDefaults,
  } = useSettings();
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [dataBusy, setDataBusy] = useState(false);
  // Key bindings only matter with a real keyboard; same test as the key hints on the Play screen.
  const hasKeyboard = useMemo(() => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false, []);

  const matchCap = maxMatchesFor(settings.nLevel);

  // A tick on the reset button confirms the reset, then fades after a moment. Another click restarts it.
  const [resetDone, setResetDone] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const onResetDefaults = () => {
    resetDefaults();
    setResetDone(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setResetDone(false), RESET_CONFIRM_MS);
  };

  const onExportStats = async () => {
    if (dataBusy) return;
    setDataBusy(true);
    setDataStatus(null);
    try {
      const rounds = await loadRounds();
      if (rounds.length === 0) {
        setDataStatus('Nothing to export yet — play a round first.');
        return;
      }
      const filename = statsFilename();
      if (!(await exportStats(buildStatsJson(rounds), filename))) return;
      setDataStatus(`Exported ${rounds.length} rounds.`);
    } catch (error) {
      setDataStatus(errorMessage(error, 'Export failed.'));
    } finally {
      setDataBusy(false);
    }
  };

  const onImportStats = async () => {
    if (dataBusy) return;
    setDataBusy(true);
    setDataStatus(null);
    try {
      const text = await pickStatsFileText();
      if (text == null) return;
      const { rounds, skipped } = parseStatsPayload(text);
      const { added } = await mergeRounds(rounds);
      const status = added > 0 ? `Imported ${added} new round${added === 1 ? '' : 's'}.` : 'No new rounds found.';
      setDataStatus(skipped > 0 ? `${status} Skipped ${skipped} broken round${skipped === 1 ? '' : 's'}.` : status);
    } catch (error) {
      setDataStatus(errorMessage(error, 'Import failed.'));
    } finally {
      setDataBusy(false);
    }
  };

  return (
    <div className="content settings">
      <Section
        title="Active streams"
        info={
          <>
            <p>What you keep track of each trial. More streams is harder. At least one stays on.</p>
            <p>
              <strong>Letter</strong> is spoken aloud.
            </p>
          </>
        }>
        {STREAM_IDS.map((stream) => (
          <label key={stream} className="row-between switch-row">
            <span className="t-default">{STREAM_LABELS[stream]}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={settings.activeStreams[stream]}
              onChange={(e) => toggleStream(stream, e.target.checked)}
            />
          </label>
        ))}
      </Section>

      <Section
        title="N-back level"
        info={
          <p>
            How far back to compare: each trial is checked against the one N trials before it. A higher N is harder.
          </p>
        }>
        <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
      </Section>

      <Section
        title="Trial speed"
        info={
          <>
            <p>
              How long the box shows, which is the time you have to answer. Then the grid is blank for{' '}
              {BLANK_MS / 1000} s before the next one. Faster is harder.
            </p>
            <p>
              <strong>Trial timer:</strong> a bar at the top of the grid, under the progress, that fills up while you can
              answer.
            </p>
          </>
        }>
        <div className="preset-row">
          {/* Slowest first, reading left to right towards faster. */}
          {[...SPEED_PRESETS].reverse().map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={settings.speed === preset.id ? 'preset-chip on' : 'preset-chip'}
              onClick={() => setSpeed(preset.id)}>
              <span className="t-small">{preset.label}</span>
              <span className="t-code preset-sub">{preset.answerMs} ms</span>
            </button>
          ))}
        </div>
        <label className="switch-row inline">
          <span className="t-default">Show trial timer</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.showTrialTimer}
            onChange={(e) => setShowTrialTimer(e.target.checked)}
          />
        </label>
      </Section>

      <Section
        title="Matches per stream"
        info={
          <p>
            How many of the {TRIALS_PER_ROUND} trials in a round are a match, for each stream. The first N trials can't
            be matches, so the most is {TRIALS_PER_ROUND} − N ({matchCap} now).
          </p>
        }>
        {STREAM_IDS.filter((s) => settings.activeStreams[s]).map((stream) => (
          <MatchSlider
            key={stream}
            stream={stream}
            value={settings.matchCounts[stream]}
            cap={matchCap}
            onChange={(v) => setMatchCount(stream, v)}
          />
        ))}
      </Section>

      <Section
        title="Daily target"
        info={
          <p>How long you want to play each day. It shows at the top of the Play screen. Tutorial rounds don't count.</p>
        }>
        <div className="inline-row">
          <Stepper
            value={prefs.dailyTargetMinutes}
            min={MIN_DAILY_TARGET_MINUTES}
            max={MAX_DAILY_TARGET_MINUTES}
            step={STEP_DAILY_TARGET_MINUTES}
            onChange={setDailyTargetMinutes}
          />
          <span className="t-default secondary">minutes per day</span>
        </div>
      </Section>

      <Section
        title="Tutorial"
        info={
          <>
            <p>
              Turn tutorial mode on with <Icon name="school-outline" size={16} /> on the Play screen. 
              The round results aren't saved and don't count towards the daily target. One of the tutorial options shoulbe be always on.
            </p>
            <p>
              <strong>History:</strong> every trial from the one N back to the current one, just above the grid. The one N
              back is outlined when it matches the current trial.
            </p>
            <p>
              <strong>Solution:</strong> the answer buttons of the streams that match are outlined.
            </p>
          </>
        }>
        <label className="row-between switch-row">
          <span className="t-default">Show history</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.tutorialHistory}
            onChange={(e) => setTutorialAid('tutorialHistory', e.target.checked)}
          />
        </label>
        <label className="row-between switch-row">
          <span className="t-default">Show solution</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.tutorialSolution}
            onChange={(e) => setTutorialAid('tutorialSolution', e.target.checked)}
          />
        </label>
      </Section>

      <Section
        title="Button layout"
        info={
          <>
            <p>Where the answer buttons sit on the Play screen.</p>
            <p>
              With two per row you can also swipe: press a button and slide over the others to answer them too. To
              answer two buttons corner to corner, slide straight through the middle.
            </p>
          </>
        }>
        <div className="layout-options">
          {BUTTON_LAYOUTS.map((layout) => (
            <button
              key={layout.id}
              type="button"
              className={prefs.buttonLayout === layout.id ? 'preset-chip on' : 'preset-chip'}
              onClick={() => setButtonLayout(layout.id)}>
              <LayoutPreview layout={layout.id} />
              <span className="t-small">{layout.label}</span>
            </button>
          ))}
        </div>
        {prefs.buttonLayout === 'grid' && (
          <label className="switch-row inline">
            <span className="t-default">Swipe</span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={prefs.swipeAnswers}
              onChange={(e) => setSwipeAnswers(e.target.checked)}
            />
          </label>
        )}
      </Section>

      {hasKeyboard && (
        <Section
          title="Keyboard"
          info={
            <>
              <p>
                <strong>Space</strong> starts, pauses and resumes a round. <strong>Esc</strong> stops it.
              </p>
              <p>To change a stream's key, click it, then press the new key.</p>
            </>
          }>
          <KeyBindings keys={prefs.keyBindings} onChange={setKeyBinding} />
        </Section>
      )}

      <Section
        title="Data"
        info={
          <p>
            Save your rounds to a file, or load them from one (for example from another device). Rounds you already have
            aren't added twice.
          </p>
        }>
        <div className="data-row">
          <button type="button" className="outline-button accent" disabled={dataBusy} onClick={onExportStats}>
            Export JSON
          </button>
          <button type="button" className="outline-button accent" disabled={dataBusy} onClick={onImportStats}>
            Import JSON
          </button>
        </div>
        {dataStatus && <p className="t-small secondary">{dataStatus}</p>}
      </Section>

      <button type="button" className="outline-button danger reset-button" onClick={onResetDefaults}>
        Reset to defaults
        <span className={resetDone ? 'reset-done on' : 'reset-done'}>
          <Icon name="checkmark-circle" size={22} />
        </span>
      </button>
      <span className="visually-hidden" role="status">
        {resetDone ? 'Settings reset to defaults' : ''}
      </span>

      <p className="app-version t-small secondary">Mnemax v{__APP_VERSION__}</p>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function Slider({
  value,
  min,
  max,
  step,
  onValueChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      className="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onValueChange(Number(e.target.value))}
    />
  );
}

function MatchSlider({
  stream,
  value,
  cap,
  onChange,
}: {
  stream: StreamId;
  value: number;
  cap: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="match-block">
      <div className="row-between">
        <span className="t-default">{STREAM_LABELS[stream]}</span>
        <span className="t-code">{value}</span>
      </div>
      <Slider value={value} min={0} max={cap} step={1} onValueChange={onChange} />
    </div>
  );
}

// A thumbnail of the play screen for each button layout: the 3x3 grid with the answer buttons under it.
// TODO: Move to a component
function LayoutPreview({ layout }: { layout: ButtonLayout }) {
  const cell = 7;
  const gap = 1.5;
  const gridSize = cell * 3 + gap * 2;
  const gridX = (60 - gridSize) / 2;

  const cells = [];
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    cells.push(
      <rect
        key={i}
        x={gridX + (i % 3) * (cell + gap)}
        y={Math.floor(i / 3) * (cell + gap)}
        width={cell}
        height={cell}
        rx={1.5}
        fillOpacity={0.3}
      />,
    );
  }

  const buttons =
    layout === 'grid'
      ? [0, 1].map((i) => <rect key={i} x={8 + i * 23} y={28} width={21} height={11} rx={2} />)
      : [0, 1].map((i) => <rect key={i} x={8} y={28 + i * 9} width={44} height={7} rx={2} />);

  return (
    <svg className="layout-preview" viewBox="0 0 60 44" width={60} height={44} aria-hidden fill="currentColor">
      {cells}
      <g fillOpacity={0.55}>{buttons}</g>
    </svg>
  );
}

/**
 * One row per stream with its answer key. Tapping a key waits for the next key press and assigns it
 * (Esc cancels); a key already used by another stream swaps with it.
 */
function KeyBindings({
  keys,
  onChange,
}: {
  keys: Record<StreamId, string>;
  onChange: (stream: StreamId, key: string) => void;
}) {
  const [listening, setListening] = useState<StreamId | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Shift', 'CapsLock', 'Tab'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        setWarning(null);
      } else if (e.key === ' ') {
        setWarning('Space is taken: it starts, pauses and resumes a round.');
      } else if (!isBindableKey(e.key)) {
        setWarning(`"${e.key}" can't be used. Pick a letter, digit, symbol or arrow key.`);
      } else {
        onChange(listening, e.key);
        setListening(null);
        setWarning(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, onChange]);

  return (
    <div className="stack-8">
      {STREAM_IDS.map((stream) => (
        <div key={stream} className="row-between">
          <span className="key-binding-label t-default">
            <Icon name={STREAM_ICONS[stream]} size={20} />
            {STREAM_LABELS[stream]}
          </span>
          <button
            type="button"
            className={listening === stream ? 'key-binding listening' : 'key-binding'}
            aria-label={`${STREAM_LABELS[stream]} key: ${keyLabel(keys[stream])}. Tap to change.`}
            onClick={() => {
              setListening(listening === stream ? null : stream);
              setWarning(null);
            }}>
            {listening === stream ? 'Press a key…' : keyLabel(keys[stream])}
          </button>
        </div>
      ))}
      {warning && <p className="t-small bad">{warning}</p>}
    </div>
  );
}
