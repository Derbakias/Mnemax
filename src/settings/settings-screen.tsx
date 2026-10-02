import { useEffect, useMemo, useRef, useState } from 'react';

import { KeyBindings } from '@/settings/key-bindings';
import { LayoutPreview } from '@/settings/layout-preview';
import { MatchSlider } from '@/settings/sliders';
import { Icon } from '@/components/ui/icon';
import { Section } from '@/components/ui/section';
import { Stepper } from '@/components/ui/stepper';
import { settingsCopy } from '@/copy/settings';
import { SyncSection } from '@/sync/sync-section';
import { MAX_N, MIN_N, SPEED_PRESETS } from '@/config/game';
import { RESET_CONFIRM_MS } from '@/config/ui';
import { maxMatchesFor } from '@/game/rules';
import { STREAM_IDS, STREAM_LABELS } from '@/game/types';
import { MAX_DAILY_TARGET_MINUTES, MIN_DAILY_TARGET_MINUTES, STEP_DAILY_TARGET_MINUTES } from '@/config/stats';
import type { ButtonLayout } from '@/lib/prefs';
import { useSettings } from '@/stores/settings-context';
import { buildStatsJson, exportStats, parseStatsPayload, pickStatsFileText, statsFilename } from '@/lib/stats-io';
import { loadRounds, mergeRounds } from '@/lib/storage';

const BUTTON_LAYOUTS: ButtonLayout[] = ['grid', 'rows'];

/** `active`: the Settings tab is showing (the screen stays mounted behind the other tabs). */
export function SettingsScreen({ active }: { active: boolean }) {
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
    if (dataBusy) {
      return;
    }
    setDataBusy(true);
    setDataStatus(null);
    try {
      const rounds = await loadRounds();
      if (rounds.length === 0) {
        setDataStatus(settingsCopy.data.nothingToExport);
        return;
      }
      const filename = statsFilename();
      if (!(await exportStats(buildStatsJson(rounds), filename))) {
        return;
      }
      setDataStatus(settingsCopy.data.exported(rounds.length));
    } catch (error) {
      setDataStatus(errorMessage(error, settingsCopy.data.exportFailed));
    } finally {
      setDataBusy(false);
    }
  };

  const onImportStats = async () => {
    if (dataBusy) {
      return;
    }
    setDataBusy(true);
    setDataStatus(null);
    try {
      const text = await pickStatsFileText();
      if (text == null) {
        return;
      }
      const { rounds, skipped } = parseStatsPayload(text);
      const { added } = await mergeRounds(rounds);
      const status = added > 0 ? settingsCopy.data.imported(added) : settingsCopy.data.nothingNew;
      setDataStatus(skipped > 0 ? `${status} ${settingsCopy.data.skipped(skipped)}` : status);
    } catch (error) {
      setDataStatus(errorMessage(error, settingsCopy.data.importFailed));
    } finally {
      setDataBusy(false);
    }
  };

  return (
    <div className="content settings">
      <Section title={settingsCopy.streams.title} info={settingsCopy.streams.info}>
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

      <Section title={settingsCopy.nLevel.title} info={settingsCopy.nLevel.info}>
        <Stepper value={settings.nLevel} min={MIN_N} max={MAX_N} onChange={setNLevel} />
      </Section>

      <Section title={settingsCopy.speed.title} info={settingsCopy.speed.info}>
        <div className="preset-row">
          {/* Slowest first, reading left to right towards faster. */}
          {[...SPEED_PRESETS].reverse().map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={settings.speed === preset.id ? 'preset-chip on' : 'preset-chip'}
              onClick={() => setSpeed(preset.id)}
            >
              <span className="t-small">{preset.label}</span>
              <span className="t-code preset-sub">{preset.answerMs} ms</span>
            </button>
          ))}
        </div>
        <label className="switch-row inline">
          <span className="t-default">{settingsCopy.speed.timerSwitch}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.showTrialTimer}
            onChange={(e) => setShowTrialTimer(e.target.checked)}
          />
        </label>
      </Section>

      <Section title={settingsCopy.matches.title} info={settingsCopy.matches.info(matchCap)}>
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

      <Section title={settingsCopy.dailyTarget.title} info={settingsCopy.dailyTarget.info}>
        <div className="inline-row">
          <Stepper
            value={prefs.dailyTargetMinutes}
            min={MIN_DAILY_TARGET_MINUTES}
            max={MAX_DAILY_TARGET_MINUTES}
            step={STEP_DAILY_TARGET_MINUTES}
            onChange={setDailyTargetMinutes}
          />
          <span className="t-default secondary">{settingsCopy.dailyTarget.unit}</span>
        </div>
      </Section>

      <Section title={settingsCopy.tutorial.title} info={settingsCopy.tutorial.info}>
        <label className="row-between switch-row">
          <span className="t-default">{settingsCopy.tutorial.historySwitch}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.tutorialHistory}
            onChange={(e) => setTutorialAid('tutorialHistory', e.target.checked)}
          />
        </label>
        <label className="row-between switch-row">
          <span className="t-default">{settingsCopy.tutorial.solutionSwitch}</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={prefs.tutorialSolution}
            onChange={(e) => setTutorialAid('tutorialSolution', e.target.checked)}
          />
        </label>
      </Section>

      <Section title={settingsCopy.buttonLayout.title} info={settingsCopy.buttonLayout.info}>
        <div className="layout-options">
          {BUTTON_LAYOUTS.map((layout) => (
            <button
              key={layout}
              type="button"
              className={prefs.buttonLayout === layout ? 'preset-chip on' : 'preset-chip'}
              onClick={() => setButtonLayout(layout)}
            >
              <LayoutPreview layout={layout} />
              <span className="t-small">{settingsCopy.buttonLayout.layouts[layout]}</span>
            </button>
          ))}
        </div>
        {prefs.buttonLayout === 'grid' && (
          <label className="switch-row inline">
            <span className="t-default">{settingsCopy.buttonLayout.swipeSwitch}</span>
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
        <Section title={settingsCopy.keyboard.title} info={settingsCopy.keyboard.info}>
          <KeyBindings keys={prefs.keyBindings} onChange={setKeyBinding} />
        </Section>
      )}

      <Section title={settingsCopy.data.title} info={settingsCopy.data.info}>
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

      <SyncSection active={active} />

      <button type="button" className="outline-button danger reset-button" onClick={onResetDefaults}>
        Reset to defaults
        <span className={resetDone ? 'reset-done on' : 'reset-done'}>
          <Icon name="checkmark-circle" size={22} />
        </span>
      </button>
      <span className="visually-hidden" role="status">
        {resetDone ? settingsCopy.reset.done : ''}
      </span>

      <p className="app-version t-small secondary">Mnemax v{__APP_VERSION__}</p>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error) {
    return error;
  }
  return fallback;
}
