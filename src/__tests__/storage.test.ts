import {
  appendRound,
  clearRoundInProgress,
  clearRounds,
  loadRounds,
  mergeRounds,
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

  describe('mergeRounds', () => {
    const at = (id: string, finishedAt: number): RoundResult => ({ ...sampleRound(id), finishedAt });

    it('adds the rounds from both devices, newest first', async () => {
      // Yesterday on the desktop, today on the phone.
      await appendRound(at('desktop-1', 1000));
      await appendRound(at('desktop-2', 2000));
      const { added } = await mergeRounds([at('phone-2', 4000), at('phone-1', 3000)]);
      expect(added).toBe(2);
      expect((await loadRounds()).map((r) => r.id)).toEqual(['phone-2', 'phone-1', 'desktop-2', 'desktop-1']);
    });

    it('adds nothing the second time', async () => {
      await mergeRounds([at('a', 1000)]);
      await expect(mergeRounds([at('a', 1000)])).resolves.toEqual({ added: 0 });
      expect((await loadRounds()).length).toBe(1);
    });

    it('never changes a saved round', async () => {
      await appendRound(at('a', 1000));
      await mergeRounds([{ ...at('a', 1000), stopped: true, trials: [] }]);
      expect(await loadRounds()).toEqual([at('a', 1000)]);
    });

    it('keeps the first of two incoming rounds with one id', async () => {
      const { added } = await mergeRounds([at('a', 2000), at('a', 1000)]);
      expect(added).toBe(1);
      expect((await loadRounds()).map((r) => r.finishedAt)).toEqual([2000]);
    });

    it('ends with the same rounds whichever device merges', async () => {
      const desktop = [at('d1', 1000), at('same-b', 5000), at('d2', 3000)];
      const phone = [at('p1', 2000), at('same-a', 5000), at('p2', 4000)];

      await mergeRounds(desktop);
      await mergeRounds(phone);
      const desktopFirst = await loadRounds();
      mockMemory.clear();
      await mergeRounds(phone);
      await mergeRounds(desktop);

      expect(await loadRounds()).toEqual(desktopFirst);
      expect(desktopFirst.map((r) => r.id)).toEqual(['same-a', 'same-b', 'p2', 'd2', 'p1', 'd1']);
    });

    it('keeps the same newest 500 on both devices, ties broken by id', async () => {
      // 499 newer rounds, then two that finished at the same moment: only one of them fits.
      const newer = Array.from({ length: 499 }, (_, i) => at(`n${i}`, 10_000 + i));
      await mergeRounds([...newer, at('tie-b', 5000)]);
      await mergeRounds([at('tie-a', 5000)]);
      const one = await loadRounds();
      mockMemory.clear();
      await mergeRounds([...newer, at('tie-a', 5000)]);
      await mergeRounds([at('tie-b', 5000)]);
      const other = await loadRounds();

      expect(one.length).toBe(500);
      expect(other).toEqual(one);
      expect(one[499].id).toBe('tie-a');
    });

    it('counts only the rounds it kept', async () => {
      await mergeRounds(Array.from({ length: 500 }, (_, i) => at(`n${i}`, 10_000 + i)));
      await expect(mergeRounds([at('old', 1000)])).resolves.toEqual({ added: 0 });
      expect((await loadRounds()).some((r) => r.id === 'old')).toBe(false);
    });

    it('loses nothing when a round ends while a sync saves', async () => {
      await Promise.all([mergeRounds([at('from-phone', 1000)]), appendRound(at('just-played', 2000))]);
      expect((await loadRounds()).map((r) => r.id)).toEqual(['just-played', 'from-phone']);
    });
  });
});
