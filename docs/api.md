# HTTP API

## Public Android downloads

`GET /downloads/android/latest.json` returns `{available:true,packageName,versionName,versionCode,minSdk,size,sha256,apkUrl}` for the current validated APK. Both the versioned `apkUrl` and `/downloads/android/openframe-player.apk` return an APK attachment with `Cache-Control: no-store`. These public GET/HEAD endpoints require no OpenFrame authentication. Missing releases return 404 JSON, invalid/incomplete releases return 503 JSON, both with `available:false`; they never fall through to the HTML app. Only the advertised release is served. By default the server verifies and mirrors the latest release from `veRoduS/OpenFrame`, branch `android-releases`, folder `apks/`, caching one verified APK for five minutes. `ANDROID_RELEASE_SOURCE=local` selects local files; `ANDROID_RELEASE_DIR` supplies the directory containing the APK and `latest.json` (and selects local mode unless source is explicit). See [Android updates](android-tv.md).

## User accounts and access

`GET /api/auth` includes `user:{id,username,name,role,disabled}` when signed in. Normal server startup seeds a unique admin before listening, so `setup` is false and `/api/setup` returns 409. The legacy setup route remains for isolated application-factory tests; custom entrypoints must call the returned `seedInitialAdmin()` before accepting requests, as `server/index.mjs` does. Initial credentials are never exposed through HTTP. All library reads, edits, previews, reference validation, and browser media requests are checked against ownership and direct/group grants. Inaccessible resources return 404. Player APIs retain their existing device-token authorization.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/activate` | Accept one-use password invitation `{token,password}`; signs in |
| POST | `/api/account/password` | `{currentPassword,password}`; invalidates other sessions and invitations |
| GET / POST | `/api/users` | Admin list/create; create `{username,name}` returns `{user,password,invitation}` with a cryptographically random 12-character password for immediate sign-in; response is `no-store`, password appears only in this response, legacy one-use invitation remains supported |
| POST | `/api/users/:id/invitation` | Admin replacement password invitation; returns `{invitation}` |
| PATCH | `/api/users/:id` | Admin role/status update with `{role?:"user"|"admin",disabled?:boolean}`; self-demotion/disable and last-admin removal protected |
| GET | `/api/users/:id/access` | Admin overview of direct grants, ownership, group sources, effective and read-only access |
| GET / POST | `/api/groups` | List accessible groups including descendants with direct members and implicit global admins (`accountRole` distinguishes account role from group `role`); global admin creates `{name,parentId?:string|null}` |
| PATCH | `/api/groups/:id` | Group admin renames; global admin reparents `{name?:string,parentId?:string|null}`; cycle and administrator checks |
| POST | `/api/groups/:id/invitation` | Group admin creates one-use join token; returns `{invitation}` |
| POST | `/api/groups/join` | Signed-in user accepts `{token}` |
| PUT | `/api/groups/:id/members/:userId` | Global admin adds existing users; group admin updates direct members with `{role:"admin"|"member"|"remove"}`; last active direct group admin protected; global admin group access is implicit and cannot be changed |
| GET | `/api/access/:kind/:id` | Returns `{canShare,managingGroupId,grants:[{userId,groupId,permission}]}` for an accessible item |
| POST | `/api/access/:kind/:id` | Personal owner/managing group/admin grants `{groupId,permission?:"view"|"edit"}` or admin grants `{userId,permission?}`; add `remove:true` to revoke; new grants default to View for slides/playlists |

Access kinds are `device`, `slide`, `playlist`, `asset`, `folder`, `slide-folder`, `playlist-folder`, and `data-feed`. Grants are additive. Slides/playlists and data feeds inherit View through ancestors and descendants, never siblings. Direct managing-group members edit, as do personal owners without a managing group and explicit direct Edit recipients. Global admins remain unrestricted. All folder metadata is visible to every authenticated user; only global admins can create, rename, move, delete, share, or change folder management, regardless of legacy folder ownership or grants. Folder visibility does not grant access to content. Media/screens and group-admin membership management retain downward-only inheritance. Visible resources with insufficient Edit permission return 403 for mutations; inaccessible resources return 404. Account roles are `user` and `admin`; old `superadmin` roles migrate without changing credentials or sessions. Sharing includes current referenced content atomically; revocation affects only the selected resource. Existing recipients must have access to newly referenced content before an update (409 otherwise). A valid `X-OpenFrame-Group` header shares newly created resources with that group; users must be members (or admins). Invitations expire after 24 hours and are never returned in user listings. Admin permission is required for screen approval/deletion, screen-setup/VPN inventory and exports, and managed-VPN status. See [permission details](users-and-groups.md).

## Local recovery portal

These routes exist only on the temporary player hotspot at `http://192.168.50.1`, not on the home server or first-boot portal. `GET /setup/state` returns `{csrf,paused,pauseSeconds,remainingSeconds,closing}`. `pauseSeconds` is the selected pause length; null means indefinite when paused. `remainingSeconds` is a rounded-up, monotonic countdown, or null while indefinitely paused. Reading state never extends the window.

`POST /setup/pause` accepts exactly `{duration:60}`, `{duration:300}`, `{duration:900}`, or `{duration:null}` and returns the updated state. `POST /setup/resume` takes `{}` and queues immediate reconnection to saved Wi-Fi. `POST /setup` takes `{ssid,password,country}` and queues replacement Wi-Fi regardless of pause. Resume/submission return 202; invalid input returns 400, an expired/closing/already-submitted window returns 409. Writes require the local Host, matching Origin, and `X-Setup-Token` from state; bodies are limited to 2048 bytes. Responses are not cached. Pauses belong to the running recovery service and reset on restart. See [recovery behavior](player-recovery.md).

`GET /setup/networks` returns `{revision,country,limit:20,networks:[{id,ssid,security,hidden,hasPassword,priority}]}` for supported persistent `wlan0` Wi-Fi profiles, ordered by priority. Country may be empty until configured here. Revision is an opaque, process-keyed token; passwords and keyfiles are never returned. An unreadable inventory returns 503, not a misleading empty list.

`POST /setup/networks` accepts `{revision,country,networks:[{id,ssid,security,hidden,password?}]}` in preferred-first order. Use an existing ID to edit, null/omitted ID to add, and omit a listed ID to remove it. Between 1 and 20 unique SSIDs are required. Security is `wpa-psk`, `sae`, or `open`; hidden must be boolean. SSIDs are printable UTF-8, 1-32 bytes. Country is two uppercase letters. Personal passwords are 8-63 printable ASCII characters (WPA/WPA2 additionally accepts 64 hexadecimal digits); an absent/null password retains the existing secret only with unchanged security. Open profiles discard stored passwords. A successful save returns the new inventory (200), keeps the hotspot/pause running, and does not activate a connection. NetworkManager priorities are 999, 998, etc., with one autoconnect attempt per profile before temporary blocking. Existing non-Wi-Fi settings in retained profiles are preserved. Country is applied at reconnection. The legacy `/setup` single-network submission remains supported, but the new UI uses save followed by explicit resume.

Network writes use the same Host/Origin/CSRF checks, with a 16 KiB request limit. Invalid input returns 400, a stale revision or closing window returns 409, and a failed system save returns 503. Changes validate before filesystem writes; failures attempt rollback. Unsupported profiles are neither listed nor removed. See [saved-network limits and recovery testing](player-recovery.md#saved-wi-fi-and-priority).

The array order also governs background promotion from an active backup network. The player checks roughly every 60 seconds, requires two consecutive suitable scans, and attempts only a strictly higher-priority, enabled saved profile. Failed targets receive a bounded cooldown and a previous-connection recovery attempt. This is local player behavior, with no new API fields or server connectivity checks. Scans and promotions are suspended throughout a recovery-hotspot window; saving a reordered list still does not resume or disconnect the portal. See the recovery guide for thresholds and timing.

## Home server

`GET /api/weather?latitude=41.8781&longitude=-87.6298` requires an administrator session and returns the shared weather snapshot immediately, scheduling refresh if needed. Coordinates must be finite and within geographic bounds. Weather layers accept `weather:{name,latitude,longitude,unit,mode,layout?,zip?}`; name is at most 80 characters, coordinates may be null while editing, unit is `F` or `C`, mode is `current` (default) or `six-hour`, layout is `horizontal` (default) or `vertical`, and optional zip is a five-digit string. Published player sync responses add `weather:{"latitude,longitude":snapshot}` only for approved players' assigned published locations; previews include the same map. Keys use four decimal places. A snapshot has `status`, optional ISO forecast `fetchedAt`, optional IANA `timeZone`, and `periods:[{startTime,endTime,temperatureF,shortForecast,isDaytime?}]`. Optional `observation:{timestamp,temperatureF,shortForecast,station,isDaytime?}` and `observationStatus` (`ready` or `unavailable`) are independent of forecast freshness. Status is `loading`, `ready`, `stale`, `unavailable`, `unsupported`, or `capacity`. Live snapshots are not accepted from slide writes and do not change publication revisions. See [weather caching and lifecycle](weather.md).

`GET /api/weather/zip?zip=02108` is administrator-only and returns `{zip,places:[{name,latitude,longitude}]}` from the fixed US Zippopotam.us endpoint. Keep ZIP codes as strings, including leading zeros. Multiple places require a selection in the editor. Errors use the normal JSON error shape: 400 invalid input, 404 unknown ZIP, 429 local lookup throttle, or 502 upstream failure. Lookups are cached/deduplicated; this endpoint does not save a slide or change a player location.

This contract follows the application source; it is not a separate versioned URL namespace. Software versions, publication revisions, and manifest schemaVersion are independent. Server and player software versions advance separately. See [player/server compatibility reviews](player-compatibility.md).

All JSON responses use UTF-8. Errors are `{ "error": "message" }` with an appropriate HTTP status. Administrator requests require the persistent `openframe_session` HttpOnly, SameSite=Strict cookie, issued by setup/login/activation and valid for 30 days. Authenticated activity renews the cookie and stored session back to 30 days at most once every 24 hours; logout and password changes clear or replace the session instead. Expired, revoked, or disabled-account sessions are never renewed. `COOKIE_SECURE=true` requires HTTPS for this cookie. Browser writes must use the server's origin (or configured `PUBLIC_URL`). Devices use `Authorization: Bearer <token>`; their authentication is unchanged.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health and version |
| GET | `/api/auth` | Initial setup and session status |
| POST | `/api/setup` | Legacy initialization; returns 409 on normally started servers |
| POST | `/api/login` | Sign in; `{username,password}` (omitted username defaults to `admin` for compatibility) |
| POST | `/api/logout` | Revoke current session |
| GET | `/api/library` | Slides, playlist summaries, assets, folders, device status, visible groups |
| POST | `/api/slides` | Create slide |
| PUT / DELETE | `/api/slides/:id` | Replace/delete slide; deletion blocked while used in drafts or publications |
| POST | `/api/assets` | Upload image as multipart field `file`, optional `folderId`; GIF animation is preserved in bounded animated WebP. From a slide picker, optional `shareWithSlideId` copies that slide's user/group grants to the new asset (slide owner or admin only) |
| PATCH | `/api/assets/:id` | Edit `{name?,folderId?,tags?}`; null folderId means Unfiled |
| POST | `/api/assets/batch` | `{ids,action?,folderId?,addTags?,removeTags?}`; action is update (default) or delete |
| POST | `/api/folders` | Admin only. Create `{name}`; names are case-insensitively unique |
| PUT / DELETE | `/api/folders/:id` | Admin only. Rename with `{name}` or delete an empty folder |
| GET | `/media/:filename` | Image, with an authorized user session or assigned-device token |
| POST | `/api/playlists` | Create `{name,items:[{slideId,duration}]}` |
| PUT / DELETE | `/api/playlists/:id` | Replace draft/delete playlist; deletion blocked while assigned |
| POST | `/api/playlists/:id/publish` | Snapshot current slides; requires nonempty playlist. Later saves to an included slide refresh its published copy and referenced asset list automatically; playlist structure and settings still require republishing |
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

Playlist create/replace accepts optional `transition:{type,durationMs}`. Type is `cut` (default), `fade`, `slide-left`, or `slide-right`; durationMs is an integer from 200 to 2000 in multiples of 100, default 500. The saved draft, preview, and published manifest include this object. Legacy manifests without it use Cut. Draft changes do not affect a publication until republished. Transition settings participate in the preview revision hash. Display durations exclude the incoming animation; initial/replacement frames and a one-entry rotation cut without animation. This is an additive schemaVersion 1 field; older players ignore it.

Layers also accept `verticalAlign` (top/middle/bottom, default top), `autoSize` (default false), and `lockAspect` (default true). Auto-size is applied by the shared renderer and does not overwrite the stored manual font size. Corner resizing keeps the opposite corner fixed and clamps to the canvas.

Slides default to a white `background` (`#ffffff`); new layers default to dark text (`#202923`). Explicit saved colors are preserved. Image layers accept `cropX` and `cropY` (0-100, default 50) and `cropZoom` (1-4, default 1). They define the cover-mode focal point and zoom without changing the source image; contain mode displays the complete image centered. Counter layers require `counter: {direction, targetAt, unit, showUnit?}`; see [widgets.md](widgets.md). Crop, background, and widget changes require republishing to reach assigned players.

Asset metadata includes `tags`, `folderId`, and `createdAt`. Legacy assets return empty tags, a null folder, and a null upload date. Tags are trimmed, lowercased, and deduplicated. Batch updates validate the entire selection before writing; unknown IDs, invalid folders, or referenced-image deletions reject the complete request. A batch accepts up to 200 unique image IDs. Folder/tag edits do not change the image file or published snapshots.

The player sync request accepts `{revision,error,version,uptime,commandAck,playback?}`. Optional `playback` contains `{phase,error?,slideId?,preparationMs?,missedDeadlines?}`. Phases are preparing, playing, waiting, blank, empty, unpaired, or stalled. These browser readiness reports are available in each device's library `status`; they do not prove that the physical display is working. An unapproved device receives `{approved:false,code}` and no content. An approved device receives `{approved:true,blank,rotation,command,manifest}`. The current manifest uses `schemaVersion:2` and contains `{revision,name,publishedAt,items:[{duration,slide}],assets}`. Image layers may include `removedMedia:true` when their original asset has been deleted. Asset metadata includes filename, URL, dimensions, byte size, and SHA-256. Player 0.10.8 and newer accept schema 2 and continue to accept schema 1.

The Python agent accepts local browser reports at `POST /local/playback` on its loopback-only HTTP service, not on the home server. It bounds the JSON body to 4096 bytes, validates numeric fields and phases, and restricts Host/Origin to its local service. The browser reports every five seconds; after 30 seconds without a report, the agent sends stalled status on its next sync.

Sync is a 15-second polling protocol. A publication revision changes when an editor publishes, a saved slide refreshes an accessible publication, or a published master refreshes an eligible linked fork. Device assignment and blank/rotation settings are independent of that revision. The client must persist a command ID before executing it, then echo it as `commandAck`; only the matching queued command is cleared. There is one pending command slot per device.

Initial enrollment is rate-limited and grants no content access. Pending entries expire after 24 hours when another enrollment is requested. Tokens are returned only during enrollment and stored hashed on the server. They are never returned in library responses.

With Cloudflare Access in front of the server, the agent adds `CF-Access-Client-Id` and `CF-Access-Client-Secret` to every upstream request, while retaining OpenFrame's Bearer token. These optional edge credentials require HTTPS and never confer administrator rights in OpenFrame. Invalid OpenFrame player tokens return HTTP 401 with `code: "DEVICE_CREDENTIALS_INVALID"`; the agent distinguishes this from proxy/Access failures so an expired edge credential does not erase a valid pairing or offline cache. Cross-origin redirects are blocked to avoid forwarding either credential to another host. See [remote-players.md](remote-players.md).

## Shapes and stock quotes

Shape layers use `type:"shape"` and `shape:{kind:"rectangle"|"circle",fill,fillEnabled?,outline,outlineWidth,cornerRadius}`. Paint colors are six-digit hex; outline width is 0–100 source-slide pixels, radius is 0–1000, and fill is enabled by default. Radius and outline geometry clamp to the layer bounds. A shape configuration is required for shape layers.

Stock layers use `type:"stocks"` and `stocks:{name?,symbols:["WMT","AAPL"]}`. One to eight US symbols are normalized to uppercase and deduplicated; arbitrary URLs are rejected. Authenticated `GET /api/stocks?symbols=WMT,AAPL` returns a map of snapshots and schedules shared provider refreshes if due. Snapshots contain `symbol,status,price?,change?,changePercent?,quotedAt?,fetchedAt?,scheduledSession,source,refreshMinutes`; status can be `unconfigured`, `loading`, `ready`, `stale`, `unavailable`, or `capacity`.

Admin-only `GET /api/settings/stocks` returns `{configured:boolean}`. Admin-only `PUT /api/settings/stocks` accepts `{token:"Finnhub API key"}` to replace the encrypted provider connection, or `{token:""}` to disconnect. The key is never serialized in public responses, manifests, or snapshots. This encrypted integration record uses the existing provisioning vault; back up the matching key and database together.

Approved player sync responses include quote snapshots inside `manifest.stocks`; authenticated previews include `stocks` alongside `weather`. Quote updates do not change publication revisions. Publications using shapes, stocks, or vertical weather have `schemaVersion:3`; other newly published content remains schema 2. Player 0.10.11+ accepts schemas 1, 2, and 3. See [stock scheduling and provider limits](user-guide.md#stock-tracker).

Library responses include `groups:[{id,name,parentId,directMember}]` scoped to groups visible to the caller. Slides, playlists, and devices include `groupIds` for their managing group and direct sharing grants to those visible groups; user grants and hidden group grants are excluded. Resources also include `accessTags:[{type:"group"|"user",id,name,username?}]`: visible group grants and active non-admin direct user grants not already covered by a granted group (including inherited membership). Only display identity fields are exposed. These additive fields support client-side filters and access summaries and do not change player manifests.


## Library permissions, folders, tags, and linked forks

Slide/playlist input accepts `managingGroupId?:uuid|null`, `folderId?:uuid|null`, and `tags?:string[]`. Library output includes these fields plus `readOnly`. A regular user can assign a managing group only when directly a member. Existing direct grants without a stored role remain Edit; inherited access is View. `PUT /api/access/:kind/:id/management` accepts `{groupId:uuid|null}` for slides, playlists, and their organization folders. Changing slide/playlist management requires the managing group, personal owner, or admin; folder management is admin-only; an explicit Edit recipient cannot reassign it. Clearing management restores the original creator's personal ownership, leaving independent grants intact.

`GET /api/library` includes `slideFolders` / `playlistFolders` with `{id,name,parentId,readOnly,managingGroupId?}`. Each item includes `folderId` and `tags` (legacy defaults null and []). All existing folders and their nesting are returned, even empty folders or folders containing only inaccessible content. Non-admin folder metadata has `readOnly:true` and omits management/grant details; folder metadata access does not authorize content access. The `folders` media collection uses the same shared visibility and `readOnly` flag. Basic ancestor group names are also returned without membership lists.

| Method | Path | Input / behavior |
| --- | --- | --- |
| POST | `/api/library-folders/:kind` | Admin only. `kind=slides|playlists`; `{name,parentId?:uuid|null,managingGroupId?:uuid|null}` |
| PUT | `/api/library-folders/:kind/:id` | Admin only. Same fields; cycles rejected |
| DELETE | `/api/library-folders/:kind/:id` | Admin only; 409 unless no items or subfolders |
| POST | `/api/organization/:kind` | `{ids:uuid[],folderId?:uuid|null,addTags?:string[],removeTags?:string[]}`; 1–200 IDs, all must be editable; atomic; no publication or access changes |
| POST | `/api/playlists/:id/fork` | `{name,managingGroupId?:uuid|null}`; View required on a published master; returns a new draft fork |

Folders are organization metadata and do not grant item access. Tags are trimmed/lowercased/deduplicated, at most 30 of 40 characters per item. Users can move editable items into any existing folder even though folder management is admin-only. Uploads and media batch moves likewise accept any existing media folder; content access is still checked independently.

Playlist entry input/output adds a stable `id` (generated when omitted), `sourceEntryId?`, `durationOverride?`, and `afterEntryId?`. IDs distinguish repeated slide entries. Existing playlists acquire IDs on startup without changing their published player snapshots/revisions. Forks have `fork:{masterId,order:"master"|"custom",speed:0.1..10}`. Create forks through the dedicated endpoint; save cannot attach, detach, or change a master. Inherited entries come from the master's last publication, with schedules and slide content controlled upstream. `durationOverride:true` preserves the supplied duration; false restores the master duration. `masterDuration` in resolved output helps the editor reset an override. `afterEntryId` is computed from the submitted order for local insertion anchors. All master entries remain included.

Follow-master order inserts local entries after their anchors; missing anchors move local entries to the end. Custom order retains surviving entry IDs and appends new master entries. Fork deletion never affects the master, which cannot be deleted while forks exist. Nesting is limited to eight levels, combined playlists to 200 entries, durations to integer 2–3600 seconds after speed scaling.

Publishing a fork freezes its local draft state in server metadata. Publishing a master recursively refreshes published forks using those frozen overrides, leaving subsequent local draft changes unpublished. Audience validation includes master viewing access and every included slide for all recipients, including the entire subtree of a group recipient. A failed refresh sets `forkSyncError`, retaining the prior publication. A later valid publication clears it. Player manifests remain flattened with standard durations, embedded slides/assets, and schema 2/3 as appropriate; fork entry IDs and slide/playlist organization/access metadata are not sent to players; media metadata retains its existing format. Pi/Android code and protocol versions are unchanged.

## Data feeds

External integrations update a reusable feed with `PUT /api/data-feeds/{feedId}/data`, `Authorization: Bearer <feed token>`, and a complete JSON snapshot. Tokens are write-only and scoped to one feed, and require their creator to retain active Edit access. The body is limited to 32 KiB; feed updates are limited to 60 authorized attempts per minute. Data supports numbers, bounded time series, and bounded category arrays. Updates are separate from playlist publication revisions.

See the [standalone integration guide](data-feeds-api.md) for exact payload shapes, status/error codes, retries, limits, and copyable curl/Python examples. [OpenAPI 3.1 JSON](../server/data-feeds.openapi.json) is served publicly at `/api/data-feeds/openapi.json`; the guide is served at `/api/data-feeds/guide`. Session-authenticated feed endpoints live under `/api/data-feeds`. Feed creation, changes, deletion, and token management require an admin session. Metadata and snapshot reads retain normal resource viewing permissions; bearer snapshot updates remain available to integrations. Add `data-feed` to the existing `/api/access/:kind/:id` sharing interface for View/Edit hierarchy rules.

Player sync adds a top-level `dataFeeds` map keyed by referenced feed UUID, with `{revision,updatedAt,data,status}` snapshots. Preview includes the same map. At most 20 distinct feeds are allowed per playlist; no token metadata is delivered to players. Playlists using data widgets emit manifest schema **4**, requiring player **0.10.13+**. Existing schema 2/3 publications are unchanged.

### Publication state, preview versions, and starter layers

Library and playlist responses include `publicationState: "draft" | "published" | "changes"`, `publishedAt`, `publishedRevision`, and `publishedSlideIds`. State compares effective playback order, timing, schedules, name, and transition with the publication; folders, tags, access metadata, entry IDs, and automatic slide-content refreshes do not create playlist draft changes.

`GET /api/preview/:id` previews the saved draft. `?version=published` previews the actual publication and returns 404 if none exists. Both require normal playlist viewing access. The browser player preview accepts `version=published`; normal player synchronization is unchanged.

Generated text layers may carry `starterText:true` only for the exact initial string `Something worth\nsharing.`. Editing the text or omitting its marker permanently removes the marker for that existing layer. Publishing removes untouched marked layers from the snapshot and from source slides the publisher can edit, in one transaction; source slides with only View access are retained. Draft previews never trigger cleanup. The marker is not sent to players. Existing unmarked layers are never inferred to be starters.
