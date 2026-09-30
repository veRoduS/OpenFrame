# Docker images and Compose stack

The optional [managed WireGuard stack](managed-wireguard.md) currently builds both services from source. Its `Dockerfile.wireguard` is separate from the normal application image. CI includes native AMD64/ARM64 helper builds, a WireGuard binary check, and Compose validation, but does not publish that helper or validate a live VPN. Published milestone application images do not automatically include later local changes.

Repository: https://github.com/veRoduS/OpenFrame

The **Publish milestone images** action builds OpenFrame's home-server image and uploads a ready-to-run Compose stack. It does not deploy onto your computer, install a Pi OS, or configure a physical HDMI kiosk. The existing native Pi player installer remains the lightweight playback path.

## Platforms

| Hardware / OS | Image platform | Notes |
| --- | --- | --- |
| PC, Intel/AMD home server | `linux/amd64` | 64-bit Linux or Docker Desktop Linux containers |
| Raspberry Pi 4 / 5 | `linux/arm64` | 64-bit Raspberry Pi OS / compatible 64-bit Linux userspace |
| Raspberry Pi Zero 2 W | `linux/arm64` | CPU-compatible with a 64-bit OS; full server performance is not validated on 512 MB RAM |
| 32-bit Raspberry Pi OS | Not included | Install a 64-bit OS for this Docker image |
| Original Pi Zero / Zero W (not Zero 2 W) | Not included | Different CPU architecture |

The Zero 2 W should normally run the native cached player, with the server elsewhere. Do not build the Node/React server on it or assume a server plus Chromium will fit comfortably in its memory. ARM64 container tests validate software architecture and native image processing, not memory use, HDMI output, or physical-device smoothness.

Check the host before installing: `uname -m` should report `aarch64` on a 64-bit Pi, and `getconf LONG_BIT` should report `64`. A 64-bit-capable CPU alone is not sufficient. Docker chooses the matching platform from the image manifest automatically; do not force `linux/amd64` on a Pi.

References: [official Node image architecture list](https://github.com/docker-library/official-images/blob/master/library/node), [Sharp platform support](https://sharp.pixelplumbing.com/install/), and [Zero 2 W hardware](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/).

## Run the published stack

After a successful milestone workflow, download the `openframe-compose-X.Y.0` artifact from its Actions run. Extract it into a dedicated directory. It contains `compose.yaml`, this guide, and `.env.example` with the exact multi-platform manifest digest already filled in.

```sh
cp .env.example .env
docker compose config --quiet
docker compose pull
docker compose up -d
```

On PowerShell use `Copy-Item .env.example .env`. Read the unique initial password with `docker compose logs openframe`. Open http://localhost:3100 or the server's LAN address, sign in as `superadmin`, and change the password under **Users & Groups > My password**. Keep the directory/project name stable so subsequent upgrades reuse the same named data volume and accounts.

From a full repository checkout instead of an artifact, set `OPENFRAME_IMAGE` in `.env` to `ghcr.io/verodus/openframe:latest` to follow the latest successfully published milestone, or use a fixed version such as `ghcr.io/verodus/openframe:0.6.0` (preferably its published `@sha256:...` digest) to keep deployments reproducible, then run:

```sh
docker compose -f compose.registry.yaml config --quiet
docker compose -f compose.registry.yaml pull
docker compose -f compose.registry.yaml up -d
```

The registry stack has no `build:` section and refuses to start without an explicit image selection. It is a standalone alternative to `compose.yaml`; do not merge them. Each successful approved milestone publishes both its immutable version tag and the mutable `latest` alias. `latest` moves only when a milestone image finishes publishing; it does not track ordinary commits or update a running server. To move an existing deployment using `latest` forward, run `docker compose -f compose.registry.yaml pull` and then `docker compose -f compose.registry.yaml up -d`. For repeatable deployments and rollback, use a fixed version or image digest. The same persistent `openframe-data` volume declaration is used by both stacks; preserve the Compose project name when switching. Never use `down -v` for an upgrade.

The image is published to GitHub Container Registry (GHCR). A new GHCR package may initially be private even when its repository is public. The owner must make the package public in its Package settings for anonymous pulls, or authenticate Docker to GHCR with a credential permitted to read that package. Never put a registry credential in the Compose file or commit it. Public source does not imply the image already exists: check the workflow result first.

## HTTPS proxies and public hostnames

For any reverse proxy, tunnel, ingress, or load balancer, set these values in the OpenFrame stack's `.env` (or directly in the OpenFrame container environment):

```dotenv
PUBLIC_URL=https://signage.example.com
COOKIE_SECURE=true
```

Use your exact browser-facing origin, including HTTPS and a non-default port if applicable, without a path. Do not use the proxy's internal upstream address. This applies to Nginx, Caddy, Traefik, Cloudflare, and other providers, including when the proxy connects to OpenFrame over HTTP.

Recreate the container with `docker compose up -d --force-recreate openframe`, retaining the existing Compose file, environment-file, and project arguments (for example `-f compose.registry.yaml` for the repository's registry stack). In Portainer, edit the stack and redeploy. A restart alone does not apply environment changes. Keep the same project and data volume; never use `down -v`.

**Origin not allowed** at login means the browser origin does not match the server's expected origin, before password verification. Check `PUBLIC_URL` in the running container, then sign in through that exact HTTPS address. Alternate LAN/IP browser addresses are intentionally rejected once a public origin is configured. Keep the origin check enabled. Direct trusted LAN HTTP installations can leave `PUBLIC_URL` unset and `COOKIE_SECURE=false`.

## Tunnels and players

For an existing home tunnel, point cloudflared at the running server's reachable address and set `PUBLIC_URL`/`COOKIE_SECURE` appropriately. The separate source-build `compose.cloudflare.yaml` remains available. This downloadable stack does not carry your Cloudflare token, player identity, Wi-Fi password, or WireGuard keys.

Players still use the server's stable LAN/VPN/HTTPS origin in their private configuration, enroll, and receive a pairing code for approval in Screens. No server image needs to be installed on each player. Follow the [Pi guide](https://github.com/veRoduS/OpenFrame#raspberry-pi-installation), [remote-player guide](https://github.com/veRoduS/OpenFrame/blob/main/docs/remote-players.md), and [WireGuard guide](https://github.com/veRoduS/OpenFrame/blob/main/docs/wireguard-players.md).

## Action behavior

Normal branch pushes and pull requests run CI only. Publishing requires an approved Git tag of the form `vX.Y.0`, or an explicit manual run selecting an existing approved tag. Patch tags and tag/package version mismatches are rejected. The pipeline checks the exact tagged commit, runs Node/Python checks plus native AMD64 and ARM64 Docker smoke tests, then builds both architectures and publishes a versioned multi-platform image under both `X.Y.0` and `latest` tags. GitHub release tags remain versioned so each build is tied to an immutable milestone; `latest` is only the convenience image alias.

The frontend is built on the builder's native platform; production dependencies, including Sharp, install inside the target-platform stage. This avoids copying x64 native modules into ARM images. Buildx/QEMU supplies cross-platform builds; native ARM CI exercises SQLite startup and actual WebP encoding/decoding.

The action uses its repository-scoped `GITHUB_TOKEN` for `packages: write`; no personal token is needed in workflow secrets. Other jobs remain read-only. It verifies both platform entries in the registry manifest and creates a digest-pinned Compose artifact from an allowlist of public files. Published version tags are not intentionally overwritten; only the `latest` alias moves forward when a new approved milestone succeeds. If publishing succeeded but artifact upload failed, recover the existing digest rather than replacing the versioned image. Artifacts expire after 90 days; maintainers can attach the reviewed bundle to a manual GitHub Release for longer retention.

Source commits, Git tags, image publication, and deployment are separate operations. Routine local work still receives patch bumps without pushing. The owner approves minor milestones and explicitly requests major releases. This workflow never commits code, creates GitHub releases, or updates installed servers/players.

## Upgrade and rollback

Stop and back up the complete data volume before upgrading; record the old image digest. Select the new milestone/digest in `.env`, pull, and run `up -d`. Test one representative device before a fleet rollout. Restore the matching pre-upgrade backup into a fresh volume if a downgrade requires it, and restore the previous digest. Server container replacement does not update installed Pi player files.

See [server operations](https://github.com/veRoduS/OpenFrame/blob/main/docs/operations.md) for consistent backups, restore precautions, and configuration. Complete a physical Pi soak test before unattended production use.
