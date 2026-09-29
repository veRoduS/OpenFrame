# Contributing

OpenFrame is an independent MIT-licensed project for local-first digital signage. Contributions should keep the server self-hostable and the player practical on small devices. Discuss large architectural changes in an issue before implementing them. Be respectful, provide reproducible reports, and avoid sharing credentials or private screen content.

## Development setup

Install Node.js 24 and pnpm 11.19.0 (`npm install --global pnpm@11.19.0`). Python 3.9+ is required for the standard-library player tests; Linux is required for actual Pi image construction. Docker with the Compose plugin is needed for container acceptance tests. No account or API key is required for local development.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3100 and sign in as `superadmin` using the unique password printed in the terminal on the first start. The server creates `data/` automatically. Existing accounts are preserved on restart. Use a separate `DATA_DIR` for test installations; never develop against your only production database. Local Node does not load `.env` automatically: set environment variables in your shell. Compose reads `.env` for interpolation.

## Verification

On Linux/macOS:

```sh
export OPENFRAME_PYTHON="$(command -v python3)"
pnpm version:check
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

For browser checks, install Playwright in a separate tools directory, install its Chromium browser, and set `OPENFRAME_PLAYWRIGHT` to that package's absolute `index.mjs` file URL. Run `node tests/playlist-picker.browser.mjs` against `pnpm dev` or `pnpm start`. Alternatively select an installed browser with `OPENFRAME_BROWSER_CHANNEL=msedge`. The test mocks API requests and writes ignored screenshots under `work/`; it does not edit your library. See the [hardware checklist](docs/playback-testing.md) for real-device acceptance.

After `pnpm build`, run `node tests/screen-setup.browser.mjs` with the same Playwright settings. It starts its own ephemeral server/database and verifies VPN import, allocation, ZIP contents, re-download, and desktop/mobile layouts using fake credentials. It does not contact a VPN or modify your running server's data.

## Change requirements

After building, `node tests/landing.browser.mjs` checks the public homepage, login/logout, bookmarked `/dashboard` access, persisted browser sessions, legacy invitation links, clipboard, FAQ, mobile navigation, and image loading at five viewport sizes. Use the same Playwright settings as the other browser checks. It seeds an isolated database with fictional content, never your library. To refresh the public sample workspace image deliberately, run it with `OPENFRAME_CAPTURE_LANDING=true`, then rebuild and rerun without that flag. See [public website](docs/public-website.md) for routes and asset provenance.

After building, `node tests/accounts.browser.mjs` verifies user invitations, password changes, group joining, and desktop/mobile account layouts against an isolated database. Use the same Playwright environment settings as the other browser tests. Account authorization, migration, direct media access, and screen assignment are covered by `tests/accounts.test.mjs` in the standard Node suite.

After building, `node tests/weather.browser.mjs` checks ZIP lookup, current/six-hour weather, local icons, resize handles, units, persistence, responsive layouts, and player weather updates without replacing the active frame. It starts an isolated database/server and injects fake NWS and ZIP responses; it never modifies your normal library or contacts those services. Use the same Playwright environment settings as the other browser tests.

After building, `node tests/transitions.browser.mjs` uses an isolated server/database to check playlist transition controls and persistence at desktop/phone widths, native whole-frame animations with decoded image/text/clock layers, midpoint pixels, portrait rotation, and effect cleanup. Use the same Playwright settings. Screenshots are ignored under `work/`; these browser checks do not establish physical Pi performance.

For `node tests/player-connectivity.browser.mjs`, provide a generated, non-secret Wi-Fi QR PNG at `work/setup-qr.png` or set `OPENFRAME_TEST_QR_PNG`. For example, with Python `qrcode[pil]` installed in a separate test environment, generate `WIFI:T:WPA;S:OpenFrame-Setup-AB12;P:fake-password;;` into that file. The test uses the same Playwright settings, mocks all networking, and checks the HDMI setup view at 1920x1080 and 800x480, mobile layout, offline cached frames, agent interruption, blanking, and the recovery form. It does not validate the Pi's native `qrencode` binary or physical scanning.

Run `node tests/bootstrap.browser.mjs` with the same Playwright settings to check the first-boot form at desktop and phone sizes. Its network requests are mocked and it never configures your Wi-Fi. Managed VPN tests use an injected helper; Python provisioning tests mock privileged commands. Actual Compose networking, image chroot/package installation, regulatory settings, and Pi AP/client switching need the separate [acceptance checklist](docs/managed-wireguard.md#acceptance-checks).

Recovery browser coverage includes saved Wi-Fi add/edit/remove/reorder, mouse/touch drag grips, keyboard reordering and cancellation, password retention/clearing, hidden/open settings, save conflicts, and saving without closing the hotspot. `wifi_test.py` exercises real temporary keyfiles with mocked NetworkManager commands; `recovery_test.py` checks portal authorization and pause-preserving saves. `roaming_test.py` models scan cadence, stable priority promotion, restoration attempts, cooldowns, and inspection failures. These do not establish radio/failover behavior on a physical Pi. Regenerate the bundled weather and recovery icons with `pnpm icons:generate`, then `pnpm format`, when changing the selected Lucide icons.

## Source layout

Management UI code lives under `app/`, including shared components in `app/components/ui/`, hooks in `app/hooks/`, and utilities in `app/lib/`. The `@/` import alias resolves to `app/` in both Vite and TypeScript. Keep only components used by the application; add new ones as needed. Formatting and linting cover this entire tree.

The API lives in `server/`. The independently installed Pi agent and browser assets live in `player/`; do not move these into the management UI. See the [source map](docs/architecture.md#source-map) for the remaining boundaries.

Only server runtime packages belong in `dependencies`. Frontend libraries, CSS tooling, and development tools belong in `devDependencies`: the Docker build stage compiles them into `dist/` before the runtime stage installs production dependencies. Use a full install for `pnpm dev` or `pnpm build`; a production-only install runs the already-built server and assets.

- Keep changes focused; add tests for behavior and regressions, including editor/player agreement when a layer changes.
- Validate inputs in `server/schema.mjs`, mirror them in `app/types.ts`, and bound player memory/network/timer work.
- Update the relevant [documentation](docs/README.md) and describe user-visible behavior, compatibility, and migration needs.
- At completion, record one local patch version using `pnpm version:patch "Summary"`. Maintainers reconcile concurrent branch versions at integration time; do not overwrite another contributor's changelog entries.
- Run the checks above and review `git diff`/the staged files. See [SECURITY.md](SECURITY.md) before attaching logs or data.

Local commits may be as frequent as useful. Publishing to GitHub is a separate, explicitly approved milestone, not an automatic consequence of completing a task. Contributor pull requests should represent an agreed milestone; maintainers allocate the integration version. See [releases](docs/releases.md) for the complete policy.

By contributing, you agree that your contribution is available under the project's MIT license. Include attribution/licenses for third-party code or assets; never submit media you do not have permission to redistribute.
