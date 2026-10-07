# Contributing

OpenFrame is an independent MIT-licensed project for local-first digital signage. Contributions should keep the server self-hostable and the player practical on small devices. Discuss large architectural changes in an issue before implementing them. Be respectful, provide reproducible reports, and avoid sharing credentials or private screen content.

## Development setup

For the recommended cloud workflow, see [Codex Cloud](docs/codex-cloud.md). Cloud tasks should use isolated task workspaces and follow the same local-patch versus approved-milestone release rules below.

Install Node.js 24 and pnpm 11.19.0 (`npm install --global pnpm@11.19.0`). Python 3.9+ is required for the standard-library player tests; Linux is required for actual Pi image construction. Docker with the Compose plugin is needed for container acceptance tests. No account or API key is required for local development.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3100 and sign in as `admin` using the unique password printed in the terminal on the first start. The server creates `data/` automatically. Existing accounts are preserved on restart. Use a separate `DATA_DIR` for test installations; never develop against your only production database. Local Node does not load `.env` automatically: set environment variables in your shell. Compose reads `.env` for interpolation.

## Verification

On Linux/macOS:

```sh
export OPENFRAME_PYTHON="$(command -v python3)"
pnpm version:check
pnpm compatibility:check
pnpm repository:check
pnpm typecheck
pnpm lint
pnpm test
python3 -m unittest discover -s tests -p '*_test.py'
pnpm build
bash -n player/install.sh
bash -n player/firstboot.sh
bash -n player/build-image.sh
```

On PowerShell, set `$env:OPENFRAME_PYTHON = (Get-Command python).Source`, use `python` for the Python command, and run shell checks in Git Bash or WSL. Setting `OPENFRAME_PYTHON` enables the real agent/server integration cases; otherwise those cases are skipped. Tests use temporary databases and caches. `pnpm format` formats maintained app/server/player-web/test/tooling source.

For browser checks, install Playwright in a separate tools directory, install its Chromium browser, and set `OPENFRAME_PLAYWRIGHT` to that package's absolute `index.mjs` file URL. After building, run `node tests/playlist-picker.browser.mjs`; it starts a local static server and mocks API requests. It checks a 30-slide library with landscape, portrait, and square previews, scrolling, duplicate confirmation, and save/reopen at desktop and phone sizes. Alternatively select an installed browser with `OPENFRAME_BROWSER_CHANNEL=msedge` or `OPENFRAME_BROWSER_EXECUTABLE`. Screenshots stay under ignored `work/`; the test does not edit your library. See the [hardware checklist](docs/playback-testing.md) for real-device acceptance.

After `pnpm build`, run `node tests/screen-setup.browser.mjs` with the same Playwright settings. It starts its own ephemeral server/database and verifies VPN import, allocation, ZIP contents, re-download, and desktop/mobile layouts using fake credentials. It does not contact a VPN or modify your running server's data.

## Change requirements

After building, `node tests/landing.browser.mjs` checks the public homepage, login/logout, bookmarked `/dashboard` access, persisted browser sessions, legacy invitation links, clipboard, FAQ, mobile navigation, and image loading at five viewport sizes. Use the same Playwright settings as the other browser checks. It seeds an isolated database with fictional content, never your library. To refresh the public sample workspace image deliberately, run it with `OPENFRAME_CAPTURE_LANDING=true`, then rebuild and rerun without that flag. See [public website](docs/public-website.md) for routes and asset provenance.

After building, `node tests/accounts.browser.mjs` verifies user invitations, password changes, group joining, and desktop/mobile account layouts against an isolated database. Use the same Playwright environment settings as the other browser tests. After building, run `node tests/organization.browser.mjs` with the same Playwright settings to verify admin-only direct membership management, account role changes, user access editing, group reparenting, indented sharing options, folder drag/drop (including return to top level and cycle rejection), and desktop/mobile layouts against an isolated database. Screenshots are written under ignored `work/`.

After building, `node tests/workspace-management.browser.mjs` checks compact slide metadata previews/editing, singular layer labels, hidden built-in admin listings, direct membership editing and user deletion, three Media grid sizes with reload persistence, and stable Row/Grid screen ordering through real heartbeats at desktop and phone widths. It uses the same Playwright settings and a disposable database.

Account authorization, migration, direct media access, and screen assignment are covered by `tests/accounts.test.mjs` in the standard Node suite.

After building, `node tests/library-access.browser.mjs` checks inherited View access, independent linked forks, speed/order controls, bulk tagging, folder moves, and the View/Edit sharing dialog at desktop and phone widths. Use the same Playwright settings as other browser checks. It uses an isolated local database and writes ignored screenshots under `work/`; it does not modify your library. Server access tests also cover managing groups, explicit Edit grants, publication propagation without publishing local drafts, revoked master access, and folders under read-only ancestors.

After building, `node tests/tag-picker.browser.mjs` verifies selecting existing tags and typing new tags in Slides, Playlists, and Media, including bulk removal, duplicate exclusion, saved results, form reset, private-tag visibility, and phone layout. It uses the same Playwright settings and a disposable database; screenshots stay under ignored `work/`.

After building, `node tests/editor-locks.browser.mjs` verifies eight-character login, separate image insertion/replacement, full locks, and movement-locked dimension edits for text, images, clocks, and counters in an isolated database. The accounts and editor-lock browser checks also accept `OPENFRAME_BROWSER_EXECUTABLE` for an installed Chromium executable.

After building, `node tests/weather.browser.mjs` checks ZIP lookup, current/six-hour weather, local icons, resize handles, units, persistence, responsive layouts, and player weather updates without replacing the active frame. It starts an isolated database/server and injects fake NWS and ZIP responses; it never modifies your normal library or contacts those services. Use the same Playwright environment settings as the other browser tests.

After building, `node tests/transitions.browser.mjs` uses an isolated server/database to check playlist transition controls and persistence at desktop/phone widths, native whole-frame animations with decoded image/text/clock layers, midpoint pixels, portrait rotation, and effect cleanup. Use the same Playwright settings. Screenshots are ignored under `work/`; these browser checks do not establish physical Pi performance.

For `node tests/player-connectivity.browser.mjs`, provide a generated, non-secret Wi-Fi QR PNG at `work/setup-qr.png` or set `OPENFRAME_TEST_QR_PNG`. For example, with Python `qrcode[pil]` installed in a separate test environment, generate `WIFI:T:WPA;S:OpenFrame-Setup-AB12;P:fake-password;;` into that file. The test uses the same Playwright settings, mocks all networking, and checks the HDMI setup view at 1920x1080 and 800x480, mobile layout, offline cached frames, agent interruption, blanking, and the recovery form. It does not validate the Pi's native `qrencode` binary or physical scanning.

Run `node tests/bootstrap.browser.mjs` with the same Playwright settings to check the first-boot form at desktop and phone sizes. Its network requests are mocked and it never configures your Wi-Fi. Managed VPN tests use an injected helper; Python provisioning tests mock privileged commands. Actual Compose networking, image chroot/package installation, regulatory settings, and Pi AP/client switching need the separate [acceptance checklist](docs/managed-wireguard.md#acceptance-checks).

Recovery browser coverage includes saved Wi-Fi add/edit/remove/reorder, mouse/touch drag grips, keyboard reordering and cancellation, password retention/clearing, hidden/open settings, save conflicts, and saving without closing the hotspot. `wifi_test.py` exercises real temporary keyfiles with mocked NetworkManager commands; `recovery_test.py` checks portal authorization and pause-preserving saves. `roaming_test.py` models scan cadence, stable priority promotion, restoration attempts, cooldowns, and inspection failures. These do not establish radio/failover behavior on a physical Pi. Regenerate the bundled weather and recovery icons with `pnpm icons:generate`, then `pnpm format`, when changing the selected Lucide icons.

## Source layout

Management UI code lives under `app/`, including shared components in `app/components/ui/`, hooks in `app/hooks/`, and utilities in `app/lib/`. The `@/` import alias resolves to `app/` in both Vite and TypeScript. Keep only components used by the application; add new ones as needed. Formatting and linting cover this entire tree.

The API lives in `server/`. The independently installed Pi agent and browser assets live in `player/`; do not move these into the management UI. See the [source map](docs/architecture.md#source-map) for the remaining boundaries.

The Android TV app is in `player/android/` and packages `player/web/` directly. See [Android TV builds](docs/android-tv.md#build-the-usb-package) for SDK/signing requirements, tests, and the dependency-free SDK fallback. Android changes additionally require the native agent tests, APK signing/alignment checks, and device acceptance before claiming hardware support. Preserve the release key for in-place updates; never commit it. `pnpm build:android` publishes the signed APK to the dedicated `android-releases` branch by default; use `pnpm build:android --local` for development builds. Publication requires clean, committed source and a current compatibility review; `pnpm publish:android` retries an upload without rebuilding. This uploads APKs and public metadata only and does not push the source branch.

Android native tests include `PlayerAgentIntegrationTest`, which starts the real Express API against disposable data and verifies HTTP 201 enrollment, the pairing code, saved-credential reuse, and approval. Install the repository's Node dependencies with `pnpm install --frozen-lockfile` and keep Node on `PATH` before running `cd player/android && ./gradlew testDebugUnitTest` (`gradlew.bat` on Windows). Gradle supplies the repository path. This test does not use a deployed server or existing screen records; mocked HTTP 200-only tests do not cover the real enrollment contract.

Player 0.10.4 fixes the registration failure in 0.10.1–0.10.3 and defaults to direct updates from the fixed GitHub APK folder, independently of the content server's version. **Back/Menu → Update source → This server** opts into local/server APK distribution. Keep both discovery paths covered when changing the updater; an older server may return HTML for unsupported download paths. Users with older players should install 0.10.4 or newer over the existing app once, preserving settings and pairing. If previous failed enrollments filled the server's pending-screen limit, remove only unused pending **Screens** entries; do not clear the player's pairing data. See [Android recovery and updates](docs/android-tv.md#recovering-a-missing-pairing-code).

Run `node tests/player-startup.browser.mjs` with the Playwright settings above when changing player startup or timers. This serves the actual player entrypoint and checks pairing, empty playlists, playback, telemetry, and blank/resume using both a simulated Android bridge and the Pi HTTP reporting path. It uses real browser timers; injected clocks in unit tests alone cannot establish browser compatibility. Set `OPENFRAME_BROWSER_EXECUTABLE` to select an installed Chromium executable.

Run `node tests/android-download.browser.mjs` after building to verify the public APK availability states, real download attachments, and desktop/mobile layout against an isolated server. `tests/android-releases.test.mjs` covers metadata/path/checksum validation in the standard Node suite; `UpdateSourceTest` covers native discovery and downloads through the default GitHub source and the explicit server source. Real Android package parsing, installation permission/settings return, installer confirmation/cancellation, and signing-key rejection still require device acceptance.

Only server runtime packages belong in `dependencies`. Frontend libraries, CSS tooling, and development tools belong in `devDependencies`: the Docker build stage compiles them into `dist/` before the runtime stage installs production dependencies. Use a full install for `pnpm dev` or `pnpm build`; a production-only install runs the already-built server and assets.

- Keep changes focused; add tests for behavior and regressions, including editor/player agreement when a layer changes.
- Validate inputs in `server/schema.mjs`, mirror them in `app/types.ts`, and bound player memory/network/timer work.
- Update the relevant [documentation](docs/README.md) and describe user-visible behavior, compatibility, and migration needs.
- At completion, record one patch for each changed component: `pnpm version:patch "Summary"` updates the server/web version and root changelog; `pnpm version:player:patch "Summary"` updates the shared Pi/Android version and player changelog. Leave an unchanged component's version alone. Maintainers reconcile concurrent branch versions at integration time; do not overwrite another contributor's changelog entries.
- Review server/player contract changes in both directions, run affected checks, and record the outcome with `pnpm compatibility:review --impact compatible|breaking "Summary"`. Then run `pnpm compatibility:check`. The check flags changed contract sources; matching release numbers do not establish compatibility. See [compatibility reviews](docs/player-compatibility.md) for support declarations, source scope, and upgrade requirements.
- Run the checks above and review `git diff`/the staged files. See [SECURITY.md](SECURITY.md) before attaching logs or data.

Local commits may be as frequent as useful. Publishing source to GitHub remains a separate, explicitly approved milestone. The owner separately authorized Android APK publication: completed signed builds are archived under `apks/` on the `android-releases` branch, with a stable latest download. After an approved source push changes `player/version.json` on `main`, the Android workflow builds and publishes using the existing release key configured in repository secrets. This does not grant permission to push source history or to create a replacement signing key. Contributor pull requests should represent an agreed milestone; maintainers allocate the integration version. See [releases](docs/releases.md) for the complete policy and signing-secret setup.

By contributing, you agree that your contribution is available under the project's MIT license. Include attribution/licenses for third-party code or assets; never submit media you do not have permission to redistribute.

Run `node tests/widgets.browser.mjs` after building for shared editor/player shape styles, vertical weather fitting at multiple heights, encrypted stock connection controls, and quote changes without frame replacement. This uses injected/mock provider responses and an isolated database; it does not prove live Finnhub availability or account allowance. `tests/organization.browser.mjs` also covers single/multiple media drag/drop, user-to-group drag/drop, and admin-only group reparenting.

After building, `node tests/library-filters.browser.mjs` checks combined name/group/status filters, parent/child branches, ungrouped resources, counts, empty results, independent page state, and 320px layout using an isolated database. Use the Playwright environment settings above. Filter metadata visibility is covered by the Node account tests.

After building, run `node tests/ui-layout.browser.mjs` with the same Playwright settings for populated responsive UI checks. It verifies compact phone filters, visible first results, 31 access grants and direct-user summaries, accessible grant controls, collapsible nested folders, tag filtering, and aligned Media action footers. It uses synthetic images and an isolated temporary database and writes ignored screenshots under `work/ui-review/after/`.

After building, `node tests/data-feeds.browser.mjs` uses the standard Playwright environment settings to verify feed creation, one-time tokens, all four editor widgets, live player updates without frame replacement, disposal, and desktop/phone layouts. It starts an isolated disposable server/database and uses fictional data. Node feed tests cover authorization, validation, expiry/revocation, rate limits, publication permissions, and the public handoff contract; Python and Android native tests cover schema 4, cached snapshots, and online clearing after revocation.

After building, `node tests/media-uploads.browser.mjs` checks shared empty-folder visibility, hidden non-admin folder controls, real multi-file uploads, transfer/processing progress, mixed success/failure, navigation persistence, mobile notification layout, and cancellation against an isolated database. It uses the standard Playwright environment settings and synthetic images. Folder authorization tests also verify legacy ownership/Edit grants cannot bypass the admin-only policy and shared navigation never exposes private content.

After building, `node tests/workspace-ui.browser.mjs` checks load failure/retry states, generated starter creation/publication, draft versus published preview behavior, phone dialog actions, section/filter reload and browser Back, mobile navigation closure, guided pairing, and editor keyboard focus/publication impact. It uses the same Playwright settings and an isolated disposable database.

After building, `node tests/library-selection.browser.mjs` checks visible checked states after blur and search rerenders, pointer and keyboard toggling, multiple selections, and clearing selection in Slides and Playlists at desktop and phone widths. It uses the same Playwright settings and an isolated disposable database.

After building, `node tests/data-feed-applications.browser.mjs` verifies admin application setup, one-time scoped key generation, an external first push without a login cookie, automatic feed discovery, new metric fields, stable IDs through key rotation, confirmed revocation and unused-application deletion, and desktop/phone layouts. It uses the same Playwright settings and a disposable database; screenshots stay under ignored `work/ui-review/application-keys/`. The Node data-feed tests cover application isolation, payload/field/feed/key/rate limits, transaction rollback, creator disable/demotion/deletion, persisted mappings and unchanged player publication revisions.
