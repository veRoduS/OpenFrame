import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const id = z.uuid();
export const layerSchema = z
  .object({
    id,
    type: z.enum(['text', 'image', 'clock', 'counter', 'weather']),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
    text: z.string().max(4000).default(''),
    assetId: id.optional(),
    fontSize: z.number().min(12).max(400).default(72),
    color: color.default('#202923'),
    bold: z.boolean().default(false),
    align: z.enum(['left', 'center', 'right']).default('left'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
    autoSize: z.boolean().default(false),
    lockAspect: z.boolean().default(true),
    fit: z.enum(['contain', 'cover']).default('cover'),
    cropX: z.number().min(0).max(100).default(50),
    cropY: z.number().min(0).max(100).default(50),
    cropZoom: z.number().min(1).max(4).default(1),
    weather: z
      .object({
        name: z.string().trim().max(80).default('Weather'),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        unit: z.enum(['F', 'C']).default('F'),
      })
      .optional(),
    clock: z
      .object({
        showSeconds: z.boolean().default(false),
        hour12: z.boolean().default(true),
      })
      .optional(),
    counter: z
      .object({
        direction: z
          .enum(['auto', 'up', 'down'])
          .default('auto')
          .transform(() => 'auto'),
        goalMessage: z.string().max(500).optional(),
        prefix: z.string().max(500).optional(),
        suffix: z.string().max(500).optional(),
        targetAt: z.iso.datetime({ offset: true }),
        unit: z.enum(['seconds', 'minutes', 'hours', 'days']),
        showUnit: z.boolean().default(true),
      })
      .optional(),
  })
  .refine(
    (l) => l.x + l.width <= 100.01 && l.y + l.height <= 100.01,
    'Layer must fit inside the slide',
  )
  .refine((l) => l.type !== 'image' || !!l.assetId, 'Choose an image')
  .refine((l) => l.type !== 'counter' || !!l.counter, 'Configure the counter')
  .refine((l) => l.type !== 'weather' || !!l.weather, 'Configure the weather');
export const slideSchema = z.object({
  name: z.string().trim().min(1).max(100),
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(320).max(3840),
  background: color.default('#ffffff'),
  layers: z.array(layerSchema).max(50),
});
export const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(30)
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLowerCase()))]);
export const folderSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export const assetPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    folderId: id.nullable().optional(),
    tags: tagsSchema.optional(),
  })
  .strict();
export const assetBatchSchema = z
  .object({
    ids: z
      .array(id)
      .min(1)
      .max(200)
      .transform((ids) => [...new Set(ids)]),
    action: z.enum(['update', 'delete']).default('update'),
    folderId: id.nullable().optional(),
    addTags: tagsSchema.default([]),
    removeTags: tagsSchema.default([]),
  })
  .strict();
export const playlistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  items: z
    .array(
      z
        .object({
          slideId: id,
          duration: z.number().int().min(2).max(3600),
          startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
          scheduleEnabled: z.boolean().optional(),
          expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
        })
        .refine(
          (item) =>
            item.scheduleEnabled === false ||
            !item.startsAt ||
            !item.expiresAt ||
            Date.parse(item.startsAt) < Date.parse(item.expiresAt),
          'Expiration must be after the start time',
        ),
    )
    .max(200),
});
export const deviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  playlistId: id.nullable(),
  blank: z.boolean(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});
