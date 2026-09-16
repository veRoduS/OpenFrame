# HTTP API

This contract follows the application source; it is not a separate versioned URL namespace. Software versions, publication revisions, and manifest schemaVersion are independent. See [release compatibility](releases.md).

All JSON responses use UTF-8. Errors are `{ "error": "message" }` with an appropriate HTTP status. Administrator requests require the `openframe_session` HttpOnly cookie, issued by setup/login and valid for 24 hours. Browser writes must use the server's origin (or configured `PUBLIC_URL`). Devices use `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and version |
| GET | `/api/auth` | Initial setup and session status |
| POST | `/api/setup` | Set first administrator password; `{password}` |
| POST | `/api/login` | Sign in; `{password}` |
| POST | `/api/logout` | Revoke current session |
| GET | `/api/library` | Slides, playlist summaries, assets, folders, device status |
| POST | `/api/slides` | Create slide |
| PUT / DELETE | `/api/slides/:id` | Replace/delete slide; deletion blocked while used in drafts |
| POST | `/api/assets` | Upload image as multipart field `file`, optional `folderId` |
| PATCH | `/api/assets/:id` | Edit `{name?,folderId?,tags?}`; null folderId means Unfiled |
| POST | `/api/assets/batch` | `{ids,action?,folderId?,addTags?,removeTags?}`; action is update (default) or delete |
| POST | `/api/folders` | Create `{name}`; names are case-insensitively unique |
| PUT / DELETE | `/api/folders/:id` | Rename with `{name}` or delete an empty folder |
| GET | `/media/:filename` | Image, with admin session or authorized assigned-device token |
| POST | `/api/playlists` | Create `{name,items:[{slideId,duration}]}` |
| PUT / DELETE | `/api/playlists/:id` | Replace draft/delete playlist; deletion blocked while assigned |
| POST | `/api/playlists/:id/publish` | Snapshot current slides; requires nonempty playlist |
| GET | `/api/preview/:id` | Renderable saved-draft manifest for administrator preview |
| POST | `/api/player/enroll` | Enroll `{name}`; returns `{id,token,code}` |
| POST | `/api/devices/:id/approve` | Approve by matching `{code}` |
| PUT | `/api/devices/:id` | Set `{name,playlistId,blank,rotation}`; playlistId may be null |
| POST | `/api/devices/:id/command` | Queue `{type:"refresh"}` or `{type:"reboot"}` |
| DELETE | `/api/devices/:id` | Revoke and remove device |
| POST | `/api/player/sync` | Heartbeat plus publication/config/command delivery |
| GET | `/api/screen-setup` | Administrator-only VPN/setup metadata and default public server URL |
| POST | `/api/screen-setup/vpns` | Import `{name,server,config}` with WireGuard client text; returns metadata only |
| DELETE | `/api/screen-setup/vpns/:id` | Delete unused VPN config; allocated configs return 409 |
| POST | `/api/screen-setup/setups` | Create encrypted setup and atomically reserve optional VPN client |
| POST | `/api/screen-setup/setups/:id/download` | Administrator-only private ZIP attachment, `Cache-Control: no-store` |
| GET | `/api/managed-vpn` | Administrator-only managed VPN status and registered peer metadata |
| POST | `/api/player/provision` | Device bearer token; approval-gated managed VPN settings |
| POST | `/api/player/recovery` | Approved device bearer token; retrieve its stable hidden Wi-Fi settings |
| GET | `/api/devices/:id/recovery` | Administrator-only explicit credential reveal; never included in library responses |

Recovery retrieval takes `{}` and returns `{playerId,ssid,password,hidden:true}`. The SSID is the player's UUID without hyphens (32 bytes), and the password is server-generated. Unapproved devices receive 403. Admin reveal returns `{available:false}` until the player has requested credentials, or `{available:true,...settings}` afterward. Both responses use `Cache-Control: no-store`. Credentials are encrypted under `provisioning.key` and removed with the device. The sync request additionally accepts `recovery` as null or `standby`, `starting`, `hotspot`, `reconnecting`, `error`; it is last-reported status only. The player's local state adds `connection:{connected,lastContactAt}` (Unix seconds or null), with no recovery secrets. See [player recovery](player-recovery.md).

Managed enrollment optionally adds `{wireguardPublicKey,enrollmentToken}` to `/api/player/enroll`. The key must be canonical, nonzero, 32-byte base64; the token is a client-generated 64-character hex secret persisted before the request. Both require the opt-in managed VPN service. Repeating the same public key/token returns the original `{id,token,code}`; a different token for that key returns 409. The server stores only the token hash and public key. Ordinary `{name}` enrollment is unchanged.

`/api/player/provision` accepts an empty JSON object. Pending devices receive `{approved:false,code}`; approved managed devices receive `{approved:true,wireguard:{address,publicKey,endpoint,allowedIPs,server}}`. The key is the server's public key, `address` is the client `/32`, and `allowedIPs` permits only the private server `/32`. No client private key is received or returned. Approved ordinary players without a managed public key receive 400; disabled/unavailable managed services return 503. Allocation is serialized and retries retain the same address; a full address pool returns 409 and an overloaded operation queue returns 429.

Managed status returns `{enabled:false,peers:[]}` when disabled. When enabled it includes `prefix`, server `address`, `endpoint`, `server`, `allowedIPs`, server `publicKey`, and `peers:[{id,name,address}]`. These are registered peers, not handshake measurements. Device records may additionally contain `wireguardPublicKey` and `wireguardAddress`. Deletion invalidates the device token before requesting peer removal; a helper failure may return 503 after deletion. Reconciliation/lease expiry then removes the peer. See [managed VPN operations](managed-wireguard.md).

Setup creation accepts `{name,server?,vpnId?,wifi?:{ssid,password,country},access?:{client_id,client_secret}}`. Choose a direct server origin or a saved VPN ID; the saved VPN's server takes precedence. Origins require HTTP/HTTPS without userinfo, paths, queries, or fragments. Access credentials require HTTPS and nonempty printable ASCII header values. SSIDs are limited to 32 UTF-8 bytes, passwords to 64 characters, and country to two uppercase letters. Setup names and VPN names are case-insensitively unique within their respective inventories. Already allocated clients or duplicate names return 409; missing IDs return 404; invalid input returns 400. Missing/mismatched encryption keys return 503 without replacing the key or allocating a client.

Inventory returns `{vpns,setups,defaultServer}`. VPN metadata is `{id,name,server,addresses,endpoints,fullTunnel,assignedTo,createdAt}`; `assignedTo` is a setup ID or null, not a device ID. Setup metadata is `{id,name,server,vpnId,createdAt}`. No listing includes credential fields or ciphertext. Downloads contain `openframe.json`, optional `openframe-wg.conf`, and `SETUP.txt`; creation does not enroll/approve a player. See [screen setup](screen-setup.md) for limits, retention, installation, and secret-handling requirements.

Slide structure is defined in `server/schema.mjs`; positions and sizes are percentages. Durations are integer seconds from 2 to 3600. Rotation is 0, 90, 180, or 270 degrees.

Layers also accept `verticalAlign` (top/middle/bottom, default top), `autoSize` (default false), and `lockAspect` (default true). Auto-size is applied by the shared renderer and does not overwrite the stored manual font size. Corner resizing keeps the opposite corner fixed and clamps to the canvas.

Slides default to a white `background` (`#ffffff`); new layers default to dark text (`#202923`). Explicit saved colors are preserved. Image layers accept `cropX` and `cropY` (0-100, default 50) and `cropZoom` (1-4, default 1). They define the cover-mode focal point and zoom without changing the source image; contain mode displays the complete image centered. Counter layers require `counter: {direction, targetAt, unit, showUnit?}`; see [widgets.md](widgets.md). Crop, background, and widget changes require republishing to reach assigned players.

Asset metadata includes `tags`, `folderId`, and `createdAt`. Legacy assets return empty tags, a null folder, and a null upload date. Tags are trimmed, lowercased, and deduplicated. Batch updates validate the entire selection before writing; unknown IDs, invalid folders, or referenced-image deletions reject the complete request. A batch accepts up to 200 unique image IDs. Folder/tag edits do not change the image file or published snapshots.

The player sync request accepts `{revision,error,version,uptime,commandAck,playback?}`. Optional `playback` contains `{phase,error?,slideId?,preparationMs?,missedDeadlines?}`. Phases are preparing, playing, waiting, blank, empty, unpaired, or stalled. These browser readiness reports are available in each device's library `status`; they do not prove that the physical display is working. An unapproved device receives `{approved:false,code}` and no content. An approved device receives `{approved:true,blank,rotation,command,manifest}`. The manifest contains `{schemaVersion:1,revision,name,publishedAt,items:[{duration,slide}],assets}`. Asset metadata includes filename, URL, dimensions, byte size, and SHA-256.

The Python agent accepts local browser reports at `POST /local/playback` on its loopback-only HTTP service, not on the home server. It bounds the JSON body to 4096 bytes, validates numeric fields and phases, and restricts Host/Origin to its local service. The browser reports every five seconds; after 30 seconds without a report, the agent sends stalled status on its next sync.

Sync is a 15-second polling protocol. A publication revision changes only when an administrator publishes. Device assignment and blank/rotation settings are independent of that revision. The client must persist a command ID before executing it, then echo it as `commandAck`; only the matching queued command is cleared. There is one pending command slot per device.

Initial enrollment is rate-limited and grants no content access. Pending entries expire after 24 hours when another enrollment is requested. Tokens are returned only during enrollment and stored hashed on the server. They are never returned in library responses.

With Cloudflare Access in front of the server, the agent adds `CF-Access-Client-Id` and `CF-Access-Client-Secret` to every upstream request, while retaining OpenFrame's Bearer token. These optional edge credentials require HTTPS and never confer administrator rights in OpenFrame. Invalid OpenFrame player tokens return HTTP 401 with `code: "DEVICE_CREDENTIALS_INVALID"`; the agent distinguishes this from proxy/Access failures so an expired edge credential does not erase a valid pairing or offline cache. Cross-origin redirects are blocked to avoid forwarding either credential to another host. See [remote-players.md](remote-players.md).
