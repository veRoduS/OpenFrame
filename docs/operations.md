# Server operations

## Install

Use a machine with Docker Engine/Desktop in Linux-container mode and the Docker Compose plugin. Download a milestone's source archive from the repository's Releases page, or clone the repository and check out its published tag. Run commands from the extracted repository root. No prebuilt OpenFrame container image is published yet; Compose builds the included Dockerfile.

```sh
cp .env.example .env
docker compose config
docker compose up -d --build
docker compose ps
```

In PowerShell use `Copy-Item .env.example .env`. Open http://localhost:3100, or the server's LAN address, and immediately create the administrator password. Do this privately before exposing any public hostname. Reserve the server's LAN address or give it stable DNS, then follow [first playlist](../README.md#first-playlist) and [Pi installation](../README.md#raspberry-pi-installation).

Do not run multiple server containers against one SQLite volume. This is a single-server deployment, not an HA cluster. Production and development data are separate: Docker uses a named volume, local Node uses `./data` by default.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENFRAME_PORT` | `3100` | LAN Compose host port; does not change the container port |
| `OPENFRAME_BIND_ADDRESS` | `0.0.0.0` | LAN Compose host interface; use `127.0.0.1` for a same-host proxy |
| `PUBLIC_URL` | unset | Expected browser origin, e.g. `https://signage.example.com`; no path |
| `COOKIE_SECURE` | `false` | Set to `true` with HTTPS; secure cookies do not work over ordinary LAN HTTP |
| `DATA_DIR` | `./data` | Node data path; Compose explicitly sets `/data` |
| `HOST` | `0.0.0.0` | Node listener interface |
| `PORT` | `3100` | Node listener port; keep Compose container port unchanged |

Compose reads `.env`. Direct Node startup requires shell environment variables. The [Cloudflare deployment](remote-players.md) uses its own `.env.cloudflare` and `OPENFRAME_PUBLIC_URL` instead. Use its full `--env-file .env.cloudflare -f compose.cloudflare.yaml` arguments wherever this page shows `docker compose`; do not merge the two Compose files. Keep the same Compose project name/directory when replacing or upgrading a deployment so the volume name stays consistent.

## Backup

Back up before every upgrade. A consistent backup includes the **entire** data directory, not just a live `.sqlite` file. Stop writes before copying. The commands below deliberately stop the service; connected players can keep playing cached content.

1. Create a new, private empty backup directory, for example `backups/before-upgrade`. Never reuse a directory containing an older backup.
2. Stop and copy, checking each command succeeds:

```sh
docker compose stop openframe
docker compose cp openframe:/data/. ./backups/before-upgrade/
docker compose start openframe
```

3. Verify the backup contains `openframe.sqlite` and `media/` plus any SQLite sidecars present. Encrypt/copy it to separate storage. Record the source version/tag and Compose project name. Back up environment files, tunnel secrets, and per-player VPN/configuration separately with restricted access; they are not inside `/data`.
4. Rehearse restoration on an isolated machine/project. A backup that has never been restored is unverified.

If the copy fails, retain the original volume and diagnose it; restarting restores service but does not mean the backup succeeded. Do not copy a running local Node database either: stop that process first, copy all of `DATA_DIR`, then restart.

Command reference: [Docker Compose copy](https://docs.docker.com/reference/cli/docker/compose/cp/) and [container creation](https://docs.docker.com/reference/cli/docker/compose/create/).

## Restore safely

Restore first into a **new, isolated Compose project with a fresh volume**, using the same OpenFrame source version as the backup. Keep the original volume intact. Set `OPENFRAME_BIND_ADDRESS=127.0.0.1` and an unused `OPENFRAME_PORT` in an isolated checkout's `.env`; leave `PUBLIC_URL` unset and `COOKIE_SECURE=false` during local verification. Do not expose this instance to players while validating it.

For example, use project name `openframe-restore-test` only if it has never been used on this Docker host:

```sh
docker compose -p openframe-restore-test create --build openframe
docker compose -p openframe-restore-test cp ./backups/before-upgrade/. openframe:/data/
docker compose -p openframe-restore-test run --rm --no-deps --user root openframe chown -R node:node /data
docker compose -p openframe-restore-test start openframe
```

Confirm the destination volume is fresh before copying. Do not overlay a backup onto an old database with stale WAL/SHM files. Verify login, media, slides, and published playlists through the isolated port. For production recovery, schedule downtime, stop the old instance, and deliberately switch your proxy/port to the restored deployment. Restore its production origin/cookie settings and secrets before reconnecting players. Keep old data until recovery is accepted; never use `down -v` as a routine upgrade or troubleshooting step.

## Upgrade and rollback

1. Read the milestone changelog and compatibility notes. Back up the stopped server as above and record the currently running server/player versions.
2. Obtain the approved tag in a clean source checkout, preserve your private configuration, and retain the existing Compose project/volume name.
3. Run `docker compose up -d --build`, inspect `docker compose ps` and logs, and check `/api/health` reports the expected version.
4. Verify login, media, draft saving, publication, and one representative screen before rolling out to all screens.
5. Update player source separately when the milestone requires it. There is no automatic OTA/code distribution service.

To update an installed Pi, copy the milestone's `player/` directory to a temporary location on the Pi. Stop `openframe-agent`, copy **agent.py, wireguard.py, and the complete web directory** into `/opt/openframe` with root ownership and readable file permissions, then restart `openframe-agent` and reboot the kiosk. Keep `/etc/openframe/config.json` and `/var/lib/openframe` unchanged. Do not copy your development cache or another Pi's identity. For installer/service changes, follow that milestone's explicit migration instructions rather than blindly re-running provisioning.

To roll back, stop the failed deployment and use the previous source tag. Do not assume a newer database is backwards compatible: restore its matching pre-upgrade backup into a fresh volume, then switch back after verification. Roll back affected player source too. Drafts, uploads, pairings, or commands created since that backup will be lost; devices enrolled afterward need re-pairing. Restoring old state may also restore pending commands or undo revocations: review Screens and re-revoke removed devices before allowing players to reconnect.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server does not start | `docker compose logs --tail=100 openframe`; port collisions, volume permissions, disk space |
| Empty library after upgrade | Compose project/volume name or Node `DATA_DIR` changed; preserve and locate original data |
| Login loops or writes return 403 | Browser origin matches `PUBLIC_URL`; secure cookies require HTTPS |
| Player never shows a pairing code | Correct server origin, DNS/routing/TLS; use agent `--check-connection` |
| Paired player is empty | Published playlist assigned, not blanked, at least one currently eligible entry |
| Draft edits do not reach screens | Save and publish; wait for sync/download/preparation; inspect device readiness/error |
| Counter/schedule time is wrong | Pi system date/time, timezone, and time synchronization after boot |
| Transition holds an old slide | Inspect preparation error/delayed-switch count; reduce slide complexity and test on hardware |
| Offline first boot is blank | Initial provisioning and first publication download require connectivity |
| Pi fills its SD card | Cached assets are retained; monitor disk use and plan maintenance |

Pi diagnostics: `sudo systemctl status openframe-agent`, `sudo journalctl -u openframe-agent -n 100`, and `sudo journalctl -u openframe-firstboot -n 100`. WireGuard/Cloudflare-specific checks are in their guides. Do not attach unredacted logs or configuration to public issues. There is no supported administrator password-reset command yet; do not delete your database to reset a password.
