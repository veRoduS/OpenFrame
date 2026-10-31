# OpenFrame API Update: Site-Scoped Metrics

For **server 0.30.3+**, integrations can instead use one central application
key and an atomic all-store batch. See the brief
[SMCC integration update](smcc-integration-update.md). The per-store methods
below remain supported unchanged; their body-routing restrictions apply to the
original `/ingest/:sourceKey` endpoint.

Developer migration bulletin • 30 October 2026

**Audience:** Developers maintaining existing OpenFrame metric integrations. The
player/admin appendix applies only to custom enrollment or screen-management apps.

**Target:** The multi-site API implemented through development server **0.29.7**
and player **0.15.4**. This update is prepared for testing and has not yet been
published or deployed. The final release tag may differ. Confirm availability
with the host administrator before changing production configuration;
`GET /api/health` reports the deployed server version.

## 1. What your application needs to change

Most existing producers can keep their HTTP method, URL pattern, and metric JSON.
The new requirement is correct **site-to-credential mapping**. Each application
API key belongs to one site, and each screen has an approved site.

| Your current integration | Required action | Request compatibility |
| --- | --- | --- |
| `ofa_` application key, one location | Administrator assigns the existing application integration to its original site. Keep the existing key and source names. | Existing `POST` payloads continue working. |
| `ofa_` application key, several locations | Configure a separate site-bound key for each location. Choose the correct key before each push. | Keep the same source/field names across sites for shared layouts. |
| `ofd_` feed-specific key | Administrator assigns the existing feed to its original site. Keep its feed ID and key. | Existing complete-snapshot `PUT` requests remain supported. |
| Intentionally switching from `ofd_` to `ofa_` | Obtain new application/site keys, change endpoint/method, and coordinate widget rebinding. | This is an optional migration that normally creates new feed IDs. |

Keys are opaque credentials. Do not change a prefix, manufacture a key, or reuse
a player device token as an integration key. Key prefixes identify different
credential types; they are not interchangeable.

## 2. Site numbers, site IDs, and feed identity

- **Site number:** Human-facing string, such as `001`. It contains 1–20 digits;
  leading zeros are significant, so `001` and `1` are different sites.
- **Site ID:** Internal UUID used by management APIs and ingestion receipts.
- **Application ID:** Internal UUID identifying the registered producer application.
- **Source key:** Application-chosen, case-sensitive feed name, such as `production`.
- **Feed ID:** UUID identifying one concrete feed and its latest saved values.

Application feeds previously used `(applicationId, sourceKey)` as their identity.
They now use **`(applicationId, siteId, sourceKey)`**. Two keys for different sites
can send `production` without overwriting one another. Rotating a key within the
same application/site preserves that site's feed IDs.

If your app caches feed IDs or receipts, include site identity in its cache key.
Do not assume the same application/source has one global feed ID. The write
receipt returns `siteId`, not the human site number; obtain the number-to-ID
mapping from the administrator if your app needs both.

**The authenticated key selects the destination.** Do not add `siteNumber`,
`siteId`, a site wrapper, or a custom site header to route metric ingestion.
Top-level JSON properties are metric names, not routing instructions. A caller
cannot use a request property to override its key's site assignment.

## 3. Existing application-key producers (`ofa_`)

The endpoint and direct JSON object are unchanged:

```http
POST /api/data-feeds/ingest/production
Authorization: Bearer YOUR_SITE_APPLICATION_KEY
Content-Type: application/json

{"completed":42,"goal":100}
```

Use the same `production` source and field names at each location, with a different
key for each site's request. A key can still write several sources at its own
site, for example `production` and `production-tables`.

Example configuration owned by **your app**, not an OpenFrame request body:

```json
{
  "serverUrl": "https://your-openframe.example",
  "sourceKey": "production",
  "sites": {
    "001": { "apiKeySecretRef": "openframe/site-001" },
    "002": { "apiKeySecretRef": "openframe/site-002" }
  }
}
```

Store actual keys in your deployment's secret configuration. For a single-site
app, one configured key is enough. A central producer sending several locations
must choose the matching secret for each location.

Example using an injected site credential:

```sh
curl --fail-with-body --request POST \
  "$OPENFRAME_URL/api/data-feeds/ingest/production" \
  --header "Authorization: Bearer $OPENFRAME_SITE_API_KEY" \
  --header 'Content-Type: application/json' \
  --data '{"completed":42,"goal":100}'
```

Accept **201 Created** on the first push and **200 OK** on subsequent pushes.
Successful receipts include the additional, nullable `siteId` field:

```json
{
  "applicationId": "11111111-1111-4111-8111-111111111111",
  "siteId": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  "sourceKey": "production",
  "feedId": "22222222-2222-4222-8222-222222222222",
  "fields": [
    { "key": "completed", "type": "number" },
    { "key": "goal", "type": "number" }
  ],
  "revision": "33333333-3333-4333-8333-333333333333",
  "updatedAt": "2026-10-30T12:00:00.000Z",
  "created": true
}
```

These identifiers and timestamps are illustrative. `siteId: null` identifies an
Unassigned legacy integration; it does not authorize all sites. Ask the host
administrator to assign it rather than guessing a destination.

Application ingestion still **merges named fields**. After the request above,
`{"completed":43}` changes completed to 43 and retains goal at 100. New fields
are inferred automatically, up to the feed's field limit. Receipts contain
identifiers/schema metadata, not the complete stored metric snapshot.

## 4. Existing feed-specific producers (`ofd_`)

This method remains supported:

```http
PUT /api/data-feeds/YOUR_FEED_UUID/data
Authorization: Bearer YOUR_EXISTING_FEED_KEY
Content-Type: application/json

{"completed":42,"goal":100}
```

Keep sending **every declared field**, with no extras. Omitting `goal` from a
feed that declares it returns 400 and preserves the previous snapshot. Fields
are not added automatically through this endpoint. Successful writes return
**200 OK** with `feedId`, `revision`, and `updatedAt`.

Assigning an existing manual feed to a site preserves its ID, data, field schema,
keys, and widget bindings. The existing key inherits its feed's site; the external
producer does not need to add a site field or obtain a different key solely for
that first assignment. Normal expiry, revocation, and issuer-access checks still
apply. A feed's assigned site cannot subsequently be changed.

### Optional switch to application ingestion

To adopt automatic metric creation:

1. Obtain an issued `ofa_` key for the intended application/site.
2. Change `PUT /api/data-feeds/{feedId}/data` to
   `POST /api/data-feeds/ingest/{sourceKey}`.
3. Accept both 201 and 200. Seed the needed fields on the first push.
4. Save the returned feed ID and coordinate widget rebinding with the host admin.
5. Verify new writes and displayed values before revoking an obsolete `ofd_` key.

The new application source does not automatically adopt an existing manual
feed's ID. Do not assume existing slides will follow a newly created feed.

## 5. Payload rules and clearing values

| Behavior | Application `POST` | Feed-specific `PUT` |
| --- | --- | --- |
| Omitted field | Retains its previous value | Invalid if the field is declared |
| New field | Automatically inferred | Invalid; fixed declared schema |
| Number cleared | Send `null` for that field | Send `null`, plus all other declared fields |
| Series/category cleared | Send `[]` for the existing field | Send `[]`, plus all other declared fields |
| Array update | Replaces that field's entire array | Replaces the complete snapshot, including arrays |
| Invalid value | Entire request rejected atomically | Entire request rejected atomically |

Types remain Number, Time series, and Categories. Numeric tables use Categories:
`[{"label":"Unloaded","value":12}]`. Strings and booleans are not metric values;
send `42`, not `"42"` or `"42%"`. Existing field types cannot change.

For a new application field, a number or `null` infers Number. A new chart field
requires a nonempty array to infer its type; `[]` can clear an existing chart
field but cannot define a new one. Series points and category rows are replaced,
not appended. OpenFrame stores the latest snapshot, not an append-only history.

## 6. Limits, errors, and retries

| Limit | Multi-site update |
| --- | --- |
| Application ingestion | 60 attempts/minute per application/site, shared across keys and sources |
| Application aggregate ceiling | 600 attempts/minute across all its sites |
| Legacy Unassigned application keys | Share their own 60/minute scope |
| Feed-specific ingestion | 60 attempts/minute per feed, shared across its keys |
| Body size | 32 KiB (32,768 bytes) |
| Application payload | 1–20 metrics; maximum 20 fields per feed |
| Count limits | 200 feeds globally; 50 applications; 20 active keys per application |
| Number | Finite, within ±1 trillion |
| Time series | At most 240 points with unique, increasing ISO timestamps |
| Categories | At most 100 unique trimmed labels, each 1–60 characters |

Source names match `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`. Metric names match
`[A-Za-z][A-Za-z0-9_]{0,39}`. Names are case-sensitive.

Authenticated, parsed requests with invalid metric values consume ingestion
budget. A request rejected because its site is already saturated does not consume
other sites' aggregate allowance. Key rotation does not reset the site's budget.

Ingestion errors return `{"code":"...","error":"..."}`:

| HTTP status | Examples | Required handling |
| --- | --- | --- |
| 400 | `INVALID_PAYLOAD`, invalid names/types, `INVALID_SITE` | Correct configuration or data; avoid blind retries. |
| 401 | `INVALID_TOKEN`: wrong, expired, revoked, or unauthorized key | Check the issued credential and issuer status with the host admin. |
| 409 | `SITE_ARCHIVED`, `INVALID_GROUP`, `FEED_LIMIT`, `FIELD_LIMIT` | Resolve the site/group/limit issue; do not loop unchanged requests. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce the payload. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Send `Content-Type: application/json`. |
| 429 | `RATE_LIMITED` | Honor `Retry-After` seconds, then retry with backoff. |
| 5xx / network failure | Temporary server or connection failure | Use bounded retries with backoff and jitter. |

A timeout can happen after a write committed. Retrying the same snapshot values
is safe for values, but each successful write creates a new revision/timestamp;
there is no exactly-once or idempotency-key guarantee. Ingestion sets values—it
never interprets a number as an increment command. Avoid forwarding bearer keys
through redirects or including them in logs or support messages.

## 7. Administrator changes that affect integration apps

These are **administrator-session APIs**, not endpoints authorized by an
integration bearer key. Producers normally receive their key/configuration from
the administrator and do not need to call them.

| Endpoint | Purpose / update |
| --- | --- |
| `GET /api/sites` | Obtain site number/UUID metadata. |
| `POST /api/sites` | Create `{siteNumber,name,accessGroupId?}`. |
| `POST /api/data-feeds/applications/{id}/tokens` | Issue `{name,expiresInDays?,siteId}`; response still uses the one-time `token` field. |
| `PATCH /api/data-feeds/applications/{id}/tokens/{keyId}` | Change `{expiresInDays}` without rotating the application secret; null means never expires. |
| `PATCH /api/data-feeds/{id}/tokens/{keyId}` | Change `{expiresInDays}` without rotating the feed-specific secret. |
| `POST /api/data-feeds/applications/{id}/assign-site` | Assign all of that application's Unassigned keys/sources together using `{siteId}`. |
| `POST /api/data-feeds` | Manual feed creation accepts `siteId`, required once any site exists. |
| `POST /api/data-feeds/{id}/assign-site` | Assign one Unassigned manual feed using `{siteId}`. |

Assign existing integrations **before** creating duplicate destination sources
if you need to preserve their feed IDs. A destination conflict returns
`409 SITE_SOURCE_CONFLICT`; the entire application assignment rolls back.
Already assigned keys/sources are not moved by this migration. Assigning an
already scoped manual feed to another site returns `409 IMMUTABLE_SITE`.

Site numbers are strings in creation/enrollment; management assignments use UUIDs.
New application keys require an active site once sites exist. Finite expiry is
1–365 days, default 90; explicitly send `expiresInDays: null` for a non-expiring
key. Metadata then returns `expiresAt: null`. Use `PATCH` on either key's
management URL with `{ "expiresInDays": null }` or a day count to change an
existing key without replacing its secret. Revoked keys cannot be renewed;
non-expiring keys still count toward the 20-active-key cap. Key secrets remain
visible once at issuance; they cannot be retrieved later.

Archiving a site stops ingestion, new keys, and new enrollment at that site while
retaining saved values. Revoking a key stops future writes and retains existing
data. An application key's issuing account must remain an active administrator;
a feed-specific key's issuer must retain active Edit access. Optional site access
groups add membership requirements to resource permissions for non-admin users.
Integration keys still cannot read snapshots, manage users/screens, or approve
players. Some management errors contain only `error`; check HTTP status first.

## 8. Cutover and developer acceptance checklist

- [ ] Confirm the updated server is deployed to the test environment.
- [ ] Inventory each producer's method/key type, source names, stored feed IDs,
  and location. Keep site numbers as strings.
- [ ] Have the admin create the original/new sites and assign existing
  application integrations or manual feeds to their original locations.
- [ ] Configure separate keys for additional sites and update any feed-ID caches
  to include site identity. Preserve common source/field names for shared layouts.
- [ ] Accept application 201/200 and the added nullable `siteId` receipt field.
- [ ] Verify Site 001 pushing completed=42 and Site 002 pushing completed=17
  produce independent feeds. Update Site 001 to 43; Site 002 must stay at 17.
- [ ] Verify merge behavior for `POST`, complete snapshots for `PUT`, and
  explicit null/empty-array clearing.
- [ ] Verify rotation at the same application/site keeps the same feed ID;
  handle revoked/expired keys, archived sites, and 429 retry timing.
- [ ] Have the admin assign screens to their sites and publish shared widgets
  with a source under **Follows each screen’s store**. Check each site's
  preview and screen.
- [ ] For an intentional method switch, update/re-publish affected bindings and
  verify them before disabling the old integration.

Previously mixed location data cannot be separated automatically from the latest
saved snapshot. Review it with the host admin and replay correct per-site values
from your upstream system. Coordinate key changes and host assignments to avoid
continuing to send another location's values with the original site's key.

## Appendix: custom player and screen-management apps only

Metric producers do not implement these player APIs.

- Enrollment accepts optional `siteNumber` alongside `name`; managed WireGuard
  fields and persistent enrollment-token retry behavior are unchanged. Accept
  201 for a new enrollment and 200 for a reused managed enrollment.
- The entered number is a request, not authorization. Approval uses
  `POST /api/devices/{id}/approve` with `{code,siteId}` and a signed-in user
  session. Any member of the requested store's configured access group or its
  subgroups can approve for that store; no administrator role is required.
  Members cannot redirect the screen to another site. Administrators can also
  approve, including older enrollments without a number and sites without an
  access group. Library sites/devices expose `canApprove` for the current user
  and include that user's eligible pending screens. Member approval shares the
  screen with the store group and its subgroups without personal ownership; content and
  metric permissions remain separate. Already approved screens cannot be moved
  through pairing.
- Existing approved Unassigned screens use `POST /api/devices/{id}/site` with
  `{siteId}` for their first assignment; this requires a 0.15.1+ heartbeat.
- Transfers require a 0.15.2+ heartbeat. Request an impact review through
  `GET /api/devices/{id}/site-preview?siteId=UUID`, then submit
  `POST /api/devices/{id}/transfer` with `{siteId,reviewToken}`. Stale reviews
  return 409. Prior screen shares/commands are reset; incompatible fixed-feed
  playlists are detached.
- Upgraded sync clients persist `siteRevision` with the approved site, clear
  prior site content before media downloads, and send `siteAck` for that durable
  revision on a subsequent sync. Reject older revisions and equal revisions
  naming another site. Once a positive revision is stored, missing revision
  metadata must not restore old state.
- Clear revoked or omitted snapshot values before replacement downloads, even
  when the site is unchanged. Download failure/offline restart must not restore
  cleared values. A pending transfer ends only after the server receives the
  exact clearing acknowledgement; this does not confirm physical-panel playback.
- Use player device credentials for sync. Application/feed API keys cannot
  authenticate players. Normal device edits, heartbeat claims, and pairing are
  not alternatives to the reviewed transfer endpoint.

The server resolves shared site bindings to concrete feed IDs before delivery;
manifest schema versions are unchanged. Fresh 0.15.2 players can use older hosts,
but those hosts do not provide these site guarantees. A player that has persisted
a positive assignment revision needs a deliberate state reset/re-provisioning
when the same host is rolled back to a server without revision support.

## References

- On the target host: `GET /api/data-feeds/guide` and
  `GET /api/data-feeds/openapi.json`.
- [Complete integration reference](data-feeds-api.md).
- [Site setup, permissions, migrations, and transfers](sites.md).
- [Server/player compatibility](player-compatibility.md).
