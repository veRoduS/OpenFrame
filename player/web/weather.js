import { weatherIcons } from './weather-icons.js';

export function weatherKey(config) {
  const { latitude, longitude } = config || {};
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return `${Number(latitude.toFixed(4)).toFixed(4)},${Number(longitude.toFixed(4)).toFixed(4)}`;
}

export function weatherCondition(description, isDaytime = true) {
  const text = (description || '').toLowerCase();
  if (/tornado|funnel/.test(text)) return ['tornado', '#87644b'];
  if (/thunder|t-storm/.test(text)) return ['cloud-lightning', '#b47d12'];
  if (
    /freezing (rain|drizzle)|ice pellets|sleet|wintry|mix|hail|rain.*snow|snow.*rain/.test(
      text,
    )
  )
    return ['cloud-hail', '#6b78b8'];
  if (/snow|blizzard|flurr/.test(text)) return ['cloud-snow', '#518da6'];
  if (/drizzle/.test(text)) return ['cloud-drizzle', '#408fbc'];
  if (/rain|shower/.test(text))
    return [
      /wind|heavy/.test(text) ? 'cloud-rain-wind' : 'cloud-rain',
      '#287ba8',
    ];
  if (/fog|mist/.test(text)) return ['cloud-fog', '#758a8f'];
  if (/haze|smoke|dust|sand/.test(text)) return ['haze', '#9b8764'];
  if (/mostly cloudy|overcast/.test(text)) return ['cloudy', '#768794'];
  if (/partly|scattered|few cloud/.test(text))
    return [
      isDaytime ? 'cloud-sun' : 'cloud-moon',
      isDaytime ? '#ba8a24' : '#7b88bd',
    ];
  if (/clear|sunny|fair/.test(text))
    return [isDaytime ? 'sun' : 'moon', isDaytime ? '#d39a18' : '#8794c7'];
  if (/cloud/.test(text)) return ['cloud', '#768794'];
  if (/wind|breezy|gust/.test(text)) return ['wind', '#648e82'];
  return ['circle-question-mark', '#87928c'];
}

const HOUR = 3600000;
const temperatureText = (value, unit) =>
  `${Math.round(unit === 'C' ? ((value - 32) * 5) / 9 : value)}\u00b0${unit}`;
function ageText(timestamp, now) {
  const minutes = Math.max(
    0,
    Math.floor((now - Date.parse(timestamp)) / 60000),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h ago`
      : `${Math.floor(minutes / 1440)}d ago`;
}
export function weatherView(config, snapshot, now = Date.now()) {
  const name = config?.name?.trim() || 'Weather';
  const unit = config?.unit === 'C' ? 'C' : 'F';
  const base = {
    name,
    source: 'National Weather Service',
    cells: [],
    detail: '',
  };
  if (!weatherKey(config)) return { ...base, detail: 'Set a weather location' };
  if (config?.mode === 'six-hour') {
    const periods = (snapshot?.periods || [])
      .filter(
        (p) =>
          Date.parse(p.startTime) > now &&
          Date.parse(p.startTime) <= now + 6 * HOUR,
      )
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
    const unique = periods
      .filter((p, i) => i === 0 || p.startTime !== periods[i - 1].startTime)
      .slice(0, 6);
    let formatter;
    try {
      if (snapshot.timeZone)
        formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: snapshot.timeZone,
          hour: 'numeric',
        });
    } catch {
      /* Forecast offsets remain usable if an older snapshot lacks a valid zone. */
    }
    const cells = unique.map((p) => {
      let label;
      try {
        // Fall back to the forecast's own UTC offset, never the player's timezone.
        label = formatter
          ? formatter.format(new Date(p.startTime))
          : `${Number(p.startTime.slice(11, 13)) % 12 || 12} ${Number(p.startTime.slice(11, 13)) >= 12 ? 'PM' : 'AM'}`;
      } catch {
        label = p.startTime.slice(11, 16);
      }
      return {
        label,
        temperature: temperatureText(p.temperatureF, unit),
        description: p.shortForecast,
        icon: weatherCondition(p.shortForecast, p.isDaytime),
      };
    });
    return {
      ...base,
      mode: 'six-hour',
      cells,
      detail: cells.length
        ? `Next 6 hours${cells.length < 6 ? ' - partial forecast' : ''} / ${snapshot.status === 'stale' || now - Date.parse(snapshot.fetchedAt) >= HOUR ? 'Cached forecast' : 'NWS forecast'} - checked ${ageText(snapshot.fetchedAt, now)}`
        : snapshot?.status === 'unsupported'
          ? 'Outside NWS forecast coverage'
          : 'Six-hour forecast unavailable',
    };
  }
  if (
    snapshot?.observation &&
    Number.isFinite(snapshot.observation.temperatureF)
  ) {
    const p = snapshot.observation;
    const daytime =
      p.isDaytime ??
      snapshot.periods?.find(
        (period) =>
          Date.parse(period.startTime) <= now &&
          now < Date.parse(period.endTime),
      )?.isDaytime;
    const stale =
      snapshot.observationStatus === 'unavailable' ||
      now - Date.parse(p.timestamp) >= 2 * HOUR;
    return {
      ...base,
      mode: 'current',
      cells: [
        {
          temperature: temperatureText(p.temperatureF, unit),
          description: p.shortForecast,
          icon: weatherCondition(p.shortForecast, daytime),
        },
      ],
      detail: `${stale ? 'Cached observation' : 'Current weather'} - observed ${ageText(p.timestamp, now)}`,
    };
  }
  // Old player snapshots or stations with missing readings may only have a forecast.
  const current = (snapshot?.periods || []).find(
    (p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime),
  );
  const period =
    current ||
    (snapshot?.periods || [])
      .filter((p) => Date.parse(p.startTime) <= now)
      .at(-1);
  return period
    ? {
        ...base,
        mode: 'current',
        cells: [
          {
            temperature: temperatureText(period.temperatureF, unit),
            description: period.shortForecast,
            icon: weatherCondition(period.shortForecast, period.isDaytime),
          },
        ],
        detail: `${!current ? 'Expired forecast' : snapshot.status === 'stale' || now - Date.parse(snapshot.fetchedAt) >= HOUR ? 'Cached forecast' : 'NWS forecast'} - checked ${ageText(snapshot.fetchedAt, now)} (observation unavailable)`,
      }
    : {
        ...base,
        detail:
          snapshot?.status === 'unsupported'
            ? 'Outside NWS forecast coverage'
            : snapshot?.status === 'loading' || !snapshot
              ? 'Waiting for weather'
              : 'Weather unavailable',
      };
}
export function weatherText(config, snapshot, now = Date.now()) {
  const view = weatherView(config, snapshot, now);
  return [
    view.name,
    ...view.cells.map(
      (c) =>
        `${c.label ? c.label + ' / ' : ''}${c.temperature} / ${c.description}`,
    ),
    view.detail,
    view.source,
  ].join('\n');
}

export function renderWeather(element, view) {
  const span = (text, style = {}) => {
    const node = document.createElement('span');
    node.textContent = text;
    Object.assign(
      node.style,
      { display: 'block', whiteSpace: 'normal', lineHeight: '1.25' },
      style,
    );
    return node;
  };
  const icon = ([name, color]) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: color,
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      'data-weather-icon': name,
    }))
      svg.setAttribute(key, value);
    Object.assign(svg.style, {
      display: 'block',
      width: '1.5em',
      height: '1.5em',
      flexShrink: '0',
    });
    for (const [tag, attrs] of weatherIcons[name] ||
      weatherIcons['circle-question-mark']) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs))
        child.setAttribute(key, String(value));
      svg.append(child);
    }
    return svg;
  };
  const content = span('');
  const six = view.mode === 'six-hour';
  Object.assign(content.style, {
    display: six ? 'grid' : 'block',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: '0.16em',
    marginBottom: '0.25em',
  });
  for (const cell of view.cells) {
    const box = span('', { minWidth: '0', fontSize: six ? '0.58em' : '1em' });
    if (cell.label)
      box.append(
        span(cell.label, { fontSize: '0.6em', marginBottom: '0.3em' }),
      );
    const main = span('', {
      display: 'flex',
      flexDirection: six ? 'column' : 'row',
      alignItems: 'center',
      gap: '0.15em',
      justifyContent: six
        ? 'center'
        : { left: 'flex-start', center: 'center', right: 'flex-end' }[
            element.parentElement?.style.textAlign
          ] || 'flex-start',
    });
    main.append(
      icon(cell.icon),
      span(cell.temperature, { whiteSpace: 'nowrap' }),
    );
    box.append(
      main,
      span(cell.description, {
        fontSize: '0.48em',
        marginTop: '0.25em',
      }),
    );
    if (six) box.style.textAlign = 'center';
    content.append(box);
  }
  element.replaceChildren(
    span(view.name, { fontSize: '0.55em', marginBottom: '0.3em' }),
    content,
    span(view.detail, { fontSize: '0.25em', marginBottom: '0.15em' }),
    span(view.source, { fontSize: '0.23em', opacity: '0.65' }),
  );
}

let snapshots = {};
const listeners = new Set();
export function setWeatherSnapshots(value) {
  snapshots = value || {};
  for (const listener of listeners) listener();
}
export const getWeatherSnapshot = (config) => snapshots[weatherKey(config)];
export function subscribeWeather(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
