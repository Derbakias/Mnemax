import { clampPrefs } from '../prefs';
import { DEFAULT_KEY_BINDINGS } from '@/config/ui';

describe('clampPrefs key bindings', () => {
  it('defaults to F, D, J, K', () => {
    expect(clampPrefs(null).keyBindings).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('keeps valid bindings, upper-cased', () => {
    const keyBindings = { position: 'q', color: 'w', number: '1', audio: ';' };
    expect(clampPrefs({ keyBindings }).keyBindings).toEqual({ position: 'Q', color: 'W', number: '1', audio: ';' });
  });

  it('accepts arrow keys', () => {
    const keyBindings = { position: 'ArrowLeft', color: 'ArrowUp', number: 'ArrowRight', audio: 'ArrowDown' };
    expect(clampPrefs({ keyBindings }).keyBindings).toEqual(keyBindings);
  });

  it('falls back to the defaults for duplicates, Space, other named keys or missing streams', () => {
    expect(clampPrefs({ keyBindings: { position: 'A', color: 'A', number: 'K', audio: 'L' } }).keyBindings).toEqual(
      DEFAULT_KEY_BINDINGS,
    );
    expect(clampPrefs({ keyBindings: { position: 'Enter', color: 'S', number: 'K', audio: 'L' } }).keyBindings).toEqual(
      DEFAULT_KEY_BINDINGS,
    );
    expect(clampPrefs({ keyBindings: { position: ' ', color: 'S', number: 'K', audio: 'L' } }).keyBindings).toEqual(
      DEFAULT_KEY_BINDINGS,
    );
    expect(
      clampPrefs({ keyBindings: { position: 'Q' } as unknown as typeof DEFAULT_KEY_BINDINGS }).keyBindings,
    ).toEqual(DEFAULT_KEY_BINDINGS);
  });
});

describe('clampPrefs tutorial', () => {
  it('shows the history by default', () => {
    expect(clampPrefs(null)).toMatchObject({ tutorialHistory: true, tutorialSolution: false });
  });

  it('keeps either one or both on', () => {
    expect(clampPrefs({ tutorialHistory: false, tutorialSolution: true })).toMatchObject({
      tutorialHistory: false,
      tutorialSolution: true,
    });
    expect(clampPrefs({ tutorialHistory: true, tutorialSolution: true })).toMatchObject({
      tutorialHistory: true,
      tutorialSolution: true,
    });
  });

  it('never turns both off', () => {
    expect(clampPrefs({ tutorialHistory: false, tutorialSolution: false })).toMatchObject({
      tutorialHistory: true,
      tutorialSolution: false,
    });
  });
});

describe('clampPrefs swipe answers', () => {
  it('is off by default', () => {
    expect(clampPrefs(null).swipeAnswers).toBe(false);
  });

  it('only turns on for true', () => {
    expect(clampPrefs({ swipeAnswers: true }).swipeAnswers).toBe(true);
    expect(clampPrefs({ swipeAnswers: 'yes' as unknown as boolean }).swipeAnswers).toBe(false);
  });
});

describe('clampPrefs auto sync', () => {
  it('is on by default', () => {
    expect(clampPrefs(null).autoSync).toBe(true);
    expect(clampPrefs({}).autoSync).toBe(true);
  });

  it('only turns off for false', () => {
    expect(clampPrefs({ autoSync: false }).autoSync).toBe(false);
    expect(clampPrefs({ autoSync: 'no' as unknown as boolean }).autoSync).toBe(true);
  });
});
