/** The answer buttons' look (ResponseButtons). */
export const styles = {
  // The buttons share the height left under the grid (at least --buttons-min, set on the round's stage): two
  // per row, or one per row (data-layout). Lined up with the grid's edges, or the full width on phones.
  root: [
    'group grid min-h-(--buttons-min) flex-1 auto-rows-[1fr] grid-cols-[1fr_1fr] gap-2.5',
    'w-(--stage-grid) self-center max-[600px]:w-full',
    'data-[layout=rows]:grid-cols-[1fr]',
    // Two per row: a lone button in the last row spans both columns.
    'data-[layout=grid]:[&>button:last-of-type:nth-of-type(odd)]:col-span-full',
    // Big windows: the buttons stop growing at a comfortable size, the spare height left at the bottom.
    'min-[600px]:max-h-[max(var(--buttons-min),320px)]',
    // Swipe to answer: the page doesn't scroll under the finger.
    'data-[swipe=true]:relative data-[swipe=true]:touch-none',
  ],
  // The swipe's path, drawn over the buttons in the canvas's CSS colour (see trail.ts).
  trail: ['pointer-events-none absolute inset-0 z-1 size-full', 'text-swipe-trail opacity-85'],
  button: [
    'relative flex min-h-0 flex-col items-center justify-center gap-1.5 rounded-[14px] px-3 py-2.5 text-text',
    // One per row: the label beside the icon.
    'group-data-[layout=rows]:flex-row group-data-[layout=rows]:gap-3',
    // Like the grid: at rest the buttons lie almost flat, as the empty tiles do.
    '[background:linear-gradient(160deg,var(--color-tile-top)_20%,var(--color-tile-bottom))]',
    'shadow-[inset_0_-6px_10px_-8px_var(--color-tile-inner-shade),var(--shadow-tile-rest)]',
    // Settles back quicker than it rises.
    '[transition:transform_0.09s_ease-in,box-shadow_0.09s_ease-in] motion-reduce:transition-none',
    // One icon size whatever the number of buttons, so they don't balloon when only one or two are on.
    '[&_.icon]:size-7 [&_.icon]:text-accent',
    // Answers come from the keys, so no focus ring. Faded while answers are closed (warm-up, paused).
    'focus-visible:outline-none disabled:opacity-40',
    // Held down (see ResponseButtons): a slight give.
    'data-[held=true]:transform-[scale(0.99)]',
    // Once pressed, until the trial ends: blue when it was a match, red when it wasn't, with white on it. The
    // colour changes in place, with no rise or deep shadow, which drew the eye away from the grid on every press.
    'data-[result]:text-on-accent data-[result]:[&_.icon]:text-on-accent',
    'data-[result=correct]:bg-[linear-gradient(160deg,color-mix(in_srgb,var(--color-accent-fill)_80%,var(--color-light))_0%,var(--color-accent-fill)_60%)]',
    'data-[result=correct]:shadow-[inset_0_-6px_10px_-8px_var(--color-accent-strong),var(--shadow-tile-rest)]',
    'data-[result=wrong]:bg-[linear-gradient(160deg,color-mix(in_srgb,var(--color-wrong)_80%,var(--color-light))_0%,var(--color-wrong)_60%)]',
    'data-[result=wrong]:shadow-[inset_0_-6px_10px_-8px_var(--color-wrong-strong),var(--shadow-tile-rest)]',
    // Tutorial: a button that should be pressed this trial, outlined in the blue a right answer fills with.
    // Inset, so the button doesn't change size.
    'data-[solution=true]:shadow-[inset_0_0_0_2px_var(--color-accent-fill),inset_0_-6px_10px_-8px_var(--color-tile-inner-shade),var(--shadow-tile-rest)]',
  ],
  // One per row: every label takes the width of the longest ("Position"), left-aligned, so the icon and label
  // group is the same width on every button and the icons line up one above the other.
  label: 'group-data-[layout=rows]:min-w-[4.6em] group-data-[layout=rows]:text-left',
  // The answer key, in the corner. Only on devices with a real keyboard and mouse.
  keyHint: [
    'absolute top-1.5 right-2 hidden rounded-[4px] border border-current px-1 opacity-55',
    'font-mono text-[10px] leading-[14px]',
    '[@media(hover:hover)_and_(pointer:fine)]:block',
  ],
};
