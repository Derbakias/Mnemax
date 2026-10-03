import { withAlpha } from '../series';

describe('withAlpha', () => {
  it('adds the alpha to a six-digit colour', () => {
    expect(withAlpha('#1e88e5', 0.5)).toBe('#1e88e580');
    expect(withAlpha('#1e88e5', 0)).toBe('#1e88e500');
    expect(withAlpha('#1e88e5', 1)).toBe('#1e88e5ff');
  });

  it('writes out the short forms the build makes', () => {
    expect(withAlpha('#fa0', 0.5)).toBe('#ffaa0080');
    expect(withAlpha('#fa08', 0.5)).toBe('#ffaa0080');
  });

  it('replaces an alpha the colour already has', () => {
    expect(withAlpha('#1e88e524', 0.5)).toBe('#1e88e580');
  });

  it('trims spaces read from the CSS', () => {
    expect(withAlpha(' #1e88e5 ', 0.5)).toBe('#1e88e580');
  });

  it('leaves anything that is not hex as it is', () => {
    expect(withAlpha('rgb(1, 2, 3)', 0.5)).toBe('rgb(1, 2, 3)');
    expect(withAlpha('', 0.5)).toBe('');
  });
});
