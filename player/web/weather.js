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

export function weatherText(config, snapshot, now = Date.now()) {
  const name = config?.name?.trim() || 'Weather';
  if (!weatherKey(config)) return `${name}\nSet a weather location`;
  const periods = snapshot?.periods || [];
  const current = periods.find(
    (p) => Date.parse(p.startTime) <= now && now < Date.parse(p.endTime),
  );
  const period =
    current || periods.filter((p) => Date.parse(p.startTime) <= now).at(-1);
  if (!period) {
    const message =
      snapshot?.status === 'unsupported'
        ? 'Outside NWS forecast coverage'
        : snapshot?.status === 'loading' || !snapshot
          ? 'Waiting for weather'
          : 'Weather unavailable';
    return `${name}\n${message}\nNational Weather Service`;
  }
  const unit = config?.unit === 'C' ? 'C' : 'F';
  const temperature = Math.round(
    unit === 'C' ? ((period.temperatureF - 32) * 5) / 9 : period.temperatureF,
  );
  const age = Math.max(
    0,
    Math.floor((now - Date.parse(snapshot.fetchedAt)) / 60000),
  );
  const checked =
    age < 60
      ? `${age}m ago`
      : age < 1440
        ? `${Math.floor(age / 60)}h ago`
        : `${Math.floor(age / 1440)}d ago`;
  const stale = !current
    ? 'Expired forecast'
    : age >= 60 || snapshot.status === 'stale'
      ? 'Cached forecast'
      : 'NWS forecast';
  return `${name}\n${temperature}\u00b0${unit} / ${period.shortForecast}\n${stale} - checked ${checked}\nNational Weather Service`;
}

let snapshots = {};
export function weatherLineStyle(index) {
  return {
    display: 'block',
    whiteSpace: 'normal',
    fontSize: ['0.55em', '1em', '0.32em', '0.28em'][index] || '0.28em',
    lineHeight: '1.25',
    marginBottom: index < 2 ? '0.2em' : '0',
  };
}
export function renderWeatherText(element, text) {
  const lines = text.split('\n');
  element.replaceChildren(
    ...lines.map((line, index) => {
      const part = document.createElement('span');
      Object.assign(part.style, weatherLineStyle(index));
      part.textContent = line + (index < lines.length - 1 ? '\n' : '');
      return part;
    }),
  );
}
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
