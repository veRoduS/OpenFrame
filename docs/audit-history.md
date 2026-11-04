# Audit and history

Global administrators can open **Settings → Audit & history**. Both the interface
and all history endpoints require administrator permission. Existing site history
remains available separately. Application history begins on installation; changes
made before this version cannot be reconstructed.

The log records actor IDs/names, UTC time, action/route, resource IDs/names, and
before/after versions for slides, playlists, sharing, ownership, groups and
memberships. Media uploads and metadata, fonts, users, sites, API-key metadata and
configuration changes are also recorded. Player heartbeat noise, sessions, raw
credentials, token digests, secret configuration values and uploaded file contents
are excluded. Feed ingestion identifies the application/feed key by its public
ID/name; background operations are labeled System / API. Direct external database
edits are outside the application history. History is stored in the server's SQLite
database and is included in ordinary database backups. It is not a tamper-proof
external security ledger.

Filter by name/ID search, actor ID, resource type, action/route and UTC date range.
Click an actor to filter that account. Older entries load in pages of 50.
**Review** shows the before/after record and lists related entries in the operation.

**Restore before this operation** reverses a complete supported operation, including
related playlist publications or sharing changes. Restores themselves are recorded.
The server checks that every affected record still matches the recorded after
version and validates content dependencies. If an item changed afterward, the
restore fails atomically rather than overwriting newer work. Missing media, fonts,
feeds, groups or users can also block restoration. Restore requires the administrator
to review and explicitly select the action; viewing history does not change content.

Slide/playlist edits and changes involving only sharing, permissions and managing
groups support restoration. New-item creation, deletion, media uploads/metadata,
account changes, configuration and device operations are audit-only. Files and
credentials cannot be reconstructed from history. Use normal management actions or
a stopped-server backup restore where appropriate. Restoring a published slide or
playlist also changes what connected screens receive on their next sync.

API endpoints:

- `GET /api/audit?search=&actorId=&kind=&action=&from=&to=&before=` lists safe
  metadata with `nextCursor`; `before` is the last sequence number.
- `GET /api/audit/{sequence}` returns administrator-only versions and related entries.
- `POST /api/audit/{sequence}/revert` restores a supported operation; 409 means it
  cannot be restored automatically or has conflicting newer changes.
