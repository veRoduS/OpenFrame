# Validation record

## Local server revision 0.18.1: inherited access and linked playlists

Checked on 2026-10-05: 52 Node server/access checks passed; two optional Python-agent integration checks were skipped because OPENFRAME_PYTHON was not enabled. Lint, typecheck, the production web build, and version/repository/compatibility checks passed. Both organization and library-access browser checks passed using installed Chromium, including desktop/phone layouts, inherited read-only views, user-local forks, timing/order, tagging, folder moves, and access dialog controls. Screenshots were visually reviewed at 1280 and 390 pixels.

The reviewed player contract stays compatible with player 0.10.12: forks are flattened by the server into existing schema 2/3 publications, with ordinary embedded slides, assets, durations, schedules, and transitions. Stable entry IDs and frozen fork draft state stay on the server. Tests verify that master updates preserve published overrides without releasing draft item, name, or transition changes, and that missing master access retains the last valid publication even when a source slide is edited. Existing direct grants retain Edit while hierarchy access becomes View; credentials, sessions, player tokens, and stored publications are preserved.

This is local source work. No deployment or physical Pi/Android playback check is included. Player source and its version remain unchanged.


## Player 0.10.5: automatic update preference

Automatic APK checks can now be disabled per device. The persisted setting defaults off; the Back/Menu action always supports an immediate manual update check. Choosing GitHub or This server remains independent of that preference. The SDK build verifies that the player source compiles and the signed APK metadata matches the player version. No automated tests or physical Android TV checks were run for this small settings change.


## Player 0.10.4: real enrollment and independent GitHub updates

The reported missing pairing code was reproduced: the real server returns HTTP 201 for new enrollment, but the Android agent accepted only HTTP 200. Earlier native fixtures incorrectly returned 200, so their passing results did not establish enrollment compatibility. Correcting that fixture made five of the eight original native tests fail. Player 0.10.4 accepts 201 for enrollment (and legacy 200), keeps sync/media success restricted to 200, preserves a saved pairing code during an initial sync failure, and gives controlled HTTP, webpage, and network diagnostics.

Checked on 2026-10-02: 25 native Java tests passed, including a new integration test that runs the actual Android agent against the real Express API with disposable data. It verifies initial pairing, saved-credential reuse after reopening, and approval with no assigned playlist. The 152 Node tests, 89 Python tests, lint, typecheck, production web build, and repository checks passed. The native updater also discovered and downloaded the published GitHub APK directly through this environment's HTTPS proxy, then verified its checksum.

Updates now default to the fixed GitHub APK folder, independent of the content server version. Tests cover immutable version URLs, metadata that attempts to choose a foreign source, explicit local-server distribution, source binding through download/restoration, redirects, malformed HTML/JSON, bounds, checksum failures, and cancellation. The installation signer/package checks remain in place. The server runtime is unchanged at 0.10.4; the older published server's enrollment and playlist contracts are also preserved.

Install the signed 0.10.4 APK over the existing app once when an old server cannot supply update metadata. Old failed enrollment retries may leave unused pending screens; remove those only if the server's pending-device limit blocks pairing. These checks do not establish physical Android TV installation, permission return, or long-run playback. Gradle dependency access remains unavailable here; native tests use the host JDK and the APK uses the official SDK fallback with the existing release key. The supplied public server could not be probed from this workspace because its outbound proxy denied that hostname; live network/proxy access on the TV remains separate from the reproduced client bug.

## Server 0.10.4 / player 0.10.3: GitHub APK distribution and independent versions

Checked on 2026-10-02: 152 Node tests (including real Python-agent integration), 89 Python tests, and 13 native Java agent/updater tests passed. Typecheck, lint, production build, repository checks, and Pi shell syntax passed. Landing browser checks passed at five viewport widths; the Android download browser check verifies the direct GitHub link and downloaded bytes on desktop/mobile without a local APK or render-time metadata request.

Tests cover separate server/player version bumps, compatibility review invalidation on source/protocol changes, immutable APK archives, monotonic latest updates, idempotent publication to a temporary bare Git repository, symlink rejection, pinned signing identity, actual APK package/version/SDK checks, and the bounded GitHub mirror's cache, redirects, size and checksum enforcement. The existing signed player APK passes SDK signature/package/alignment verification against the public certificate pin. The player runtime and sync/playlist/update wire contracts remain unchanged; the review records server 0.10.4 with player 0.10.3.

APK publication is authorized for the dedicated `android-releases` branch. Source changes, the landing-page deployment, and hosted workflow activation are separate; the workflow needs the existing signing key in Actions secrets after its source reaches GitHub. Gradle lint and a full Gradle build remain unavailable here due to the previously recorded Maven dependency-access failure; the SDK fallback is available. Physical Android TV installation and upgrade acceptance, Docker deployment, and long-run playback have not been validated by these host checks.

## Local revision 0.10.3: Android downloads and update checks

Checked on 2026-10-01: 121 Node tests, 89 Python tests, and 13 native Java agent/updater tests passed. Typecheck, lint, and the production web build passed. The public-download browser test verified unavailable/available states, APK attachment bytes, and desktop/mobile layout. The full landing-page browser suite passed at five viewport widths.

Native update tests cover newer/equal/older versions, incompatible SDK/package, metadata path/size validation, rejected redirects, missing releases, checksum failures, preservation of an existing download after a failed replacement, and cancellation. All Android sources compile against API 35. The 0.10.3 APK is built through the SDK fallback with the existing private release key; signing/alignment and package/provider metadata are checked. Builds now generate a matching `latest.json` for the public download endpoints. No live server deployment or GitHub publication is included.

An end-to-end host smoke check ran the native updater's discovery/download code against the real OpenFrame server routes with the signed 0.10.3 release, then independently verified the downloaded APK signature. The release certificate matches 0.10.2, and archive metadata/checksums match the APK.

The real Android permission/settings-return flow, package-manager signing checks, installer approval/cancellation, and successful in-place replacement still require device testing. Checks on the host do not establish unattended TV reliability. Android requires user approval for installation; 0.10.1/0.10.2 need a manual update once to gain this feature. See [Android acceptance and hosting](android-tv.md).

## Local revision 0.10.2: player startup timer binding

Reproduced the reported **Waiting for connection / Illegal invocation** screen in Chromium with the actual player entrypoint before changing the code. The playback controller stored native browser timer functions as instance methods, passing the controller as their receiver; browsers reject that invocation. Wrapped the default timer calls through `globalThis`, preserving injected clocks used by other tests.

The new browser regression covers pairing, empty playlists, actual playback with browser timers, telemetry, and blank/resume for both the simulated Android bridge and Pi HTTP paths. Both paths pass after the fix. The Node suite now includes a receiver-enforcing timer regression. Android 0.10.2 is rebuilt with the existing private release key for installation over 0.10.1 without clearing app data. Browser testing does not replace validation on the user's Android TV device.

## Local revision 0.10.1: Android TV USB player

Checked on 2026-10-01: 117 Node tests (including Python-agent integration), 89 Python tests, typecheck, lint, and the production web build passed. Eight native Java agent tests passed using JUnit 4.13.2 and Android's JSON implementation: pairing persistence, credential isolation, checksum/atomic publication behavior, offline restart, explicit revocation versus proxy failures, command acknowledgement, telemetry, input limits, and cached weather preservation.

The release APK was compiled against Android API 35, dexed for API 28+, packaged with the shared renderer, aligned, and signed using official Android SDK build-tools 35.0.0. APK signature verification and alignment checks passed. A private local signing key is retained outside version control for future compatible updates. The USB bundle contains the APK, checksum, and installation instructions, with no signing credentials.

Maven Central returned HTTP 429 during Gradle dependency resolution. The checked-in SDK-only fallback produced the APK; Gradle release lint and the complete Gradle build remain unverified in this environment. No emulator or physical Android TV test was performed. USB installation, remote navigation, WebView playback, upgrades, device power/sleep behavior, and long-run performance still require the [Android TV acceptance checklist](android-tv.md#physical-acceptance-checklist). No GitHub publication or deployment was performed.

## GitHub milestone 0.9.0

Checked on 2026-09-30: 112 Node tests (including real Python-agent integration), 85 Python tests, typecheck, lint, production build, version consistency, and repository/documentation checks passed. This milestone preserves local revision 0.8.1 and adds Codex Cloud onboarding/deployment documentation; no application runtime or player behavior changes. Browser suites, an isolated clean install, and a dependency audit were not repeated for this documentation-focused milestone.

Docker is unavailable in this development environment. Consult the actual GitHub Actions run for native AMD64/ARM64 container checks and image-publication status. Physical Pi performance and deployment validation are not claimed. No application deployment or player update is included.

## Pre-publication 0.8.0

Checked on 2026-09-30: 111 Node tests including real Python-agent integration and 85 Python tests passed, along with typecheck, lint, formatting, production build, three Pi shell syntax checks, and version/repository checks. An isolated frozen-lockfile install using the repository's build-script policy passed. The production dependency audit reported no known vulnerabilities. The new access controls and dialog were visually checked against isolated preview data on desktop and phone layouts during revision 0.7.1. The complete browser automation suite was not repeated for this milestone.

Docker is not installed on this machine, so local container and volume-backup/restore acceptance checks remain unavailable. The tagged workflow must pass its native AMD64 and ARM64 container checks before publishing 0.8.0 and latest. Physical Pi and live managed-VPN testing remain outstanding; this milestone does not claim hardware validation or enable managed WireGuard on existing deployments. No screenshots, private preview data, or credentials are included in the publication.

## Pre-publication 0.6.0

Checked on 2026-09-29: 111 Node tests (including Python-agent integration), 85 Python tests, typecheck, lint, formatting, production build, shell syntax, and version/repository checks passed. The landing, account, playlist-picker, transition, weather, screen-setup, player-connectivity/recovery, and first-boot browser suites passed against isolated data; external APIs and player networking were mocked. The production dependency audit identified [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34); Multer was upgraded to 2.4.0, the first patched version, and the repeated audit found no known vulnerabilities. The publish workflow now assigns both the fixed milestone version and `latest` to the same successful multi-platform image build.

Docker is not installed here, so local image build, AMD64/ARM64 container smoke, and volume-backup tests were unavailable; the tagged GitHub Actions workflow is configured to run both architecture checks before publishing. Physical Pi Zero 2 W resource use and behavior remain unvalidated; see the [hardware checklist](playback-testing.md) before unattended use. Review the actual Actions result after pushing; it determines whether `latest` advances.

The first publication attempt for `v0.6.0` passed the general CI job, but both architecture jobs exposed an outdated smoke test that still expected `/api/setup` to create the administrator. Fresh installations now seed the administrator first, so the API correctly rejects that request. The image publisher did not run; neither the `0.6.0` image nor `latest` was published. The `v0.6.0` source tag remains unchanged. The failed job's diagnostic logs included the one-time credential from its disposable CI database; cleanup removed that database at job end. The corrected check masks that generated credential before any failure-log step. Verify the replacement milestone's Actions run before using its image.

## Local revision 0.5.3

103 Node tests including Python-agent integration and 85 Python tests passed, along with lint, typecheck, formatting, production build, Pi shell syntax, and version/repository checks. New roaming tests cover one-minute cadence, consecutive-scan confirmation, highest-priority and staged promotion, signal/security filtering, exact UTF-8/whitespace SSID matching, hidden probes, disabled profiles, stale edits, connection/approval changes, activation failures, restoration attempts, bounded cooldowns, and scan failures. NetworkManager commands remain mocked.

Recovery browser checks passed at 900/390/320px for mouse/touch dragging, keyboard reordering, cancellation, retained unsaved passwords, save/reload, hidden/open networks, conflicts, pause/resume, cached offline playback, and blanking. First-boot form regressions also passed; screenshots were inspected. Physical Pi scans, network switching, restoration timing, HDMI continuity, and unattended reliability require the [hardware checklist](player-recovery.md#validation-before-unattended-use). No Docker test, deployment, dependency audit, or GitHub push was performed. Update the complete player source and setup web assets, then restart the recovery service or reboot; updating the home-server container alone does not update this behavior.

## Local revision 0.5.2

103 Node tests including Python-agent integration and 71 Python tests passed, along with lint, typecheck, formatting, production build, Pi shell syntax, and version/repository checks. New Python coverage uses temporary real keyfiles and mocked NetworkManager commands for imported-profile inventory, secret-free responses, password retention/replacement, hidden/open profiles, priority persistence, static IP preservation, stale/invalid input rejection, unrelated-profile preservation, rollback, country application on reconnect, and authenticated pause-preserving portal saves.

Recovery browser checks passed at 900/390/320px for adding/editing/removing/reordering networks, save and reload, retained/cleared password fields, hidden/open settings, save conflicts with retained drafts, all pause choices, explicit resume, offline playback, and blanking. The first-boot form regression also passed. Screenshots were inspected. Radio operations, actual NetworkManager profile loading, regulatory-domain changes, fallback timing, power-loss recovery, and physical Pi Wi-Fi/HDMI behavior still need the [hardware checklist](player-recovery.md#validation-before-unattended-use). No Docker test, deployment, dependency audit, or GitHub push was performed. Install the updated complete player directory; the local hotspot UI is not hosted by the home-server container.

## Local revision 0.5.1

103 Node tests (including real Python-agent integration), 58 Python tests, lint, typecheck, formatting, production build, shell syntax, and version/repository checks passed. New tests cover transition validation/publication isolation, complete-frame readiness, full display timing after animations, two-frame bounds over repeated loops, cancellation on publication/rotation/expiration/blanking, reduced-motion/cut fallbacks, and animation disposal/watchdog behavior.

Isolated browser checks passed for transition controls and saved settings at 1280/390/320px, decoded photo/text/clock layers, native whole-frame animation targets, fade/slide midpoint pixels, portrait rotation, and cleanup. Screenshots were inspected. Weather, playlist selection/duplicate confirmation, and player connectivity/recovery browser regressions passed. The updated local server reports 0.5.1. No GitHub push, Docker/deployment test, dependency audit, or physical Pi performance/soak test was performed. Server updates do not update installed player code; see [player compatibility](user-guide.md#prepared-playback).

## GitHub milestone 0.5.0

Documentation-only milestone checked on 2026-09-17: the README was reduced from 3,376 to 319 words, detailed usage and Pi installation instructions were preserved in dedicated guides, and affected links were updated. Repository/version checks, 93 Node tests (including Python-agent integration), 58 Python tests, typecheck, lint, formatting, production build, shell syntax, and an isolated frozen-lockfile install passed. The production dependency audit reported no known vulnerabilities. No behavior, dependency, configuration, or data-format changes were made; browser/hardware tests were not repeated for this documentation revision. Docker remains unavailable locally. Consult [Actions](https://github.com/veRoduS/OpenFrame/actions) for this tag's remote container checks and publication result.

## GitHub milestone 0.4.0

Pre-publication checks on 2026-09-17: 93 Node tests (including Python-agent integration), 58 Python tests, typecheck, lint, formatting, production build, three Pi shell syntax checks, version/repository checks, and an isolated frozen-lockfile install passed. The production dependency audit reported no known vulnerabilities. Weather, setup/connectivity/recovery, first-boot form, and screen-setup browser suites passed with isolated or mocked data. This milestone preserves the four local patch commits below.

Docker is unavailable on this development machine; native AMD64/ARM64 container checks and image publication are performed by the tagged [Actions workflow](https://github.com/veRoduS/OpenFrame/actions). Consult the actual run for remote results; local checks do not establish workflow success. Physical Pi radio switching, QR scanning, HDMI smoothness, and Zero 2 W memory/soak tests remain unvalidated. No deployment or hardware-tested SD-card image is included. Update the complete player directory along with the server for the new recovery and weather features; see the compatibility and rollback notes in the [changelog](../CHANGELOG.md).

## Local revision 0.3.4

Checked on 2026-09-17: 93 Node tests (including Python-agent integration), 58 Python tests, typecheck, lint, formatting, production build, shell syntax, and version/repository checks passed. Weather coverage includes ZIP validation, leading zeros, bounded cache/deduplication and request throttling, administrator authorization, malformed/oversized responses, independent forecast/observation retention, missing-temperature station fallback, six-hour windows, timezone labels, unit conversion, icon mapping, deferred timers/disposal, and the agent's static icon module and offline persistence.

Browser checks passed for ZIP lookup and error preservation, current/six-hour controls, bundled icon geometry, units, resizing, saved settings, editor layouts at 1280/390/320px, and both player views at 1280/390px. Cached weather refreshes preserve the visible frame; weather/icon requests never leave the local player origin. Blanking, two-frame bounds, and the setup/connectivity/recovery regression also passed. Screenshots were inspected. Fixtures use isolated data and fake weather. Separate read-only live ZIP lookup, NWS station-list, and latest-observation checks for Chicago returned HTTP 200 with expected fields. No Docker/Pi hardware test, deployment, dependency audit, or GitHub push was performed. Update the complete player directory before using these settings.

## Local revision 0.3.3

Checked on 2026-09-16: 88 Node tests (including Python-agent integration), 57 Python tests, typecheck, lint, formatting, production build, shell syntax, and version/repository checks passed. Weather tests cover location/request deduplication, persisted cache reuse, retry backoff and last-known data, request/destination/response bounds, concurrency/capacity, authenticated API access, approval and publication isolation, independent weather updates, units, stale/expired formatting, deferred widget timers and cleanup, and agent offline persistence. The agent's static module allowlist now includes weather and clock modules.

The weather browser suite passed at 1280/390/320px for editor controls, resize handles, units, saving, text fitting, and responsive layout, plus player weather refresh without replacing the visible frame, offline content, two-frame bounds, and blanking. The first-boot/connectivity/recovery browser regression also passed. Screenshots were inspected. Browser weather tests use injected NWS fixtures and an isolated database. Separate read-only live NWS points and hourly-forecast requests for the Chicago example both returned HTTP 200 with the expected fields. This is not a physical-Pi performance or long-term NWS availability test. No Docker/hardware test, deployment, dependency audit, or GitHub push was performed.

## Local revision 0.3.2

Checked on 2026-09-16: 81 Node tests (including Python-agent integration), 56 Python tests, typecheck, lint, formatting, production build, shell syntax, and version/repository checks passed. New recovery coverage includes each monotonic pause deadline, indefinite pause, invalid inputs, expiry/submission ordering, restart defaults, protected pause/resume endpoints, and retaining the hotspot past its original deadline until resumed. Privileged networking remains mocked.

Browser checks passed for the branded first-boot display at 1920x1080 and 800x480 plus 390px, all three setup stages, cached playback and connection indicators, and the recovery page at 900/390/320px. Recovery tests exercise all four pause choices, reload persistence, preserving in-progress edits when pausing, explicit resume, failed pause responses, and replacement Wi-Fi submission while paused. The first-boot phone-form regression also passed at 900/390/320px. Screenshots were inspected. QR credentials are fake fixtures; native QR generation/scanning and actual Pi radio switching remain untested. Complete the expanded [hardware recovery checks](player-recovery.md#validation-before-unattended-use) before unattended use. No GitHub push, device deployment, or new dependency audit was performed.

## Local revision 0.3.1

Checked on 2026-09-16: 81 Node tests (including Python-agent integration), 49 Python tests, typecheck, lint, formatting, build, shell syntax, and version/repository checks passed. The added coverage includes encrypted recovery credentials and access control, cached-playback connectivity/retry state, hidden profile construction, outage grace/retry timing, reserved firewall cleanup, and recovery form boundaries.

Browser checks cover the real isolated admin API and credential reveal/hide at 1280/390/320px, the setup display at 1920x1080 and 800x480 plus mobile, approval state, unchanged visible frames during server/agent interruption, subtle offline indicator and blanking, and recovery form submission. Screenshots were inspected. The QR fixture contains fake credentials and was generated by a test-only QR library; the native Pi `qrencode` binary was not run here. Network operations remain mocked: radio switching, hidden SSID association, DHCP/firewall isolation, physical QR scanning, and uninterrupted Pi playback require the [recovery acceptance checks](player-recovery.md#validation-before-unattended-use). No GitHub push or device deployment was performed for this revision.

## GitHub milestone 0.3.0

Pre-publication checks on 2026-09-13: 80 Node tests (zero skips, including Python-agent integration), 40 Python tests, typecheck, lint, formatting, production build, shell syntax, version/repository checks, and an isolated frozen-lockfile install passed. The production dependency audit reported no known vulnerabilities. Screen-setup and first-boot-form browser regressions passed at desktop and phone widths using isolated data and mocked networking.

This milestone preserves both local patch commits. See [Actions](https://github.com/veRoduS/OpenFrame/actions) for CI and image-publication results; local checks do not establish remote success. Docker is unavailable locally. Live managed networking, image building, Pi boot, and hardware performance remain experimental and unvalidated, as described in the [acceptance checklist](managed-wireguard.md#acceptance-checks). No hardware-tested SD-card image is being published.

## Local revision 0.2.2

Checked on 2026-09-12, locally only. Optional managed WireGuard and hotspot onboarding are experimental, not a published appliance release.

- 80 Node tests passed, zero skipped, including real Python-agent integration and injected managed-VPN approval, allocation, retry, outage, revocation, and identity-pinning cases.
- 40 Python tests passed. First-boot country/AP commands, route guarding, public-to-private pairing preservation, enrollment retries, portal request boundaries, and existing agent/import paths use mocked privileged networking.
- Typecheck, lint, formatting, production build, three Pi shell syntax checks, version consistency, repository hygiene, documentation links, and Compose/CI YAML parsing passed.
- First-boot phone form passed at 900/390/320px. Screen setup/import/export and managed-status layouts passed at 1280/390/320px using an ephemeral database and fake credentials. Playlist picker regression passed at the same three sizes against mocked APIs. Screenshots were visually inspected for the phone form and setup views.
- The normal local preview reports version 0.2.2. No VPN service, router change, image publication, GitHub push, or deployment was performed.

Docker is unavailable in this Windows environment. Live WireGuard/iptables/network-namespace behavior, hotspot radio switching, image chroot/package installation, fresh Pi boot, and physical Zero 2 W/Pi 4/5 performance remain untested. CI's new helper build/binary checks have not been run remotely for this local revision. Complete the [managed VPN acceptance checklist](managed-wireguard.md#acceptance-checks), including forced-helper-failure recovery, before unattended use. No new dependency audit or independent security audit was performed for this revision.

## GitHub milestone 0.2.0

Local checks for the first GitHub milestone: 67 Node tests (including real Python-agent integration), 32 Python tests, lint, typecheck, production build, version/repository checks, and production dependency audit passed. The production audit reported zero advisories at check time.

The new workflow adds native AMD64 and ARM64 Docker health, persistence, SQLite startup, and image-codec checks before image publication. Consult the [actual Actions runs](https://github.com/veRoduS/OpenFrame/actions) for remote results; adding a workflow is not proof it passed. Physical Pi testing remains outstanding. This milestone builds a server container and Compose artifact, not a tested SD-card image or containerized HDMI kiosk.

## Local baseline 0.1.1

Local release-preparation revision: **0.1.1**, checked on **2026-09-09**. These results describe this source revision, not a published GitHub release or a certified appliance image.

| Check | Result |
| --- | --- |
| Node test suite with real Python agent integration | 65 passed, zero skips |
| Python agent and WireGuard provisioning suite | 32 passed; system networking mocked |
| TypeScript, Oxlint, production Vite build | Passed |
| Isolated locked dependency installation | Passed on Windows with Node 24 / pnpm 11.19.0 |
| Playlist picker browser regression | Passed at 1280px, 390px, and 320px using Edge with mocked API fixtures |
| Local server health | HTTP 200, version 0.1.1 |
| Package/player/changelog consistency | Passed |
| Candidate-file hygiene and local documentation links | Passed; not a comprehensive secret scan |
| Pi shell syntax and Compose/CI YAML parsing | Passed; not runtime validation |
| npm advisory audit through pnpm, including development dependencies | Zero reported advisories at check time; not a security audit |

## Still required

- Execute the newly added GitHub CI workflow after the first approved publication.
- Build/start Docker on a Docker host and rehearse volume backup/restore and upgrades. Docker was not available in this development environment.
- Provision and soak-test a physical Raspberry Pi/Zero 2 W, including real networking, display timing, memory, and offline reboot behavior.
- Validate actual Cloudflare and WireGuard deployments; unit/integration test doubles are not proof of those external services.
- Review staged content and dependency licenses, configure a real Git author/repository, and approve the milestone before publishing.

Repeat the [release checklist](releases.md#pre-publication-checklist) for every milestone. Do not reuse this dated record as evidence for a later version.
