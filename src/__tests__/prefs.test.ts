import { DEFAULT_KEY_BINDINGS, clampPrefs } from '../prefs';

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
