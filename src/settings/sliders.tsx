import type { StreamId } from '@/game/types';
import { STREAM_LABELS } from '@/game/types';

function Slider({
  value,
  min,
  max,
  step,
  onValueChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <input
      type="range"
      className="slider"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onValueChange(Number(e.target.value))}
    />
  );
}

export function MatchSlider({
  stream,
  value,
  cap,
  onChange,
}: {
  stream: StreamId;
  value: number;
  cap: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="match-block">
      <div className="row-between">
        <span className="t-default">{STREAM_LABELS[stream]}</span>
        <span className="t-code">{value}</span>
      </div>
      <Slider value={value} min={0} max={cap} step={1} onValueChange={onChange} />
    </div>
  );
}
