import { useEffect, useState } from 'react';

import { startOfDay } from '@/stats/levels';

/** The start of today, which moves on at midnight (the Stats screen stays mounted). */
export function useToday(): number {
  const [today, setToday] = useState(() => startOfDay(Date.now()));
  useEffect(() => {
    const d = new Date(today);
    // The next midnight by the calendar, so a daylight-saving day (23 or 25 hours) still works. At least
    // `next`, in case the timer fires a moment early; later if the device slept through midnight.
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const timer = setTimeout(() => setToday(Math.max(next, startOfDay(Date.now()))), next - Date.now());
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}

/** The start of the first day of a range of `days` calendar days ending today (null: all time). */
export function rangeStart(today: number, days: number | null): number {
  if (days == null) {
    return -Infinity;
  }
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}
