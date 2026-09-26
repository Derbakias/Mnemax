export type StreamId = 'position' | 'color' | 'number' | 'audio';

export const STREAM_IDS: StreamId[] = ['position', 'color', 'number', 'audio'];

export const STREAM_LABELS: Record<StreamId, string> = {
  position: 'Position',
  color: 'Color',
  number: 'Number',
  audio: 'Letter',
};

export interface TrialStimulus {  position: number;
  color: number;
  number: number;
  letter: string;
}

export type StreamOutcome = 'hit' | 'falseAlarm' | 'miss' | 'correctRejection';

export interface TrialRecord {
  index: number;
  stimulus: TrialStimulus;
  isMatch: Record<StreamId, boolean>;
  responded: Partial<Record<StreamId, boolean>>;
  outcome: Partial<Record<StreamId, StreamOutcome>>;
  responseTimesMs?: Partial<Record<StreamId, number>>;
}

export interface GameSettings {
  activeStreams: Record<StreamId, boolean>;
  nLevel: number;
  trialDurationMs: number;
  matchCounts: Record<StreamId, number>;
}

export interface RoundResult {
  id: string;
  finishedAt: number;
  settings: GameSettings;
  trials: TrialRecord[];
  durationMs?: number;
  /**
   * Set when the round ended before its last trial: stopped, or the app closed mid-round. `trials` holds
   * the ones played. A stopped round scores 0, so stopping a round that's going badly can't keep it out of
   * the stats.
   */
  stopped?: boolean;
}

export interface StreamScore {
  stream: StreamId;
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  accuracy: number;
}

export interface RoundSummary {
  overallAccuracy: number;
  scores: StreamScore[];
}
