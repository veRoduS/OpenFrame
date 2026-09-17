import { z } from 'zod';

const coordinate = (limit) =>
  z
    .union([z.number(), z.string().trim().min(1).max(24)])
    .pipe(z.coerce.number().min(-limit).max(limit));
const placesSchema = z.object({
  places: z
    .array(
      z.object({
        'place name': z.string().min(1).max(100),
        'state abbreviation': z.string().max(10),
        latitude: coordinate(90),
        longitude: coordinate(180),
      }),
    )
    .min(1)
    .max(100),
});
const error = (status, message) =>
  Object.assign(new Error(message), { status });

export function createZipLookup({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const active = new Map();
  const abort = new AbortController();
  let nextRequest = 0;
  async function lookup(zip) {
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip))
      throw error(400, 'Enter a five-digit US ZIP code');
    const cached = cache.get(zip);
    if (cached && cached.until > now()) return cached.value;
    if (active.has(zip)) return active.get(zip);
    if (active.size >= 2 || now() < nextRequest)
      throw error(429, 'Please wait a moment before another ZIP lookup');
    nextRequest = now() + 1000;
    const task = (async () => {
      const response = await fetcher(`https://api.zippopotam.us/us/${zip}`, {
        redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw error(
          response.status === 404 ? 404 : 502,
          response.status === 404
            ? 'ZIP code not found'
            : 'ZIP lookup unavailable. Try again later.',
        );
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 128 * 1024)
            throw error(502, 'Invalid ZIP lookup response');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const parsed = placesSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
      );
      const value = {
        zip,
        places: parsed.places.map((p) => ({
          name: `${p['place name']}, ${p['state abbreviation']}`,
          latitude: p.latitude,
          longitude: p.longitude,
        })),
      };
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(zip, { value, until: now() + 86400000 });
      return value;
    })()
      .catch((cause) => {
        throw cause.status
          ? cause
          : error(502, 'ZIP lookup unavailable. Try again later.');
      })
      .finally(() => active.delete(zip));
    active.set(zip, task);
    return task;
  }
  return { lookup, close: () => abort.abort() };
}
