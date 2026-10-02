import { formatCount } from '../format';

describe('formatCount', () => {
  it('keeps counts to four characters', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1202)).toBe('1.2K');
    expect(formatCount(9960)).toBe('10K');
    expect(formatCount(12345)).toBe('12K');
    expect(formatCount(999_499)).toBe('999K');
    expect(formatCount(999_600)).toBe('1M');
    expect(formatCount(1_250_000)).toBe('1.3M');
    expect(formatCount(2_000_000_000)).toBe('2B');
  });
});
