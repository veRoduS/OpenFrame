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
  const setting = (key, fallback, low, high) =>
    Number.isFinite(card[key]) ? clamp(card[key], low, high) : fallback;
  const titleScale = setting('titleScale', 100, 50, 200) / 100;
  const valueScale = setting('valueScale', 100, 50, 200) / 100;
  const detailScale = setting('detailScale', 100, 50, 200) / 100;
  const paddingX = setting('paddingX', 16, 0, 48);
  const paddingY = setting('paddingY', 16, 0, 48);
  const valueAlign = ['left', 'center', 'right'].includes(card.valueAlign)
    ? card.valueAlign
    : 'auto';
  const valueAnchor =
    valueAlign === 'center'
      ? 'middle'
      : valueAlign === 'right'
        ? 'end'
        : 'start';
  const categoryLimit = Number.isInteger(card.maxRows)
    ? clamp(card.maxRows, 1, 40)
    : 4;
  const categoryOffset = Number.isInteger(card.rowOffset)
    ? clamp(card.rowOffset, 0, 39)
    : 0;
  const rawRows = snapshot?.data?.[config.field];
  const rowCount =
    config.mode === 'bar' && Array.isArray(rawRows)
      ? Math.min(categoryLimit, Math.max(0, rawRows.length - categoryOffset))
      : 0;
  const measuredWidth = element.clientWidth || 320,
    measuredHeight = element.clientHeight || 232;
  // A short, wide tile gets a wider design canvas instead of shrinking the body
  // beneath the header. Both dimensions preserve the layer's exact aspect ratio.
  const headerHeight = Math.max(
    42,
    24 * titleScale + 18,
    24 * detailScale + 12,
  );
  const hasFooter = card.footer || card.footerRight;
  const footerBase = hasFooter
    ? config.showUpdated
      ? 44
      : 30
    : config.showUpdated
      ? 28
      : 0;
  const rowSubtitle =
    config.mode === 'bar' && card.subtitle ? 24 * detailScale : 0;
  const baseHeight =
    Math.max(220, 100 + rowCount * 18) +
    Math.max(0, headerHeight - 42) +
    Math.max(0, 2 * (paddingY - 16)) +
    footerBase * Math.max(0, detailScale - 1);
  const customSpacing = titleScale > 1 || detailScale > 1 || paddingY > 16;
  const stackedLine =
    (valueAlign === 'center' || valueAlign === 'right') && card.subtitle;
  const lineBodyHeight =
    config.mode === 'line' && (valueScale > 1 || detailScale > 1 || stackedLine)
      ? (44 * valueScale * 1.05 +
          14 * detailScale +
          (stackedLine ? 10 * detailScale + 10 : 0) +
          4) /
        0.7
      : 0;
  const minimumHeight = Math.max(
    baseHeight,
    lineBodyHeight
      ? headerHeight +
          footerBase * Math.max(1, detailScale) +
          paddingY * 2 +
          lineBodyHeight
      : 0,
    customSpacing && rowCount
      ? headerHeight +
          footerBase * Math.max(1, detailScale) +
          paddingY * 2 +
          rowSubtitle +
          rowCount * 18 +
          Math.max(0, rowCount - 1) * 4
      : 0,
  );
  const scale = Math.min(measuredWidth / 320, measuredHeight / minimumHeight);
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
  ) => {
    // Detail size applies to supporting copy, badges, rows and metadata.
    // Header and row values have independent size controls.
    if (attrs['data-card-part'] === 'title') size *= titleScale;
    else if (attrs['data-card-part'] === 'row-value') size *= valueScale;
    else size *= detailScale;
    return node(
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
  };
  const wrap = (parent, x, y, text, maxWidth, size = 12, lines = 2) => {
    let rest = clean(text, 100).trim();
    for (let i = 0; i < lines && rest; i++) {
      if (i === lines - 1 || textWidth(rest, size * detailScale) <= maxWidth) {
        label(
          parent,
          x,
          y + i * (size * detailScale + 5),
          rest,
          size,
          maxWidth,
        );
        break;
      }
      let count = 1;
      while (
        count < rest.length &&
        textWidth(rest.slice(0, count + 1), size * detailScale) <= maxWidth
      )
        count++;
      const space = rest.lastIndexOf(' ', count);
      if (space > count / 2) count = space;
      label(
        parent,
        x,
        y + i * (size * detailScale + 5),
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
  const headerMiddle = headerHeight / 2;
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
    pillHeight = 24 * detailScale,
  ) => {
    const display = ellipsis(
      text,
      Math.max(0, maxWidth - 18),
      fontSize * detailScale,
    );
    const pillWidth = Math.min(
      maxWidth,
      textWidth(display, fontSize * detailScale) + 18,
    );
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
      cy + fontSize * detailScale * 0.35,
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
      pill(
        surface,
        width - 16,
        headerMiddle,
        delta,
        Math.min(125, width * 0.4),
      ) + 10;
  else if (card.badge === 'spark') {
    const spark = node(surface, 'g', {
      transform: `translate(${width - 26} ${headerMiddle})`,
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
  label(
    surface,
    16,
    headerMiddle + 5 * titleScale,
    title.toUpperCase(),
    12,
    width - 32 - focalWidth,
    {
      fill: card.header === 'navy' ? SKY : '#FFFFFF',
      'letter-spacing': '0.6',
      'data-card-part': 'title',
    },
  );

  let updated = '';
  const updatedTime = Date.parse(snapshot?.updatedAt);
  if (config.showUpdated && Number.isFinite(updatedTime)) {
    const minutes = Math.max(0, Math.floor((now - updatedTime) / 60000));
    updated = `${minutes >= (config.staleAfterMinutes || 60) ? 'Stale · ' : ''}Updated ${minutes < 1 ? 'just now' : `${minutes} min ago`}`;
  }
  if (valid && config.mode === 'bar') {
    const count = Math.min(
      categoryLimit,
      Math.max(0, points.length - categoryOffset),
    );
    if (count < points.length) {
      const range = count
        ? `Rows ${categoryOffset + 1}–${categoryOffset + count} of ${points.length}`
        : `0 of ${points.length} rows · Adjust First row`;
      updated = [updated, range].filter(Boolean).join(' · ');
    }
  }
  const footer = clean(card.footer, 80),
    footerRight = clean(card.footerRight, 40);
  const footerHeight =
    (footer || footerRight ? (updated ? 44 : 30) : updated ? 28 : 0) *
    Math.max(1, detailScale);
  const bodyTop = headerHeight + paddingY,
    bodyBottom = height - footerHeight - paddingY;
  const bodyHeight = bodyBottom - bodyTop,
    bodyWidth = width - 2 * paddingX;
  const valueX =
    valueAlign === 'center'
      ? width / 2
      : valueAlign === 'right'
        ? width - paddingX
        : paddingX;
  const bodyClip = node(defs, 'clipPath', { id: `${id}-body` });
  node(bodyClip, 'rect', {
    x: 1,
    y: bodyTop,
    width: width - 2,
    height: bodyHeight,
  });
  const body = node(surface, 'g', {
    'clip-path': `url(#${id}-body)`,
    'data-card-part': 'body',
  });

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
      body,
      width / 2,
      (bodyTop + bodyBottom) / 2 + 5,
      message,
      paddingX,
      bodyWidth,
      { 'text-anchor': 'middle', 'data-card-part': 'status' },
    );
    description += `. ${message}`;
  } else if (config.mode === 'metric') {
    const bodyDelta = card.badge !== 'delta' && delta;
    const stacked = valueAlign === 'center' || valueAlign === 'right';
    const deltaWidth = bodyDelta
      ? Math.min(125, bodyWidth * 0.44, textWidth(delta, 12 * detailScale) + 18)
      : 0;
    const size = Math.min(
      56 * valueScale,
      bodyHeight * (card.subtitle || (bodyDelta && stacked) ? 0.52 : 0.8),
    );
    const baseline =
      bodyTop + bodyHeight / 2 + (card.subtitle ? 5 : size * 0.357);
    lockup(
      body,
      valueX,
      baseline,
      rawValue,
      bodyWidth - (bodyDelta && !stacked ? deltaWidth + 12 : 0),
      size,
      'value',
      valueAnchor,
    );
    if (bodyDelta)
      pill(
        body,
        width - paddingX,
        stacked ? bodyBottom - 12 * detailScale : baseline - size * 0.357,
        delta,
        deltaWidth,
        'delta',
        12,
        24 * detailScale,
      );
    if (card.subtitle) {
      const subtitleWidth =
        bodyWidth - (bodyDelta && stacked ? deltaWidth + 12 : 0);
      const subtitle = node(body, 'g', {
        transform: `translate(${valueAlign === 'center' ? width / 2 - subtitleWidth / 2 : valueAlign === 'right' ? width - paddingX - subtitleWidth : paddingX} 0)`,
      });
      wrap(
        subtitle,
        0,
        Math.min(bodyBottom - 4, baseline + 28 * detailScale),
        card.subtitle,
        subtitleWidth,
        12,
        Math.max(
          1,
          Math.min(
            2,
            Math.floor((bodyBottom - baseline - 18) / (12 * detailScale + 5)),
          ),
        ),
      );
    }
    description += `. ${formatted(rawValue)}`;
  } else if (config.mode === 'progress') {
    const radius = Math.min(100, bodyWidth / 2 - 6, bodyHeight / 2 - 6);
    const cx = width / 2;
    const cy = bodyTop + bodyHeight / 2;
    const scaleMax =
      Number.isFinite(card.scaleMax) && card.scaleMax > 0 ? card.scaleMax : 100;
    const ratio = clamp(rawValue / scaleMax, 0, 1);
    const circle = { cx, cy, r: radius, fill: 'none', 'stroke-width': 12 };
    node(body, 'circle', { ...circle, stroke: '#E8EEF5' });
    node(body, 'circle', {
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
      body,
      cx,
      cy + 1,
      rawValue,
      radius * 1.65,
      Math.min(38 * valueScale, radius * 0.57 * valueScale, radius * 0.85),
      'value',
      'middle',
    );
    const scoreSize = Math.min(9 * detailScale, radius * 0.2);
    label(
      body,
      cx,
      cy + Math.min(18 * detailScale, radius * 0.55),
      'SCORE',
      scoreSize / detailScale,
      radius * 1.6,
      {
        'text-anchor': 'middle',
        'letter-spacing': '1',
      },
    );
    const target = config.targetField
      ? snapshot.data[config.targetField]
      : config.target;
    const goal =
      Number.isFinite(target) && target > 0
        ? `Goal: ${formatted(target)}`
        : 'Goal unavailable';
    const goalHeight = 22 * detailScale;
    const goalTop = bodyBottom - goalHeight;
    const distance = goalTop - cy;
    const outerRadius = radius + 6;
    const goalSpace =
      distance >= outerRadius
        ? bodyWidth
        : width -
          paddingX -
          cx -
          Math.sqrt(outerRadius ** 2 - distance ** 2) -
          8;
    const goalWidth = Math.max(
      16,
      Math.min(goalSpace, textWidth(goal, 10 * detailScale) + 16),
    );
    const goalX = width - paddingX - goalWidth;
    const goalSize = Math.min(
      10 * detailScale,
      Math.max(8 * detailScale, (goalWidth - 16) / textWidth(goal, 1)),
    );
    node(body, 'rect', {
      x: goalX,
      y: goalTop,
      width: goalWidth,
      height: goalHeight,
      rx: 7,
      fill: 'rgba(169,221,247,0.35)',
      'data-card-part': 'goal-badge',
    });
    label(
      body,
      goalX + 8,
      goalTop + goalHeight / 2 + goalSize * 0.35,
      goal,
      goalSize / detailScale,
      goalWidth - 16,
      {
        'data-card-part': 'goal',
      },
    );
    description += `. ${formatted(rawValue)}. ${goal}. Scale maximum ${scaleMax}`;
  } else if (config.mode === 'line') {
    const latest = points.at(-1);
    const compact = bodyHeight < 125;
    const stacked = valueAlign !== 'auto' && valueAlign !== 'left';
    const subtitleSpace = card.subtitle && stacked ? 10 * detailScale + 10 : 0;
    const valueSize = Math.min(
      (compact ? 36 : 44) * valueScale,
      Math.max(
        12,
        (bodyHeight -
          14 * detailScale -
          Math.max(24, bodyHeight * 0.3) -
          subtitleSpace -
          4) /
          1.05,
      ),
    );
    const valueWidth = lockup(
      body,
      valueX,
      bodyTop + valueSize * 0.92,
      latest.value,
      card.subtitle && !stacked ? bodyWidth * 0.55 : bodyWidth,
      valueSize,
      'value',
      valueAnchor,
    );
    if (card.subtitle)
      label(
        body,
        width - paddingX,
        bodyTop + valueSize * 0.92 + (stacked ? 10 * detailScale + 5 : 0),
        clean(card.subtitle, 100),
        10,
        stacked ? bodyWidth : bodyWidth - valueWidth - 12,
        { 'text-anchor': 'end', 'data-card-part': 'subtitle' },
      );
    const top = bodyTop + Math.max(48, valueSize * 1.05 + subtitleSpace + 4),
      bottom = bodyBottom - 14 * detailScale;
    const minimum = Math.min(...points.map((p) => p.value)),
      maximum = Math.max(...points.map((p) => p.value));
    let low = minimum,
      high = maximum;
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
        : paddingX +
          clamp(
            (Date.parse(p.time) - firstTime) / (lastTime - firstTime),
            0,
            1,
          ) *
            bodyWidth;
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
    node(body, 'path', {
      d: `M ${coordinates[0][0]} ${bottom} L ${coordinates.map((p) => p.join(' ')).join(' L ')} L ${coordinates.at(-1)[0]} ${bottom} Z`,
      fill: `url(#${id}-fill)`,
    });
    node(body, 'line', {
      x1: paddingX,
      x2: width - paddingX,
      y1: bottom,
      y2: bottom,
      stroke: '#E8EEF5',
      'stroke-width': 1,
    });
    if (low < 0 && high > 0)
      node(body, 'line', {
        x1: paddingX,
        x2: width - paddingX,
        y1: y(0),
        y2: y(0),
        stroke: '#E8EEF5',
        'stroke-dasharray': '3 3',
      });
    node(body, 'polyline', {
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
        node(body, 'circle', {
          cx,
          cy,
          r: 2.6,
          fill: '#FFFFFF',
          stroke: BLUE,
          'stroke-width': 1.8,
        });
    const [cx, cy] = coordinates.at(-1);
    node(body, 'circle', {
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
    if (card.showStats) {
      const average =
        points.reduce((sum, point) => sum + point.value, 0) / points.length;
      const statistics = [
        ['MIN', minimum],
        ['AVG', average],
        ['MAX', maximum],
      ];
      for (const [index, [name, value]] of statistics.entries()) {
        const anchor = index === 0 ? 'start' : index === 1 ? 'middle' : 'end';
        const x =
          index === 0 ? paddingX : index === 1 ? width / 2 : width - paddingX;
        label(
          body,
          x,
          bodyBottom,
          `${name} ${formatted(value)}`,
          10,
          bodyWidth / 3 - 8,
          {
            'text-anchor': anchor,
            'data-card-part': `stat-${name.toLowerCase()}`,
          },
        );
      }
      description += `. Minimum ${formatted(minimum)}. Average ${formatted(average)}. Maximum ${formatted(maximum)}`;
    } else {
      label(body, paddingX, bodyBottom, date(points[0]), 10, bodyWidth / 2);
      label(
        body,
        width - paddingX,
        bodyBottom,
        date(latest),
        10,
        bodyWidth / 2,
        {
          'text-anchor': 'end',
        },
      );
    }
    description += `. ${points.length} values. Latest ${formatted(latest.value)}`;
  } else if (config.mode === 'bar') {
    const bars = card.rows === 'bars';
    const rows = points.slice(categoryOffset, categoryOffset + categoryLimit);
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
    const subtitleHeight = card.subtitle ? 24 * detailScale : 0;
    if (card.subtitle)
      label(
        body,
        paddingX,
        bodyTop + 12 * detailScale,
        clean(card.subtitle, 100),
        11,
        bodyWidth,
      );
    const gap = Math.min(
      8,
      bodyHeight / (Math.max(1, rows.length) * (rows.length > 8 ? 10 : 5)),
    );
    const rowHeight =
      (bodyHeight - subtitleHeight - gap * Math.max(0, rows.length - 1)) /
      Math.max(1, rows.length);
    if (!rows.length)
      label(
        body,
        width / 2,
        bodyTop + bodyHeight / 2,
        'No rows in this range',
        14,
        bodyWidth,
        { 'text-anchor': 'middle', 'data-card-part': 'status' },
      );
    const scaleMax =
      Number.isFinite(card.scaleMax) && card.scaleMax > 0 ? card.scaleMax : 100;
    const low = Math.min(0, ...rows.map((p) => p.value)),
      high = Math.max(scaleMax, ...rows.map((p) => p.value));
    rows.forEach((row, index) => {
      const y = bodyTop + subtitleHeight + index * (rowHeight + gap);
      const group = node(body, 'g', {
        'data-card-part': 'row',
        'data-label': row.label,
      });
      node(group, 'rect', {
        x: Math.max(1, paddingX - 2),
        y,
        width: width - 2 * Math.max(1, paddingX - 2),
        height: rowHeight,
        rx: Math.min(12, rowHeight / 2),
        fill: '#FFFFFF',
      });
      const size = Math.min(
        13,
        rowHeight * (bars ? 0.24 : rows.length > 8 ? 0.6 : 0.38),
        (rowHeight * (bars ? 0.32 : 0.7)) / Math.max(detailScale, valueScale),
      );
      const baseline =
        y +
        (bars
          ? rowHeight * 0.47
          : rowHeight / 2 + size * Math.max(detailScale, valueScale) * 0.35);
      const rowDelta = deltas.has(row.label)
        ? deltaFormat(deltas.get(row.label))
        : '';
      const deltaWidth = rowDelta ? Math.min(64, bodyWidth * 0.24) : 0;
      if (rowDelta)
        pill(
          group,
          width - paddingX - 8,
          y + rowHeight / 2,
          rowDelta,
          deltaWidth,
          'row-delta',
          Math.min(11, size),
          Math.max(1, Math.min(24, rowHeight - 2)),
        );
      const valueRight = width - paddingX - 8 - (rowDelta ? deltaWidth + 8 : 0);
      const valueWidth = Math.min(
        bodyWidth * 0.43,
        Math.max(48, textWidth(formatted(row.value), size * valueScale)),
      );
      label(
        group,
        valueAlign === 'center'
          ? valueRight - valueWidth / 2
          : valueAlign === 'left'
            ? valueRight - valueWidth
            : valueRight,
        baseline,
        formatted(row.value),
        size,
        valueWidth,
        {
          'text-anchor':
            valueAlign === 'center'
              ? 'middle'
              : valueAlign === 'left'
                ? 'start'
                : 'end',
          'data-card-part': 'row-value',
        },
      );
      label(
        group,
        paddingX + 10,
        baseline,
        clean(row.label, 60),
        size,
        Math.max(12, valueRight - valueWidth - paddingX - 20),
        { 'data-card-part': 'row-label' },
      );
      if (bars) {
        const trackX = paddingX + 10,
          trackWidth = bodyWidth - 20,
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
      description += rows.length
        ? `. Showing rows ${categoryOffset + 1}–${categoryOffset + rows.length} of ${points.length}`
        : `. No rows in this range. ${points.length} total rows`;
  }
  if (card.subtitle && config.mode !== 'progress')
    description += `. ${clean(card.subtitle, 100)}`;
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
        ? Math.min(
            bodyWidth * (footer ? 0.4 : 1),
            textWidth(footerRight, 11 * detailScale),
          )
        : 0;
      label(
        group,
        16,
        top + 19 * detailScale,
        footer,
        11,
        bodyWidth - rightWidth - (rightWidth ? 10 : 0),
      );
      if (footerRight)
        label(
          group,
          width - 16,
          top + 19 * detailScale,
          footerRight,
          11,
          rightWidth,
          {
            'text-anchor': 'end',
          },
        );
    }
    if (updated)
      label(group, 16, height - 9 * detailScale, updated, 10, bodyWidth, {
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
