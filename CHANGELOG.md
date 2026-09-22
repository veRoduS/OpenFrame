# Changelog

Versions follow the project's [milestone policy](docs/releases.md), not feature-based SemVer increments. Entries are local development history unless identified by a published Git tag/release. No historical release dates or GitHub publications are implied.

## [0.5.5] - 2026-09-22

- Consolidate app source and remove unused scaffolding and dependencies

## [0.5.4] - 2026-09-19

- Clarify example Wi-Fi network names in recovery previews

## [0.5.3] - 2026-09-19

- Add draggable Wi-Fi priorities and automatic promotion from backup networks
- Replace arrow controls with left-side drag grips supporting mouse, touch, keyboard reordering, and cancellation. Preserve unsaved edits and require Save networks to apply the order.
- Check higher saved priorities about once a minute while connected to a backup. Require two stable scans and matching security; attempt restoration after failed activation, with increasing candidate cooldowns. Do not scan or promote during recovery-hotspot windows.
- Compatibility: update the complete player source and setup web assets, then restart the recovery service or reboot. No new dependency, service, data migration, or automatic player update. Existing pairing, VPN, and cached playback are preserved. Switching briefly interrupts networking; physical Pi/radio behavior remains unvalidated. See [recovery acceptance](docs/player-recovery.md) and [upgrade/rollback](docs/operations.md).

## [0.5.2] - 2026-09-19

- Add saved Wi-Fi networks and priority ordering to the recovery portal
- Add/edit/remove up to 20 personal/open networks, reorder with arrow controls, retain stored passwords, and support hidden networks. Save without ending a recovery pause; reconnect explicitly when ready.
- Persist priority in root-only NetworkManager profiles, preserve other settings on retained profiles, reject stale edits, and attempt rollback after save failures. Keep Wi-Fi secrets off the home server and out of browser responses and command arguments.
- Compatibility: update the complete player source and rerun the installer, including `wifi.py` and all `setup-web` assets; a Docker-only update cannot update the local recovery page. Existing pairing, VPN, and cached content remain intact. No server data migration or automatic player update is included. See [recovery setup and hardware acceptance](docs/player-recovery.md) and [private backup/rollback guidance](docs/operations.md). Physical NetworkManager/radio failover remains untested; priority does not force roaming from a healthy Wi-Fi connection or detect server-only outages.

## [0.5.1] - 2026-09-18

- Add prepared whole-slide fade and slide transitions with playlist controls
- Keep Cut as the default; offer Fade, Slide left, and Slide right with 0.2-2.0 second durations. Save and publish transition settings with the playlist.
- Wait for decoded photos, widget readiness, fonts, and layout before transitioning. Retain at most two frames, dispose outgoing resources before preparing another, and give each incoming slide its full duration after animation.
- Cancel effects on replacement, expiration, blanking, and revocation. Use Cut for initial/replacement frames, reduced motion, and unsupported animation backends.
- Compatibility: update the server and complete `player/web` directory, then restart the kiosk. Existing publications default to Cut; older players ignore these additive settings. No database migration or automatic player update is included. Follow [upgrade/rollback operations](docs/operations.md) and [Pi acceptance checks](docs/playback-testing.md); physical-device smoothness is not validated.

## [0.5.0] - 2026-09-17

- Approved documentation milestone: concise project overview, features, and setup in the README; detailed usage and Raspberry Pi instructions now live in dedicated guides.
- Present OpenFrame independently, remove product comparisons, and update documentation links. Preserve the local 0.4.1 revision in history.
- Documentation and version metadata only; no application behavior, stored-data format, configuration, or player protocol changes. No player reinstall is needed solely for this milestone. Existing backup/rollback guidance and experimental hardware limitations still apply.

## [0.4.1] - 2026-09-17

- Simplify the README and separate user and Pi installation guides

## [0.4.0] - 2026-09-17

- Approved GitHub milestone: player recovery, branded onboarding, and shared weather widgets. Includes all local revisions 0.3.1 through 0.3.4 without squashing their history.
- Add branded first-boot QR guidance, last-heartbeat labels, cached playback with a subtle disconnection indicator, and reconnect attempts approximately every 15 seconds.
- Add single-radio hidden recovery Wi-Fi when needed, server-managed recovery credentials, and reconnect pauses of one minute, five minutes, fifteen minutes, or indefinitely.
- Add NWS weather with shared per-location requests, US ZIP lookup, current observations or the next six forecast hours, bundled offline condition icons, and independent forecast/observation caching.
- Compatibility: update the server and complete player directory together for the new widgets and recovery features; server container updates do not update Pi code or the OS. Existing slides, media, pairing, and manifest schemaVersion remain compatible. Review [weather upgrades](docs/weather.md), [recovery setup](docs/player-recovery.md), and [backup/rollback operations](docs/operations.md). Preserve application data and matching VPN state backups before upgrading; restore the matching backup and previous image/source for rollback.
- Experimental limitations: physical Pi Wi-Fi switching, QR scanning, HDMI performance, and Zero 2 W memory/soak testing remain unvalidated. No automatic player updater or hardware-tested SD-card image is included. The milestone workflow publishes the application image and Compose artifact, not the optional source-built WireGuard helper.

## [0.3.4] - 2026-09-17

- Add weather ZIP lookup, current observations, six-hour forecasts, and offline condition icons

## [0.3.3] - 2026-09-17

- Add NWS weather widgets with shared location caching and offline player snapshots

## [0.3.2] - 2026-09-16

- Polish first-boot branding and add timed or indefinite recovery reconnect pauses

## [0.3.1] - 2026-09-16

- Add setup QR guidance, offline indicators, heartbeat labels and single-radio hidden Wi-Fi recovery

## [0.3.0] - 2026-09-13

- Approved GitHub milestone: screen setup bundles and experimental managed WireGuard onboarding.
- Add encrypted imported WireGuard inventory, one-client-per-setup allocation, and private ZIP downloads containing player, optional Wi-Fi, and Cloudflare Access configuration.
- Add opt-in, source-built WireGuard hosting, approval-gated peer allocation, managed VPN status, and a Pi first-boot hotspot form. Client private keys remain on the Pi; verified setup switches playback to the private VPN origin.
- Include simple installation instructions, security/recovery guidance, and native AMD64/ARM64 helper build checks in CI. The managed helper is source-built; the existing publishing workflow publishes the application image and Compose artifact only.
- Compatibility: existing players, external VPN imports, stored media, and manifest schema remain unchanged. Back up application data before upgrading; managed deployments also require the matching WireGuard state backup. Server upgrades do not update Pi code or the OS. Use matching player source when provisioning the new hotspot flow; see [setup](docs/quick-start.md) and [upgrade/rollback operations](docs/operations.md).
- Experimental limitations: real managed Docker networking, image building, Pi Wi-Fi/HDMI boot, and Zero 2 W performance remain unvalidated. No prebuilt hardware-tested SD-card image, automatic public fallback, or OTA update service is included.

## [0.2.2] - 2026-09-13

- Add optional managed WireGuard hosting and Pi first-boot hotspot setup

## [0.2.1] - 2026-09-11

- Add screen setup bundles with encrypted WireGuard inventory and per-screen allocation

## [0.2.0] - 2026-09-10

- First GitHub milestone: ARM64/AMD64 container publishing, native architecture CI, and digest-pinned Compose stack.

## [0.1.1] - 2026-09-09

- Prepare GitHub documentation, release policy, synchronized versions, CI, and repository hygiene checks.
- Remove unused server-component/cloud-hosting scaffold dependencies; update Sharp, Vite, and UUID to patched versions. Rebuild the server image to use these dependency changes. This does not change stored media or player protocol.
- Pin Vite's optional esbuild development peer to a patched version and use Vite's client types directly.

## [0.1.0] - Initial Development Baseline (Unpublished)

- Self-hosted Docker server, authenticated single-admin management, SQLite persistence, and image uploads.
- Text/image slide editor with cropping, resizing, automatic text sizing, backgrounds, and clock/counter widgets.
- Media folders/tags, playlist scheduling and status indicators, duplicate-slide confirmation, and unsaved-change navigation.
- Published snapshots, device pairing/commands, verified offline cache, and prepared-frame playback.
- Raspberry Pi installation/image customization scripts, optional Cloudflare Access credentials, and WireGuard drop-in provisioning.
- Automated API, editor, renderer, and agent checks. Docker and physical Pi acceptance testing remain outstanding.
