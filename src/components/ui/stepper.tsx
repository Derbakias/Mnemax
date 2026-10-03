import { cn } from '@/lib/cn';

import { Icon } from './icon';

const styles = {
  button: [
    'flex size-11 items-center justify-center rounded-xl',
    'border border-background-selected bg-background-element',
    'disabled:opacity-35',
  ],
};

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
    <div className="flex items-center gap-4 data-[disabled=true]:opacity-45" data-disabled={disabled}>
      <button
        type="button"
        className={cn(styles.button)}
        aria-label="Decrease"
        disabled={!canDecrement}
        onClick={() => canDecrement && onChange(value - step)}
      >
        <Icon name="remove" size={20} />
      </button>
      <span className="t-subtitle min-w-14 text-center">{value}</span>
      <button
        type="button"
        className={cn(styles.button)}
        aria-label="Increase"
        disabled={!canIncrement}
        onClick={() => canIncrement && onChange(value + step)}
      >
        <Icon name="add" size={20} />
      </button>
    </div>
  );
}
