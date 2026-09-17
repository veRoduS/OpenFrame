# OpenFrame

An MIT-licensed, self-hosted digital signage application. The server runs in Docker; Raspberry Pi players cache their content locally. No cloud account, external telemetry, subscription check, or external runtime service is required. Player health reports stay on your home server.

This is pre-1.0 software, not a finished Yodeck replacement. The management application, HTTP API, renderer, and player cache logic have automated verification, with focused desktop/mobile browser regressions. Docker execution and Raspberry Pi hardware testing have not been performed in the development environment. A flashable-image build script is included; a prebuilt, hardware-tested `.img` is not included. See [scope and validation gaps](docs/roadmap.md).

## Documentation

- [Simple server and screen setup](docs/quick-start.md), including the optional [managed WireGuard and hotspot flow](docs/managed-wireguard.md)
- [Player connection and recovery Wi-Fi](docs/player-recovery.md): setup QR, offline indicator, heartbeat, and private recovery credentials
- [Documentation index](docs/README.md) and [server setup, backup, restore, and upgrades](docs/operations.md)
- [Prebuilt Docker images and ARM Compose setup](docs/container-images.md)
- [Pi installation](#raspberry-pi-installation), [Cloudflare Tunnel](docs/remote-players.md), and [WireGuard](docs/wireguard-players.md)
- [Screen setup builder](docs/screen-setup.md): saved VPN clients and downloadable per-screen configurations
- [Architecture and pairing](docs/architecture.md), [API](docs/api.md), and [widget development](docs/widgets.md)
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md), [versioning/releases](docs/releases.md), and [changelog](CHANGELOG.md)

Routine changes receive local patch versions. GitHub publication happens only at approved minor milestones; major versions require an explicit owner request. Version commands never push. Only approved milestone tags (or explicitly selected existing tags) trigger the separate image-publishing workflow; ordinary CI never publishes.

## Run with Docker

Install Docker with the Compose plugin (Linux containers). For a prebuilt image, use the [milestone Compose stack](docs/container-images.md), available for AMD64 and ARM64 with a 64-bit OS. To build from source instead, obtain this repository's source from an approved milestone tag/archive and run from its root directory. Copy `.env.example` to `.env` to customize host/port settings. No registry image is required for source builds.

```sh
docker compose up -d --build
```

Open **http://localhost:3100** on the server, or **http://SERVER_LAN_IP:3100** from another computer. Create the administrator password (at least 12 characters) on first access, before exposing a public hostname. The default installation is intended for your LAN.

Data lives in the `openframe-data` Docker volume: the SQLite database and uploaded images survive container replacements. Do not use `docker compose down -v` unless you intend to delete all content and device registrations.

To change the port, set `OPENFRAME_PORT` in `.env`. To use an HTTPS reverse proxy, set `PUBLIC_URL` to the external origin and `COOKIE_SECURE=true`. The image runs as an unprivileged user. Internet access is needed to build the image, not to run the server.

## Players outside your home

Players can connect from other networks through a Cloudflare Tunnel and your own HTTPS domain. The server stays at home; the Pi needs only outbound HTTPS access, not a VPN or cloudflared installation. Cloudflare Tunnel is an optional deployment choice, not a required OpenFrame service.

The included `compose.cloudflare.yaml` runs the home connector without publishing application ports. Players support optional Cloudflare Access service tokens as well as OpenFrame's normal pairing. See [docs/remote-players.md](docs/remote-players.md) for existing-tunnel and Docker setup, secret handling, and connection checks. The Cloudflare deployment is not started automatically, and the default local setup is unchanged.

**WireGuard is also supported.** Drop an exported player client config named `openframe-wg.conf` beside `openframe.json`, then run the Pi installer or image builder. Set `server` to OpenFrame's VPN-reachable address. The installer enables a dedicated tunnel service without making cached playback wait for VPN readiness. See [docs/wireguard-players.md](docs/wireguard-players.md) for routing, per-player keys, and checks. No VPN server changes are made automatically.

OpenFrame can also host an optional WireGuard service and enroll Pi players through a first-boot Wi-Fi hotspot. This experimental, source-built path registers a separate public key per approved screen; private keys stay on the Pi. It does not change an existing VPN server. See [the setup guide](docs/managed-wireguard.md) for UDP/HTTPS requirements and outstanding hardware validation.

## First playlist

The playlist's Add slides tab marks slides already included with **In playlist**, including their entry count when repeated. Adding another copy requires confirmation; Cancel leaves the playlist unchanged. Existing repeated entries remain supported and can have independent durations and schedules.

1. Create a slide. New slides have a white background; change it with the Background color swatch in the editor header. Add text, images, a clock, a count-up/countdown widget, or [NWS weather](docs/weather.md). Weather uses shared server requests for matching coordinates and cached player snapshots; no API key is needed.
2. Drag layers on the canvas or resize photos with the four corner handles. Proportions stay locked unless disabled in Properties. Text supports top/middle/bottom alignment and automatic sizing to fit its box. With Image fit set to Fill, choose Adjust crop to drag the photo inside its frame. Zoom and horizontal/vertical sliders adjust the crop without changing the source file. Reset crop restores the centered, unzoomed view. Save the slide.
3. Create a playlist, add slides, choose durations, and reorder them with the arrows.
4. Publish the playlist. Publishing stores a snapshot; later slide edits do not change screens until you publish again.
5. Pair a player using its displayed code, then assign the published playlist in Screens.

Screens supports naming, assignment, last-seen status, rotation, a black display, refresh, restart, and credential revocation. Changes normally reach a connected player within 15 seconds, plus download time. Online status means a recent agent heartbeat, not proof that a physical monitor is working.

Choose **Screens > Screen setup** to import WireGuard clients, track available/allocated configurations, and download a per-screen ZIP with server, optional VPN, first-boot Wi-Fi, and Cloudflare Access settings. Secrets are encrypted on the server; downloaded bundles are private plaintext files. See the [setup builder guide](docs/screen-setup.md) before copying files onto an SD card. Normal pairing approval is still required.

When leaving an edited slide or playlist, choose Save and continue, Discard changes, or Keep editing. Save and continue waits for a successful save; a failed save leaves the editor open. This covers the editor Back action, browser Back from the editor, closing the playlist editor, and same-window links. Reloading, closing a tab, or entering another address uses the browser's native unsaved-changes warning; browsers do not permit a custom Save button there. Cancel that warning and save in the editor first. Saving a playlist draft does not publish it.

Counters automatically count down to future targets and count up from past targets; there is no direction selector. An optional Goal message replaces the entire counter at the target and stays visible instead of counting up afterward. Leave it empty for normal automatic counting. Choose seconds, minutes, hours, or days as the granularity. Count up shows complete elapsed units; count down rounds remaining units up. A day is 24 hours, not a calendar-day boundary. Prefix and suffix fields add plain text around the number and optional unit label. Clock and counter widgets have four corner resize handles; auto-sizing fits the complete text or goal message into the resized box. The editor accepts local time and stores an explicit UTC timestamp; players need a correct system clock, including after an offline reboot. Existing Pis need the updated complete `player/web` directory for this behavior, including automatic handling of legacy counters and goal messages.

Images are decoded, resized to at most 1920 pixels per dimension, and stored as WebP. Upload limit: 15 MB and 25 megapixels. Text is rendered as text, never as executable HTML.

## Organize media

Media supports named folders, image tags, filename/tag search, tag filtering, and grid/list views. Sort by name, upload date, or file size in either direction. The editor's image picker includes the same folder and search controls.

Select individual images or all visible results to move, add/remove tags, or delete them together. Click an image to rename it or edit its folder and full tag list. Select a folder, then choose Rename folder in the Media toolbar to change its name without moving its images. Tags are normalized to lowercase and deduplicated, with a limit of 30 per image. Uploading multiple files puts them in the current folder. Folders are single-level and must be empty before deletion.

Deletion is blocked if any selected image is used by a saved slide or a published playlist; no images in that selection are deleted on failure. A published snapshot can still reference an image even after the draft slide changes. Existing untagged media remains available under Unfiled; its original URL is unchanged.

To use cropping, counters, and prepared-frame playback on an existing Pi installation, update `player/agent.py` and the complete `player/web/` directory, then restart the agent and kiosk. Include all JavaScript modules, not just `player.js`. Updating the Docker server alone does not update installed player code. Existing slide backgrounds, colors, and saved formatting are preserved. Older images default to a centered crop at 1x zoom, with no data migration.

## Prepared playback

Each playlist entry has a **Schedule** toggle. Date/time fields are hidden when it is off, and the entry plays without date limits. Turning it back on restores retained dates. Entries saved before this toggle was added are enabled automatically when they already contain a start or expiration date. Save and publish toggle changes to apply them to players.

In Edit playlist, each entry has optional **Starts at** and **Expires at** date/time fields. Empty fields mean no lower or upper limit. Times are entered in the browser's local timezone and saved as absolute UTC instants; expiration must be later than start. Save and publish to apply changes to devices. The same slide can have different windows in different playlist entries.

Players evaluate these windows locally, including offline. Start is inclusive; expiration is exclusive and can interrupt a slide before its duration ends. If no entries are eligible, the screen stays empty until one becomes eligible. All publication assets, including future entries, are downloaded ahead of time; frames still require preparation before display. Keep Pi clocks synchronized and update the complete `player/web` directory before publishing schedules: older players ignore these fields. Recurring weekday/time-of-day schedules are not included.

The agent downloads and checksum-verifies every image in a publication before committing its manifest to disk. The browser then maintains one visible slide and one next-slide frame. It constructs the next frame offscreen, decodes its actual image elements, waits for widget readiness and fonts, and completes text layout before making it eligible to display. At the deadline it activates the prepared widgets and swaps frame visibility in one synchronous operation; the outgoing frame is then disposed.

If the next frame is late, the current complete slide remains visible. If preparation fails or exceeds its 15-second readiness timeout, the player reports the error and retries after two seconds. The next slide receives its full scheduled duration once displayed. New publications, rotation changes, and refreshes also keep the current frame up until their replacement is ready. Blanking and revocation deliberately clear the display immediately. A one-slide playlist stays mounted rather than repeatedly rebuilding.

Only visible widgets run update timers. Counters wake at their selected unit boundary. Clock format supports HH:MM or HH:MM:SS plus a 24-hour time toggle; defaults are HH:MM in 12-hour time with AM/PM. Clocks wake once per minute or once per second according to that setting. Editor and player use their machine's local timezone. Existing Pis need the updated complete `player/web` directory, including `clock.js`. Cancelled frames release image elements, widget resources, and timers. Local images use immutable browser caching and are streamed by the agent without copying the entire response into memory.

Screens shows the browser's playback phase, last preparation time, delayed-switch count, and readiness error. A delayed-switch count means the player held a slide past its deadline; it is cumulative for the browser session. The browser reports to the local agent every five seconds, and the agent includes this in its normal server heartbeat. No browser report for 30 seconds is reported as stalled.

This removes the clear-then-load transition path, but is not a guarantee of zero dropped frames on every device. Two complex slides can still exceed a small device's memory or rendering capacity, and browser decoding/layout tests do not measure HDMI output or GPU composition. Start with a representative photo/widget loop and measure on your target Pi. See [docs/playback-testing.md](docs/playback-testing.md) for the hardware acceptance checklist.

## Raspberry Pi installation

Target: Raspberry Pi Zero 2 W with HDMI, Raspberry Pi OS Lite, and a suitable power supply and microSD card. The player uses Python's standard library and one Chromium kiosk window. The React management application never runs on the Pi. Memory usage and sustained playback still need measurement on a physical Zero 2 W.

### Install on an existing Pi

Install Raspberry Pi OS Lite using Raspberry Pi Imager. Configure a user, Wi-Fi, and SSH in Imager, then boot the Pi. Copy this repository's `player` directory onto it. Create `openframe.json`:

```json
{
  "server": "http://192.168.1.10:3100",
  "name": "Lobby screen"
}
```

For local players, use your server's LAN address, not `localhost`. Reserve its IP address in your router, or use a resolvable local hostname. For off-site players, use the HTTPS address from the Cloudflare setup or the private address reachable through WireGuard.

```sh
sudo bash player/install.sh ./openframe.json
sudo reboot
```

The installation creates an `openframe` kiosk user, a content-agent system service, and console autologin for the display. It changes the Pi's default boot target to console mode. It is intended for a dedicated signage Pi. Installing OS packages requires Internet access.

The screen shows an eight-character pairing code. In the server, choose Screens > Pair screen and enter it. Then assign a published playlist. No incoming connection to the Pi is needed; the agent initiates all server communication.

### Build an image to flash

On a Linux machine with root access, use an **uncompressed official Raspberry Pi OS Lite `.img`** with its standard two partitions. Install `util-linux`, `parted`, `e2fsprogs`, and Python 3. Provide the same configuration file, optionally including Wi-Fi:

```json
{
  "server": "http://192.168.1.10:3100",
  "name": "Lobby screen",
  "wifi_ssid": "Your network",
  "wifi_password": "Your Wi-Fi password",
  "wifi_country": "US"
}
```

```sh
sudo bash player/build-image.sh raspberry-pi-os-lite.img openframe.json openframe-player.img
```

The script copies the base image, expands the copy by 2 GiB, and installs a first-boot service and the player source. It refuses to overwrite an existing output image. Flash the resulting image using Imager's custom-image option. Configuration is in `openframe.json` on the visible boot partition and can be changed **before first boot**.

First boot connects Wi-Fi, downloads and installs OS packages, and reboots into the player. It can take several minutes and **requires Internet access**. Wi-Fi and optional Cloudflare Access credentials are removed from the boot JSON after successful provisioning. An optional `openframe-wg.conf` is imported and removed from the boot partition as well. Credentials remain in their installed OS configuration and in your original image/configuration. Treat configured images as private. Each flashed Pi enrolls with a fresh OpenFrame device identity, but WireGuard requires a distinct client configuration per Pi.

This is a reproducible customization workflow, not a fully offline appliance image build. Base-image changes and Zero 2 W display compatibility need hardware validation before distributing an image release.

### Operation and troubleshooting

```sh
sudo systemctl status openframe-agent
sudo journalctl -u openframe-agent -n 100
sudo journalctl -u openframe-firstboot -n 100
```

After installation, edit `/etc/openframe/config.json` and restart `openframe-agent` to change servers. A different server requires fresh approval. Edit Wi-Fi with the Pi's NetworkManager tools. Future boot-file edits are not automatically imported.

The agent serves its player at `http://127.0.0.1:8080`, accessible only on the Pi. Device credentials are stored with restricted permissions in `/var/lib/openframe/identity.json`. Downloaded images are checksum-verified before a new manifest replaces the current one. The last complete manifest remains on disk and plays after an offline restart. Before the first successful publication download, there is no offline content to show.

Blanking and rotation are cached. A revoked device stops playback when it next contacts the server; revocation cannot reach an offline device. Old downloaded assets are retained in this initial version. Monitor SD-card capacity when frequently replacing large image libraries.

Restart is a narrowly scoped, acknowledged command. The Pi user receives sudo access only to `/usr/sbin/reboot`; the server cannot send arbitrary shell commands. Commands are acknowledged durably before execution to avoid reboot loops. A power failure in that interval may require queuing the restart again.

## Local development

Requirements: Node.js 24+, pnpm 11.19.0; Python 3.9+ for agent tests.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The server and Vite development middleware share port 3100. `PORT`, `HOST`, and `DATA_DIR` can override the defaults. For a production build outside Docker:

```sh
pnpm build
pnpm start
```

Test the player without a Pi:

```sh
python3 player/agent.py --config player/openframe.example.json --cache ./player-cache
```

Copy the example to an ignored private `openframe.json`, set its server address, and pass that path with `--config` instead when customizing it. Open http://127.0.0.1:8080 and pair it. Restart commands are disabled unless `--allow-reboot` is explicitly passed. Never commit real provisioning configurations.

Use `python3 player/agent.py --config player/openframe.example.json --check-connection` to verify a configured server without enrolling a player. For Access-protected deployments, use a private configuration following `player/openframe.cloudflare.example.json` instead. This diagnostic applies Access headers, checks TLS normally, and does not create a cache.

## Verification

Optional picker browser regression: with Playwright available, run `node tests/playlist-picker.browser.mjs` against a running local server. `OPENFRAME_URL` overrides the default local URL, `OPENFRAME_PLAYWRIGHT` can specify a resolvable Playwright module path/URL, and `OPENFRAME_BROWSER_CHANNEL` optionally selects an installed browser such as `msedge`. The test intercepts all API calls with isolated fixtures and checks duplicate confirmation, cancellation, rapid clicks, removal, save/reopen, and desktop/mobile layout without editing your library. Screenshots are written to `work/`.

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm test
python3 tests/player_test.py
python3 tests/wireguard_test.py
```

Server tests cover authentication, cross-origin write rejection, immutable publication snapshots, crop/counter validation and persistence, white defaults, media organization, device playback reports, image access, commands, revocation, and SQLite persistence. Player tests cover offline restart, incomplete downloads, command deduplication, path restrictions, cache reuse, server changes, reboot capability checks, and local status validation/streaming.

WireGuard provisioning tests cover optional drop-ins, Windows-export normalization, multiple peers, rejected shell hooks, private-key validation/redaction, boot-image staging, atomic writes, scoped tunnel replacement, and boot-copy cleanup. System networking commands are mocked; this is not a real VPN or Pi boot test.

Deterministic renderer tests cover image/widget/font readiness, late and failed preparation, cancellation, publication replacement, a 300-switch frame-lifetime check, counter timer cleanup, and crop math. Navigation tests exercise the hook's state machine with modeled history/events, including effect replay and deferred navigation. These use test doubles, not a real browser or physical Pi, and do not constitute visual or hardware performance QA.

Set `OPENFRAME_PYTHON` to your Python executable when running `pnpm test` to also run the real Python-agent/server integration test. This was run during implementation alongside the standalone player tests.

Before deploying unattended screens, perform a real-device soak test: publish a text/image loop, reboot offline, interrupt a download, republish, rotate, blank, restart, and revoke the player. Check memory, SD storage growth, HDMI framing, Wi-Fi recovery, and monitor sleep behavior.

## Architecture and extensions

- `app/`: React/TypeScript management UI, slide editor and preview canvas.
- `server/`: Express API, input validation, SQLite storage, media processing.
- `player/agent.py`: enrollment, authenticated polling, durable cache, local HTTP service.
- `player/web/`: small framework-free renderer shared by the Pi and playlist preview.
- `player/install.sh`, `player/build-image.sh`: dedicated Pi setup and image customization.

See [docs/widgets.md](docs/widgets.md) for the widget extension contract and [docs/api.md](docs/api.md) for the API.

The editor uses percentage coordinates and a fixed slide design size. Publishing copies the slides and image metadata into a versioned manifest. The player downloads the complete manifest's images, verifies their SHA-256 hashes, and atomically activates it. The server stays the source of truth for drafts and device assignments; the player cache keeps playback independent of availability.

Current scope: one administrator, text/image slides with cropping and background colors, clock/counter/NWS weather widgets, looping playlists with prepared frames and per-entry availability windows, publication snapshots, media folders/tags, and basic device management. Recurring schedules, video playback, multi-user roles, arbitrary plugin installation, remote screenshots, fleet OS updates, and backup/restore UI are future work. Back up the Docker volume while the service is stopped, or use SQLite's online backup API and include the media directory.

## License and references

MIT; see [LICENSE](LICENSE). Dependencies retain their own licenses. OpenFrame is an independent project and is not affiliated with Yodeck.

The hardware workflow is based on [Raspberry Pi OS](https://www.raspberrypi.com/software/operating-systems/) and the official [kiosk documentation](https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/). The installer uses an X11 session on Lite rather than the tutorial's desktop session. For future fully built appliance images, see [Raspberry Pi's rpi-image-gen](https://github.com/raspberrypi/rpi-image-gen).
