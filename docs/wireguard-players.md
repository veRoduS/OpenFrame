# Off-site players through your existing WireGuard server

WireGuard is an alternative to Cloudflare Tunnel. It does not require a public OpenFrame hostname. Keep the existing VPN server; export a separate **client** configuration for each Pi. OpenFrame does not create peers on your VPN server or change its firewall.

```text
Remote Pi -- WireGuard --> Home VPN server -- private network --> OpenFrame
```

Wi-Fi or Ethernet must work at the remote location first. WireGuard provides a route home, not an Internet connection or automatic server discovery. Enrollment, synchronization, and media downloads then use the same OpenFrame API as LAN and Cloudflare players. Slides continue to play from the Pi's local cache.

## Drop-in setup

For a guided workflow, use **Screens > Screen setup** to import client exports into an available/allocated inventory and generate each screen's private setup ZIP. The [builder guide](screen-setup.md) covers allocation, encrypted storage, backups, and re-downloads. The manual drop-in method below remains supported and does not require storing keys on the home server.

1. Export a client `.conf` from your existing WireGuard server. Give each player its own private key, peer registration, and VPN address. Do not copy your VPN server's own configuration onto a player.
2. Rename the export to **`openframe-wg.conf`** and place it in the same directory as **`openframe.json`**. This filename opts in to WireGuard; no extra JSON fields are needed.
3. Set `server` in the JSON to OpenFrame's address **reachable through the VPN**, including its port. For example, if OpenFrame runs on the VPN host at `10.8.0.1`:

```json
{
  "server": "http://10.8.0.1:3100",
  "name": "Off-site lobby"
}
```

If OpenFrame is a different machine on your home LAN, use that machine's LAN IP instead. `10.8.0.1` above is illustrative, not automatic. Your client's `AllowedIPs`, home routing/return path, and firewall must permit reaching the selected machine. HTTP is only appropriate over trusted private networks/the encrypted VPN; use valid HTTPS when the path needs end-to-end TLS. Do not disable certificate checks.

For an existing dedicated Pi with the updated `player` directory:

```sh
sudo bash player/install.sh ./openframe.json
sudo reboot
```

For a customized image, place both files together before running the existing builder:

```sh
sudo bash player/build-image.sh raspberry-pi-os-lite.img openframe.json openframe-player.img
```

The builder carries the optional `.conf` onto the boot partition. Alternatively, drop `openframe-wg.conf` beside `openframe.json` on the customized image's visible boot partition **before first boot**. First boot still needs ordinary Internet access to install OS packages. Adding these files to an unmodified Raspberry Pi OS image does not install OpenFrame by itself.

After provisioning, approve the displayed pairing code in OpenFrame and assign a published playlist. Keep the same `server` URL to retain pairing when changing only the VPN configuration. Changing the server origin requires pairing again.

## Routing and compatibility

- Prefer a split-tunnel client whose `AllowedIPs` include only the OpenFrame host or necessary home subnets. This limits routing changes; it is not a replacement for VPN-server firewall restrictions. Full-tunnel exports (`0.0.0.0/0`, `::/0`) are accepted but can redirect all Pi traffic and interrupt an SSH installation session. Apply those with local console access available.
- `PersistentKeepalive = 25` is useful for a player behind NAT. The installer preserves the supplied value; it does not silently change routing or keepalives. See the [WireGuard quick start](https://www.wireguard.com/quickstart/).
- IPv4/IPv6, multiple peers, optional preshared keys, `Address`, `DNS`, `MTU`, `Table`, and ordinary WireGuard settings pass through to the distro's `wg-quick`. If `DNS` is present, the installer installs `openresolv` only when a `resolvconf` command is not already available. The configured DNS servers must be reachable; omit VPN DNS if you do not need it.
- Shell hooks (`PreUp`, `PostUp`, `PreDown`, `PostDown`) are rejected, not executed or silently discarded. `SaveConfig` must be absent or `false`. Use a plain client export without server-side firewall hooks. The installer checks supported settings, required fields, and key encoding; `wg-quick` performs the remaining network validation. See [wg-quick's configuration reference](https://git.zx2c4.com/wireguard-tools/about/src/man/wg-quick.8).
- Avoid overlapping home and remote LAN ranges. If both sites use the same subnet, the chosen home address may route locally instead of through the tunnel. A distinct VPN-side address for OpenFrame often avoids that conflict.
- A successful WireGuard handshake does not prove OpenFrame is reachable. When the VPN server is not the OpenFrame host, your existing server/router must provide forwarding and a return route or suitable NAT. Restrict that access to the OpenFrame service as appropriate.

The normal `compose.yaml` publishes the application port and works with a VPN-reachable host address. The Cloudflare-only Compose file deliberately publishes no ports; a WireGuard peer on another machine cannot reach that container without an additional private route or carefully scoped host binding. Do not publish port 3100 to the public Internet. If `PUBLIC_URL` is set to a Cloudflare HTTPS hostname, continue to use that hostname for administrator browser writes. Player API traffic can still use its configured private address.

You can use Cloudflare for management and WireGuard for players, or select either transport for each player. This feature does not automatically fail over between two server URLs. A player still configured with a public Cloudflare hostname follows the route for that hostname; simply enabling WireGuard does not switch it to your private OpenFrame address.

## Startup, recovery, and keys

The installer stores the normalized client configuration at `/etc/wireguard/wg-openframe.conf`, owned by root with mode `600`. The unprivileged OpenFrame agent and renderer never receive the private key. If you use the optional setup builder, its administrator-only API receives the imported client and stores it encrypted on the home server; explicit bundle downloads contain the plaintext key. Normal library/player API responses do not include it. The interface name `wg-openframe` is reserved for this feature. Existing unrelated tunnels and Wi-Fi profiles are not replaced. An unmanaged file at an OpenFrame WireGuard destination causes installation to fail instead of overwriting it.

The distro's `wg-quick@wg-openframe.service` starts at boot. An OpenFrame drop-in bounds startup DNS attempts and retries failed startup every 15 seconds, with a 30-second start timeout. NetworkManager continues managing Wi-Fi/Ethernet but leaves this specific tunnel to `wg-quick`. The agent and kiosk do **not** depend on VPN readiness, so a tunnel outage does not block playback of previously downloaded content. These retry settings do not detect a wrong peer key or a failed handshake after the interface starts. See [WireGuard's service unit](https://github.com/WireGuard/wireguard-tools/blob/master/src/systemd/wg-quick%40.service) and [NetworkManager device configuration](https://networkmanager.dev/docs/api/latest/NetworkManager.conf.html#device-sections).

The agent keeps attempting normal sync during an outage and retains its last complete publication. New content downloads and device commands wait until connectivity returns. `wg-quick` resolves an endpoint hostname when starting the interface; if your home's public IP changes while the tunnel is running, restart the tunnel to resolve it again. There is no dynamic-DNS watchdog in this version.

After successful first-boot installation, the boot-partition `.conf` is removed only after its content matches the installed secure copy. The original client file and customized image still contain keys. Keep them private, including copies in cloud-synced folders; deletion from an SD card is not secure erasure. The manual installer deliberately leaves your source `.conf` in place. Git and Docker build contexts ignore `*.conf`; examples use `.conf.example`. Do not publish configured images or source archives containing private client files.

To rotate a player's VPN key/config, export a new client configuration, replace the local drop-in beside the installer JSON, and rerun the installer on that Pi. It stops only its own tunnel using the old settings before installing the replacement. Revoke the old peer on your VPN server after verifying the new connection. Boot-file edits after provisioning are not automatically imported. Omitting the drop-in on a later install leaves the installed VPN unchanged; it does not disable it.

To disable this tunnel explicitly on the Pi, run `sudo systemctl disable --now wg-quick@wg-openframe.service`. The private file remains available for re-enabling; revoke the peer on your WireGuard server when retiring a device. OpenFrame device revocation is separate from VPN peer revocation.

## Verify on the remote network

```sh
sudo systemctl status wg-quick@wg-openframe.service
sudo wg show wg-openframe
sudo journalctl -u wg-quick@wg-openframe.service -n 100
sudo -u openframe python3 /opt/openframe/agent.py --config /etc/openframe/config.json --check-connection
```

The health check contacts OpenFrame, does not enroll a player, and prints no credentials. Generate traffic with that check, then inspect the latest handshake with `wg show`. Do not use `wg showconf` or `wg show all dump` in shared diagnostic output; those can expose private keys. Check endpoint DNS/UDP reachability, peer keys, `AllowedIPs`, routes, and the home firewall if the check fails. A remote network blocking WireGuard UDP may require using the Cloudflare HTTPS option instead.

Test from outside your home, then publish content, restart offline, restore Wi-Fi, and verify that publishing resumes without resetting pairing. Automated tests cover drop-in discovery, validation, secret handling, staging, scoped installation, and cleanup. Real Linux service execution, image flashing, DNS integration, tunnel routing, and Raspberry Pi recovery still require hardware testing.
