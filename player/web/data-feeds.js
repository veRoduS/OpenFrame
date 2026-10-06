let snapshots = {};
const listeners = new Set();
export function setDataFeedSnapshots(value) {
  snapshots = value || {};
  for (const listener of listeners) listener();
}
export const getDataFeedSnapshots = () => snapshots;
export function subscribeDataFeeds(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Shared SVG renderer: safe text nodes, bounded charts, no network calls or timers.
export function renderDataWidget(
  element,
  config = {},
  snapshot,
  color = '#202923',
  now = Date.now(),
) {
  const vertical =
    config.mode === 'progress' && config.orientation === 'vertical';
  const width = vertical ? 300 : 640,
    height = vertical ? 600 : 400;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  Object.assign(svg.style, {
    width: '100%',
    height: '100%',
    display: 'block',
    overflow: 'hidden',
  });
  const node = (tag, attrs = {}, text) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs))
      n.setAttribute(key, String(value));
    if (text !== undefined) n.textContent = String(text);
    svg.append(n);
    return n;
  };
  const label = (x, y, text, size = 22, anchor = 'start') =>
    node(
      'text',
      {
        x,
        y,
        fill: color,
        'font-size': Math.min(
          size,
          (width - 40) / Math.max(1, String(text).length * 0.58),
        ),
        'text-anchor': anchor,
      },
      text,
    );
  const format = (value) =>
    `${Number(value).toLocaleString('en-US', { minimumFractionDigits: config.decimals || 0, maximumFractionDigits: config.decimals || 0 })}${config.unit ? ` ${config.unit}` : ''}`;
  const title =
    config.title ||
    {
      metric: 'Metric',
      progress: 'Progress',
      line: 'Line graph',
      bar: 'Bar chart',
    }[config.mode] ||
    'Data';
  label(
    20,
    36,
    `${title}${['line', 'bar'].includes(config.mode) && config.unit ? ` (${config.unit})` : ''}`,
    28,
  );
  const value = snapshot?.data?.[config.field];
  const valid = ['metric', 'progress'].includes(config.mode)
    ? Number.isFinite(value)
    : Array.isArray(value) && value.length > 0;
  let description = title;
  if (!valid || snapshot?.status === 'unavailable') {
    const message =
      snapshot?.status === 'unavailable'
        ? 'Data unavailable'
        : 'Waiting for data';
    label(width / 2, height / 2, message, 28, 'middle');
    description += `. ${message}`;
  } else if (config.mode === 'metric') {
    label(width / 2, 220, format(value), 72, 'middle');
    description += `. ${format(value)}`;
  } else if (config.mode === 'progress') {
    const target = config.targetField
      ? snapshot.data[config.targetField]
      : config.target;
    if (!Number.isFinite(target) || target <= 0) {
      label(width / 2, height / 2, 'Target must be positive', 22, 'middle');
      description += '. Target must be positive';
    } else {
      const ratio = Math.max(0, Math.min(1, value / target));
      const x = vertical ? 105 : 30,
        y = vertical ? 80 : 125,
        w = vertical ? 90 : 580,
        h = vertical ? 350 : 65;
      node('rect', {
        x,
        y,
        width: w,
        height: h,
        rx: 10,
        fill: config.track || '#dce5df',
      });
      node('rect', {
        x,
        y: vertical ? y + h * (1 - ratio) : y,
        width: vertical ? w : w * ratio,
        height: vertical ? h * ratio : h,
        rx: 8,
        fill: config.accent || '#17613d',
      });
      label(
        width / 2,
        vertical ? 478 : 250,
        `${Math.round((value / target) * 100)}%`,
        48,
        'middle',
      );
      label(
        width / 2,
        vertical ? 520 : 300,
        `${format(value)} / ${format(target)}`,
        22,
        'middle',
      );
      description += `. ${format(value)} of ${format(target)}`;
    }
  } else {
    const points = value.slice(0, config.mode === 'line' ? 240 : 40);
    const left = 88,
      top = 75,
      right = 610,
      bottom = 315;
    const low = Math.min(0, ...points.map((p) => p.value));
    let high = Math.max(0, ...points.map((p) => p.value));
    if (low === high) high = low + 1;
    const y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top);
    for (let i = 0; i <= 4; i++) {
      const v = low + ((high - low) * i) / 4;
      node('line', {
        x1: left,
        y1: y(v),
        x2: right,
        y2: y(v),
        stroke: config.track || '#dce5df',
        'stroke-width': 1,
      });
      label(
        left - 8,
        y(v) + 5,
        Number(v).toLocaleString('en-US', {
          notation: 'compact',
          maximumFractionDigits: 1,
        }),
        14,
        'end',
      );
    }
    if (low < 0 && high > 0) {
      node('line', {
        x1: left,
        y1: y(0),
        x2: right,
        y2: y(0),
        stroke: color,
        'stroke-width': 1.5,
        opacity: 0.5,
      });
    }
    const accent = config.accent || '#17613d';
    if (config.mode === 'line') {
      const first = Date.parse(points[0].time),
        last = Date.parse(points.at(-1).time);
      const x = (p) =>
        first === last
          ? (left + right) / 2
          : left +
            ((Date.parse(p.time) - first) / (last - first)) * (right - left);
      node('polyline', {
        points: points.map((p) => `${x(p)},${y(p.value)}`).join(' '),
        fill: 'none',
        stroke: accent,
        'stroke-width': 4,
        'stroke-linejoin': 'round',
      });
      if (points.length === 1)
        node('circle', {
          cx: x(points[0]),
          cy: y(points[0].value),
          r: 5,
          fill: accent,
        });
      const date = (p) =>
        new Date(p.time).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      label(left, 340, date(points[0]), 14);
      label(right, 340, date(points.at(-1)), 14, 'end');
    } else {
      const step = (right - left) / points.length;
      const labelEvery = Math.max(1, Math.ceil(points.length / 8));
      points.forEach((p, i) => {
        const rect = node('rect', {
          x: left + i * step + step * 0.1,
          y: Math.min(y(0), y(p.value)),
          width: step * 0.8,
          height: Math.max(1, Math.abs(y(0) - y(p.value))),
          fill: accent,
        });
        const tooltip = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'title',
        );
        tooltip.textContent = `${p.label}: ${format(p.value)}`;
        rect.append(tooltip);
        if (i % labelEvery === 0)
          label(
            left + (i + 0.5) * step,
            340,
            p.label.length > 10 ? `${p.label.slice(0, 9)}…` : p.label,
            14,
            'middle',
          );
      });
    }
    description += `. ${points.length} values. Latest ${format(points.at(-1).value)}`;
  }
  if (config.showUpdated && snapshot?.updatedAt) {
    const minutes = Math.max(
      0,
      Math.floor((now - Date.parse(snapshot.updatedAt)) / 60000),
    );
    const stale = minutes >= (config.staleAfterMinutes || 60);
    label(
      20,
      height - 16,
      `${stale ? 'Stale · ' : ''}Updated ${minutes < 1 ? 'just now' : `${minutes} min ago`}`,
      16,
    );
  }
  svg.setAttribute('aria-label', description);
  element.replaceChildren(svg);
}
