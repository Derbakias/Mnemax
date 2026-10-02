import type { ButtonLayout } from '@/lib/prefs';

// A thumbnail of the play screen for each button layout: the 3x3 grid with the answer buttons under it.
export function LayoutPreview({ layout }: { layout: ButtonLayout }) {
  const cell = 7;
  const gap = 1.5;
  const gridSize = cell * 3 + gap * 2;
  const gridX = (60 - gridSize) / 2;

  const cells = [];
  for (let i = 0; i < 9; i++) {
    if (i === 4) {
      continue;
    }
    cells.push(
      <rect
        key={i}
        x={gridX + (i % 3) * (cell + gap)}
        y={Math.floor(i / 3) * (cell + gap)}
        width={cell}
        height={cell}
        rx={1.5}
        fillOpacity={0.3}
      />,
    );
  }

  const buttons =
    layout === 'grid'
      ? [0, 1].map((i) => <rect key={i} x={8 + i * 23} y={28} width={21} height={11} rx={2} />)
      : [0, 1].map((i) => <rect key={i} x={8} y={28 + i * 9} width={44} height={7} rx={2} />);

  return (
    <svg className="layout-preview" viewBox="0 0 60 44" width={60} height={44} aria-hidden fill="currentColor">
      {cells}
      <g fillOpacity={0.55}>{buttons}</g>
    </svg>
  );
}
