import { COLOR_PALETTE, NEUTRAL_COLOR, OUTCOME_GLYPHS, TRIALS_PER_ROUND } from '@/game/config';
import type { RoundResult, StreamOutcome } from '@/game/types';
import { STREAM_IDS } from '@/game/types';

const OUTCOME_CLASS: Record<StreamOutcome, string> = {
  hit: 'good',
  falseAlarm: 'bad',
  miss: 'bad',
  correctRejection: 'good',
};

const OUTCOME_COL_LABEL: Record<string, string> = {
  position: 'Pos',
  color: 'Col',
  number: 'Num',
  audio: 'Ltr',
};

/** `legend`: show the key to the outcome symbols; lists of rounds turn it off and show `OutcomeLegend` once. */
export function RoundDetailTable({ result, legend = true }: { result: RoundResult; legend?: boolean }) {
  const s = result.settings;
  const showNumberCol = s.activeStreams.number;
  const showColorCol = s.activeStreams.color;
  const activeCols = STREAM_IDS.filter((stream) => s.activeStreams[stream]);

  return (
    <div className="detail-table">
      <div className="h-scroll">
        <table>
          <thead>
            <tr>
              <th className="c-idx">#</th>
              <th className="c-pos">Cell</th>
              {showColorCol && <th className="c-color">Color</th>}
              {showNumberCol && <th className="c-num">Digit</th>}
              {s.activeStreams.audio && <th className="c-letter">Ltr</th>}
              {activeCols.map((stream) => (
                <th key={stream} className="c-outcome">
                  {OUTCOME_COL_LABEL[stream]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.trials.map((trial) => {
              const color = showColorCol ? COLOR_PALETTE[trial.stimulus.color % COLOR_PALETTE.length] : NEUTRAL_COLOR;
              return (
                <tr key={trial.index}>
                  <td>{String(trial.index + 1).padStart(2, '0')}</td>
                  <td>{trial.stimulus.position + 1}</td>
                  {showColorCol && (
                    <td>
                      <span className="table-swatch" style={{ backgroundColor: color }} />
                    </td>
                  )}
                  {showNumberCol && <td>{trial.stimulus.number}</td>}
                  {s.activeStreams.audio && <td>{trial.stimulus.letter}</td>}
                  {activeCols.map((stream) => {
                    const outcome = trial.outcome[stream];
                    const rt = trial.responseTimesMs?.[stream];
                    return (
                      <td key={stream}>
                        <div className={outcome ? OUTCOME_CLASS[outcome] : undefined}>
                          {outcome ? OUTCOME_GLYPHS[outcome] : ''}
                        </div>
                        {rt != null && <div className="rt">{Math.round(rt)}</div>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="t-small secondary">
        {result.stopped ? `Stopped after ${result.trials.length} of ${TRIALS_PER_ROUND}` : TRIALS_PER_ROUND} trials ·
        N={s.nLevel} · {Math.round(s.trialDurationMs)} ms per trial
      </p>
      {legend && <OutcomeLegend />}
    </div>
  );
}

/** What the symbols in a round's table mean; `inline` lays it out on one wrapping line. */
export function OutcomeLegend({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? 'legend-list inline' : 'legend-list'}>
      <LegendItem glyph="✓" label="matched" good />
      <LegendItem glyph="〇" label="no match" good />
      <LegendItem glyph="✕" label="missed" />
      <LegendItem glyph="■" label="false match" />
      <span className="t-small secondary legend-note">Small numbers are reaction times in ms</span>
    </div>
  );
}

function LegendItem({ glyph, label, good = false }: { glyph: string; label: string; good?: boolean }) {
  return (
    <div className="legend-item">
      <span className={`t-code ${good ? 'good' : 'bad'}`}>{glyph}</span>
      <span className="t-small secondary">{label}</span>
    </div>
  );
}
