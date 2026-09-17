import { z } from 'zod';
import { weatherKey } from '../player/web/weather.js';

const INTERVAL = 15 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const periodSchema = z.object({
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
  temperature: z.number().min(-150).max(180),
  temperatureUnit: z.enum(['F', 'C']),
  shortForecast: z.string().min(1).max(250),
  isDaytime: z.boolean().optional(),
});
const forecastSchema = z.object({
  properties: z.object({ periods: z.array(periodSchema).min(1).max(200) }),
});

export function createWeatherCache({ db, fetcher = fetch, now = Date.now }) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS weather_cache (id TEXT PRIMARY KEY, body TEXT NOT NULL)',
  );
  const entries = new Map(
    db
      .prepare('SELECT id, body FROM weather_cache LIMIT 256')
      .all()
      .map((r) => [r.id, JSON.parse(r.body)]),
  );
  const active = new Map();
  const abort = new AbortController();
  let closed = false;
  const save = (key, entry) => {
    if (!closed)
      db.prepare('INSERT OR REPLACE INTO weather_cache VALUES (?,?)').run(
        key,
        JSON.stringify(entry),
      );
  };
  async function request(path) {
    // Only fixed NWS paths are used; never follow a supplied URL or redirect.
    const response = await fetcher(`https://api.weather.gov${path}`, {
      headers: {
        Accept: 'application/geo+json',
        'User-Agent': 'OpenFrame (https://github.com/veRoduS/OpenFrame)',
      },
      redirect: 'error',
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get('retry-after');
      const delay = /^\d+$/.test(retry || '')
        ? Number(retry) * 1000
        : Date.parse(retry) - now();
      throw Object.assign(new Error('NWS unavailable'), {
        status: response.status,
        delay: Number.isFinite(delay)
          ? Math.max(INTERVAL, Math.min(DAY, delay))
          : INTERVAL,
      });
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024 * 1024) throw new Error('NWS response too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function refresh(key, entry) {
    let delay = INTERVAL;
    try {
      if (!entry.grid || now() >= entry.gridUntil) {
        const point = await request(`/points/${key}`);
        const { gridId, gridX, gridY } = point.properties || {};
        if (
          !/^[A-Z]{3}$/.test(gridId || '') ||
          !Number.isInteger(gridX) ||
          !Number.isInteger(gridY) ||
          gridX < 0 ||
          gridY < 0 ||
          gridX > 10000 ||
          gridY > 10000
        )
          throw new Error('Invalid NWS grid');
        entry.grid = `${gridId}/${gridX},${gridY}`;
        entry.gridUntil = now() + DAY;
        try {
          new Intl.DateTimeFormat('en', {
            timeZone: point.properties.timeZone,
          }).format();
          entry.timeZone = point.properties.timeZone;
        } catch {
          entry.timeZone = undefined;
        }
      }
      try {
        const forecast = forecastSchema.parse(
          await request(`/gridpoints/${entry.grid}/forecast/hourly?units=us`),
        );
        const periods = forecast.properties.periods
          .filter(
            (p) =>
              Date.parse(p.endTime) > now() &&
              Date.parse(p.startTime) < Date.parse(p.endTime),
          )
          .slice(0, 48)
          .map((p) => ({
            startTime: p.startTime,
            endTime: p.endTime,
            temperatureF:
              p.temperatureUnit === 'C'
                ? (p.temperature * 9) / 5 + 32
                : p.temperature,
            shortForecast: p.shortForecast,
            isDaytime: p.isDaytime,
          }));
        if (!periods.length) throw new Error('No valid forecast periods');
        entry.data = {
          ...entry.data,
          status: 'ready',
          timeZone: entry.timeZone,
          fetchedAt: new Date(now()).toISOString(),
          periods,
        };
        entry.status = 'ready';
      } catch (error) {
        entry.status = 'unavailable';
        delay = Math.max(delay, error.delay || INTERVAL);
        if (error.status === 429) throw error;
      }
      // Observations and forecasts retain their last good values independently.
      try {
        if (!entry.stations || now() >= entry.stationsUntil) {
          const result = await request(`/gridpoints/${entry.grid}/stations`);
          const stations = result.features
            ?.map((f) => f.properties?.stationIdentifier)
            .filter(
              (id) => typeof id === 'string' && /^[A-Z0-9]{3,8}$/.test(id),
            )
            .slice(0, 2);
          if (!stations?.length) throw new Error('No observation stations');
          entry.stations = stations;
          entry.stationsUntil = now() + DAY;
        }
        let observation;
        for (const station of entry.stations) {
          try {
            const result = await request(
              `/stations/${station}/observations/latest`,
            );
            const p = result.properties || {};
            const timestamp = Date.parse(p.timestamp);
            const temperature = p.temperature?.value;
            if (
              !Number.isFinite(timestamp) ||
              timestamp > now() + 300000 ||
              !Number.isFinite(temperature) ||
              temperature < -100 ||
              temperature > 150 ||
              !['wmoUnit:degC', 'wmoUnit:degF'].includes(
                p.temperature?.unitCode,
              )
            )
              continue;
            const cloud = {
              CLR: 'Clear',
              SKC: 'Clear',
              FEW: 'Few clouds',
              SCT: 'Scattered clouds',
              BKN: 'Mostly cloudy',
              OVC: 'Overcast',
            };
            const description =
              typeof p.textDescription === 'string' && p.textDescription.trim()
                ? p.textDescription.trim().slice(0, 250)
                : cloud[p.cloudLayers?.at(-1)?.amount] ||
                  'Conditions unavailable';
            const candidate = {
              timestamp: new Date(timestamp).toISOString(),
              temperatureF:
                p.temperature.unitCode === 'wmoUnit:degC'
                  ? (temperature * 9) / 5 + 32
                  : temperature,
              shortForecast: description,
              ...(typeof p.icon === 'string' && /\/(day|night)\//.test(p.icon)
                ? { isDaytime: !p.icon.includes('/night/') }
                : {}),
              station,
            };
            if (!observation || timestamp > Date.parse(observation.timestamp))
              observation = candidate;
            if (now() - timestamp < 2 * 3600000) break;
          } catch (error) {
            if (error.status === 429 || error.delay > INTERVAL) throw error;
          }
        }
        if (!observation) throw new Error('No valid observation');
        if (
          !entry.data?.observation ||
          Date.parse(observation.timestamp) >=
            Date.parse(entry.data.observation.timestamp)
        )
          entry.data = {
            periods: [],
            ...entry.data,
            timeZone: entry.timeZone,
            observation,
          };
        entry.observationStatus = 'ready';
      } catch (error) {
        entry.observationStatus = 'unavailable';
        delay = Math.max(delay, error.delay || INTERVAL);
      }
      entry.nextAt = now() + delay;
    } catch (error) {
      entry.status =
        error.status === 404 && !entry.grid ? 'unsupported' : 'unavailable';
      entry.observationStatus = 'unavailable';
      if (entry.grid) entry.gridUntil = 0;
      entry.nextAt =
        now() +
        (entry.status === 'unsupported' ? DAY : error.delay || INTERVAL);
    } finally {
      if (!closed) save(key, entry);
    }
  }
  function read(config) {
    const key = weatherKey(config);
    if (!key || closed) return null;
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= 256) {
        const old = [...entries].find(
          ([id, value]) => !active.has(id) && now() - value.usedAt > DAY,
        );
        if (!old) return { status: 'capacity', periods: [] };
        entries.delete(old[0]);
        db.prepare('DELETE FROM weather_cache WHERE id=?').run(old[0]);
      }
      entry = { usedAt: now(), nextAt: 0, status: 'loading', data: null };
      entries.set(key, entry);
    }
    entry.usedAt = now();
    if (now() >= entry.nextAt && !active.has(key) && active.size < 2) {
      entry.nextAt = now() + INTERVAL;
      save(key, entry);
      const task = refresh(key, entry)
        .catch(() => {})
        .finally(() => active.delete(key));
      active.set(key, task);
    }
    return entry.data
      ? {
          ...entry.data,
          status: entry.status === 'ready' ? 'ready' : 'stale',
          observationStatus: entry.observationStatus,
        }
      : { status: entry.status, periods: [] };
  }
  function forManifest(manifest) {
    const locations = new Map();
    for (const item of manifest?.items || [])
      for (const layer of item.slide.layers) {
        const key = layer.type === 'weather' && weatherKey(layer.weather);
        if (key && !locations.has(key)) locations.set(key, layer.weather);
      }
    return Object.fromEntries(
      [...locations].map(([key, config]) => [key, read(config)]),
    );
  }
  return {
    read,
    forManifest,
    idle: () => Promise.all(active.values()),
    close() {
      closed = true;
      abort.abort();
    },
  };
}
