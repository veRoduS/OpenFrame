# Multiple locations: site isolation punch list

Status: server/web **0.29.5** and player **0.15.3** implement the core multi-site
workflow: site-bound keys and feeds, enrollment/approval, shared local-metric
layouts, original-location migrations for application and manual feeds, reviewed
screen transfers, scope acknowledgements, audit history, optional access groups,
per-site ingestion budgets, user-scoped saved filters, and store-member pairing
approval through the site's configured access group.

Transfers reset old screen shares and commands, retain shared playlists, detach
incompatible fixed-feed playlists, and remain pending until the player confirms
persisting a cleared cache. Assignment revisions fence stale replies. Revoked
metric snapshots clear before media downloads, including failed updates/restarts.
An optional site access group adds a membership gate to existing resource rights;
without one, normal sharing remains in effect. Templates/media retain their
existing permissions. The changes are local and unpublished.

Software validation: **256 Node tests**, **101 Python tests**, and **38 Android
host JVM tests** pass. Five Chromium suites cover transfer/confirmation, manual-feed
migration, store-member pairing and cross-store isolation, site membership loss,
saved-filter clearing, shared previews, and
application-key workflows at desktop/mobile sizes. Physical Pi/Android acceptance,
APK installation, production inventory/site-number selection, and controlled
rollout remain operator work. Additional publication-impact and migration-inventory
previews and local approved-site status presentation are follow-up improvements.
See the [site guide](sites.md) for setup, permissions and upgrade order.

## Goal and recommended behavior

Assign each metrics API key and each approved screen to a site. Separate screens
and metric values by site while retaining central administration and reusable
content. A site number identifies a location; it is not an authentication secret.

Proposed flow:

1. An administrator creates Site `001` and issues an application API key for it.
2. The application pushes metrics with that key. The server derives Site `001`
   from the key; the caller cannot select a different destination site.
3. A player enters Site `001` during setup and requests enrollment.
4. Any member of that store's access group (or an administrator) verifies the
   pairing code and confirms the site assignment.
5. The approved player receives only metric values authorized for Site `001`.

Confirmed requirement: one shared slide or playlist must automatically show each
screen's local site metrics. Shared-layout resolution is part of the initial
multi-site scope; duplicating layouts for every location is not required.
Existing site-specific layouts and fixed-feed bindings remain supported within
their authorized site.
“Metrics” here means the existing application data feeds; screen online/offline
and playback status should also filter by site. Historical analytics is separate
scope: current feeds store latest values, not a full event history.

## Baseline before this work

- Application keys (`ofa_`) authenticate ingestion only. They belonged to an
  application, with no site assignment. Sources are unique by
  `(applicationId, sourceKey)`, so two keys for one application previously update
  the same feed when they use the same source name.
- Legacy feed-specific keys (`ofd_`) and player device tokens are separate
  credentials and must stay separate.
- Public enrollment creates a pending player; an administrator approves its
  pairing code. Neither enrollment nor device editing previously had a site field.
- Groups and resource sharing control access, but there was no independent site
  boundary. Sharing a slide can propagate access to its referenced feeds.
- Data widgets bind to concrete `feedId` values. Live snapshots are delivered
  separately from publication revisions and are cached for offline playback.

## 1. Establish the site model

- [x] Add a site registry with immutable internal `id`, unique `siteNumber`,
  display name, active/archived status, and timestamps.
- [x] Use a string for site numbers so leading zeros survive. Specify allowed
  characters, length, whitespace normalization, and whether `001` differs from
  `1` before implementing validation. Do not automatically invent site numbers.
- [x] Reference internal site IDs from devices, keys, and feeds. Display site
  numbers to users; changing a display name must not change ownership.
- [x] Add indexes and database-enforced uniqueness for site numbers and
  `(applicationId, siteId, sourceKey)`; ensure source creation is atomic.
- [x] Make site creation, archival, key assignment, and screen transfers
  administrator-only initially. Define how existing groups grant site access;
  a site and a group remain distinct concepts.
- [x] Prevent deleting a site that still owns devices, feeds, or keys. Define
  archival behavior for ingestion, enrollment, and already-playing devices.
- [x] Record who creates sites, assigns keys, confirms enrollment, and transfers
  screens. Never log raw API keys or player tokens.

## 2. Assign authorized API keys to sites

- [x] Add a required site selection when generating a new application key, and
  show that assignment beside key name, expiry, revocation, and last use.
- [x] Permit multiple keys for one application/site to support rotation. One key
  authorizes exactly one site; one application may supply multiple sites.
- [x] Provide a controlled one-time assignment for existing unassigned keys,
  coordinated with migration of their existing feeds. Do not silently move a
  working key from one site to another; issue a replacement for a new site.
- [x] Preserve hash-only storage, one-time secret display, expiration,
  revocation, and checks on the issuing administrator's authorization.
- [x] Resolve the destination site from the authenticated key on every ingest.
  Keep the existing direct metrics JSON body and source URL where possible.
  If a site is exposed in a future request header/path, require an exact match;
  never let it override the key's assignment.
- [x] Return site identity in successful ingestion metadata and document stable
  errors for missing assignment, disabled site, and conflicting site selection.
- [x] Keep ingestion keys unable to enroll/approve players, read metrics, or
  access management APIs. Players should never store application API keys.
- [x] Preserve legacy feed-specific writes, constrained to the assigned site of
  their feed; cover feed lifecycle and migration so they cannot bypass isolation.
- [x] Revisit existing limits: 20 active keys per application, 200 total feeds,
  and 60 ingestion attempts/minute per application. Multiple sites multiply
  demand. Plan per-site budgets with a bounded application/server-wide ceiling.

## 3. Separate metric storage and access

- [x] Change source lookup and creation to `(applicationId, siteId, sourceKey)`.
  Two sites posting `production.completed` must create independent feed IDs,
  values, revisions, timestamps, and inferred field definitions.
- [x] Persist `siteId` on automatically created and manually created feeds;
  expose safe site metadata in feed lists and details.
- [x] Keep key rotation within the same application/site attached to the same
  feed IDs. Never duplicate feeds just because the secret changed.
- [x] Apply site permission checks to library responses, feed details,
  snapshots, previews, and mutations, as well as screen lists and commands.
  A browser filter is not sufficient protection.
- [x] Enforce both existing resource permissions and the site boundary. Audit
  parent/child group inheritance and automatic dependency sharing so they cannot
  accidentally grant another site's metrics.
- [x] For player delivery, require an approved device, its stored site, an
  applicable widget binding, and the existing content permission checks.
- [x] Make cross-site or missing feeds explicitly unavailable. Do not fall back
  to another site's identically named source or to an implicit global feed.
- [x] Preserve atomic payload validation, omitted-field behavior, and the
  current number/series/category formats independently within each site.

## 4. Add the site number to every enrollment path

- [x] Add Site number to Android setup, Pi first-boot/setup, and the management
  screen-configuration download form, with consistent help and validation.
- [x] Carry the value through downloaded provisioning JSON, Pi installer,
  bootstrap configuration rewrites, saved configuration, and enrollment calls.
  Audit scripts that copy only a fixed list of configuration fields.
- [x] Store the submitted site as a requested assignment on the pending player.
  A public request must not create a site or gain access by knowing its number.
- [x] Show the requested site in the pending-screen list and pairing dialog.
  Allow any member of the requested store's access group or subgroups to approve
  that store's pending screens. Administrators can confirm or correct the site;
  store members cannot redirect requests. Keep unscoped legacy approvals and
  sites without an access group administrator-only.
- [x] Commit the approved site with approval; obtain the authoritative site from
  the server-side device record during sync. Do not trust a site sent in a
  heartbeat to change that assignment.
- [x] Define unknown, missing, archived, and malformed site behavior. During
  migration, old players may enroll as Unassigned, but must receive an explicit
  site assignment before approval.
- [x] Preserve retry behavior, saved device credentials, pairing codes, and
  managed WireGuard enrollment-token reuse. A retry must not change the site
  of an already-approved player.
- [ ] Return approved site metadata for local status/setup display where useful;
  document whether changing local site input requires fresh approval.

## 5. Resolve shared layouts to local metrics

- [x] Add an explicit widget binding mode: a fixed feed, or the current screen's
  site plus application/source/field. Existing bindings remain fixed feeds.
- [x] Recommend server-side resolution into a concrete player manifest and
  snapshot map. The player receives only the selected site's values; it does
  not receive a bundle of every site's data to filter locally.
- [x] Give editor previews an explicit authorized preview-site selection, and
  validate numeric, goal, delta, series, and category field types for that site.
- [ ] Validate assignment and publication for each affected site's bindings.
  A site-relative feed may not exist before its first push; show a clear pending
  or unavailable state rather than borrowing another site's values.
- [x] Account for linked playlists and sharing dependency checks, which currently
  assume a concrete `feedId`. Sharing a reusable template must not share all
  sites' metric values.
- [x] Design the effective manifest/cache identity to include site and resolved
  binding changes. Current players use publication revision to detect changes;
  a different site mapping must not reuse stale resolved content.
- [x] Keep ordinary metric-value refreshes independent of publication revisions
  and frame replacement, preserving current polling and resource bounds.
- [ ] Verify older-player handling of resolved manifests before declaring this
  compatible; new authoring fields and new setup fields need their own review.

## 6. Separate screens and metrics in management

- [x] Add a site selector to Screens and Data feeds, with site number/name badges
  in lists and screen details. Support authorized All sites and administrative
  Unassigned views with distinct empty states.
- [x] Keep search, online/offline counts, pending approvals, errors, and feed
  freshness indicators scoped to the selected site.
- [x] Label same-named feeds by site and application in editor pickers; make the
  selected preview site obvious when using a shared layout.
- [x] Persist selection safely across navigation and reload, clearing it on
  logout or loss of permission. Exclude unauthorized data server-side.
- [x] Define an administrator screen-transfer workflow with an impact preview:
  old/new site, incompatible fixed-feed bindings, and expected next-sync result.
- [x] On transfer, invalidate previous site snapshots and resolved bindings;
  ensure late responses cannot restore old-site values. Record the transfer.
  Clear previous-site metrics when the new scope is received, independently of
  whether new media finishes downloading: both agents preserve only still-authorized
  cached content when an asset download fails.
  A disconnected player cannot receive an immediate wipe: show transfer pending
  until it reconnects, and require reconnect/reset before physical relocation
  when old cached values must not remain visible.

## 7. Migrate without losing the existing location

- [ ] Inventory existing screens, application keys, legacy keys, feed mappings,
  and published bindings; prepare a migration preview before changing records.
- [ ] Choose the real site number for the original location. Backfill existing
  records together only where ownership is known; leave ambiguous records
  visibly Unassigned for administrator resolution.
- [x] Preserve device IDs/tokens, feed IDs/data, grants, and published bindings
  during migration. A site addition must not require re-enrolling every player.
- [x] Migrate the source uniqueness constraint transactionally and idempotently,
  with explicit handling for unassigned rows and interrupted upgrades.
- [x] Allow legacy traffic only within its migrated original-site assignment;
  never interpret a missing site as permission to access all sites.
- [x] Prepare backup/restore and rollback instructions. Do not downgrade to a
  server that ignores site isolation while continuing multi-site operation.
- [ ] Pilot with two sites and a small number of screens before broader rollout.

## 8. Acceptance tests and delivery checks

- [x] Same application/source/metric, different site keys: independent values;
  same application/site with rotated keys: unchanged feed identity.
- [x] Site A key cannot write Site B; expired/revoked keys, inactive issuers,
  and archived sites fail without partial writes.
- [x] With configured access groups, a Site A screen/user cannot obtain Site B metrics by changing a URL, resource
  ID, site selector, preview request, sharing grant, or sync payload.
- [ ] Enrollment site validation, administrator correction, older clients,
  duplicate retries, WireGuard enrollment, and restart retain expected identity.
- [x] One shared playlist on Sites A and B renders their respective values;
  missing or incompatible local fields never display the other site's values.
- [x] Fixed-feed bindings, linked playlists, legacy ingestion, goals, deltas,
  charts, and category tables retain their existing supported behavior.
- [x] Site transfer, permission removal, late responses, reconnect, and offline
  restart cannot resurrect a cleared site's snapshots after the client has
  received the new assignment, including when replacement media fails to
  download. Document the offline limitation explicitly.
- [x] Existing-install migration retains IDs and values, can be rerun safely,
  and survives an interrupted migration without partial ownership changes.
- [ ] Check screen/site/key forms and filtering on desktop and mobile; verify
  enrollment on both Android and Pi, including real-device acceptance.
- [x] For implementation, run relevant Node/Python/native Android/browser tests,
  lint, typecheck, build, repository/version checks, and compatibility review.
  Update changed components' versions/changelogs using repository scripts.
- [x] Update API/OpenAPI/examples, user and setup guides, site permissions,
  migration/operations guidance, and server/player compatibility notes. Source
  publication and deployment remain separate milestones.

## Expected implementation areas

| Area | Current files |
| --- | --- |
| Site records, devices, approval, sync, library | `server/app.mjs`, `server/schema.mjs`, `server/accounts.mjs` |
| Key scope and source uniqueness | `server/data-feed-applications.mjs` |
| Feed permissions, snapshots, widget bindings | `server/data-feeds.mjs`, `server/data-feeds.openapi.json` |
| Site management, screen filters, key/feed UI | `app/page.tsx`, `app/types.ts`, `app/library-filters.tsx`, `app/data-feed-applications.tsx`, `app/data-feeds.tsx`, `app/data-card-options.tsx` |
| Provisioning | `app/screen-setup.tsx`, `server/screen-setup.mjs`, `player/install.sh`, `player/bootstrap.py` |
| Player setup, persistence, sync, rendering | `player/agent.py`, `player/setup-web/`, `player/android/`, `player/web/` |
| Regression coverage | `tests/data-feeds.test.mjs`, `tests/data-feed-applications.browser.mjs`, `tests/accounts.test.mjs`, existing provisioning/player/browser suites |

## Suggested build order and decisions to settle

Original build order: site registry and migration → site-bound keys and feed storage →
server authorization → enrollment/approval → shared-layout resolution and cache
handling → management views → two-site acceptance and rollout preparation.

For rollout, choose the original site's number and review group/site access.
Numbers currently use 1–20 digits. Archived sites stop writes and new enrollments;
already approved screens retain access to saved authorized values.
Shared layouts with site-local metrics are confirmed for the initial scope.
Recommended starting point:
administrators manage sites centrally, each key/screen has one site, multiple
keys per site support rotation, and site access groups can further constrain
resource sharing. Ingestion budgets are 60/minute per application/site and
600/minute per application; feed and key count caps remain unchanged.
