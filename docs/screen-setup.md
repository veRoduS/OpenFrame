# Screen setup builder

Open **Screens > Screen setup** as an administrator to create a private setup ZIP. It supports a direct LAN/HTTPS server or a saved WireGuard client, with optional first-boot Wi-Fi and Cloudflare Access credentials. The ZIP builder is not an OS image flasher and does not change an external VPN server.

The separate **Managed VPN** tab shows the optional OpenFrame-hosted WireGuard service and its registered peers. Enable that service through the [managed stack](managed-wireguard.md). Its hotspot-prepared players generate private keys themselves and request settings after approval, without consuming imported VPN inventory or downloading a ZIP. Registered does not mean currently connected. Existing imported clients follow the instructions below; their external VPN peers are still managed manually.

## Prepare a WireGuard inventory

1. On your existing VPN server, register/export a separate client for each screen. Each needs its own private key and address. Never import the VPN server's own configuration.
2. Open **VPN configs**, enter a descriptive name and the OpenFrame server URL reachable through that VPN, then select the exported `.conf` and choose **Import client config**. For example, `http://10.8.0.1:3100` works only if your routing actually reaches OpenFrame there.
3. Repeat for the clients you want available. The list shows addresses, endpoints, and **Available** or **Allocated: screen name**. Available means not yet assigned to a generated setup; it does not mean the VPN has passed a connectivity test.

Imports are limited to 64 KiB and 500 saved clients. Shell hooks are rejected, `SaveConfig` must be false or omitted, and required fields/key encoding are checked. Network routing is still validated by `wg-quick` on the Pi. Duplicate private keys, including equivalent X25519 encodings, and duplicate names are rejected. OpenFrame cannot detect whether a key/address is already used outside this inventory. Prefer split-tunnel routes; full-tunnel clients are flagged because they may redirect SSH and Internet traffic. See [WireGuard routing](wireguard-players.md).

## Build and download

1. In **Build config**, enter a unique screen name.
2. Select **LAN / HTTPS** and enter the server origin, or select **WireGuard** and an available client. A WireGuard client uses the server URL saved with it. Use a reachable LAN/VPN IP or public HTTPS hostname, never `localhost`, which would refer to the Pi itself. URLs cannot contain credentials, paths, queries, or fragments.
3. Optionally enable **Wi-Fi** and enter SSID, password, and two-letter country code. A blank password represents an open network. These fields are consumed by OpenFrame's customized image on first boot; the manual installer expects networking to be configured already.
4. For a hostname protected by Cloudflare Access, optionally enter a service token's client ID and secret. This requires an HTTPS server URL and an appropriate Service Auth policy. A Tunnel alone does not require this token. See [Cloudflare setup](remote-players.md).
5. Choose **Create and download**. The ZIP contains `openframe.json`, optional `openframe-wg.conf`, and `SETUP.txt`. Extract it before installation; the Pi does not read ZIPs directly.

Creation reserves the selected VPN client in a database transaction. Another screen cannot select it, including through competing requests. The **Issued setups** tab keeps the screen name, server, transport, creation time, and a download button. Re-download the same setup after a failed download or to reinstall the **same** screen; this does not allocate another client. Names are unique case-insensitively, and history is limited to 2,000 setups.

Only unused VPN configurations can be deleted, with confirmation. This version deliberately does not release allocated clients, edit issued bundles, or reuse their keys. For replacement credentials create a new client and a distinctly named setup, then revoke the old peer on your VPN server. Allocated refers to a setup record, not a successful pairing or live VPN connection. Removing an OpenFrame screen does not revoke its VPN peer or remove its issued bundle.

## Install on the screen

For an existing dedicated Raspberry Pi OS installation, configure networking first, copy the repository's `player/` directory and extracted setup files to the Pi, and run:

```sh
sudo bash player/install.sh ./openframe.json
sudo reboot
```

Keep `openframe-wg.conf` beside `openframe.json` when using WireGuard. For a new SD card, use the [image builder](player-installation.md#build-an-image-to-flash) with those files together, or replace the two files on an **OpenFrame-customized image's** visible boot partition **before first boot**. Do not clone an already provisioned Pi's identity/cache. Dropping files onto stock Raspberry Pi OS does not install OpenFrame. First boot requires Internet access for OS packages, and Wi-Fi/Ethernet must work before WireGuard can connect.

The Pi displays its normal pairing code. Approve it using **Screens > Pair screen**, then assign a published playlist. Setup creation does not approve devices or embed an OpenFrame device token. All subsequent content synchronization uses the existing outbound player protocol. The builder does not increase playback memory use or modify slide preparation.

Boot-file edits after provisioning are not automatically imported. Existing WireGuard-capable players use the same JSON/drop-in format; no player-code update is needed solely for this builder. OS flashing, live VPN connectivity, and Pi hardware behavior still require physical testing.

## Secrets and backups

Use HTTPS or a trusted encrypted management connection to upload configs and download bundles. Imported VPN keys, Wi-Fi passwords, and Cloudflare credentials are encrypted in SQLite using AES-256-GCM with a random per-record nonce and record-bound authentication. The server lazily creates the 32-byte `DATA_DIR/provisioning.key` with restrictive permissions. Names, server URLs, VPN addresses/endpoints, and allocation metadata remain readable in the database and administrator inventory. Ordinary library/player responses do not contain the saved secrets; ZIP retrieval requires an administrator session and an explicit download request.

Back up the **entire stopped data directory, including `provisioning.key`**, following [operations](operations.md#backup). A missing, damaged, or mismatched key prevents exports; restore the matching key and database. OpenFrame refuses to replace a missing key when saved records exist. Encryption protects a database-only leak, not a compromised running server or theft of the whole data directory, where the key also lives. Restrict and encrypt backups externally.

Downloaded ZIPs, extracted files, and configured images contain **plaintext credentials**. Keep them off Git, shared drives, public artifacts, and support tickets. Delete unnecessary copies after successful installation. Git/Docker ignore the generated `openframe-screen-*.zip` filenames, but renaming a file can bypass those rules. Issued bundles remain retrievable by administrators, so revoke/rotate credentials externally if a bundle leaks. This version does not provide an issued-secret purge or automated credential-rotation service.
