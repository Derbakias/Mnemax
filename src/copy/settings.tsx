// The words on the Settings screen: section titles, info text and the button layout names. Change them here.
import { Icon } from '@/components/ui/icon';
import { BLANK_MS, TRIALS_PER_ROUND } from '@/config/game';

export const settingsCopy = {
  streams: {
    title: 'Active streams',
    info: (
      <>
        <p>What you keep track of each trial. More streams is harder. At least one stays on.</p>
        <p>
          <strong>Letter</strong> is spoken aloud.
        </p>
      </>
    ),
  },
  nLevel: {
    title: 'N-back level',
    info: (
      <p>How far back to compare: each trial is checked against the one N trials before it. A higher N is harder.</p>
    ),
  },
  speed: {
    title: 'Trial speed',
    info: (
      <>
        <p>
          How long the box shows, which is the time you have to answer. Then the grid is blank for {BLANK_MS / 1000} s
          before the next one. Faster is harder.
        </p>
        <p>
          <strong>Trial timer:</strong> a bar at the top of the grid, under the progress, that fills up while you can
          answer.
        </p>
      </>
    ),
    /** The switch under the speeds. */
    timerSwitch: 'Show trial timer',
  },
  matches: {
    title: 'Matches per stream',
    /** `cap`: the most matches the current N allows. */
    info: (cap: number) => (
      <p>
        How many of the {TRIALS_PER_ROUND} trials in a round are a match, for each stream. The first N trials can't be
        matches, so the most is {TRIALS_PER_ROUND} − N ({cap} now).
      </p>
    ),
  },
  dailyTarget: {
    title: 'Daily target',
    info: (
      <p>How long you want to play each day. It shows at the top of the Play screen. Tutorial rounds don't count.</p>
    ),
    /** Next to the number of minutes. */
    unit: 'minutes per day',
  },
  tutorial: {
    title: 'Tutorial',
    info: (
      <>
        <p>
          Turn tutorial mode on with <Icon name="school-outline" size={16} /> on the Play screen. The round results
          aren't saved and don't count towards the daily target. One of the tutorial options should be always on.
        </p>
        <p>
          <strong>History:</strong> every trial from the one N back to the current one, just above the grid. The one N
          back is outlined when it matches the current trial.
        </p>
        <p>
          <strong>Solution:</strong> the answer buttons of the streams that match are outlined.
        </p>
      </>
    ),
    historySwitch: 'Show history',
    solutionSwitch: 'Show solution',
  },
  buttonLayout: {
    title: 'Button layout',
    info: (
      <>
        <p>Where the answer buttons sit on the Play screen.</p>
        <p>
          With two per row you can also swipe: press a button and slide over the others to answer them too. To answer
          two buttons corner to corner, slide straight through the middle.
        </p>
      </>
    ),
    /** The name under each layout's picture. */
    layouts: {
      grid: 'Two per row',
      rows: 'One per row',
    },
    swipeSwitch: 'Swipe',
  },
  keyboard: {
    title: 'Keyboard',
    info: (
      <>
        <p>
          <strong>Space</strong> starts, pauses and resumes a round. <strong>Esc</strong> stops it.
        </p>
        <p>To change a stream's key, click it, then press the new key.</p>
      </>
    ),
    /** Shown when a key can't be picked. `key` is the key pressed. */
    spaceTaken: 'Space is taken: it starts, pauses and resumes a round.',
    keyNotAllowed: (key: string) => `"${key}" can't be used. Pick a letter, digit, symbol or arrow key.`,
  },
  data: {
    title: 'Data',
    info: (
      <p>
        Save your rounds to a file, or load them from one (for example from another device). Rounds you already have
        aren't added twice.
      </p>
    ),
    /** Shown under the buttons after an export or import. `n` is a number of rounds. */
    nothingToExport: 'Nothing to export yet — play a round first.',
    exported: (n: number) => `Exported ${n} rounds.`,
    exportFailed: 'Export failed.',
    imported: (n: number) => `Imported ${n} new round${n === 1 ? '' : 's'}.`,
    nothingNew: 'No new rounds found.',
    skipped: (n: number) => `Skipped ${n} broken round${n === 1 ? '' : 's'}.`,
    importFailed: 'Import failed.',
  },
  reset: {
    /** Read out by screen readers after Reset to defaults. */
    done: 'Settings reset to defaults',
  },
};
