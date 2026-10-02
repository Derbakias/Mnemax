import { useSyncStore } from '@/stores/sync';

describe('sync store', () => {
  it('shows an error and notes it in the log, unless told not to', () => {
    const { failWith } = useSyncStore.getState();
    failWith(new Error('No network'));
    expect(useSyncStore.getState().notice).toEqual({ kind: 'error', text: 'No network' });
    expect(useSyncStore.getState().log.lines.at(-1)?.text).toBe('Failed: No network');

    failWith('Key store locked', false);
    expect(useSyncStore.getState().notice).toEqual({ kind: 'error', text: 'Key store locked' });
    expect(useSyncStore.getState().log.lines).toHaveLength(1);
  });
});
