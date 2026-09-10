# Changelog

Versions follow the project's [milestone policy](docs/releases.md), not feature-based SemVer increments. Entries are local development history unless identified by a published Git tag/release. No historical release dates or GitHub publications are implied.

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
