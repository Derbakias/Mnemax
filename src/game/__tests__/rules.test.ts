import { BLANK_MS, COLOR_PALETTE, COLOR_SHADES } from '@/config/game';
import { clampSettings, defaultSettings, maxMatchesFor, speedOf, speedPreset, stimulusVisibleMs } from '../rules';

describe('stimulusVisibleMs', () => {
  it('shows the box for all of a trial except the fixed blank', () => {
    expect(stimulusVisibleMs(4000 + BLANK_MS)).toBe(4000);
    expect(stimulusVisibleMs(2500 + BLANK_MS)).toBe(2500);
    expect(stimulusVisibleMs(1000 + BLANK_MS)).toBe(1000);
  });
});

describe('speedOf', () => {
  it('reads the saved level, whatever the trial length', () => {
    expect(speedOf({ speed: 'fast', trialDurationMs: 9999 }).id).toBe('fast');
  });

  it('places a trial length without a level at the nearest level', () => {
    expect(speedOf({ trialDurationMs: speedPreset('slow').ms + 50 }).id).toBe('slow');
    expect(speedOf({}).id).toBe('normal');
  });
});

describe('clampSettings', () => {
  it('returns sane defaults for empty input', () => {
    const s = defaultSettings();
    expect(s.nLevel).toBeGreaterThanOrEqual(1);
    expect(s.trialDurationMs).toBeGreaterThanOrEqual(500);
    expect(Object.values(s.activeStreams).some(Boolean)).toBe(true);
  });

  it('forces at least one active stream', () => {
    const s = clampSettings({
      activeStreams: { position: false, color: false, number: false, audio: false },
    });
    expect(Object.values(s.activeStreams).some(Boolean)).toBe(true);
  });

  it('clamps n level into 1..10', () => {
    expect(clampSettings({ nLevel: 0 }).nLevel).toBe(1);
    expect(clampSettings({ nLevel: 99 }).nLevel).toBe(10);
  });

  it("sets the trial length from the level, so saved settings follow a change of the level's timing", () => {
    expect(clampSettings({ speed: 'slow', trialDurationMs: 9999 }).trialDurationMs).toBe(speedPreset('slow').ms);
    expect(defaultSettings().speed).toBe('normal');
  });

  it('snaps a trial length saved without a level to the nearest level', () => {
    expect(clampSettings({ trialDurationMs: 10 }).speed).toBe('veryFast');
    expect(clampSettings({ trialDurationMs: speedPreset('normal').ms - 50 }).speed).toBe('normal');
    expect(clampSettings({ trialDurationMs: 99999 }).speed).toBe('verySlow');
  });

  it('clamps match counts when raising the n level', () => {
    const s = clampSettings({ nLevel: 15, matchCounts: { position: 18, color: 6, number: 6, audio: 6 } });
    expect(s.matchCounts.position).toBe(maxMatchesFor(10));
    expect(s.matchCounts.color).toBe(6);
  });
});

describe('COLOR_SHADES', () => {
  it('has a shade for every palette colour', () => {
    expect(COLOR_SHADES).toHaveLength(COLOR_PALETTE.length);
  });
});
