// The words in the round tables and lists, on the Play and Stats screens. Change them here.
import type { ReactNode } from 'react';

import { TRIALS_PER_ROUND } from '@/config/game';
import type { StreamId, StreamOutcome } from '@/game/types';

export const roundsCopy = {
  /** Each stream's short name, heading its column in a round's trial table. */
  columns: {
    position: 'Pos',
    color: 'Col',
    number: 'Num',
    audio: 'Ltr',
  } satisfies Record<StreamId, string>,
  /** What each outcome is called, in the round tables' key. */
  outcomes: {
    hit: 'matched',
    correctRejection: 'no match',
    miss: 'missed',
    falseAlarm: 'false match',
  } satisfies Record<StreamOutcome, string>,
  /** At the end of the key. */
  legendNote: 'Small numbers are reaction times',
  detail: {
    /** Under a round's trial table. `trials` is the number played, or how far a stopped round got. */
    footer: (trials: ReactNode, n: number, ms: number) => (
      <>
        {trials} trials · N={n} · {ms} ms per trial
      </>
    ),
    /** `played`: the trials a stopped round got through. */
    stoppedAfter: (played: number) => `Stopped after ${played} of ${TRIALS_PER_ROUND}`,
  },
  summary: {
    /** On the last round's card when it was stopped early. */
    stopped: (played: number) => `Stopped after ${played} of ${TRIALS_PER_ROUND} trials, so this round scores 0.`,
  },
  history: {
    /** In a list row, after the date, when the round was stopped early. */
    stoppedAt: (played: number) => `· stopped at ${played}/${TRIALS_PER_ROUND}`,
    /** Shown instead of an empty list, unless the screen gives its own. */
    empty: 'Finish a round to see its detailed trial history here.',
  },
};
