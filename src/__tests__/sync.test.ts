import { loadRounds } from '../storage';
import { SYNC_API, apiMismatch, codeFromQr, forgetDevice, saveReceived, syncWith } from '../sync';
import type { RoundResult } from '../game/types';

const mockMemory = new Map<string, string>();
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  isTauri: () => true,
  Channel: class {
    onmessage: unknown = null;
  },
}));

vi.mock('../kv', () => ({
  getItem: async (key: string) => mockMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockMemory.set(key, value);
  },
  removeItem: async (key: string) => {
    mockMemory.delete(key);
  },
}));

function round(id: string, finishedAt: number): RoundResult {
  return {
    id,
    finishedAt,
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2900,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    },
    trials: [],
  };
}

describe('saveReceived', () => {
  beforeEach(() => mockMemory.clear());

  it('saves the rounds another device sent, checked like an imported file', async () => {
    const good = round('phone-1', Date.UTC(2026, 8, 30));
    const result = await saveReceived([
      good,
      { ...round('phone-2', Date.UTC(2026, 8, 30)), settings: { nLevel: 99 } },
      { ...round('phone-3', Date.UTC(2026, 8, 30)), extra: '<script>' },
      'not a round',
    ]);
    expect(result).toEqual({ added: 2, skipped: 2 });
    const saved = await loadRounds();
    expect(saved.map((r) => r.id).sort()).toEqual(['phone-1', 'phone-3']);
    expect(saved.find((r) => r.id === 'phone-3')).not.toHaveProperty('extra');
  });

  it('adds nothing when the rounds are already here', async () => {
    const r = round('a', Date.UTC(2026, 8, 30));
    await saveReceived([r]);
    await expect(saveReceived([r])).resolves.toEqual({ added: 0, skipped: 0 });
  });
});

describe('codeFromQr', () => {
  it('takes the code from a Mnemax pairing QR code', () => {
    expect(codeFromQr('mnemax:pair:815307')).toBe('815307');
    expect(codeFromQr(' mnemax:pair:000001\n')).toBe('000001');
  });

  it('turns down any other QR code', () => {
    for (const text of [
      '815307',
      'https://example.com/mnemax:pair:815307',
      'mnemax:pair:81530',
      'mnemax:pair:8153077',
      'mnemax:pair:815-307',
      'mnemax:pair:815307&next=evil',
      'MNEMAX:PAIR:815307',
    ]) {
      expect(codeFromQr(text)).toBeNull();
    }
  });
});

describe('talking to the Rust side', () => {
  beforeEach(() => {
    mockMemory.clear();
    mockInvoke.mockReset();
  });

  it('only takes an answer that says so as unpaired', async () => {
    mockInvoke.mockResolvedValueOnce({ kind: 'unpaired' });
    await expect(syncWith('k', () => {})).resolves.toBeNull();
  });

  it('saves the rounds from a sync', async () => {
    mockInvoke.mockResolvedValueOnce({ kind: 'synced', rounds: [round('a', Date.UTC(2026, 8, 30))] });
    await expect(syncWith('k', () => {})).resolves.toEqual({ added: 1, skipped: 0 });
  });

  it('turns an answer it does not know into an error, not a conclusion', async () => {
    // What an older Rust side answered: the rounds alone.
    for (const answer of [[round('a', Date.UTC(2026, 8, 30))], null, 'unpaired', { kind: 'synced' }]) {
      mockInvoke.mockResolvedValueOnce(answer);
      await expect(syncWith('k', () => {})).rejects.toThrow('Restart the app');
    }
    // What an older Rust side answered to forgetting: the status.
    mockInvoke.mockResolvedValueOnce({ name: 'Laptop', peers: [] });
    await expect(forgetDevice('k', () => {})).rejects.toThrow('Restart the app');
  });

  it('notices a Rust side from another version', () => {
    expect(apiMismatch({ api: SYNC_API, name: 'Laptop', peers: [] })).toBeNull();
    expect(apiMismatch({ name: 'Laptop', peers: [] })).toContain('Restart/update the app');
    expect(apiMismatch({ api: SYNC_API - 1, name: 'Laptop', peers: [] })).toContain('Restart/update the app');
  });
});
