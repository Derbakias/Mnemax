import type uPlot from 'uplot';

/**
 * A magnetic crosshair (`cursor.move`): the vertical line jumps to the nearest data point on x, and the
 * horizontal line to whichever visible series value there is closest to the pointer.
 */
export const snapToNearestPoint: uPlot.Cursor.MousePosRefiner = (u, left, top) => {
  if (left < 0) {
    return [left, top];
  }
  const idx = u.posToIdx(left);
  const x = u.data[0][idx];
  if (x == null) {
    return [left, top];
  }
  let bestTop = top;
  let bestDistance = Infinity;
  u.series.forEach((series, i) => {
    if (i === 0 || !series.show) {
      return;
    }
    const value = (u.data[i] as (number | null | undefined)[])[idx];
    if (value == null) {
      return;
    }
    const pos = u.valToPos(value, series.scale ?? 'y');
    if (Math.abs(pos - top) < bestDistance) {
      bestDistance = Math.abs(pos - top);
      bestTop = pos;
    }
  });
  return [u.valToPos(x, 'x'), bestTop];
};

export interface TooltipContent {
  title: string;
  rows: [label: string, value: string][];
}

/**
 * A floating tooltip that follows the cursor (or a tap) and shows details for the data point under it.
 * Charts using it usually hide uPlot's legend (`legend: { show: false }`). `render` also gets the chart, e.g.
 * to skip hidden series.
 */
export function tooltipPlugin(render: (idx: number, u: uPlot) => TooltipContent | null): uPlot.Plugin {
  let tip: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement('div');
        tip.className = 'chart-tooltip';
        tip.style.display = 'none';
        u.over.appendChild(tip);
      },
      setCursor: (u) => {
        if (!tip) {
          return;
        }
        const { idx, left, top } = u.cursor;
        const content = idx == null || left == null || left < 0 ? null : render(idx, u);
        if (!content || left == null) {
          tip.style.display = 'none';
          return;
        }
        const title = document.createElement('div');
        title.className = 'chart-tooltip-title';
        title.textContent = content.title;
        const rows = content.rows.map(([label, value]) => {
          const row = document.createElement('div');
          row.className = 'chart-tooltip-row';
          const l = document.createElement('span');
          l.textContent = label;
          const v = document.createElement('span');
          v.textContent = value;
          row.append(l, v);
          return row;
        });
        tip.replaceChildren(title, ...rows);
        tip.style.display = 'block';

        // Right of the cursor, or left of it near the right edge; vertically centred, kept inside.
        const width = u.over.clientWidth;
        const height = u.over.clientHeight;
        const x = left + 14 + tip.offsetWidth > width ? left - 14 - tip.offsetWidth : left + 14;
        const y = Math.min(Math.max(0, (top ?? 0) - tip.offsetHeight / 2), Math.max(0, height - tip.offsetHeight));
        tip.style.transform = `translate(${Math.max(0, x)}px, ${y}px)`;
      },
    },
  };
}
