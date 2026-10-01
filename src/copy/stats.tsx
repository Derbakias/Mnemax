// The words on the Stats screen: section titles, info text and the notes under the charts. Change them here.
import { Icon } from '@/components/ui/icon';
import { ChartControlsTip } from '@/components/ui/info-tip';
import { LEVEL_WINDOW, MASTERY_ACCURACY, RECENT_ROUNDS } from '@/config/stats';

export const statsCopy = {
  /** Shown instead of the stats until a round has been saved. */
  empty: 'Play a few rounds to build up your stats.',
  /** Shown in a chart when its time range has no rounds. */
  noRoundsInRange: 'No rounds in this time range.',
  level: {
    title: 'Level',
    info: (
      <>
        <p>Your overall skill, comparable across every mode.</p>
        <p>
          Each round scores <strong>difficulty × accuracy</strong>. Harder settings are worth more: a higher N, more
          streams, a faster speed.
        </p>
        <p>For example, a perfect Position + Color 2-back at Normal speed scores 2.</p>
        <p>Your level is the average of your last {LEVEL_WINDOW} rounds.</p>
        <ChartControlsTip />
      </>
    ),
  },
  byMode: {
    title: 'By mode',
    info: (
      <>
        <p>
          A mode is one exact setup: <strong>N, streams and speed</strong>. Pick one to see how you're doing in it over
          time.
        </p>
        <p>
          <strong>Accuracy:</strong> 100% is perfect, 0% is no better than guessing.
        </p>
        <p>
          <strong>Reaction time:</strong> how quickly you press when you spot a match.
        </p>
        <p>
          <strong>Time to 100%:</strong> an estimate from how fast your accuracy has been rising. Progress slows as you
          get close to 100%, and the estimate allows for that.
        </p>
        <p>
          <strong>Matched:</strong> you pressed on a match. <strong>Missed:</strong> you didn't match.{' '}
          <strong>False:</strong> you pressed when there was no match.
        </p>
        <ChartControlsTip />
      </>
    ),
    /** The reaction time chart when the rounds in range caught no matches. */
    noReactionTimes: 'No reaction times yet. They come from the matches you catch.',
    // Under the accuracy chart: how far from 100%.
    reached: 'At 100%: time for a harder mode',
    noProgress: 'No clear progress toward 100% yet',
    /** `time` is the play time left, like "2h 15m". */
    toPerfect: (time: string) => `You need ~${time} playtime to reach 100%`,
    /** Under the reaction time chart. `change` is signed, like "+12" or "-8". */
    reactionTrend: (change: string) => `${change} ms per hour of play`,
  },
  modesPlayed: {
    title: 'Modes played',
    /** `starColor`: the colour of the mastered star in the table. */
    info: (starColor: string) => (
      <>
        <p>Every mode you've played, most recent first. Tap one to show it in By mode.</p>
        <p>
          <strong>Recent:</strong> your average accuracy over the last {RECENT_ROUNDS} rounds.
        </p>
        <p>
          <strong>Best:</strong> your best single round.
        </p>
        <p>
          <Icon name="star" size={14} color={starColor} /> <strong>Mastered:</strong> {MASTERY_ACCURACY}% or more
          recently. Time to try something harder.
        </p>
      </>
    ),
  },
  activity: {
    title: 'Activity',
    info: (
      <p>
        Each square is a day: the darker it is, the more rounds you played. Hover over or tap a day to see its count.
      </p>
    ),
    /** The weekday letters down the side of the calendar, Monday first. */
    dayLetters: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
    /** Under the calendar until a day is picked: with a mouse, then on a touch screen. */
    hoverHint: 'Hover over a day for details',
    tapHint: 'Tap a day for details',
  },
  timePlayed: {
    title: 'Time played vs level',
    info: (
      <>
        <p>
          <strong>Bars:</strong> minutes played each day.
        </p>
        <p>
          <strong>Dotted line:</strong> whether you're playing more or less over time.
        </p>
        <p>
          <strong>Solid line:</strong> your average level that day.
        </p>
        <ChartControlsTip />
      </>
    ),
    noPlayTime: 'No play time in this range.',
  },
  roundHistory: {
    title: 'Round history',
    info: (
      <p>
        Every round, newest first. Tap one to see each trial and how you answered it. Clearing deletes the rounds on
        this device only: a paired device sends them back at the next sync.
      </p>
    ),
    /** The clear button, then what it asks once tapped: on its own, or with a paired device. */
    clear: 'Clear history',
    confirmClear: 'Tap again to clear',
    confirmClearPaired: 'Tap again (paired devices send them back)',
  },
};
