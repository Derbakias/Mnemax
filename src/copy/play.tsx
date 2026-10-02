// The words on the Play screen: the chips' panels and tooltips, the start screen's notes and the round results.
// Change them here.

export const playCopy = {
  hud: {
    nLevel: {
      /** The heading in the chip's panel. */
      title: 'N-back level',
      /** The chip's tooltip. */
      chipTitle: (n: number) => `N-back level: ${n}`,
    },
    speed: {
      /** The chip's tooltip during a round. `label` is the speed's name, like "Normal". */
      chipTitle: (label: string) => `Speed: ${label}`,
      /** The chip's tooltip on the start screen, then each bolt's. `ms` is the time to answer. */
      pickerTitle: (label: string, ms: number) => `Speed: ${label} (${ms} ms to answer)`,
      boltTitle: (label: string, ms: number) => `${label} (${ms} ms to answer)`,
    },
    dailyTarget: {
      /** The chip's tooltip and the heading in its panel. */
      title: 'Daily target',
    },
    /** The tooltip on the tutorial button. */
    tutorialTitle: "Tutorial mode (rounds aren't saved)",
  },
  start: {
    /** Above the stream cards. */
    streamsLabel: 'Select active streams',
    /** A stream card's tooltip when it's the only one on. */
    lastStreamTitle: 'At least one stream stays on',
    /** Under the Play button in tutorial mode. */
    tutorialNote: (
      <>
        <p>Just for practice.</p>
        <p>This round won&apos;t count in the stats.</p>
      </>
    ),
  },
  /** Over the grid while the round is paused. */
  paused: 'Paused',
  results: {
    lastRound: 'Last round',
    thisSession: 'This session',
    /** Under This session until a second round is played. */
    sessionEmpty: 'Earlier rounds from this session will appear here.',
  },
};
