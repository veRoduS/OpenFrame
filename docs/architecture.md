# Architecture

```text
Administrator browser -> Express API -> SQLite + processed images
                              ^
                              | outbound polling from each player
                              |
                        Python agent -> verified on-disk cache
                              ^
                              | loopback HTTP only
                              |
                        Chromium kiosk -> HDMI display
```

The home server is the source of truth for drafts, media, publications, device assignments, and commands. React/TypeScript provides management and editing; it does not run on the Pi. The server runs Node.js 24 with Express, built-in SQLite, Sharp image processing, and Zod validation. The player agent uses Python's standard library; its renderer uses small browser ES modules shared with the server-side playlist preview page.

## Pairing and synchronization

1. Provision the player's `server` origin explicitly in private JSON. There is no network discovery or central cloud directory. Use a stable LAN name/address, your Tunnel HTTPS hostname, or a WireGuard-reachable address. `localhost` on a Pi is the Pi itself.
2. The agent enrolls and persists its device identity/token in its restricted cache. The server stores a token hash and supplies an eight-character pairing code. Enrollment alone grants no media access.
3. An administrator enters the code in Screens, approves the device, and assigns a published playlist. The pairing code is not the long-lived authentication credential.
4. The agent initiates authenticated sync requests approximately every 15 seconds. It reports identity, current revision, uptime, errors, browser readiness, and command acknowledgements. The response supplies approval, settings, commands, and the assigned publication.
5. The agent downloads all publication assets, checks SHA-256 hashes, and commits the manifest only when the full set is available. Interrupted downloads leave the last complete publication intact.
6. The local browser polls the agent, prepares the next complete frame offscreen, then cuts or animates the complete frames according to the published playlist settings. It reports readiness every five seconds; reports missing for 30 seconds become stalled status.

This is eventual synchronization, not synchronized clocks or frame-lock across screens. Publication changes normally arrive within a polling interval plus download/preparation time. Timed schedules and widgets use each device's wall clock; configure time synchronization and the intended timezone. No open inbound Pi port is required. Cloudflare/WireGuard change the transport, not pairing or content ownership.

## Data and lifecycle

NWS weather uses a separate persisted `weather_cache` table and a timestamped `weather` map in the authenticated sync response. The server deduplicates refreshes by rounded coordinates, outside the heartbeat's critical path. The agent persists these snapshots with the last complete playback state; the browser updates active weather widgets without replacing frames or changing publication revisions. See [weather](weather.md) for limits, privacy, and offline behavior.

`DATA_DIR` contains `openframe.sqlite` (with WAL/SHM sidecars while active) and `media/`. SQLite records contain JSON slide/playlist/device/asset/folder data. Users, user sessions, groups, memberships, invitation hashes, resource ownership, and sharing grants have separate tables. `server/accounts.mjs` binds authenticated requests to an asynchronous request context; record reads and writes check access in that context. Player requests keep device-token authorization. Global reference checks prevent deletion of content still used outside the requesting user's library. Uploaded images become bounded-resolution WebP assets. Server-side publication snapshots contain copied slide/configuration/asset metadata, independent of later draft edits. See [users and migration](users-and-groups.md).

The Pi defaults to `/var/lib/openframe` for identity, cached state, manifests, and images. Its service serves only `127.0.0.1:8080`. Cache content survives server/network outages and offline restarts after a successful first download. Old cached images are currently retained, so storage use must be monitored. A changed server origin requires fresh approval.

Player resources are bounded to two frames: one visible and one prepared, or both incoming/outgoing during a transition. Animation completion disposes the outgoing frame before preparing another and starting the incoming slide's full display duration. Only whole-frame opacity/translation is animated. Cancellation releases animation effects and outgoing resources. A late or failed preparation holds the previous complete slide and reports a delay/error. Expiration, intentional blanking, and revocation are exceptions that can clear content immediately. Future scheduled assets are prefetched, but frame construction still occurs near display time. Physical HDMI smoothness and Pi memory limits require hardware testing.

Software `X.Y.Z` versions, publication revisions, and manifest `schemaVersion` serve different purposes. Version bumps do not publish a playlist or upgrade a device. A Docker update does not distribute player source. Incompatible schema changes need coordinated player delivery; old players may ignore newer fields.

## Source map

| Path | Responsibility |
| --- | --- |
| `app/` | Management, editor, media library, navigation guards |
| `app/components/ui/`, `app/hooks/`, `app/lib/` | Shared management UI components, hooks, utilities; `@/` resolves to `app/` |
| `server/app.mjs`, `server/schema.mjs` | API, authentication, persistence, validation |
| `server/accounts.mjs`, `app/accounts.tsx` | User sessions, resource access, groups, invitations, and account UI |
| `player/agent.py` | Enrollment, polling, cache, local HTTP |
| `player/web/` | Prepared frames, rendering, scheduling, widgets |
| `player/wireguard.py` | Validated provisioning through distro WireGuard tools |
| `player/*.sh` | Dedicated Pi installation and first-boot image customization |
| `tests/` | API, agent, editor, renderer, and optional browser regressions |
| `scripts/` | Local versioning, publication hygiene checks, player icon generation |

See the [API](api.md), [widget contract](widgets.md), and [security policy](../SECURITY.md) before extending these boundaries.
