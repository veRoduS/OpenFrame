const NS = 'http://www.w3.org/2000/svg';
const BLUE = '#0053E2',
  NAVY = '#001E60',
  SKY = '#A9DDF7',
  YELLOW = '#FFC220';
let cardSequence = 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clean = (value, limit) =>
  typeof value === 'string' ? value.slice(0, limit) : '';

// Conservative text measurement keeps untrusted labels inside their allotted space
// without layout reads, external fonts, observers, or a second render pass.
function textWidth(text, size) {
  return (
    Array.from(String(text)).reduce(
      (width, char) =>
        width +
        (/^[MW@%]$/.test(char)
          ? 0.9
          : /^[ilI1.,: '-]$/.test(char)
            ? 0.34
            : char.charCodeAt(0) > 255
              ? 1
              : 0.64),
      0,
    ) * size
  );
}
function ellipsis(text, width, size, spacing = 0) {
  const chars = Array.from(String(text));
  if (textWidth(text, size) + Math.max(0, chars.length - 1) * spacing <= width)
    return String(text);
  while (
    chars.length &&
    textWidth(`${chars.join('')}…`, size) + chars.length * spacing > width
  )
    chars.pop();
  return chars.length ? `${chars.join('')}…` : '';
}

// One bounded, self-contained SVG shared by the editor, Pi and Android players.
export function renderDataCard(
  element,
  config = {},
  snapshot,
  now = Date.now(),
) {
  const card = config.card || {};
  const measuredWidth = element.clientWidth || 320,
    measuredHeight = element.clientHeight || 232;
  // A short, wide tile gets a wider design canvas instead of shrinking the body
  // beneath the header. Both dimensions preserve the layer's exact aspect ratio.
  const scale = Math.min(measuredWidth / 320, measuredHeight / 220);
  const width = measuredWidth / scale,
    height = measuredHeight / scale;
  const id = `data-card-${++cardSequence}`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('data-card-style', 'split');
  svg.setAttribute('data-card-mode', config.mode || 'metric');
  Object.assign(svg.style, {
    width: '100%',
    height: '100%',
    display: 'block',
    overflow: 'hidden',
  });
  const node = (parent, tag, attrs = {}, text) => {
    const child = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs))
      child.setAttribute(key, String(value));
    if (text !== undefined) child.textContent = String(text);
    parent.append(child);
    return child;
  };
  const label = (
    parent,
    x,
    y,
    text,
    size = 12,
    maxWidth = width - 32,
    attrs = {},
  ) =>
    node(
      parent,
      'text',
      {
        x,
        y,
        fill: NAVY,
        'font-family': 'Arial, Helvetica, sans-serif',
        'font-size': size,
        'font-weight': 800,
        ...attrs,
      },
      ellipsis(text, maxWidth, size, Number(attrs['letter-spacing']) || 0),
    );
  const wrap = (parent, x, y, text, maxWidth, size = 12, lines = 2) => {
    let rest = clean(text, 100).trim();
    for (let i = 0; i < lines && rest; i++) {
      if (i === lines - 1 || textWidth(rest, size) <= maxWidth) {
        label(parent, x, y + i * (size + 5), rest, size, maxWidth);
        break;
      }
      let count = 1;
      while (
        count < rest.length &&
        textWidth(rest.slice(0, count + 1), size) <= maxWidth
      )
        count++;
      const space = rest.lastIndexOf(' ', count);
      if (space > count / 2) count = space;
      label(
        parent,
        x,
        y + i * (size + 5),
        rest.slice(0, count),
        size,
        maxWidth,
      );
      rest = rest.slice(count).trim();
    }
  };
  const decimals = Number.isInteger(config.decimals)
    ? clamp(config.decimals, 0, 4)
    : 0;
  const prefix = clean(card.prefix, 8),
    unit = clean(config.unit, 20).trim();
  const number = (value) =>
    value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  const formatted = (value) =>
    `${prefix}${number(value)}${unit ? `${/^(?:%|[kmbt])$/i.test(unit) ? '' : ' '}${unit}` : ''}`;
  const deltaFormat = (value) =>
    `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${clean(card.deltaUnit ?? '%', 12)}`;
  const available = snapshot?.status !== 'unavailable';
  const rawValue = snapshot?.data?.[config.field];
  const points = Array.isArray(rawValue)
    ? rawValue
        .slice(0, config.mode === 'line' ? 240 : 40)
        .filter(
          (point) =>
            point &&
            Number.isFinite(point.value) &&
            (config.mode === 'line'
              ? Number.isFinite(Date.parse(point.time))
              : typeof point.label === 'string'),
        )
    : [];
  const valid =
    available &&
    (['metric', 'progress'].includes(config.mode)
      ? Number.isFinite(rawValue)
      : points.length > 0);
  const title =
    clean(config.title, 80) ||
    {
      metric: 'Metric',
      progress: 'Progress',
      line: 'Line graph',
      bar: 'Bar chart',
    }[config.mode] ||
    'Data';
  let description = title;
  let delta = '';
  if (valid && (card.badge === 'delta' || config.mode === 'metric')) {
    delta = card.deltaField
      ? Number.isFinite(snapshot?.data?.[card.deltaField])
        ? deltaFormat(snapshot.data[card.deltaField])
        : ''
      : clean(card.deltaText, 32);
  }
  const defs = node(svg, 'defs');
  const clip = node(defs, 'clipPath', { id: `${id}-clip` });
  node(clip, 'rect', { width, height, rx: 16 });
  const surface = node(svg, 'g', { 'clip-path': `url(#${id}-clip)` });
  const secondary = config.mode === 'bar';
  node(surface, 'rect', {
    width,
    height,
    fill: secondary ? 'rgba(169,221,247,0.25)' : '#FFFFFF',
  });
  const headerHeight = 42;
  node(surface, 'rect', {
    width,
    height: headerHeight,
    fill: card.header === 'navy' ? NAVY : BLUE,
    'data-card-part': 'header',
  });
  const pill = (
    parent,
    right,
    cy,
    text,
    maxWidth,
    part = 'delta',
    fontSize = 12,
    pillHeight = 24,
  ) => {
    const display = ellipsis(text, Math.max(0, maxWidth - 18), fontSize);
    const pillWidth = Math.min(maxWidth, textWidth(display, fontSize) + 18);
    const group = node(parent, 'g', { 'data-card-part': part });
    node(group, 'rect', {
      x: right - pillWidth,
      y: cy - pillHeight / 2,
      width: pillWidth,
      height: pillHeight,
      rx: pillHeight / 2,
      fill: YELLOW,
    });
    label(
      group,
      right - pillWidth / 2,
      cy + fontSize * 0.35,
      display,
      fontSize,
      pillWidth - 12,
      { 'text-anchor': 'middle' },
    );
    return pillWidth;
  };
  let focalWidth = 0;
  if (card.badge === 'delta' && delta)
    focalWidth =
      pill(surface, width - 16, 21, delta, Math.min(125, width * 0.4)) + 10;
  else if (card.badge === 'spark') {
    const spark = node(surface, 'g', {
      transform: `translate(${width - 26} 21)`,
      'data-card-part': 'spark',
      'aria-hidden': 'true',
    });
    for (let angle = 0; angle < 360; angle += 60)
      node(spark, 'path', {
        d: 'M -1.2 -4.5 L -1.8 -9.5 Q 0 -10.5 1.8 -9.5 L 1.2 -4.5 Z',
        transform: `rotate(${angle})`,
        fill: YELLOW,
      });
    focalWidth = 28;
  }
  label(surface, 16, 26, title.toUpperCase(), 12, width - 32 - focalWidth, {
    fill: card.header === 'navy' ? SKY : '#FFFFFF',
    'letter-spacing': '0.6',
    'data-card-part': 'title',
  });

  let updated = '';
  const updatedTime = Date.parse(snapshot?.updatedAt);
  if (config.showUpdated && Number.isFinite(updatedTime)) {
    const minutes = Math.max(0, Math.floor((now - updatedTime) / 60000));
    updated = `${minutes >= (config.staleAfterMinutes || 60) ? 'Stale · ' : ''}Updated ${minutes < 1 ? 'just now' : `${minutes} min ago`}`;
  }
  const footer = clean(card.footer, 80),
    footerRight = clean(card.footerRight, 40);
  const footerHeight =
    footer || footerRight ? (updated ? 44 : 30) : updated ? 28 : 0;
  const bodyTop = headerHeight + 16,
    bodyBottom = height - footerHeight - 16;
  const bodyHeight = bodyBottom - bodyTop,
    bodyWidth = width - 32;

  const lockup = (
    parent,
    x,
    baseline,
    value,
    maxWidth,
    fontSize = 48,
    part = 'value',
    anchor = 'start',
  ) => {
    const parts = [
      { text: prefix, small: true },
      { text: number(value), small: false },
      { text: unit, small: true },
    ].filter((p) => p.text);
    const naturalWidth =
      parts.reduce(
        (sum, p) => sum + textWidth(p.text, fontSize * (p.small ? 0.46 : 1)),
        0,
      ) +
      (parts.length - 1);
    const factor = Math.min(1, maxWidth / Math.max(1, naturalWidth));
    const actualWidth = naturalWidth * factor;
    const group = node(parent, 'g', {
      'data-card-part': part,
      'aria-label': formatted(value),
    });
    // Let SVG place adjacent spans using the actual font advances. Estimated
    // widths remain useful for fitting, but leave visible gaps between runs.
    const text = node(group, 'text', {
      x,
      y: baseline,
      fill: NAVY,
      'font-family': 'Arial, Helvetica, sans-serif',
      'font-weight': 900,
      'font-size': fontSize * factor,
      'text-anchor': anchor,
    });
    for (const [index, p] of parts.entries()) {
      const size = fontSize * factor * (p.small ? 0.46 : 1);
      node(
        text,
        'tspan',
        {
          'font-size': size,
          'baseline-shift': p.small ? fontSize * factor * 0.39 : 0,
          dx: index ? factor : 0,
        },
        p.text,
      );
    }
    return actualWidth;
  };

  if (!valid) {
    const message = available ? 'Waiting for data' : 'Data unavailable';
    label(
      surface,
      width / 2,
      (bodyTop + bodyBottom) / 2 + 5,
      message,
      16,
      bodyWidth,
      { 'text-anchor': 'middle', 'data-card-part': 'status' },
    );
    description += `. ${message}`;
  } else if (config.mode === 'metric') {
    const bodyDelta = card.badge !== 'delta' && delta;
    const deltaWidth = bodyDelta ? Math.min(125, bodyWidth * 0.44) : 0;
    const baseline = bodyTop + bodyHeight / 2 + (card.subtitle ? 5 : 16);
    lockup(
      surface,
      16,
      baseline,
      rawValue,
      bodyWidth - (bodyDelta ? deltaWidth + 12 : 0),
    );
    if (bodyDelta) pill(surface, width - 16, baseline - 17, delta, deltaWidth);
    if (card.subtitle)
      wrap(
        surface,
        16,
        baseline + 24,
        card.subtitle,
        bodyWidth,
        12,
        Math.max(1, Math.min(2, Math.floor((bodyBottom - baseline - 18) / 17))),
      );
    description += `. ${formatted(rawValue)}`;
  } else if (config.mode === 'progress') {
    const stacked = bodyHeight > bodyWidth * 1.1;
    const radius = Math.min(
      stacked ? 86 : 51,
      bodyHeight / (stacked ? 3.4 : 2) - 6,
    );
    const cx = stacked ? width / 2 : 16 + radius + 6;
    const cy = stacked ? bodyTop + bodyHeight * 0.38 : bodyTop + bodyHeight / 2;
    const scaleMax =
      Number.isFinite(card.scaleMax) && card.scaleMax > 0 ? card.scaleMax : 100;
    const ratio = clamp(rawValue / scaleMax, 0, 1);
    const circle = { cx, cy, r: radius, fill: 'none', 'stroke-width': 12 };
    node(surface, 'circle', { ...circle, stroke: '#E8EEF5' });
    node(surface, 'circle', {
      ...circle,
      stroke: BLUE,
      pathLength: 100,
      'stroke-dasharray': `${ratio * 100} 100`,
      'stroke-linecap': ratio ? 'round' : 'butt',
      transform: `rotate(-90 ${cx} ${cy})`,
      'data-card-part': 'gauge-arc',
      'data-ratio': ratio,
    });
    lockup(
      surface,
      cx,
      cy + 1,
      rawValue,
      radius * 1.65,
      Math.min(38, radius * 0.57),
      'value',
      'middle',
    );
    label(surface, cx, cy + 18, 'SCORE', 9, radius * 1.6, {
      'text-anchor': 'middle',
      'letter-spacing': '1',
    });
    const goalX = stacked ? 16 : cx + radius + 20;
    const goalWidth = stacked ? bodyWidth : width - goalX - 16;
    const goalY = stacked ? cy + radius + 32 : cy - (card.subtitle ? 14 : 0);
    const target = config.targetField
      ? snapshot.data[config.targetField]
      : config.target;
    const goal =
      Number.isFinite(target) && target > 0
        ? `Goal: ${formatted(target)}`
        : 'Goal unavailable';
    node(surface, 'rect', {
      x: goalX,
      y: goalY - 15,
      width: goalWidth,
      height: 28,
      rx: 9,
      fill: 'rgba(169,221,247,0.35)',
    });
    label(surface, goalX + 10, goalY + 4, goal, 12, goalWidth - 20, {
      'data-card-part': 'goal',
    });
    if (card.subtitle)
      wrap(
        surface,
        goalX,
        goalY + 32,
        card.subtitle,
        goalWidth,
        12,
        Math.max(1, Math.min(3, Math.floor((bodyBottom - goalY - 28) / 17))),
      );
    description += `. ${formatted(rawValue)}. ${goal}. Scale maximum ${scaleMax}`;
  } else if (config.mode === 'line') {
    const latest = points.at(-1);
    const compact = bodyHeight < 125;
    const valueSize = compact ? 30 : 36;
    const valueWidth = lockup(
      surface,
      16,
      bodyTop + valueSize * 0.92,
      latest.value,
      card.subtitle ? bodyWidth * 0.55 : bodyWidth,
      valueSize,
    );
    if (card.subtitle)
      label(
        surface,
        width - 16,
        bodyTop + valueSize * 0.92,
        clean(card.subtitle, 100),
        11,
        bodyWidth - valueWidth - 12,
        { 'text-anchor': 'end' },
      );
    const top = bodyTop + Math.min(54, bodyHeight - 32),
      bottom = bodyBottom - 19;
    let low = Math.min(...points.map((p) => p.value)),
      high = Math.max(...points.map((p) => p.value));
    if (high === low) {
      const pad = Math.max(1, Math.abs(high) * 0.05);
      low -= pad;
      high += pad;
    } else {
      const pad = (high - low) * 0.1;
      low -= pad;
      high += pad;
    }
    const firstTime = Date.parse(points[0].time),
      lastTime = Date.parse(latest.time);
    const x = (p) =>
      firstTime === lastTime
        ? width / 2
        : 20 +
          clamp(
            (Date.parse(p.time) - firstTime) / (lastTime - firstTime),
            0,
            1,
          ) *
            (width - 40);
    const y = (value) =>
      bottom - ((value - low) / (high - low)) * (bottom - top);
    const coordinates = points.map((p) => [x(p), y(p.value)]);
    const gradient = node(defs, 'linearGradient', {
      id: `${id}-fill`,
      x1: '0',
      y1: '0',
      x2: '0',
      y2: '1',
    });
    node(gradient, 'stop', {
      offset: '0%',
      'stop-color': '#4DBDF5',
      'stop-opacity': 0.45,
    });
    node(gradient, 'stop', {
      offset: '100%',
      'stop-color': SKY,
      'stop-opacity': 0.12,
    });
    node(surface, 'path', {
      d: `M ${coordinates[0][0]} ${bottom} L ${coordinates.map((p) => p.join(' ')).join(' L ')} L ${coordinates.at(-1)[0]} ${bottom} Z`,
      fill: `url(#${id}-fill)`,
    });
    node(surface, 'line', {
      x1: 20,
      x2: width - 20,
      y1: bottom,
      y2: bottom,
      stroke: '#E8EEF5',
      'stroke-width': 1,
    });
    if (low < 0 && high > 0)
      node(surface, 'line', {
        x1: 20,
        x2: width - 20,
        y1: y(0),
        y2: y(0),
        stroke: '#E8EEF5',
        'stroke-dasharray': '3 3',
      });
    node(surface, 'polyline', {
      points: coordinates.map((p) => p.join(',')).join(' '),
      fill: 'none',
      stroke: BLUE,
      'stroke-width': 2.75,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'data-card-part': 'sparkline',
    });
    // Markers are useful on a small weekly series, but unnecessary node work on long histories.
    if (coordinates.length <= 12)
      for (const [cx, cy] of coordinates.slice(0, -1))
        node(surface, 'circle', {
          cx,
          cy,
          r: 2.6,
          fill: '#FFFFFF',
          stroke: BLUE,
          'stroke-width': 1.8,
        });
    const [cx, cy] = coordinates.at(-1);
    node(surface, 'circle', {
      cx,
      cy,
      r: 4.3,
      fill: YELLOW,
      stroke: BLUE,
      'stroke-width': 2.2,
    });
    const date = (p) =>
      new Date(p.time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    label(surface, 16, bodyBottom, date(points[0]), 10, bodyWidth / 2);
    label(surface, width - 16, bodyBottom, date(latest), 10, bodyWidth / 2, {
      'text-anchor': 'end',
    });
    description += `. ${points.length} values. Latest ${formatted(latest.value)}`;
  } else if (config.mode === 'bar') {
    const bars = card.rows === 'bars';
    const maxRows = Number.isInteger(card.maxRows)
      ? clamp(card.maxRows, 1, 8)
      : 4;
    const rows = points.slice(0, maxRows);
    const deltaValues =
      !bars &&
      card.rowDeltaField &&
      Array.isArray(snapshot.data[card.rowDeltaField])
        ? snapshot.data[card.rowDeltaField].slice(0, 40)
        : [];
    const deltas = new Map(
      deltaValues
        .filter(
          (p) => p && typeof p.label === 'string' && Number.isFinite(p.value),
        )
        .map((p) => [p.label, p.value]),
    );
    const subtitleHeight = card.subtitle ? 24 : 0;
    if (card.subtitle)
      label(surface, 16, bodyTop + 7, clean(card.subtitle, 100), 11, bodyWidth);
    const gap = Math.min(8, bodyHeight / (rows.length * 5));
    const rowHeight =
      (bodyHeight - subtitleHeight - gap * (rows.length - 1)) / rows.length;
    const scaleMax =
      Number.isFinite(card.scaleMax) && card.scaleMax > 0 ? card.scaleMax : 100;
    const low = Math.min(0, ...rows.map((p) => p.value)),
      high = Math.max(scaleMax, ...rows.map((p) => p.value));
    rows.forEach((row, index) => {
      const y = bodyTop + subtitleHeight + index * (rowHeight + gap);
      const group = node(surface, 'g', {
        'data-card-part': 'row',
        'data-label': row.label,
      });
      node(group, 'rect', {
        x: 14,
        y,
        width: width - 28,
        height: rowHeight,
        rx: 12,
        fill: '#FFFFFF',
      });
      const size = Math.min(13, rowHeight * (bars ? 0.24 : 0.38));
      const baseline =
        y + (bars ? rowHeight * 0.47 : rowHeight / 2 + size * 0.35);
      const rowDelta = deltas.has(row.label)
        ? deltaFormat(deltas.get(row.label))
        : '';
      const deltaWidth = rowDelta ? Math.min(64, bodyWidth * 0.24) : 0;
      if (rowDelta)
        pill(
          group,
          width - 24,
          y + rowHeight / 2,
          rowDelta,
          deltaWidth,
          'row-delta',
          Math.min(11, size),
          Math.min(24, rowHeight - 2),
        );
      const valueRight = width - 24 - (rowDelta ? deltaWidth + 8 : 0);
      const valueWidth = Math.min(
        bodyWidth * 0.43,
        Math.max(48, textWidth(formatted(row.value), size)),
      );
      label(
        group,
        valueRight,
        baseline,
        formatted(row.value),
        size,
        valueWidth,
        { 'text-anchor': 'end', 'data-card-part': 'row-value' },
      );
      label(
        group,
        26,
        baseline,
        clean(row.label, 60),
        size,
        Math.max(12, valueRight - valueWidth - 36),
        { 'data-card-part': 'row-label' },
      );
      if (bars) {
        const trackX = 26,
          trackWidth = width - 52,
          trackY = y + rowHeight * 0.69;
        const trackHeight = Math.max(3, Math.min(6, rowHeight * 0.12));
        const zero = trackX + (-low / (high - low)) * trackWidth;
        const valueX = trackX + ((row.value - low) / (high - low)) * trackWidth;
        node(group, 'rect', {
          x: trackX,
          y: trackY,
          width: trackWidth,
          height: trackHeight,
          rx: trackHeight / 2,
          fill: '#E8EEF5',
        });
        node(group, 'rect', {
          x: Math.min(zero, valueX),
          y: trackY,
          width: Math.abs(valueX - zero),
          height: trackHeight,
          rx: trackHeight / 2,
          fill: '#4DBDF5',
          'data-card-part': 'row-bar',
        });
      }
      description += `. ${row.label}: ${formatted(row.value)}${rowDelta ? `, ${rowDelta}` : ''}`;
    });
    if (points.length > rows.length)
      description += `. Showing ${rows.length} of ${points.length} categories`;
  }
  if (card.subtitle) description += `. ${clean(card.subtitle, 100)}`;
  if (delta) description += `. Change ${delta}`;
  if (footerHeight) {
    const group = node(surface, 'g', { 'data-card-part': 'footer' });
    const top = height - footerHeight;
    node(group, 'rect', {
      x: 0,
      y: top,
      width,
      height: footerHeight,
      fill: 'rgba(169,221,247,0.35)',
    });
    if (footer || footerRight) {
      const rightWidth = footerRight
        ? Math.min(bodyWidth * (footer ? 0.4 : 1), textWidth(footerRight, 11))
        : 0;
      label(
        group,
        16,
        top + 19,
        footer,
        11,
        bodyWidth - rightWidth - (rightWidth ? 10 : 0),
      );
      if (footerRight)
        label(group, width - 16, top + 19, footerRight, 11, rightWidth, {
          'text-anchor': 'end',
        });
    }
    if (updated)
      label(group, 16, height - 9, updated, 10, bodyWidth, {
        'data-card-part': 'updated',
      });
    description += `${footer ? `. ${footer}` : ''}${footerRight ? `. ${footerRight}` : ''}${updated ? `. ${updated}` : ''}`;
  }
  node(svg, 'rect', {
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    rx: 15,
    fill: 'none',
    stroke: secondary ? SKY : 'rgba(0,83,226,0.2)',
    'stroke-width': 2,
  });
  svg.setAttribute('aria-label', description);
  element.replaceChildren(svg);
}
