# Simple server and screen setup

Use the server and player source from the same 0.3.0 checkout. The automated hotspot/managed-VPN flow below is experimental and uses the separate source-built managed stack, not the ordinary prebuilt application image alone. No prebuilt, hardware-tested SD-card image is available yet.

## Easiest existing setup

1. Install Docker with Compose on your server. In the OpenFrame folder, run `docker compose up -d --build`.
2. Open `http://SERVER_LAN_IP:3100`, create the administrator password, and create/publish a playlist.
3. Flash Raspberry Pi OS Lite with Raspberry Pi Imager. Set the Pi's Wi-Fi, country, user, and SSH credentials in Imager.
4. In OpenFrame, open **Screens > Screen setup**. Enter the server's reachable address and download a setup ZIP. Extract it, then transfer its files and this repository's `player` folder to the Pi.
5. On the Pi, run:

```sh
sudo bash player/install.sh ./openframe.json
sudo reboot
```

6. Enter the code shown on the screen in **Screens > Pair screen**, then assign the published playlist.

For screens outside your home, use [Cloudflare HTTPS](remote-players.md) or an [existing WireGuard client](wireguard-players.md). The manual installer expects working networking; Wi-Fi fields in the ZIP are used by the image builder's first-boot flow.

## Automated hotspot and managed WireGuard

This path lets OpenFrame run its own optional WireGuard service. It requires a reachable UDP port at home, a public HTTPS bootstrap address, and a Linux image builder. Follow the [managed server setup](managed-wireguard.md#server-setup) once before preparing screens.

### Prepare an image once

On an ARM Linux machine, obtain an uncompressed official Raspberry Pi OS Lite image and run this from the OpenFrame folder. Use the actual deployment country instead of `US`:

```sh
sudo env OPENFRAME_SETUP_COUNTRY=US bash player/build-image.sh raspberry-pi-os-lite.img --hotspot openframe-hotspot.img
```

The builder installs the player, Chromium, Wi-Fi setup page, and VPN tools into a new image. It requires Internet access and Linux image tools; see [requirements](managed-wireguard.md#prepare-the-pi). An x86 Linux builder requires separately configured ARM binfmt/QEMU. This is not a native Windows command.

### Set up each screen

1. Flash `openframe-hotspot.img` using Imager's custom-image option. Do not add personal Wi-Fi settings to a reusable image.
2. Connect HDMI and power. The screen displays an `OpenFrame-Setup-...` Wi-Fi name, password, and QR code.
3. Join that Wi-Fi on your phone. Stay connected even though it has no Internet. Open **http://192.168.50.1**; an automatic captive-portal popup is not required or implemented.
4. Enter the screen name, local Wi-Fi information, country, and public HTTPS OpenFrame address. For a Cloudflare Access-protected hostname, also enter a service token under its optional settings.
5. Choose **Connect**. The setup hotspot disconnects while the Pi joins the supplied Wi-Fi. Watch the HDMI screen for the pairing code.
6. In OpenFrame, approve that code under **Screens > Pair screen**, then assign a published playlist.
7. The Pi receives its own VPN address, verifies OpenFrame through WireGuard, and reboots into playback.

No VPN client file needs to be copied. The Pi generates its private key locally; approval lets the server register its public key and return connection settings. Once complete, the player uses only the private VPN server address. An outage keeps cached playback running; automatic public-HTTPS fallback is not implemented.

Setup failures return to the hotspot for another attempt. Normal playback outages do not reopen the hotspot. Keep physical access during initial testing, and complete the [hardware acceptance checks](managed-wireguard.md#acceptance-checks) before unattended use.

For a single fresh, Internet-connected Pi, you can prepare it directly instead of building an image:

```sh
sudo env OPENFRAME_SETUP_COUNTRY=US bash player/install.sh --prepare-setup
sudo reboot
```

This changes the dedicated Pi into a kiosk and refuses an existing OpenFrame configuration or identity. Never clone a Pi after enrollment: it contains unique device/VPN credentials and saved Wi-Fi information.
