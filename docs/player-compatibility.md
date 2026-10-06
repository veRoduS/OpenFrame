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
| `playlistManifest` | Published playlist schema and the renderer's interpretation of items, assets, scheduling, transitions, and widgets | Server publishes schemas 2/3; updated Android and Pi accept 1/2/3                           |
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
