import { z } from 'zod';
export const stockSymbols = z
  .array(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9.-]{0,14}$/),
  )
  .min(1)
  .max(8)
  .transform((values) => [...new Set(values)]);
const interval = 15 * 60000;
const sessionClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function scheduledMarketSession(now) {
  const parts = Object.fromEntries(
    sessionClock
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (
    !['Sat', 'Sun'].includes(parts.weekday) && minutes >= 570 && minutes < 960
  );
}
export function createStockCache({
  db,
  token,
  fetcher = fetch,
  now = Date.now,
}) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS stock_cache (symbol TEXT PRIMARY KEY, body TEXT NOT NULL)',
  );
  const entries = new Map(
    db
      .prepare('SELECT * FROM stock_cache LIMIT 64')
      .all()
      .map((row) => [row.symbol, JSON.parse(row.body)]),
  );
  const active = new Map();
  const abort = new AbortController();
  let epoch = 0;
  let closed = false,
    budgetAt = now(),
    attempts = 0;
  const save = (symbol, entry) => {
    if (!closed)
      db.prepare('INSERT OR REPLACE INTO stock_cache VALUES (?,?)').run(
        symbol,
        JSON.stringify(entry),
      );
  };
  async function refresh(symbol, entry, key) {
    const generation = epoch;
    try {
      const response = await fetcher(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,
        {
          headers: { 'X-Finnhub-Token': key, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Quote unavailable');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16384) throw new Error('Quote too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const quote = z
        .object({
          c: z.number().positive(),
          pc: z.number().positive(),
          t: z.number().int().positive(),
        })
        .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (quote.t * 1000 > now() + 300000)
        throw new Error('Invalid quote time');
      if (closed || generation !== epoch) return;
      entry.data = {
        symbol,
        price: quote.c,
        change: quote.c - quote.pc,
        changePercent: ((quote.c - quote.pc) / quote.pc) * 100,
        quotedAt: new Date(quote.t * 1000).toISOString(),
        fetchedAt: new Date(now()).toISOString(),
      };
      entry.status = 'ready';
    } catch {
      entry.status = 'unavailable';
    } finally {
      if (generation === epoch) save(symbol, entry);
    }
  }
  function read(symbol) {
    const valid = stockSymbols.safeParse([symbol]);
    if (!valid.success || closed) return null;
    symbol = valid.data[0];
    const key = token();
    if (!key) return { symbol, status: 'unconfigured' };
    let entry = entries.get(symbol);
    if (!entry) {
      if (entries.size >= 64) {
        const old = [...entries].find(
          ([id, item]) =>
            !active.has(id) && now() - (item.usedAt || 0) > 86400000,
        );
        if (!old) return { symbol, status: 'capacity' };
        entries.delete(old[0]);
        db.prepare('DELETE FROM stock_cache WHERE symbol=?').run(old[0]);
      }
      entry = { data: null, status: 'loading', nextAt: 0, usedAt: now() };
      entries.set(symbol, entry);
    }
    entry.usedAt = now();
    if (now() - budgetAt >= 60000) {
      budgetAt = now();
      attempts = 0;
    }
    const session = scheduledMarketSession(now());
    // First quote may be fetched outside scheduled hours; retain it until the next session.
    if (
      (session || !entry.data) &&
      now() >= entry.nextAt &&
      !active.has(symbol) &&
      active.size < 2 &&
      attempts < 30
    ) {
      attempts++;
      entry.nextAt = now() + interval;
      save(symbol, entry);
      const task = refresh(symbol, entry, key).finally(() =>
        active.delete(symbol),
      );
      active.set(symbol, task);
    }
    return {
      symbol,
      ...entry.data,
      status: entry.data
        ? entry.status === 'ready'
          ? 'ready'
          : 'stale'
        : entry.status,
      scheduledSession: session,
      source: 'Finnhub',
      refreshMinutes: 15,
    };
  }
  function forManifest(manifest) {
    const symbols = new Set();
    for (const item of manifest?.items || [])
      for (const layer of item.slide.layers)
        if (layer.type === 'stocks')
          for (const symbol of layer.stocks?.symbols || []) symbols.add(symbol);
    return Object.fromEntries(
      [...symbols].map((symbol) => [symbol, read(symbol)]),
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
    reset() {
      epoch++;
      entries.clear();
      db.exec('DELETE FROM stock_cache');
    },
  };
}
