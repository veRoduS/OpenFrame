# Scope and roadmap

## Available in source

- Single-administrator management and Docker-hosted server with persistent SQLite/media storage.
- Text/images, image cropping and resize handles, backgrounds, vertical alignment, and text auto-sizing.
- Clock formats (HH:MM/HH:MM:SS, 12/24 hour) and automatic counters with affixes and goal messages.
- Media folders, tags, sorting, search, and batch operations.
- Playlist entry timing, optional start/expiration windows, active-status indicators, and duplicate confirmation.
- Explicit publication snapshots, pairing/assignment, rotation/blanking, readiness reports, refresh/restart/revocation.
- Verified offline asset cache and prepared-frame playback; Pi installation and image-customization scripts.
- Optional off-site Cloudflare Tunnel/Access and existing WireGuard client configuration import.

## Before claiming appliance readiness

These are acceptance requirements, not completed work or promised release dates:

- Clean Docker build/start and volume backup/restore on a real Docker host.
- Actual first boot, HDMI framing, Wi-Fi recovery, provisioning, and package compatibility on Raspberry Pi OS Lite.
- Sustained Zero 2 W memory/transition measurements with representative heavy image/widget slides.
- Real WireGuard and Cloudflare Access connectivity/credential-rotation validation.
- Dependency/security review and first GitHub CI execution.

Automated Node/Python checks and focused desktop/mobile browser regressions exist. They do not prove physical display smoothness, a bootable appliance image, or production security. No prebuilt hardware-tested SD-card image is supplied.

## Future work

Potential milestones, subject to owner prioritization: player update delivery with rollback; bounded cache cleanup; better backup/restore and administrator account recovery; recurring schedules; richer snapshot-based widgets; multi-user roles; remote screenshots; video support. These are not currently implemented. Arbitrary embedded web pages and unbounded live widgets need special scrutiny on low-memory devices.

Keep the core local-first: no mandatory hosted account, telemetry endpoint, subscription service, or cloud runtime dependency. Connectivity providers remain optional. Major release designation is reserved for an explicit owner decision, not the completion of any item on this page.
