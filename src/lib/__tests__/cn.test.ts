import { cn } from '../cn';

describe('cn', () => {
  it('joins classes and drops the empty ones', () => {
    expect(cn('a', false, null, undefined, 0, '', 'b')).toBe('a b');
    expect(cn(['a', ['b']], { c: true, d: false })).toBe('a b c');
  });

  it('takes a styles object of string arrays', () => {
    const styles = { link: ['p-2 text-accent', 'hover:underline'] };
    const active = false;
    expect(cn(styles.link, active && 'font-bold')).toBe('p-2 text-accent hover:underline');
  });

  it('keeps the last of two classes that set the same thing', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('px-2 py-1', 'p-3')).toBe('p-3');
    expect(cn('bg-surface', 'bg-accent')).toBe('bg-accent');
  });

  it("knows the app's shadows, written as shadow-(--shadow-…)", () => {
    expect(cn('shadow-(--shadow-chip)', 'shadow-none')).toBe('shadow-none');
    expect(cn('shadow-(--shadow-tile-rest)', 'shadow-(--shadow-tile-drop)')).toBe('shadow-(--shadow-tile-drop)');
    // A shadow and a shadow colour are different things, so both stay.
    expect(cn('shadow-(--shadow-chip)', 'shadow-accent')).toBe('shadow-(--shadow-chip) shadow-accent');
  });

  it('tells a text colour apart from a text size', () => {
    expect(cn('text-text-secondary', 'text-accent')).toBe('text-accent');
    expect(cn('text-text-secondary', 'text-sm')).toBe('text-text-secondary text-sm');
  });

  it('only merges classes under the same variant', () => {
    expect(cn('data-[active=true]:text-accent', 'data-[active=true]:text-text')).toBe('data-[active=true]:text-text');
    expect(cn('text-text', 'data-[active=true]:text-accent')).toBe('text-text data-[active=true]:text-accent');
    expect(cn('hover:text-accent', 'data-[active=true]:text-text')).toBe(
      'hover:text-accent data-[active=true]:text-text',
    );
  });
});
