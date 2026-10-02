# OpenFrame

Open-source, self-hosted digital signage. Create slides, schedule playlists, and manage screens from your own server.

The server runs in Docker. Raspberry Pi players and the experimental Android TV app download content and keep the latest synced playlist playing when the connection drops.

## Features

- Visual slide editor with text, images, cropping, backgrounds, and resize controls.
- Clock, count-up/countdown, and NWS weather widgets with ZIP lookup and shared location caching.
- Media folders, tags, search, and bulk organization.
- Playlists with start/end dates and next-slide preparation.
- Screen pairing, heartbeat status, remote controls, and recovery Wi-Fi.
- Optional Cloudflare Tunnel or WireGuard connectivity for off-site screens.

## Get started

Install Docker with Compose, then run:

```sh
git clone https://github.com/veRoduS/OpenFrame.git
cd OpenFrame
docker compose up -d --build
```

Run `docker compose logs openframe` to find the unique first-start password. Open [localhost:3100](http://localhost:3100), select **Log in**, sign in as `superadmin`, and change it under **Users & Groups > My password**. Each fresh install generates its own password. Bookmark `/dashboard` for management; sign-ins last 30 days and renew during use. The public homepage is at `/` and sign-in at `/login`.

Content is stored in a persistent Docker volume. Back it up before upgrades; `docker compose down -v` deletes it.

Prefer a prebuilt image? See [AMD64/ARM64 images and Compose setup](docs/container-images.md).

## Android TV installation

[Download the latest signed Android APK](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk), transfer it over Wi-Fi or copy it to a USB flash drive, and open it with a TV downloader/file manager. Open **OpenFrame Player**, enter your server address, and approve its pairing code under **Screens**. See the [Android TV guide](docs/android-tv.md) for installation permission, device requirements, updates, and limitations.

The landing page's **Download Android APK** button links directly to the latest APK on GitHub. [Previous APKs](https://github.com/veRoduS/OpenFrame/tree/android-releases/apks) remain available by player version. Android players from 0.10.4 can check GitHub directly for updates, independently of the content server version. Player 0.10.5 adds an opt-in automatic update setting, off by default; manual checks remain available. The optional **This server** update source uses the server download endpoints; older player 0.10.3 uses those endpoints exclusively. Android requires you to approve installation.

Maintainers can run `pnpm build:android` to build, verify, and publish a signed APK to the dedicated GitHub APK branch. Use `--local` to keep a build local or `pnpm publish:android` to retry an upload. See [Android publication](docs/releases.md#android-apk-publication) for clean-source, signing, and automation requirements.

## Raspberry Pi installation

Follow the [simple server and screen setup](docs/quick-start.md) to prepare a dedicated Pi, download its configuration, and pair it with the server. Detailed installation and image-building instructions are in the [Pi guide](docs/player-installation.md).

Updating the server does not update player software automatically. Server and player versions advance independently; [compatibility reviews](docs/player-compatibility.md) track changes that require the other component to be reviewed or upgraded.

## First playlist

1. Create and save your slides.
2. Add them to a playlist, set durations and optional dates, then publish.
3. Pair a screen and assign the playlist.

Publish again when you want saved edits to reach your screens. See the [user guide](docs/user-guide.md) for editing, scheduling, and playback details.

## Documentation

- [All guides](docs/README.md)
- [Backups, upgrades, and troubleshooting](docs/operations.md)
- [Remote screens](docs/remote-players.md) and [WireGuard](docs/wireguard-players.md)
- [Contributing and local development](CONTRIBUTING.md)
- [Server/player compatibility](docs/player-compatibility.md)
- [Security](SECURITY.md), [roadmap](docs/roadmap.md), and [server](CHANGELOG.md)/[player](player/CHANGELOG.md) changelogs

## Status and license

OpenFrame is pre-1.0 software. Physical Pi playback and Wi-Fi validation are still required; no prebuilt, hardware-tested SD-card image is provided. See the [validation record](docs/validation.md).

[MIT licensed](LICENSE). Dependencies retain their own licenses.
