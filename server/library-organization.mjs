import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { folderSchema, tagsSchema } from './schema.mjs';
const fail = (status, message) => Object.assign(new Error(message), { status });
const kinds = { slides: 'slide', playlists: 'playlist' };

export function mountLibraryOrganization(
  app,
  { db, admin, accounts, allRecords, put, remove, requireEditable },
) {
  const kindFor = (req) => {
    const kind = kinds[req.params.kind];
    if (!kind) throw fail(400, 'Choose Slides or Playlists');
    return kind;
  };
  function visibleFolders(kind, user) {
    const folders = allRecords(`${kind}-folder`);
    const visible = new Set(
      allRecords(kind)
        .filter((i) => accounts.can(user, kind, i.id))
        .map((i) => i.folderId)
        .filter(Boolean),
    );
    for (const f of folders)
      if (accounts.can(user, `${kind}-folder`, f.id)) visible.add(f.id);
    for (const id of visible) {
      let f = folders.find((f) => f.id === id);
      const seen = new Set();
      while (f && !seen.has(f.id)) {
        seen.add(f.id);
        visible.add(f.id);
        f = folders.find((parent) => parent.id === f.parentId);
      }
    }
    return folders
      .filter((f) => visible.has(f.id))
      .map((f) => ({
        ...f,
        readOnly: !accounts.canEdit(user, `${kind}-folder`, f.id),
        pathOnly: !accounts.can(user, `${kind}-folder`, f.id),
      }));
  }
  function validateFolder(kind, folderId, user) {
    if (folderId && !visibleFolders(kind, user).some((f) => f.id === folderId))
      throw fail(404, 'Folder not found');
  }
  function folderInput(req, kind, current) {
    const input = folderSchema
      .extend({ managingGroupId: z.uuid().nullable().optional() })
      .parse(req.body);
    if (input.parentId && (!current || input.parentId !== current.parentId))
      requireEditable(`${kind}-folder`, input.parentId);
    let parent = input.parentId;
    const seen = new Set(current ? [current.id] : []);
    while (parent) {
      if (seen.has(parent))
        throw fail(400, 'Folders cannot contain themselves');
      seen.add(parent);
      parent = allRecords(`${kind}-folder`).find(
        (f) => f.id === parent,
      )?.parentId;
    }
    return input;
  }
  app.post('/api/library-folders/:kind', admin, (req, res) => {
    const kind = kindFor(req);
    const f = put(`${kind}-folder`, {
      ...folderInput(req, kind, null),
      id: randomUUID(),
    });
    res.status(201).json(f);
  });
  app.put('/api/library-folders/:kind/:id', admin, (req, res) => {
    const kind = kindFor(req);
    const current = requireEditable(`${kind}-folder`, req.params.id);
    res.json(
      put(`${kind}-folder`, {
        ...current,
        ...folderInput(req, kind, current),
        id: req.params.id,
      }),
    );
  });
  app.delete('/api/library-folders/:kind/:id', admin, (req, res) => {
    const kind = kindFor(req);
    requireEditable(`${kind}-folder`, req.params.id);
    if (
      allRecords(kind).some((i) => i.folderId === req.params.id) ||
      allRecords(`${kind}-folder`).some((i) => i.parentId === req.params.id)
    )
      throw fail(409, 'Move the contents out before deleting this folder');
    remove(`${kind}-folder`, req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/organization/:kind', admin, (req, res) => {
    const kind = kindFor(req);
    const input = z
      .object({
        ids: z.array(z.uuid()).min(1).max(200),
        folderId: z.uuid().nullable().optional(),
        addTags: tagsSchema.default([]),
        removeTags: tagsSchema.default([]),
      })
      .strict()
      .parse(req.body);
    if (input.folderId !== undefined)
      validateFolder(kind, input.folderId, req.user);
    const rows = [...new Set(input.ids)].map((id) => {
      const row = requireEditable(kind, id);
      const tags = tagsSchema.parse([
        ...new Set([
          ...(row.tags || []).filter((t) => !input.removeTags.includes(t)),
          ...input.addTags,
        ]),
      ]);
      return {
        ...row,
        tags,
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
        updatedAt: new Date().toISOString(),
      };
    });
    db.exec('BEGIN IMMEDIATE');
    try {
      rows.forEach((row) => put(kind, row));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });
  return { visibleFolders, validateFolder };
}
