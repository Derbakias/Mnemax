import { COLOR_PALETTE, DIGITS, LETTERS, POSITION_CELLS, TRIALS_PER_ROUND, maxMatchesFor } from './config';
import type { GameSettings, StreamId, TrialStimulus } from './types';
import { STREAM_IDS } from './types';

type Cell = number | string;

function rand(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randomValue(stream: StreamId): Cell {
  switch (stream) {
    case 'position':
      return POSITION_CELLS[rand(POSITION_CELLS.length)];
    case 'color':
      return rand(COLOR_PALETTE.length);
    case 'number':
      return DIGITS[rand(DIGITS.length)];
    case 'audio':
      return LETTERS[rand(LETTERS.length)];
  }
}

function shuffledCandidates(n: number): number[] {
  const indices: number[] = [];
  for (let i = n; i < TRIALS_PER_ROUND; i++) {
    indices.push(i);
  }
  for (let i = indices.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function buildSequence(stream: StreamId, targetMatches: number, n: number): Cell[] {
  const cap = maxMatchesFor(n);
  const matchCount = Math.max(0, Math.min(targetMatches, cap));
  const matchIndices = new Set(shuffledCandidates(n).slice(0, matchCount));

  const sequence: Cell[] = [];
  for (let i = 0; i < TRIALS_PER_ROUND; i++) {
    if (i >= n && matchIndices.has(i)) {
      sequence.push(sequence[i - n]);
      continue;
    }
    let value = randomValue(stream);
    if (i >= n) {
      const back = sequence[i - n];
      let guard = 0;
      while (value === back && guard < 50) {
        value = randomValue(stream);
        guard++;
      }
    }
    sequence.push(value);
  }
  return sequence;
}

export interface GeneratedRound {
  stimuli: TrialStimulus[];
  isMatch: Record<StreamId, boolean[]>;
}

export function generateRound(settings: GameSettings): GeneratedRound {
  const n = settings.nLevel;
  const sequences = {} as Record<StreamId, Cell[]>;
  for (const stream of STREAM_IDS) {
    sequences[stream] = buildSequence(stream, settings.matchCounts[stream], n);
  }

  const stimuli: TrialStimulus[] = [];
  const isMatch: Record<StreamId, boolean[]> = { position: [], color: [], number: [], audio: [] };

  for (let i = 0; i < TRIALS_PER_ROUND; i++) {
    stimuli.push({
      position: sequences.position[i] as number,
      color: sequences.color[i] as number,
      number: sequences.number[i] as number,
      letter: sequences.audio[i] as string,
    });
    for (const stream of STREAM_IDS) {
      isMatch[stream].push(i >= n && sequences[stream][i] === sequences[stream][i - n]);
    }
  }

  return { stimuli, isMatch };
}
