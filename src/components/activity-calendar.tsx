import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { YearDropdown } from './year-dropdown';
import type { RoundResult } from '@/game/types';
import { DATE_LOCALE } from '@/stats';
import { useTheme } from '@/theme';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function countsByDayFor(rounds: RoundResult[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const round of rounds) {
    const key = dayKey(new Date(round.finishedAt));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function levelOpacity(count: number): number {
  if (count <= 1) return 0.25;
  if (count === 2) return 0.45;
  if (count <= 4) return 0.65;
  if (count <= 7) return 0.85;
  return 1;
}

// Made once: toLocaleDateString sets up a new formatter on every call, and every day of the year gets a label.
const DAY_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDay(date: Date): string {
  return DAY_FORMAT.format(date);
}

/** The weeks of `year` up to the one holding `today` (all of them for a past year). */
function buildYearWeeks(year: number, today: Date): Date[][] {
  const start = startOfWeek(new Date(year, 0, 1));
  const dec31 = new Date(year, 11, 31);
  const last = today < dec31 ? today : dec31;
  const totalDays = Math.round((last.getTime() - start.getTime()) / 86400000) + 1;
  const weekCount = Math.ceil(totalDays / 7);
  const weeks: Date[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const column: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      column.push(day);
    }
    weeks.push(column);
  }
  return weeks;
}

// Memoized: the Stats screen stays mounted and re-renders on every settings change, while its rounds don't.
export const ActivityCalendar = memo(function ActivityCalendar({ rounds }: { rounds: RoundResult[] }) {
  const theme = useTheme();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  // Only which day is picked (tap) or under the mouse; its label and count are read from the live data,
  // so they update as rounds are added. The hovered day wins while there is one.
  const [selected, setSelected] = useState<{ key: string; date: Date } | null>(null);
  const [hovered, setHovered] = useState<{ key: string; date: Date } | null>(null);
  const shown = hovered ?? selected;
  const canHover = useMemo(() => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false, []);

  const years = useMemo(() => {
    const set = new Set<number>([currentYear]);
    for (const round of rounds) {
      set.add(new Date(round.finishedAt).getFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }, [rounds, currentYear]);

  const { weeks, countsByDay, todayKey } = useMemo(
    () => ({
      weeks: buildYearWeeks(year, new Date()),
      countsByDay: countsByDayFor(rounds),
      todayKey: dayKey(new Date()),
    }),
    [rounds, year],
  );
  const shownCount = shown ? (countsByDay.get(shown.key) ?? 0) : 0;

  // Open scrolled to the end (the weeks stop at this one), so the latest weeks are in view; January is
  // rarely what you want to see. The stats load while their tab is hidden, when the strip has no width
  // yet, so this runs again whenever the strip is resized, until you scroll it yourself.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolled = useRef(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolled.current = false;
    const scrollToLatest = () => {
      if (userScrolled.current || el.clientWidth === 0) return;
      el.scrollLeft = el.scrollWidth;
    };
    scrollToLatest();
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(el);
    // Wheel, touch and drag scrolls are the user's; setting scrollLeft above doesn't fire these.
    const onUserScroll = () => {
      userScrolled.current = true;
    };
    el.addEventListener('wheel', onUserScroll, { passive: true });
    el.addEventListener('touchstart', onUserScroll, { passive: true });
    el.addEventListener('pointerdown', onUserScroll);
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onUserScroll);
      el.removeEventListener('touchstart', onUserScroll);
      el.removeEventListener('pointerdown', onUserScroll);
    };
  }, [weeks]);

  return (
    <div className="stack-8">
      <YearDropdown
        years={years}
        value={year}
        onChange={(y) => {
          setYear(y);
          setSelected(null);
          setHovered(null);
        }}
      />

      <div className="calendar-row">
        <div className="calendar-day-labels">
          {DAY_LETTERS.map((letter, i) => (
            <span key={`${letter}-${i}`} className="t-code secondary">
              {letter}
            </span>
          ))}
        </div>
        <div ref={scrollRef} className="calendar-scroll" onPointerLeave={() => setHovered(null)}>
          <div className="calendar-weeks">
            {weeks.map((week, wi) => (
              <div key={wi} className="calendar-week">
                {week.map((day) => {
                  const key = dayKey(day);
                  if (key > todayKey) {
                    return <span key={key} className="calendar-cell empty" />;
                  }
                  const count = countsByDay.get(key) ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="calendar-cell"
                      aria-label={`${formatDay(day)}: ${count} rounds`}
                      // Clicking pins the day; clicking the pinned day again unpins it.
                      onClick={() => setSelected((sel) => (sel?.key === key ? null : { key, date: day }))}
                      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered({ key, date: day })}
                      onPointerLeave={() => setHovered((h) => (h?.key === key ? null : h))}
                      style={{
                        backgroundColor: count > 0 ? theme.accent : theme.backgroundSelected,
                        opacity: count > 0 ? levelOpacity(count) : 1,
                        borderColor: shown?.key === key ? theme.text : undefined,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="calendar-footer">
        <span className="t-small secondary">
          {shown
            ? `${formatDay(shown.date)} · ${shownCount} ${shownCount === 1 ? 'round' : 'rounds'}`
            : canHover
              ? 'Hover over a day for details'
              : 'Tap a day for details'}
        </span>
        <div className="calendar-legend">
          <span className="t-small secondary">less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="calendar-cell legend"
              style={{
                backgroundColor: level === 0 ? theme.backgroundSelected : theme.accent,
                opacity: level === 0 ? 1 : levelOpacity(level),
              }}
            />
          ))}
          <span className="t-small secondary">more</span>
        </div>
      </div>
    </div>
  );
});
