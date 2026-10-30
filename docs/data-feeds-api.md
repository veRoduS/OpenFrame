# OpenFrame Data Feeds API

This guide is a complete handoff for a developer or AI building an integration. The external integration sends JSON snapshots to a reusable feed; slides display fields through metric, progress, line graph, or bar chart widgets. Updates do not edit the slide or require publishing a playlist again.

**Base URL:** your OpenFrame server, for example `https://openframe.blackfalcon.cloud`.
**Contract:** download `GET /api/data-feeds/openapi.json` (OpenAPI 3.1), or share [the JSON file](../server/data-feeds.openapi.json).
**Requirements:** server 0.20.0+, player 0.10.13+ for data widgets. Existing slides remain compatible with older players. Use HTTPS outside a trusted local network.

OpenFrame supports **application API keys** that automatically create feeds and metrics on first push, and existing **feed-specific API keys** for fixed-schema integrations. Both are credentials for external applications. They work without a browser session or OpenFrame password. Send a key in the `Authorization: Bearer YOUR_API_KEY` header. The management API retains its existing `/tokens` routes and `token` response field for compatibility; these tokens are the API keys shown in Settings. Existing keys continue working. From server 0.22.2, Settings and the session-based feed setup and key-management endpoints require an admin account; users with viewing access can still use shared feeds in slide widgets.

For an existing integration, start with the [API update and migration bulletin](api-update-multi-site.md).

## One integration, multiple stores (server 0.30.3+)

Use one application for SMCC and issue a **Multiple stores (central)** key with
an explicit store selection. `POST /api/data-feeds/ingest-stores/:sourceKey`
accepts an atomic `stores` batch with store-numbered `metrics` and `tables`
sections. See the brief [SMCC integration update](smcc-integration-update.md)
for the request, limits, response, and retry contract. Per-store application keys
and the original ingestion route continue working unchanged. Central keys cannot
use that old route; single-store keys cannot use the batch route.

Settings groups application feeds by integration, with stores underneath.
Internally snapshots remain per store and source; this preserves screen-level
isolation and the existing **Follows each screen’s store** widget bindings.
New central feeds use the site's access group, falling back to the application's
managing group. Existing feed ownership stays unchanged. Keys authorize only
the selected existing stores; rotate a key to add stores. The application itself
is not tied to a single site.

## Application keys: automatic metric creation

For a concise integration handoff, use the [application metrics API one-pager](data-feeds-api-one-pager.md).

As an admin, open **Settings → Data feeds → New application**, give the application a name, and choose **Personal** or a managing group once. Create the application, enter a key name and expiry, and select **Generate application API key**. Copy the one-time key and the **Ingest URL**. **Copy integration details** provides the endpoint, method, example payload and guide; share the key separately. No individual feed or field setup is needed on the host.

The application chooses a stable feed name in the URL, for example `production`, and sends metric names and values directly as JSON:

```sh
curl --fail-with-body --request POST \
  'https://openframe.blackfalcon.cloud/api/data-feeds/ingest/production' \
  --header 'Authorization: Bearer YOUR_APPLICATION_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"completed":42,"goal":100}'
```

The first successful request creates a reusable feed named after the application and source, defines `completed` and `goal` as Number fields, and returns HTTP **201**. Later requests to the same name with any key belonging to the same application and site return **200** and update the same feed ID. The application can choose other feed names with the same key. Different applications or sites using `production` get separate feeds; keys cannot read snapshots, modify another application's feeds, manage sharing, or act as an OpenFrame login. Existing `ofd_` feed keys cannot use this endpoint; application keys use the `ofa_` prefix.

```json
{
  "applicationId": "11111111-1111-4111-8111-111111111111",
  "sourceKey": "production",
  "feedId": "22222222-2222-4222-8222-222222222222",
  "fields": [{"key":"completed","type":"number"},{"key":"goal","type":"number"}],
  "revision": "33333333-3333-4333-8333-333333333333",
  "updatedAt": "2026-10-07T18:00:00.000Z",
  "created": true
}
```

A later push such as `{"completed":43,"orders":12}` updates `completed`, creates `orders`, and keeps `goal` at 100. This endpoint **merges named metrics**; it does not require a complete snapshot. New numeric values or null create Number fields. Nonempty arrays of `{time,value}` create Time series fields; nonempty arrays of `{label,value}` create Categories fields. Once created, a metric's type cannot change. Null clears an existing number; an empty array clears an existing chart. New chart fields need a nonempty first array so their type can be identified. All existing value bounds and chart validation below still apply.

Feed names are case-sensitive, 1–80 characters, starting with a letter or number and containing only letters, numbers, underscores or hyphens. Metric keys use the existing 1–40 character field-key rules below. Each request has 1–20 metrics; each feed may accumulate at most 20 fields. Use another feed name for an additional set of metrics. Payloads remain limited to **32 KiB**. The **60 ingestion calls per minute per application/site** budget is shared by its keys and feed names, including parsed requests with invalid metric values. An application also has a **600/minute aggregate ceiling**. Saturated-site rejections do not consume other sites’ aggregate allowance. Unassigned keys share a separate 60/minute scope. Writes validate the entire request before committing feed creation, fields, values, ownership, source mapping and key usage together. Invalid requests retain the previous data and schema.

The server supports up to 50 registered applications, 20 active keys per application and 200 total feeds across both modes. Expired/revoked key metadata is pruned when generating another key. Application keys can expire in 1–365 days (90 by default) or **Never expires**. Change an existing key’s expiration without rotating its secret, or revoke it under **Manage keys**. The issuing account must remain an active admin: disabling, deleting or demoting it stops writes. User deletion also explicitly revokes its application keys. Rotating a key within the same application preserves its feed names and IDs.

Automatically created feeds use the application's configured managing group and the first writer's personal ownership. They appear in the existing feed list and widget selectors. The Settings feed list refreshes about every 15 seconds while open. Select the feed/metric in a slide and publish its layout once; subsequent data updates use normal preview/player sync without republishing. Existing sharing and schema 4 rules still apply. Revoking a key preserves feeds, last values and slide bindings. Admins can delete an application only after removing all its unused feeds; normal feed deletion protection prevents removing feeds referenced by drafts or publications. Deleting an unused feed clears that name's mapping, so another push recreates it; revoke the application's keys first to stop recreation.

Additional ingestion failures include **409 `FIELD_LIMIT`**, **409 `FEED_LIMIT`**, and **429 `RATE_LIMITED`** with `Retry-After`. Invalid fields/types use **400 `INVALID_PAYLOAD`**; rejected keys use **401 `INVALID_TOKEN`**. A missing configured managing group uses **409 `INVALID_GROUP`** and prevents creation. The legacy per-feed PUT endpoint below retains complete-snapshot behavior and fixed field definitions.

## API key expiration

Application and feed-key creation accept `expiresInDays: null` for **Never
expires**. Omitting it keeps the 90-day default; finite values remain 1–365.
Public key metadata returns `expiresAt: null` for non-expiring keys. Admins can
also change an existing key without rotating its secret:

```http
PATCH /api/data-feeds/applications/APPLICATION_UUID/tokens/KEY_UUID
Content-Type: application/json
Cookie: openframe_session=ADMIN_SESSION

{"expiresInDays":null}
```

For feed-specific keys, use `PATCH /api/data-feeds/FEED_UUID/tokens/KEY_UUID`
with the same body. A finite day count sets a new expiry relative to now. These
are session-authenticated management endpoints; ingestion keys cannot call them.
Revoked keys cannot be renewed. Non-expiring keys count toward the same 20-active-
key limit, and issuer authorization, site restrictions and revocation still apply.
Existing expiry dates are preserved during the database migration.

## SMCC and other numeric tables

A numeric table is a **Categories** field: one array of `{label,value}` rows. Use the existing application endpoint and key; no `table` field type or wrapper is required. For example, keep ordinary metrics at `production` and send tables under a separate `production-tables` source:

```http
POST /api/data-feeds/ingest/production-tables
Authorization: Bearer YOUR_APPLICATION_API_KEY
Content-Type: application/json

{"freight_counts":[{"label":"CAP2 unloaded","value":12},{"label":"CAP2 remaining","value":3}],"training_percent":[{"label":"Compliance","value":97.2}]}
```

The first push creates each table field as `categories`. Later pushes replace each included table's complete row array. Omitted table fields retain their previous rows. Keep metric and table sources separate when their field keys overlap: field types remain immutable within one feed. An empty array clears an existing table; skip the field entirely to keep its previous rows. The first push for a new table must be nonempty.

In the editor choose **Widgets → Table**, select the resulting feed and table field, and set its unit/precision. Each table has one label column and one numeric value column, with one display unit per card. SMCC's decision to skip mixed-unit tables is consistent with this presentation. Row order is preserved. Use **First row** and **Visible rows** to divide larger tables across cards. For views and ranges through row 40, these controls need server **0.26.1** and player **0.12.1**. Rows 41–100 require server **0.29.7** and player **0.15.4**; the ingestion method and numeric-row format are unchanged.

Limits remain **100 rows per field**, unique trimmed labels of **1–60 characters**, finite values within **±1 trillion**, and **32 KiB per request**. A request can include up to 20 table fields subject to that total byte limit. The table source shares the application's existing rate budget. Update timestamps describe the feed's receipt time, not an observation timestamp for each row. Text cells, multiple value columns, mixed units, and collector datasets require a separately agreed payload; they are not inferred from this numeric-row format.

## Feed-specific keys: existing quick start

1. As an OpenFrame admin, open **Settings → Data feeds → New feed**. Give it a name and a managing group. Add field keys and types. For the example below use `completed` (number), `goal` (number), `hourly` (time series), and `departments` (categories).
2. Open that feed, enter an application name, select **Generate API key**, and copy the key from the one-time pop-up. The pop-up also provides the exact update URL. Choose an expiry, 1–365 days (90 by default), or **Never expires**. Existing keys have a **Change expiration** control; changing the expiry preserves the secret. The token is shown once; OpenFrame stores only its SHA-256 hash. If lost, create a replacement and revoke the old token.
3. Use **Copy integration details** in the feed dialog to copy its base URL, feed ID, exact field definitions, update URL, and documentation links. Give the integration this handoff and provide the token separately through a secret store. Tokens are feed-specific and write-only. They cannot read data, manage feeds, edit slides, or access other feeds. Do not include a token in slides, public code, browser JavaScript, or logs.
4. Send a snapshot using the request below.
5. In a slide's **Widgets** section add a Metric, Progress bar, Line graph, or Bar chart. Select this feed and a compatible field. For a progress bar select `completed` and target field `goal`, or set a positive fixed target. Publish the playlist layout once and assign it to your screens.

Replace `FEED_ID` and `YOUR_API_KEY`. These are placeholders; no real credentials appear in this guide.

```sh
curl --fail-with-body --request PUT \
  'https://openframe.blackfalcon.cloud/api/data-feeds/FEED_ID/data' \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "completed": 75,
    "goal": 100,
    "hourly": [
      {"time": "2026-10-06T09:00:00Z", "value": 30},
      {"time": "2026-10-06T10:00:00Z", "value": 75}
    ],
    "departments": [
      {"label": "Grocery", "value": 42},
      {"label": "General merchandise", "value": 33}
    ]
  }'
```

Successful response: HTTP `200`, `Content-Type: application/json`:

```json
{
  "feedId": "11111111-1111-4111-8111-111111111111",
  "revision": "22222222-2222-4222-8222-222222222222",
  "updatedAt": "2026-10-06T10:00:05.000Z"
}
```

`updatedAt` is the server's UTC receipt time, not the observation time of your measurements. `revision` is an opaque snapshot identifier. Send measurement timestamps in series points when needed.

## The update contract

`PUT /api/data-feeds/{feedId}/data` replaces **all** current data atomically. Send the field-value object directly, without a `data` wrapper. Include every declared field and no undeclared fields. Field keys are case-sensitive. Field definitions are fixed after creation; create a new feed to change its schema.

| Field type | JSON value | Limits and rules |
| --- | --- | --- |
| `number` | `75` or `null` | Finite number between −1,000,000,000,000 and +1,000,000,000,000. `null` explicitly clears a measurement. No numeric strings. |
| `series` | `[{"time":"2026-10-06T10:00:00Z","value":75}]` | At most 240 points. ISO 8601 datetime with `Z` or an explicit offset. Unique timestamps in strictly ascending chronological order. Each value has the number bounds above and cannot be null. |
| `categories` | `[{"label":"Grocery","value":42}]` | At most 40 entries. Unique, nonempty labels, trimmed, at most 60 characters. Values have the number bounds above and cannot be null. The chart preserves input order; negative values are supported. |

An empty series or category array clears that chart. Progress targets must be positive to render; an invalid/null target displays an explanatory placeholder. Bars clamp the fill to 0–100%, while showing the actual value and percentage when the goal is exceeded. Line graphs use actual timestamp spacing. Chart axes auto-scale and include zero.

Maximum request body **32 KiB (32,768 bytes)**. A feed has 1–20 unique fields; keys match `^[A-Za-z][A-Za-z0-9_]{0,39}$`. Your payload must satisfy both the field limits and the total body limit. No automatic append or stored history is provided: your integration supplies the rolling series each time. There is one current snapshot per feed, persisted across server restarts. Treat concurrent writers as last successful write wins; there is no compare-and-swap or ordering by source time.

Maximum **60 attempted authorized updates per minute per feed**, shared by all its tokens. Validation failures after authentication also consume that budget. HTTP `429` includes `Retry-After` in seconds. Keep a regular integration at 15-second or slower cadence unless faster ingestion is needed; players usually fetch every 15 seconds, so more writes do not imply faster screen refresh.

On timeout or connection failure you may retry the same snapshot with a short exponential backoff. It replaces data again and returns a new revision/receipt time. Stop automatic retries for validation and authentication errors. On `429`, wait at least `Retry-After` seconds. On `5xx`, use bounded backoff. Set a client timeout, e.g. 10 seconds. Avoid logging Authorization headers.

## Errors

Feed routes return JSON errors with a human-readable `error` and stable `code`. Examples:

```json
{"code":"INVALID_PAYLOAD","error":"completed: Invalid input: expected number, received string"}
```

| HTTP | Code | Integration action |
| --- | --- | --- |
| 400 | `INVALID_PAYLOAD` | Fix invalid JSON, missing/unknown keys, wrong types, excessive entries, or unsorted/duplicate series timestamps. The previous snapshot remains intact. |
| 401 | `INVALID_TOKEN` | Token missing, malformed, wrong feed, expired, revoked, or creator no longer has Edit access. Replace or restore its authorized access. |
| 403 | `REQUEST_FAILED` | An Origin header was rejected by the server's same-origin policy. Call from your integration's backend rather than embedding a token in a web page. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce body to 32,768 bytes or less. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Send `Content-Type: application/json`. |
| 429 | `RATE_LIMITED` | Wait the `Retry-After` interval. |
| 500 | `REQUEST_FAILED` | Retry with bounded backoff; inspect server logs if persistent. |

A route that does not exist returns 404. A token intentionally receives 401 for a missing or inaccessible feed, avoiding information about other feeds. Reverse proxies may return their own non-JSON errors or tighter body limits. Always check the HTTP status before parsing the success response.

## Access, playback, and offline behavior

Feeds use the same group hierarchy and View/Edit rules as slides and playlists. Direct managing-group members have content Edit access. Feed setup and key management require an admin session; previously issued feed-specific keys still check their creator’s active Edit permission on every write. Access inherited through ancestor/descendant groups is View only unless an explicit Edit grant exists. Admins have unrestricted access. Tokens are rechecked on every write against the creator's current active account and Edit permission: disabling the creator or removing their Edit access stops writes immediately. Reassignment may change who can manage the feed. There are at most 20 active tokens per feed and 200 feeds per server; expired/revoked token metadata is pruned when issuing another token.

A slide's viewers must also be able to view its bound feed. Sharing slides/playlists/screens propagates View access to dependencies where the sharing user has permission to grant it. Publication checks verify playlist recipients' feed access. A published playlist can reference at most 20 distinct feeds. Preview and player sync deliver only referenced snapshots, never tokens or token hashes. Online players clear inaccessible data when a successful sync returns `unavailable`.

Data changes update visible widgets in place through normal sync without changing the playlist publication revision or restarting its active slide. Pi and Android cache the latest successful sync on disk and use it while offline, including after restarting the app. Optional update-age labels show when data becomes stale (60 minutes by default, adjustable in the editor). Revocation cannot erase a disconnected device's cached data until it reconnects. Keep sensitive information off screens that cannot reliably reconnect.

## Session-authenticated management API

These endpoints are for the OpenFrame UI or a trusted operator session, **not** feed tokens. Session cookies and same-origin checks use the existing OpenFrame authentication API. You do not need these endpoints for an integration that only sends updates.

| Method and path | Purpose |
| --- | --- |
| `GET /api/data-feeds/openapi.json` | Public machine-readable contract; no authentication. |
| `GET /api/data-feeds/guide` | Public downloadable copy of this guide; no credentials. |
| `GET / POST /api/data-feeds/applications` | Admin list/create `{name,managingGroupId?:UUID|null}`; metadata includes `id`, `createdAt`, and `feedCount`. |
| `DELETE /api/data-feeds/applications/{id}` | Admin deletes an application with no feeds and its keys; 409 `APPLICATION_IN_USE` otherwise unless `disconnectWidgets=true` explicitly deletes its feeds and disconnects widgets too. |
| `GET / POST /api/data-feeds/applications/{id}/tokens` | Admin lists key metadata or generates a key with `{name,expiresInDays?:90}`; POST returns one-time `token`. |
| `DELETE /api/data-feeds/applications/{id}/tokens/{tokenId}` | Admin revokes an application key. |
| `POST /api/data-feeds/ingest/{sourceKey}` | Application-key authentication; automatically creates/extends a scoped feed and merges named metric values. |
| `GET /api/data-feeds` | Visible feed metadata and field definitions; no snapshot values. |
| `POST /api/data-feeds` | Create `{name, managingGroupId: UUID or null, fields:[{key,type}]}`. Returns 201 metadata. |
| `GET /api/data-feeds/{id}` | View feed metadata. |
| `PUT /api/data-feeds/{id}` | Edit name/management using the same creation shape; fields must remain identical. Edit permission required. |
| `DELETE /api/data-feeds/{id}` | Delete an unused feed and tokens. Refused with 409 `FEED_IN_USE` while referenced by drafts or published playlists unless an administrator explicitly supplies `disconnectWidgets=true`; see [widget-preserving deletion and reset](https://github.com/veRoduS/OpenFrame/blob/main/docs/data-connection-reset.md). |
| `GET /api/data-feeds/{id}/data` | View `{revision,updatedAt,data,status}`. `status` is `empty` before the first write, otherwise `ready`. |
| `GET /api/data-feeds/{id}/tokens` | Edit permission required. Metadata only; no token/hash. |
| `POST /api/data-feeds/{id}/tokens` | Edit permission required. Body `{name,expiresInDays:90}`. Returns 201 metadata plus one-time `token`. |
| `DELETE /api/data-feeds/{id}/tokens/{tokenId}` | Edit permission required. Revoke immediately; returns `{ok:true}`. |
| `/api/access/data-feed/{id}` | Existing View/Edit sharing interface, documented in [API overview](api.md). |

Management errors include 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `IMMUTABLE_FIELDS`, `FEED_IN_USE`, `FEED_LIMIT`, and `TOKEN_LIMIT`, plus normal payload errors. Unauthenticated sessions return 401 using the standard session-authentication error shape.

## Copyable Python client

A dependency-free script is in [examples/push-data-feed.py](examples/push-data-feed.py). Run it with a complete JSON payload file; put the token in an environment secret:

```sh
export OPENFRAME_URL='https://openframe.blackfalcon.cloud'
export OPENFRAME_FEED_ID='FEED_ID'
# Set OPENFRAME_FEED_TOKEN through your secret manager; do not commit it.
python3 push-data-feed.py snapshot.json
```

The script validates basic configuration, uses a 10-second timeout, honors rate-limit delays, and retries connection/5xx failures up to three times. It never prints the token. For an AI handoff, include this guide and OpenAPI JSON plus your field definitions and intended update schedule; supply credentials separately.

## Sites: initial storage support

Site support introduced in 0.29.1 is extended by server **0.29.2** and player
**0.15.1**. See [Sites and shared metric layouts](sites.md) for setup, converting
existing integrations, player upgrades, permissions, and rollout limits.

Feed identity is `(applicationId, siteId, sourceKey)`. Ingestion derives the site
from the authorized application key; metric bodies and source URLs are unchanged.
A rotated key for the same application/site updates the same feed IDs. Keys for
different sites cannot overwrite each other's values. Application ingestion uses a shared 60/minute budget per application/site and a
600/minute application ceiling. Saturated-site rejections do not consume the
aggregate budget. Feed and key count limits remain unchanged. Site numbers use 1–20 digits and retain leading zeros.

Administrative endpoints (administrator session required):

- `GET /api/sites`: list sites, including archived sites.
- `POST /api/sites`: `{ "siteNumber": "001", "name": "North" }`.
- `PATCH /api/sites/{id}`: optional `name` and/or `archived` boolean.
- `POST /api/data-feeds/applications/{id}/tokens`: existing key request plus
  `siteId` (an internal UUID). New keys require an active site once sites exist.
- `POST /api/data-feeds/applications/{id}/assign-site`: `{ "siteId": "UUID" }`.
  Atomically assigns all unassigned keys and sources for that application,
  preserving hashes, feed IDs, data, grants, and published references. Returns
  `assignedFeeds` and `assignedKeys` counts. Repeated assignment is harmless.
  A destination source collision returns `409 SITE_SOURCE_CONFLICT` and changes
  nothing. Already site-bound integrations cannot be moved through this operation.

Existing integrations remain in a separate Unassigned namespace until explicitly
assigned. Feed-specific keys inherit the site's assignment from their feed.
Archiving a site prevents ingestion through either credential type, retains data,
and does not blank already approved screens. Errors include `SITE_REQUIRED`,
`INVALID_SITE`, `SITE_ARCHIVED`, and `SITE_SOURCE_CONFLICT`.

Shared widgets retain an example `feedId` for authoring and optionally store
`siteBinding: { applicationId, sourceKey }`. The server resolves that source to the
approved screen's site, validates field types and permissions, and emits a
concrete `feedId` and only the permitted values. Missing local data is unavailable,
with no cross-site fallback. Existing fixed-feed bindings stay fixed. Preview
requests can select `siteId` and use the same resolution and field checks.

The source-mapping migration is transactional and repeatable. Back up before
upgrading; downgrade only with the matching pre-upgrade database and server.


Server 0.29.3 adds manual feed site assignment (`POST /api/data-feeds/{id}/assign-site`),
conditional `siteId` on new manual feed creation, optional site `accessGroupId`,
and paginated administrator-only site history. Existing manual feed IDs, snapshots,
fields and token hashes are preserved by first assignment; feed sites are immutable
afterward. A site access group adds a membership gate to existing resource rights.
See [site transfers, permissions, history and saved views](sites.md) for operation.
