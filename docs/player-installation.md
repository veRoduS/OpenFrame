# Raspberry Pi installation

For the shortest path, see [simple setup](quick-start.md). Optional [managed WireGuard and hotspot onboarding](managed-wireguard.md) and [recovery Wi-Fi](player-recovery.md) have separate guides. Use matching server and player source from the same milestone.

Target: Raspberry Pi Zero 2 W with HDMI, Raspberry Pi OS Lite, and a suitable power supply and microSD card. The player uses Python's standard library and one Chromium kiosk window. The React management application never runs on the Pi. Memory usage and sustained playback still need measurement on a physical Zero 2 W.

## Install on an existing Pi

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

## Build an image to flash

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

## Operation and troubleshooting

```sh
sudo systemctl status openframe-agent
sudo journalctl -u openframe-agent -n 100
sudo journalctl -u openframe-firstboot -n 100
```

After installation, edit `/etc/openframe/config.json` and restart `openframe-agent` to change servers. A different server requires fresh approval. Edit Wi-Fi with the Pi's NetworkManager tools. Future boot-file edits are not automatically imported.

The agent serves its player at `http://127.0.0.1:8080`, accessible only on the Pi. Device credentials are stored with restricted permissions in `/var/lib/openframe/identity.json`. Downloaded images are checksum-verified before a new manifest replaces the current one. The last complete manifest remains on disk and plays after an offline restart. Before the first successful publication download, there is no offline content to show.

Blanking and rotation are cached. A revoked device stops playback when it next contacts the server; revocation cannot reach an offline device. Old downloaded assets are retained in this initial version. Monitor SD-card capacity when frequently replacing large image libraries.

Restart is a narrowly scoped, acknowledged command. The Pi user receives sudo access only to `/usr/sbin/reboot`; the server cannot send arbitrary shell commands. Commands are acknowledged durably before execution to avoid reboot loops. A power failure in that interval may require queuing the restart again.

## Desktop player preview

Test the player without a Pi:

```sh
python3 player/agent.py --config player/openframe.example.json --cache ./player-cache
```

Copy the example to an ignored private `openframe.json`, set its server address, and pass that path with `--config` instead when customizing it. Open http://127.0.0.1:8080 and pair it. Restart commands are disabled unless `--allow-reboot` is explicitly passed. Never commit real provisioning configurations.

Use `python3 player/agent.py --config player/openframe.example.json --check-connection` to verify a configured server without enrolling a player. For Access-protected deployments, use a private configuration following `player/openframe.cloudflare.example.json` instead. This diagnostic applies Access headers, checks TLS normally, and does not create a cache.
