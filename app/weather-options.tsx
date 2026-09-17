import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Layer } from './types';

type Config = NonNullable<Layer['weather']>;
type Place = { name: string; latitude: number; longitude: number };
export function WeatherOptions({
  config,
  onChange,
}: {
  config: Config;
  onChange: (patch: Partial<Config>) => void;
}) {
  const [zip, setZip] = useState(config.zip || '');
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const latestChange = useRef(onChange);
  useEffect(() => {
    latestChange.current = onChange;
  });
  useEffect(() => () => request.current?.abort(), []);
  function apply(place: Place) {
    latestChange.current({ ...place, zip });
    setPlaces([]);
  }
  async function lookup() {
    request.current?.abort();
    const abort = new AbortController();
    request.current = abort;
    setBusy(true);
    setError('');
    setPlaces([]);
    try {
      const response = await fetch(
        `/api/weather/zip?zip=${encodeURIComponent(zip)}`,
        {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ZIP lookup failed');
      if (abort.signal.aborted) return;
      if (result.places.length === 1) apply(result.places[0]);
      else setPlaces(result.places);
    } catch (cause) {
      if (!abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'ZIP lookup failed');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <div className="weather-zip">
        <label>
          US ZIP code
          <div className="weather-zip-input">
            <input
              value={zip}
              inputMode="numeric"
              maxLength={5}
              autoComplete="postal-code"
              onChange={(e) => {
                request.current?.abort();
                setBusy(false);
                setPlaces([]);
                setError('');
                setZip(e.target.value.replace(/\D/g, ''));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (/^\d{5}$/.test(zip) && !busy) void lookup();
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Look up ZIP code"
              title="Look up ZIP code"
              disabled={busy || !/^\d{5}$/.test(zip)}
              onClick={() => void lookup()}
            >
              <Search size={16} />
            </button>
          </div>
        </label>
        {busy && <output>Looking up location...</output>}
        {error && <small role="alert">{error}</small>}
        {places.length > 1 && (
          <label>
            ZIP location
            <select
              defaultValue=""
              onChange={(e) => apply(places[Number(e.target.value)])}
            >
              <option value="" disabled>
                Select a location
              </option>
              {places.map((place, i) => (
                <option key={i} value={i}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="weather-mode">
        Weather display
        <select
          value={config.mode || 'current'}
          onChange={(e) => onChange({ mode: e.target.value as Config['mode'] })}
        >
          <option value="current">Current weather</option>
          <option value="six-hour">Next 6 hours</option>
        </select>
      </label>
    </>
  );
}
