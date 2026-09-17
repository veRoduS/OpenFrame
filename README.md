# OpenFrame

Open-source, self-hosted digital signage. Create slides, schedule playlists, and manage screens from your own server.

The server runs in Docker. Raspberry Pi players download content and keep the latest synced playlist playing when the connection drops.

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

Open [localhost:3100](http://localhost:3100) and create your administrator password before exposing the server publicly.

Content is stored in a persistent Docker volume. Back it up before upgrades; `docker compose down -v` deletes it.

Prefer a prebuilt image? See [AMD64/ARM64 images and Compose setup](docs/container-images.md).

## Raspberry Pi installation

Follow the [simple server and screen setup](docs/quick-start.md) to prepare a dedicated Pi, download its configuration, and pair it with the server. Detailed installation and image-building instructions are in the [Pi guide](docs/player-installation.md).

Updating the server does not update player software automatically.

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
- [Security](SECURITY.md), [roadmap](docs/roadmap.md), and [changelog](CHANGELOG.md)

## Status and license

OpenFrame is pre-1.0 software. Physical Pi playback and Wi-Fi validation are still required; no prebuilt, hardware-tested SD-card image is provided. See the [validation record](docs/validation.md).

[MIT licensed](LICENSE). Dependencies retain their own licenses.
