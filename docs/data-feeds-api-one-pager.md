# Application metrics API — one-page guide

**Requires:** OpenFrame server 0.23.2+ (included in milestone 0.24.0). Existing data-widget players need no upgrade. An admin creates an application once in **Settings → Data feeds → New application**, chooses its managing group, then generates an **application API key**. Copy the one-time key and keep it in the application's secret configuration. No per-metric setup is required on OpenFrame.

## Request format

```http
POST /api/data-feeds/ingest/{sourceKey}
Authorization: Bearer YOUR_APPLICATION_API_KEY
Content-Type: application/json

{"completed":42,"goal":100}
```

Replace `{sourceKey}` with a stable feed name chosen by your application, such as `production`. The JSON body is a direct object of metric names and values, with no wrapper. Application keys start with `ofa_`; legacy `ofd_` keys use the separate feed-specific API.

**Copy and paste (Mac/Linux):** change the server URL if needed, then paste your key when prompted. This reads the key without echoing it or storing it in shell history:

```sh
(
  printf 'Application API key: '
  IFS= read -r -s OPENFRAME_APPLICATION_KEY
  printf '\n'
  curl --fail-with-body --request POST \
    'https://openframe.blackfalcon.cloud/api/data-feeds/ingest/production' \
    --header "Authorization: Bearer $OPENFRAME_APPLICATION_KEY" \
    --header 'Content-Type: application/json' \
    --data '{"completed":42,"goal":100}'
)
```

## First push and later updates

The first successful push automatically creates the feed and its fields (**201 Created**). Later pushes to the same source with any key for the same application update the same feed ID (**200 OK**). Different applications have separate source names. A key can write to several sources by choosing different names in the URL.

To send another update, run the same snippet with `--data '{"completed":43,"orders":12}'`: `completed` becomes 43, the new `orders` metric is created, and omitted `goal` remains 100. Fields are added automatically on any push. All fields in a request validate before any data is saved. Repeating the same values is safe; each successful write produces a new revision and update timestamp.

Successful JSON responses contain `applicationId`, `sourceKey`, `feedId`, `fields`, `revision`, `updatedAt`, and `created`. Save `feedId` if your integration needs it. OpenFrame's Settings list discovers feeds within about 15 seconds; select a feed and field in a slide widget and publish the layout once. Later values update through normal player sync without republishing.

## Supported metric values

| Type inferred on first use | JSON value | Clear an existing value |
| --- | --- | --- |
| Number | `42` or `null` | `null` |
| Time series | `[{"time":"2026-10-07T18:00:00Z","value":42}]` | `[]` |
| Categories | `[{"label":"Sales","value":42}]` | `[]` |

Existing field types cannot change. New chart fields require a nonempty array. Each chart value replaces that field's whole array; points are not appended automatically. Strings and booleans are unsupported. Numbers must be finite and within ±1 trillion. Time series allow 240 points with unique, increasing ISO timestamps; categories allow 40 entries with unique, trimmed labels of 1–60 characters.

**Limits:** source names match `[A-Za-z0-9][A-Za-z0-9_-]{0,79}` and are case-sensitive; metric names match `[A-Za-z][A-Za-z0-9_]{0,39}`. Send 1–20 metrics per request, with at most 20 fields per feed and 32 KiB per body. Use another source for more fields. The server allows 200 total feeds; each application shares a 60-call/minute budget across its keys and sources.

## Errors and key lifecycle

Errors return `{"code":"...","error":"..."}`. Correct **400** invalid JSON/names/types and **413** oversized bodies; use `application/json` for **415**. **401** means the key is invalid, expired, revoked, or its issuing admin is no longer active. **409** reports a field/feed limit or unavailable managing group. On **429**, wait for `Retry-After` before retrying. Retry network failures and **5xx** responses with backoff; do not blindly retry other errors.

Keys only allow ingestion, not reading snapshots or managing OpenFrame. Rotate keys within the same application to preserve feed IDs. Revocation stops writes and retains saved values and slide bindings. Existing feed-specific keys still work with their original complete-snapshot `PUT` format. See the [full API guide](data-feeds-api.md) and [OpenAPI contract](../server/data-feeds.openapi.json) for details.
