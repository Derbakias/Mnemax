import {
  appendRound,
  clearRoundInProgress,
  clearRounds,
  loadRounds,
  recoverRoundInProgress,
  saveRoundInProgress,
} from '../storage';
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

function sampleRound(id: string): RoundResult {
  return {
    id,
    finishedAt: 1755900000000 + id.length,
    settings: {
      activeStreams: { position: true, color: false, number: false, audio: true },
      nLevel: 2,
      speed: 'normal',
      trialDurationMs: 2000,
      matchCounts: { position: 6, color: 6, number: 6, audio: 6 },
    },
    trials: [],
  };
}

describe('storage', () => {
  beforeEach(() => {
    mockMemory.clear();
  });

  it('starts with an empty history', async () => {
    await expect(loadRounds()).resolves.toEqual([]);
  });

  it('persists rounds newest-first and reloads them intact', async () => {
    await appendRound(sampleRound('a'));
    await appendRound(sampleRound('bb'));

    const rounds = await loadRounds();
    expect(rounds.map((r) => r.id)).toEqual(['bb', 'a']);
    expect(rounds[0].settings.nLevel).toBe(2);
    expect(rounds[0].settings.activeStreams.position).toBe(true);
    expect(rounds[0].settings.trialDurationMs).toBe(2000);
  });

  it('caps the stored history at 500 rounds', async () => {
    for (let i = 0; i < 505; i++) {
      await appendRound(sampleRound(`r${i}`));
    }
    const rounds = await loadRounds();
    expect(rounds.length).toBe(500);
    expect(rounds[0].id).toBe('r504');
  });

  it('clears the history', async () => {
    await appendRound(sampleRound('a'));
    await clearRounds();
    await expect(loadRounds()).resolves.toEqual([]);
  });

  it('records a round left unfinished by the last run as stopped, once', async () => {
    await saveRoundInProgress({ ...sampleRound('unfinished'), stopped: true });
    await recoverRoundInProgress();
    const rounds = await loadRounds();
    expect(rounds.map((r) => [r.id, r.stopped])).toEqual([['unfinished', true]]);

    await recoverRoundInProgress();
    expect((await loadRounds()).length).toBe(1);
  });

  it("doesn't duplicate a round that was saved before its progress was cleared", async () => {
    const finished = sampleRound('done');
    await saveRoundInProgress({ ...finished, stopped: true });
    await appendRound(finished);
    await recoverRoundInProgress();
    const rounds = await loadRounds();
    expect(rounds.map((r) => [r.id, r.stopped])).toEqual([['done', undefined]]);
  });

  it('has nothing to recover after a round ends normally', async () => {
    await saveRoundInProgress({ ...sampleRound('x'), stopped: true });
    await clearRoundInProgress();
    await recoverRoundInProgress();
    await expect(loadRounds()).resolves.toEqual([]);
  });
});
