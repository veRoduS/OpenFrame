import { z } from 'zod';

export const DEFAULT_FEED_FIELDS = 100;
export const MAX_FEED_FIELDS = 500;
const settingKey = 'data-feeds.maxFieldsPerFeed';
const inputSchema = z
  .object({
    maxFieldsPerFeed: z.number().int().min(1).max(MAX_FEED_FIELDS),
  })
  .strict();

export function mountDataFeedLimits(app, { db, administrator }) {
  const read = () => ({
    maxFieldsPerFeed: Number(
      db.prepare('SELECT value FROM settings WHERE key=?').get(settingKey)
        ?.value ?? DEFAULT_FEED_FIELDS,
    ),
    minimum: 1,
    maximum: MAX_FEED_FIELDS,
  });
  app.get('/api/settings/data-feeds', administrator, (_req, res) => {
    res.set('Cache-Control', 'no-store').json(read());
  });
  app.put('/api/settings/data-feeds', administrator, (req, res) => {
    const input = inputSchema.parse(req.body);
    db.prepare(
      'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(settingKey, String(input.maxFieldsPerFeed));
    res.set('Cache-Control', 'no-store').json(read());
  });
  return { read };
}
