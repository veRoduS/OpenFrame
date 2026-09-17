# Changelog

Versions follow the project's [milestone policy](docs/releases.md), not feature-based SemVer increments. Entries are local development history unless identified by a published Git tag/release. No historical release dates or GitHub publications are implied.

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
