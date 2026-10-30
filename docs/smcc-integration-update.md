# SMCC → OpenFrame: multi-store API update

First published in **OpenFrame server 0.31.0** (implemented in local revision 0.30.3). Deploy that server update before changing SMCC; the running server must support the new endpoint.

## Setup

Create **one application named SMCC** in OpenFrame Settings → Data feeds. Under Manage keys, choose **Multiple stores (central)**, select the authorized stores, and generate a key. Never expires is optional. Share that key separately; keep it in SMCC's server configuration, outside source control and browser code.

Store numbers must already exist in OpenFrame. Adding a store does not automatically authorize it: issue a replacement key with the updated store selection, switch SMCC, then revoke the old key. Store numbers are strings; `02882` and `2882` are different.

## Request

Send JSON to **POST `/api/data-feeds/ingest-stores/production`** on your OpenFrame origin:

```http
Authorization: Bearer YOUR_CENTRAL_APPLICATION_KEY
Content-Type: application/json
```

```json
{
  "stores": [
    {
      "siteNumber": "2882",
      "metrics": { "completed": 75, "goal": 100 },
      "tables": { "training": [{ "label": "Safety", "value": 98 }] }
    },
    {
      "siteNumber": "3404",
      "metrics": { "completed": 82, "goal": 100 },
      "tables": { "training": [{ "label": "Safety", "value": 95 }] }
    }
  ]
}
```

Use stable field keys, matching existing widgets where possible. Field keys start with a letter, contain only letters/numbers/underscores, and have at most 40 characters. Numeric values must be finite and within ±1 trillion. Metrics accept numbers, `null`, or typed arrays: `{time,value}` for time series and `{label,value}` for categories. New arrays in metrics must be nonempty so the type can be inferred. Tables always accept category arrays, including `[]`. Table labels must be unique, nonempty, and at most 60 characters. Series timestamps must be ISO 8601 with timezone, unique and ascending. A field's type stays fixed and must agree across stores.

Each store must include at least one nonempty `metrics` or `tables` section. Omitted stores and fields retain their last values. A supplied array replaces that field's rows/points; `[]` clears it. Numeric `null` clears a number. Send current snapshots rather than increments: retrying a request updates the same records without adding to totals.

Limits: **50 distinct stores/request**, **256 KiB JSON/request**, **32 KiB/section**, **100 fields/feed by default** (administrator-adjustable to 1–500 in Settings → Data feeds → Feed limits, local server revision 0.31.1+), **100 rows/table**, **240 points/series**. Split larger store lists into batches. Existing wider feeds keep their fields and accept value updates when the setting is lowered; new fields must fit the current limit. Raising it does not combine numbered sources automatically: SMCC should send the combined field set to the chosen stable source. The server also permits at most 200 concrete feeds overall; each store/source/section uses one feed. Rates are 60 attempts/minute per application/store and 600 store attempts/minute per application, shared across its keys.

## Response and retries

HTTP **200** returns `ok`, `applicationId`, `sourceKey`, `storesAccepted`, `feedsCreated`, `feedsUpdated`, and `updatedAt`. The whole request succeeds or fails together; invalid data or an unauthorized/archived store leaves every store unchanged.

- **400 / 413 / 415:** correct the payload, size, or content type before retrying.
- **401:** replace an expired/revoked key or resolve its creator's account authorization.
- **403 `KEY_SCOPE` / `SITE_NOT_AUTHORIZED`:** use a central key and only its selected stores.
- **409:** fix archived sites, field type conflicts (`SOURCE_SCHEMA_CONFLICT`), or feed/field limits.
- **429:** honor the `Retry-After` header. For network errors or 5xx, retry with exponential backoff and jitter. Avoid parallel retries for the same stores; an older snapshot can overwrite a newer one.

## OpenFrame behavior and migration

The first push creates store snapshots automatically. Settings groups them under **one SMCC integration**, then each store. Internally `production` holds metrics and `production-tables` holds tables; reserve that suffix for tables. Widgets use **Follows each screen’s store** to share one layout while showing local values. New feeds belong to the site's access group when configured, otherwise the application's managing group; existing feed ownership is preserved.

Existing per-store application keys and `POST /api/data-feeds/ingest/:sourceKey` continue working. Central keys use only the new endpoint; old keys cannot submit a multi-store batch. Using the same application, store numbers and source names reuses existing feeds. After an intentional connection reset, reconnect retained widgets to the new SMCC source once data arrives. No APK update is required for players already supporting store-based widgets.

Full schema: `GET /api/data-feeds/openapi.json` on the OpenFrame server. Send the API key separately from this file.
