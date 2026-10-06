# OpenFrame Data Feeds API

This guide is a complete handoff for a developer or AI building an integration. The external integration sends JSON snapshots to a reusable feed; slides display fields through metric, progress, line graph, or bar chart widgets. Updates do not edit the slide or require publishing a playlist again.

**Base URL:** your OpenFrame server, for example `https://openframe.blackfalcon.cloud`.
**Contract:** download `GET /api/data-feeds/openapi.json` (OpenAPI 3.1), or share [the JSON file](../server/data-feeds.openapi.json).
**Requirements:** server 0.20.0+, player 0.10.13+ for data widgets. Existing slides remain compatible with older players. Use HTTPS outside a trusted local network.

## Quick start

1. In OpenFrame, open **Data feeds → New feed**. Give it a name and a managing group. Add field keys and types. For the example below use `completed` (number), `goal` (number), `hourly` (time series), and `departments` (categories).
2. Open that feed, create a named update token, and copy it immediately. Choose an expiry, 1–365 days (90 by default). The token is shown once; OpenFrame stores only its SHA-256 hash. If lost, create a replacement and revoke the old token.
3. Use **Copy integration details** in the feed dialog to copy its base URL, feed ID, exact field definitions, update URL, and documentation links. Give the integration this handoff and provide the token separately through a secret store. Tokens are feed-specific and write-only. They cannot read data, manage feeds, edit slides, or access other feeds. Do not include a token in slides, public code, browser JavaScript, or logs.
4. Send a snapshot using the request below.
5. In a slide's **Widgets** section add a Metric, Progress bar, Line graph, or Bar chart. Select this feed and a compatible field. For a progress bar select `completed` and target field `goal`, or set a positive fixed target. Publish the playlist layout once and assign it to your screens.

Replace `FEED_ID` and `YOUR_FEED_TOKEN`. These are placeholders; no real credentials appear in this guide.

```sh
curl --fail-with-body --request PUT \
  'https://openframe.blackfalcon.cloud/api/data-feeds/FEED_ID/data' \
  --header 'Authorization: Bearer YOUR_FEED_TOKEN' \
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

Feeds use the same group hierarchy and View/Edit rules as slides and playlists. Direct managing-group members can edit the feed and issue/revoke update tokens. Access inherited through ancestor/descendant groups is View only unless an explicit Edit grant exists. Admins have unrestricted access. Tokens are rechecked on every write against the creator's current active account and Edit permission: disabling the creator or removing their Edit access stops writes immediately. Reassignment may change who can manage the feed. There are at most 20 active tokens per feed and 200 feeds per server; expired/revoked token metadata is pruned when issuing another token.

A slide's viewers must also be able to view its bound feed. Sharing slides/playlists/screens propagates View access to dependencies where the sharing user has permission to grant it. Publication checks verify playlist recipients' feed access. A published playlist can reference at most 20 distinct feeds. Preview and player sync deliver only referenced snapshots, never tokens or token hashes. Online players clear inaccessible data when a successful sync returns `unavailable`.

Data changes update visible widgets in place through normal sync without changing the playlist publication revision or restarting its active slide. Pi and Android cache the latest successful sync on disk and use it while offline, including after restarting the app. Optional update-age labels show when data becomes stale (60 minutes by default, adjustable in the editor). Revocation cannot erase a disconnected device's cached data until it reconnects. Keep sensitive information off screens that cannot reliably reconnect.

## Session-authenticated management API

These endpoints are for the OpenFrame UI or a trusted operator session, **not** feed tokens. Session cookies and same-origin checks use the existing OpenFrame authentication API. You do not need these endpoints for an integration that only sends updates.

| Method and path | Purpose |
| --- | --- |
| `GET /api/data-feeds/openapi.json` | Public machine-readable contract; no authentication. |
| `GET /api/data-feeds/guide` | Public downloadable copy of this guide; no credentials. |
| `GET /api/data-feeds` | Visible feed metadata and field definitions; no snapshot values. |
| `POST /api/data-feeds` | Create `{name, managingGroupId: UUID or null, fields:[{key,type}]}`. Returns 201 metadata. |
| `GET /api/data-feeds/{id}` | View feed metadata. |
| `PUT /api/data-feeds/{id}` | Edit name/management using the same creation shape; fields must remain identical. Edit permission required. |
| `DELETE /api/data-feeds/{id}` | Delete an unused feed and tokens. Refused with 409 `FEED_IN_USE` while referenced by drafts or published playlists. |
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
