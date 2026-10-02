import { COUNT_UNITS } from '@/config/stats';

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * A count in at most four characters, for narrow table columns: 999, 1.2K, 12K, 999K, 1.2M. One decimal
 * below 10 of a unit, whole numbers above; a value that rounds up to 1000 of a unit moves to the next.
 */
export function formatCount(n: number): string {
  if (Math.abs(n) < 1000) {
    return String(Math.round(n));
  }
  for (let i = 0; i < COUNT_UNITS.length; i++) {
    const [suffix, size] = COUNT_UNITS[i];
    const x = n / size;
    const rounded = Math.abs(x) < 10 ? Math.round(x * 10) / 10 : Math.round(x);
    if (Math.abs(rounded) < 1000 || i === COUNT_UNITS.length - 1) {
      return `${rounded}${suffix}`;
    }
  }
  return String(n);
}
