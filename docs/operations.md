# Server operations

For the shortest instructions see [simple setup](quick-start.md). Optional OpenFrame-hosted WireGuard uses a separate [standalone stack](managed-wireguard.md), with its own UDP endpoint and additional backup requirements. Its internal `OPENFRAME_WG_SOCKET` setting connects the app to the restricted helper socket; leave it unset for ordinary deployments. Back up matching application data and `wireguard-state` together, not just the application volume.

## Install

Use a machine with Docker Engine/Desktop in Linux-container mode and the Docker Compose plugin. The [container guide](container-images.md) covers the prebuilt milestone stack and ARM64 requirements. For source builds, download a milestone's source archive or clone the repository and check out its published tag. Run commands from the extracted repository root; the default Compose file builds the included Dockerfile.

```sh
cp .env.example .env
docker compose config
docker compose up -d --build
docker compose ps
```

In PowerShell use `Copy-Item .env.example .env`. Read the unique initial password with `docker compose logs openframe`, then open http://localhost:3100 or the server's LAN address and sign in as `superadmin`. Change the password under **Users & Groups > My password**. Protect access to server logs; the password is printed only when an empty installation is initialized. Restarts preserve accounts and do not print passwords again. Reserve the server's LAN address or give it stable DNS, then follow [first playlist](../README.md#first-playlist) and [Pi installation](../README.md#raspberry-pi-installation).

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

## Public URL and reverse proxies

For any HTTPS reverse proxy, tunnel, ingress, or load balancer (for example Nginx, Caddy, Traefik, or Cloudflare), configure these variables on the **OpenFrame container**, not just the proxy:

```dotenv
PUBLIC_URL=https://signage.example.com
COOKIE_SECURE=true
```

Replace the example with the exact browser-facing origin: scheme, hostname, and port if non-default. Do not use the internal container/LAN address or include a path. HTTPS at the proxy still requires these settings even when its connection to OpenFrame uses HTTP. Use the configured HTTPS address for administrator access afterward. OpenFrame currently accepts one configured browser origin; writes from an alternate LAN IP or hostname are intentionally rejected. Direct trusted LAN HTTP installations without a proxy can leave `PUBLIC_URL` unset and `COOKIE_SECURE=false`.

After editing the environment, **recreate/redeploy**, rather than merely restarting, the container. For Compose, use `docker compose up -d --force-recreate openframe` with the same `-f`, `--env-file`, and project arguments used for the existing deployment. For Portainer, edit the stack's environment and redeploy it. Preserve the project name and data volume; never use `down -v` for this change. Do not expose the backend port publicly just to fix login.

If login reports **Origin not allowed**, the request was rejected before password verification. Check the running OpenFrame container's `PUBLIC_URL` against the address in the browser, including HTTP versus HTTPS and any non-default port. Confirm the changed environment was applied by recreating the container, then retry through the configured address. Do not disable the origin check or broadly trust forwarded headers to work around the error. `COOKIE_SECURE=true` also requires the browser to use HTTPS.

## Backup

Back up before every upgrade. A consistent backup includes the **entire** data directory, not just a live `.sqlite` file. Stop writes before copying. The commands below deliberately stop the service; connected players can keep playing cached content.

1. Create a new, private empty backup directory, for example `backups/before-upgrade`. Never reuse a directory containing an older backup.
2. Stop and copy, checking each command succeeds:

```sh
docker compose stop openframe
docker compose cp openframe:/data/. ./backups/before-upgrade/
docker compose start openframe
```

3. Verify the backup contains `openframe.sqlite` and `media/` plus any SQLite sidecars present. After using the screen setup builder it must also contain **`provisioning.key`**, required to decrypt saved configurations. Encrypt/copy it to separate storage. Record the source version/tag and Compose project name. Back up environment files, tunnel secrets, and manually provisioned per-player VPN/configuration separately with restricted access; those are not inside `/data`. Configurations imported/generated through the builder are encrypted in this database, with the key alongside it.
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

Playlist transitions require the updated complete `player/web` directory and a kiosk restart. Old players continue using Cut even when a newer server publishes animation settings. Existing publications without transition settings also use Cut; republish after choosing an effect. No data migration is required for these additive settings.

Multi-network Wi-Fi recovery additionally requires updated `recovery.py`, `wifi.py`, and the complete `player/setup-web` directory. Use the installer upgrade in the [recovery guide](player-recovery.md#install-or-upgrade), preserving each device's identity, cached media, VPN, and NetworkManager profiles. The home-server container cannot update this local portal. Wi-Fi preferences and passwords live on the player; privately back up `/etc/NetworkManager/system-connections` and `/etc/openframe/wifi.json` if set. To roll back the portal, restore the previous matching player source; ordered NetworkManager profiles persist unless deliberately restored from a private backup. Do not put those backups in Git or an SD-card distribution.

Updated recovery code also promotes connected backup Wi-Fi to a higher saved priority after stable scans. Roll out to one test Pi first, including a deliberately incorrect preferred password to verify return attempts and cooldowns. Restart the recovery service (or reboot) after replacing code and update the complete setup web assets for drag handles. No new service, dependency, or configuration migration is required. Restoring earlier player source removes promotion behavior but preserves saved profile priorities.

To update an installed Pi, copy the milestone's `player/` directory to a temporary location on the Pi. Stop `openframe-agent`, copy **agent.py, wireguard.py, and the complete web directory** into `/opt/openframe` with root ownership and readable file permissions, then restart `openframe-agent` and reboot the kiosk. Keep `/etc/openframe/config.json` and `/var/lib/openframe` unchanged. Do not copy your development cache or another Pi's identity. For installer/service changes, follow that milestone's explicit migration instructions rather than blindly re-running provisioning.

To roll back, stop the failed deployment and use the previous source tag. Do not assume a newer database is backwards compatible: restore its matching pre-upgrade backup into a fresh volume, then switch back after verification. Roll back affected player source too. Drafts, uploads, pairings, or commands created since that backup will be lost; devices enrolled afterward need re-pairing. Restoring old state may also restore pending commands or undo revocations: review Screens and re-revoke removed devices before allowing players to reconnect.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Server does not start | `docker compose logs --tail=100 openframe`; port collisions, volume permissions, disk space |
| Empty library after upgrade | Compose project/volume name or Node `DATA_DIR` changed; preserve and locate original data |
| Login loops or writes return 403 | Browser origin matches `PUBLIC_URL`; secure cookies require HTTPS |
| Setup download returns 503 | Restore the matching database and `provisioning.key`; never replace the key with a new one |
| Player never shows a pairing code | Correct server origin, DNS/routing/TLS; use agent `--check-connection` |
| Paired player is empty | Published playlist assigned, not blanked, at least one currently eligible entry |
| Draft edits do not reach screens | Save and publish; wait for sync/download/preparation; inspect device readiness/error |
| Counter/schedule time is wrong | Pi system date/time, timezone, and time synchronization after boot |
| Transition holds an old slide | Inspect preparation error/delayed-switch count; reduce slide complexity and test on hardware |
| Offline first boot is blank | Initial provisioning and first publication download require connectivity |
| Pi fills its SD card | Cached assets are retained; monitor disk use and plan maintenance |

Pi diagnostics: `sudo systemctl status openframe-agent`, `sudo journalctl -u openframe-agent -n 100`, and `sudo journalctl -u openframe-firstboot -n 100`. WireGuard/Cloudflare-specific checks are in their guides. Do not attach unredacted logs or configuration to public issues. For administrator recovery, follow [Users and groups](users-and-groups.md#upgrade-and-recovery); do not delete your database.
