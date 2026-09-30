import { loadRounds } from '../storage';
import { saveReceived } from '../sync';
import type { RoundResult } from '../game/types';

const mockMemory = new Map<string, string>();

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
