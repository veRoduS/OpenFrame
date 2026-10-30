# Server and player compatibility

The server and players have independent release versions. `package.json` names the server/web release; `player/version.json` names the player release shared by the Android app and Pi agent. A server-only change does not require a player bump or APK build, and a player-only change does not require a server bump. Matching release numbers are not evidence of compatibility.

`compatibility.json` records the contracts reviewed together and the source fingerprints at each review. These are engineering review records, **not automated proof of compatibility**, a runtime negotiation mechanism, or a claim of physical-device validation.

## What triggers review

Run `pnpm compatibility:check` before release. CI and the release checks use this command. It fails when contract-related source or declared protocol support differs from the most recent review, including added and deleted source files. Its error lists the files that need review.

The fingerprint covers:

- All server `.mjs` files, including enrollment, synchronization, playlist publication, media delivery, weather, recovery, and Android release metadata. This deliberately includes whole files and helper modules: an unrelated admin change in a mixed server module can also require a short review.
- All files in `player/web/`, used by both players and the server preview.
- Android main Java sources, the Android manifest, app build configuration, and the public release signing-certificate pin, including networking, local browser bridging, APK verification, and installation.
- The Pi's top-level Python modules, including its synchronization agent and networking/recovery helpers.

`package.json`, `player/version.json`, changelogs, and the standalone Pi agent's `VERSION` literal are not fingerprints. A pure release-number change can pass with the previous source review, even when the current versions differ from the versions recorded in that review. Other agent changes still trigger a review. The check does not cover every possible indirect change: dependency upgrades, build tooling, or new contract code moved outside these locations still require judgment and an expanded fingerprint scope when appropriate.

## Protocol declarations

Each protocol has explicit `server`, `android`, and `pi` arrays of supported positive integer contract versions:

| Contract           | Scope                                                                                                              | Current support                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `playerSync`       | Enrollment, pairing, sync requests/responses, commands, status, and media access                                   | Server, Android, and Pi support review contract 1                  |
| `playlistManifest` | Published playlist schema and the renderer's interpretation of items, assets, scheduling, transitions, and widgets | Server publishes schemas 2–5; updated Android and Pi accept 1–5 |
| `androidUpdate`    | Android release metadata, discovery, downloads, and verification                                                   | Server and Android support review contract 1; Pi is not applicable |

`playerSync` and `androidUpdate` numbers identify reviewed contract generations; those endpoints do not currently negotiate a protocol-version field. The playlist's `schemaVersion` is an actual wire field and must agree with its declaration. Android version codes, server/player releases, playlist publication revisions, and this file's `schemaVersion` are separate counters.

Server 0.13.3 and player 0.10.6 add font files as playlist assets. Standard-font playlists remain compatible with earlier players; a playlist that uses a custom font requires player 0.10.6 or newer so the font can be downloaded, cached, and rendered offline.

Server 0.14.1 publishes playlist manifest schema 2, and player 0.10.8 understands removed-media placeholders on both Android and Pi. Update players to 0.10.8 before deleting media referenced by a published playlist; older players reject schema 2 manifests. Updated players continue to accept schema 1 manifests from older servers.

The check requires a shared supported version between the server and each applicable player for each protocol. `androidUpdate.pi` must remain `[]` because the Pi does not install APKs. A support declaration change also requires a new review. Do not list support that the implementation does not provide.

`player/android/release-signing.json` pins the public SHA-256 certificate fingerprint verified from the existing Android 0.10.3 installer. It contains no private key. Builds and publication verify the actual APK signature, package, release version/code, minimum Android SDK, and alignment. If a CI secret supplies a different key, restore the existing release key; changing this fingerprint to make a build pass would prevent in-place updates for installed players. Any planned signing-key migration requires a separate compatibility plan and Android-supported signing continuity.

## Recording a review

When the check flags a change:

1. Inspect the listed source changes and decide which installed players and servers they affect. Review both directions: a newer server with an older player, and a newer player with an older server. Include cached playlist playback, media, and APK updates when affected.
2. Preserve existing contracts for compatible changes. For a breaking change, update the relevant support arrays to reflect the implementation, document the minimum compatible server/player releases and upgrade order in the review summary and release notes, and retain old protocol support when needed for a safe transition. The current server and players must still share a supported contract before the check can pass.
3. Run the relevant server, renderer, Pi, and/or native Android checks. Record any physical-device validation gap rather than claiming tests establish hardware support.
4. After the final code changes and version bumps, record the review:

   ```sh
   pnpm compatibility:review --impact compatible "Reviewed sync, playlist, and updater changes; existing players remain supported; targeted checks passed"
   pnpm compatibility:check
   ```

   For a migration, use `--impact breaking` and describe the required other-component review/upgrade, for example `"Playlist contract 2 requires server 0.12.0 and player 0.11.0; upgrade players before publishing contract-2 playlists"`. Use real versions and requirements established by the implementation, not this example.

The direct command is `node scripts/compatibility.mjs review --impact compatible|breaking "Summary"`. It appends the current independent versions, declarations, time, impact, summary, and SHA-256 source fingerprints to the review history. It performs no commit, tag, push, APK upload, or deployment. Recording an engineering review does not require separate owner approval; publication still follows the applicable release policy.

Do not run the review command automatically on every build or in CI: that would erase the review gate's purpose. Commit the review alongside the reviewed change. A release-number bump alone does not need a fabricated compatibility review.

The checker exports `collectFingerprints`, `validateProtocols`, `checkCompatibility`, and `recordReview` with a repository-directory parameter for isolated fixture tests. `pnpm test` covers source drift, independent version changes, required protocol intersections, and review history.

Server 0.15.2 and player 0.10.11 add shapes, stock trackers, and vertical weather. Publications containing any of these features use schema 3; ordinary playlists continue using schema 2. Upgrade affected Pi and Android players to 0.10.11 before publishing schema 3. Older players reject it and keep their cached content. Updated players preserve playback from older schema-1/2 servers. Stock quotes travel as `manifest.stocks`, without exposing the provider key or changing the publication revision. The Android agent accepts and forwards this data inside its existing manifest bridge; the Pi agent serves the new shared `shape.js` and `stocks.js` modules. Native tests and browser checks do not establish physical TV/Pi performance or APK installation acceptance.

## Live data feed compatibility

Server **0.20.0** conditionally emits manifest schema **4** for playlists containing `type: "data"` widgets. These require Pi/Android player **0.10.13+**, including the complete shared renderer. Earlier players reject schema 4 and retain their last usable cached publication. Upgrade players before assigning data dashboards. Playlists containing only existing layer types keep schema 2/3 and continue working with previously compatible players. Player 0.10.13 continues accepting schemas 1–3 and works against older servers.

Data snapshots travel separately as the optional top-level `dataFeeds` map in player sync and within previews. They do not change manifest revisions or trigger frame replacement. New players persist snapshots offline; a successful `unavailable` response clears inaccessible values. Tests cover live browser updates without slide replacement, widget lifecycle disposal, Pi/Android offline restart and clearing after reconnection. Desktop/JVM checks do not establish physical Pi or Android TV performance or acceptance.

Server **0.25.1** adds optional `layer.data.card` settings. Shared player **0.11.1** renders the split header appearance; older data-capable players ignore these settings and render the existing primary field using Classic. Manifest schemas, feed snapshots, permissions, and polling are unchanged. New players accept older publications without card settings. Older servers reject the new optional object when saving slides, so remove `card` before importing a slide into an older server. Pi installations need the updated agent allowlist and complete web directory, including `data-cards.js`; Android packages the same renderer. See [card setup](widget-cards.md).

Optional line-card `showStats` settings require server **0.25.5** and player **0.11.5** for min/avg/max rendering. Earlier card-capable players ignore the option and continue displaying their line chart. Servers before 0.25.5 reject the additional field on slide saves; omit `showStats` before importing settings into those servers. Manifest schemas and feed snapshots remain unchanged.

Server **0.26.1** and player **0.12.1** support table/category views up to 40 rows and zero-based `card.rowOffset`. The Table editor preset uses the existing categories/bar format, so manifest schemas and ingestion payloads are unchanged. Upgrade affected players before publishing row ranges or views larger than eight rows: older card players ignore offsets and display at most the first eight rows. New players retain older card settings with offset zero and their saved row counts. To edit on an older server after a downgrade, omit `rowOffset` and reduce `maxRows` to eight or fewer. SMCC-style numeric tables already ingest through application keys on existing supported servers.

Server **0.27.3** and player **0.13.2** support `card.showRowRange` (default true). False hides the automatic range footer for split category cards. Older players ignore the option and keep showing the range. Omit the field when saving to an older server; feeds and manifest schemas are unchanged.

Server **0.26.2** and player **0.12.2** add `card.valueAlign`, `titleScale`, `valueScale`, `detailScale`, `paddingX`, and `paddingY`. Defaults preserve existing card layouts. Older card players ignore these fields, so update players to see custom text sizes, padding, and alignment. New players accept older publications. Downgrade saves require removing these six fields. Multi-layer alignment and distribution change existing layer coordinates and need no player update. Ingestion, snapshots, sync, updates, and manifest schemas are unchanged; no additional player timers or dependencies are introduced.

Server **0.27.1** and player **0.13.1** add optional `card.thresholdMode`, `thresholdGoal`, `thresholdWarning`, and `thresholdUseTarget`. Colors start off; updated players retain older publications and remove the former circle Score caption. Older players ignore the new fields and keep their earlier caption. Downgrade saves must remove the four threshold fields. Higher/lower comparisons use unrounded values, including zero/negative custom goals; invalid or missing live goals render neutral. Existing gauge targets can supply the green cutoff. Tables color rows separately. No ingestion, snapshot, manifest, sync or update protocol changes, dependencies, or timers are introduced.

## Cached video compatibility

Server **0.24.1** emits schema **5** for publications containing video layers. Upgrade Android/Pi players to **0.10.15+** before publishing video. Older players reject schema 5 and retain their last usable cached publication. Playlists without video keep schemas 2/3/4 as appropriate; updated players continue accepting schemas 1–4 from older servers. Removed video placeholders also require schema 5. Delete all video layers and republish to return to an earlier schema.

Video and poster assets use the existing authenticated media endpoint, checksums, and atomic publication handoff. Updated players support local MP4 byte ranges, a 25 MiB per-video limit, and a 256 MiB cache budget protecting both the current and incoming publication. An oversized update leaves current playback intact. The shared renderer uses one visible video, poster-only staging, and cuts around video. Server optimization requires FFmpeg and ffprobe; image-only use does not. See [video support and Onn acceptance](video-support.md). Automated browser/JVM tests do not establish physical Onn or Pi performance.

Server **0.27.4** adds Ctrl/Command+click selection using existing layer coordinates and arrangement actions. Player **0.13.3** centers circle values by measured glyph bounds, including prefixes and units. No saved fields or manifest formats change; older players retain their prior centering.


## Sites and shared layouts

Server **0.29.2** / player **0.15.1** add optional enrollment `siteNumber` and sync
`siteId`/`siteNumber`. Existing player identities remain valid. Initial pairing of
older clients remains supported, with an administrator selecting the site. First
assignment of an already approved screen requires a 0.15.1-or-newer heartbeat:
these agents persist an empty state on a scope change before downloading new
media, preventing old snapshots from returning after download failure or restart.
Cross-site transfers require server 0.29.3 / player 0.15.2; see below.

Server-only `layer.data.siteBinding` authoring is resolved to concrete feed IDs
and removed before delivery. Manifest schemas remain unchanged. Older compatible
data-widget players can render an initially paired site's resolved layout; new
players also work with old servers, which ignore site numbers and provide no
location isolation. Older servers reject the new authoring field. Preview-site
selection uses an updated shared preview script; ordinary metric refreshes keep
the effective manifest revision stable. Node, Python, Chromium, and host JVM
checks do not establish physical device installation or playback acceptance.


Server **0.29.3** / player **0.15.2** add `siteRevision` and `siteAck` for reviewed
transfers. The player clears and persists the new scope before downloading media,
then acknowledges that exact revision on a subsequent sync. Delayed responses,
responses missing a previously established positive revision, and equal-revision
responses naming another site are rejected. Revoked or omitted snapshots are
cleared independently of replacement media; otherwise a failed update retains
valid cached content as before. No manifest schema, frame count, timers, or media
budget changes are introduced.

Transfers require a 0.15.2-or-newer heartbeat. First assignments still accept
0.15.1. Fresh 0.15.2 players accept earlier servers without revision metadata;
a player that has persisted a positive revision must be reset/re-provisioned
when deliberately restoring an older server/database at the same origin. Physical
Pi/TV installation, panel clearing and long-running playback remain unverified.

Server **0.29.5** lets any current member of a store's configured access group
or its subgroups approve new screens requesting that store. The pairing code
and an active site are still required; administrator approval remains available.
This changes session authorization and library metadata only, with no player
sync or manifest changes. Existing site-capable players can use the new approval
policy without an upgrade. Player **0.15.3** updates Android setup wording to
explain store-member approval; earlier setup wording still mentions an
administrator. Sites without access groups and enrollments without site numbers
retain administrator approval, and transfers remain administrator-only.

Server **0.29.7** and player **0.15.4** expand category/SMCC tables to 100 rows,
including row ranges and matching deltas. The schema-4 format, sync and ingestion
methods are unchanged. Upgrade affected players before publishing views or ranges
beyond 40 rows; older players retain their 40-row renderer bound. Existing
smaller publications work in both directions, and new players keep rendering
older snapshots. The renderer remains bounded to 100 category rows with no new
timers, network requests or frames. Non-expiring API keys and home-workspace
preferences are server/web features and do not require a player update.

Server **0.29.8** adds Skip to linked-fork authoring and removes skipped entries
when constructing previews, publications and entry mappings. Players continue to
receive ordinary flattened playlists using the existing manifest schemas; no
player upgrade is required for this feature. Skip remains local to each fork and
only published overrides follow master updates. Parent-group slide sharing
changes session authorization only. Removing the uploaded-image megapixel cap
keeps the 15 MB file limit and existing 1920-pixel WebP optimization, so the
player media format and resolution bounds are unchanged. No player source, sync
contract, frame count or timer changes are included in this revision.

Server **0.29.9** and player **0.15.5** add optional weather
`layout:"forecast-card"` using the existing weather layer, snapshots and schema 3
(or schemas 4/5 when other content requires them). Update players before using
the card layout; earlier players fall back to their Horizontal layout and retain
weather data. Existing Horizontal and Vertical publications are unchanged, and
the new player accepts them and older servers. Earlier servers reject the new
layout on authoring writes, so select Horizontal or Vertical before saving to a
downgraded server. The shared renderer adds no requests, timers or subscriptions
and keeps the one-visible/one-prepared-frame budget.

Server **0.30.1** fixes publication authorization for saved store-relative
widgets, including shared store-group audiences, store-user publishers, slide
refreshes and inherited fork updates. The example feed supplies source/field
validation during publication, while actual local feed permissions remain
enforced by preview/sync resolution. Fixed-feed checks and new/edited widget
authorization are unchanged. No sync/manifest fields, player code, timers or
resource budgets change; this correction needs only a server update and no APK.

Server **0.30.2** adds explicit data-connection deletion/reset that preserves
widgets as `feedId:null` without a site binding, including published snapshots.
The existing data schema already permits null feed IDs; schema 4, sync and
ingestion formats are unchanged. Existing renderers show Waiting for data.
New publication revisions and empty feed snapshot maps clear old metric values
on the next successful sync. No player code, timers or frame budgets change,
and no APK update is required. Offline devices retain their existing content
until they reconnect. Authoring validation permits intentionally unbound widgets
while still rejecting invalid non-null feed IDs and relative bindings with no
example feed.

Server 0.30.3 adds central store-batch ingestion and groups feeds by integration.
It materializes the same per-site/source feeds used by existing relative widget
bindings, without changing manifests, snapshots, or installed player code.
Existing single-store keys retain their original endpoint and semantics. Player
0.15.5 remains compatible; this server change needs no new APK.
