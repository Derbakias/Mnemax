import { COLOR_PALETTE, COLOR_SHADES, clampSettings, defaultSettings, maxMatchesFor, stimulusVisibleMs } from '../config';

describe('stimulusVisibleMs', () => {
  it('shows the box for all of a trial except a fixed 500 ms blank', () => {
    expect(stimulusVisibleMs(3000)).toBe(2500);
    expect(stimulusVisibleMs(1200)).toBe(700);
    expect(stimulusVisibleMs(800)).toBe(300);
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

  it('snaps trial duration to the nearest speed preset', () => {
    expect(clampSettings({ trialDurationMs: 10 }).trialDurationMs).toBe(800);
    expect(clampSettings({ trialDurationMs: 1500 }).trialDurationMs).toBe(1200);
    expect(clampSettings({ trialDurationMs: 2000 }).trialDurationMs).toBe(2000);
    expect(clampSettings({ trialDurationMs: 99999 }).trialDurationMs).toBe(3000);
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
