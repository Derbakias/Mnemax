import { Icon } from './icon';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function Stepper({ value, min, max, step = 1, disabled = false, onChange }: StepperProps) {
  const canDecrement = !disabled && value - step >= min;
  const canIncrement = !disabled && value + step <= max;

  return (
    <div className={disabled ? 'stepper disabled' : 'stepper'}>
      <button
        type="button"
        className="stepper-button"
        aria-label="Decrease"
        disabled={!canDecrement}
        onClick={() => canDecrement && onChange(value - step)}>
        <Icon name="remove" size={20} />
      </button>
      <span className="t-subtitle stepper-value">{value}</span>
      <button
        type="button"
        className="stepper-button"
        aria-label="Increase"
        disabled={!canIncrement}
        onClick={() => canIncrement && onChange(value + step)}>
        <Icon name="add" size={20} />
      </button>
    </div>
  );
}
