# OpenFrame-managed WireGuard and first-boot setup

Optional, experimental, source-built functionality. Ordinary Compose deployments and existing imported VPN clients are unchanged. Automated API, Python, and browser tests cover the control flow with networking mocked. Real Docker networking, Linux firewall behavior, image building, and Raspberry Pi hotspot/HDMI operation have not been validated in the development environment. This is not an appliance-ready claim.

## Server setup

Requirements:

- A Linux Docker host with Compose and kernel WireGuard support. Docker Desktop and rootless Docker are not validated for this stack.
- A public IP/reachable UDP port, or an independently arranged UDP forwarding service. A home connection behind CGNAT normally cannot accept a simple router port forward.
- A public HTTPS OpenFrame origin for initial enrollment, such as `https://openframe.example.com` through Cloudflare Tunnel.
- A separate DNS-only name such as `vpn.example.com` pointing at your home's reachable public IP. Cloudflare's ordinary HTTP Tunnel does not expose this native WireGuard UDP listener.
- An unused private `/24`, default `10.77.0.0/24`, that does not overlap the home or player networks.

Copy `.env.managed.example` to `.env.managed`. Set `WG_ENDPOINT` to the public hostname/IP **and forwarded UDP port**, for example `vpn.example.com:51820`. `WG_PORT` is the Docker host UDP port, default 51820; forward that router port to the Docker host. `WG_PREFIX` specifies the first three address components, default `10.77.0`.

Start from this source checkout:

```sh
docker compose --env-file .env.managed -f compose.managed-vpn.yaml up -d --build
```

This is a **standalone stack, not a Compose overlay**. Do not merge it with the default or Cloudflare stack. When replacing an existing stack, stop the old services first and preserve the same Compose project name and application data volume. Back up first; never use `down -v`. The helper image is built locally, not pulled from an already published OpenFrame milestone.

The default web binding is loopback only. Initially leave `PUBLIC_URL` empty and `COOKIE_SECURE=false`, visit `http://127.0.0.1:3100` on the server (or through an SSH tunnel), and set the administrator password before exposing HTTPS. Configure your existing Cloudflare Tunnel to reach `http://127.0.0.1:3100` when cloudflared runs on the host. A containerized connector must join this stack's default network and target `http://wireguard:3100` instead; its own localhost is not the server.

Then set `PUBLIC_URL=https://openframe.example.com` and `COOKIE_SECURE=true`, recreate the stack with the same command, and use the HTTPS origin for management. Only the WireGuard UDP port needs a router forward; do not publicly forward port 3100. See [Cloudflare Access](remote-players.md) for optional Service Auth credentials and administrator policies.

Open **Screens > Screen setup > Managed VPN**. It shows the service endpoint, private OpenFrame origin, and registered peers. This is configuration status, not a live handshake or physical-screen health report. A disabled service must be enabled through Compose, not through the browser.

The application shares the helper's network namespace and runs as its existing unprivileged user. Only the separate helper receives `NET_ADMIN`, `NET_RAW`, and `CHOWN`; neither container receives the Docker socket, host networking, full privileged mode, or permission to load host kernel modules. The helper provides a group-restricted Unix socket, not a public management port. Replacing the WireGuard container requires recreating the app so both use the same namespace; bring the complete stack up together after updates.

## Prepare the Pi

Use an unconfigured, official Raspberry Pi OS Lite image with its standard two partitions. A native ARM Linux builder needs `util-linux`, `parted`, `e2fsprogs`, Python 3, root access, and Internet access to install packages. An x86 builder must already support executing the image's ARM architecture through binfmt/QEMU; OpenFrame does not install emulation. ARM64 is appropriate for Pi 4/5 and Zero 2 W with a 64-bit OS, subject to the hardware checks below.

```sh
sudo env OPENFRAME_SETUP_COUNTRY=US bash player/build-image.sh raspberry-pi-os-lite.img --hotspot openframe-hotspot.img
```

Set the actual deployment country, not necessarily `US`. The initial hotspot needs this regulatory setting before the phone form is reachable. The form can set the country for the destination Wi-Fi connection as well. Build separate country-specific images when necessary.

The source image is unchanged. The new image is expanded by 2 GiB, receives an allowlisted set of player files, and installs packages inside the mounted image. Temporary build DNS/service-start suppression is restored on exit. The reusable image's machine ID is cleared. Use only a clean official source image: this is not a sanitizer for personally configured images, saved network profiles, SSH keys, or arbitrary files. Discard failed build output rather than flashing it as a completed image.

Flash the result, then follow [the short phone setup steps](quick-start.md#set-up-each-screen). A fresh already-networked Pi can instead run `sudo env OPENFRAME_SETUP_COUNTRY=US bash player/install.sh --prepare-setup`, followed by a reboot. This refuses an existing OpenFrame configuration/identity and is intended only for a dedicated screen.

The setup service uses NetworkManager on `wlan0`, a temporary 2.4 GHz WPA2 hotspot at `192.168.50.1`, and reserved profiles `openframe-setup` and `openframe-uplink`. It switches one radio from hotspot to client mode; it does not promise simultaneous AP/client access. Personal/open Wi-Fi is supported; enterprise authentication, hotel captive-portal login, and arbitrary network adapters are not implemented. The HDMI page shows a random hotspot password and Wi-Fi QR code. No automatic operating-system captive-portal popup is implemented; open the printed address manually.

## Enrollment and connection

1. The phone submits Wi-Fi information and a public **HTTPS** server origin. Optional Cloudflare Access headers are sent only to that origin. No administrator password is entered on the Pi.
2. The Pi saves root-only pending state before joining Wi-Fi, generates its WireGuard key locally, and persists a random enrollment token before contacting the server. Interrupted requests reuse that identity instead of allocating duplicate devices.
3. The server stores the public key and a hash of the device token. The screen shows a pairing code. No WireGuard settings or playlist content are delivered before ordinary administrator approval.
4. After approval, the server allocates one address from `.2` through `.254`, registers that public key, and returns its own public key, public endpoint, client address, private server origin, and a route limited to the server's `/32`.
5. The Pi installs the narrow WireGuard configuration, adds a route guard, verifies that traffic to the private origin actually routes over `wg-openframe`, and makes an authenticated request through it.
6. Only after that verification does it preserve the pairing under the private server origin, enable the persistent guard, remove temporary setup credentials, disable onboarding, and reboot into the normal player.

The managed path is VPN-only after setup, not merely a priority hint: it does not retain public HTTPS or Access credentials as an automatic fallback. The output guard rejects traffic to the private server address when it would leave through a different interface. It runs before the content agent so a missing VPN route cannot send its HTTP token onto a coincidentally matching LAN. Cached playback does not need a VPN handshake. The regular agent continues to poll for content and commands using its existing authenticated synchronization protocol.

If setup fails, the hotspot returns with a non-secret error on the display. Pending enrollment state survives a reboot. A later outage during normal operation does not automatically create a hotspot. There is no remote Wi-Fi recovery, key-rotation/reset UI, or automatic player/OS update service. If the public WireGuard endpoint's DNS address changes after connection, restarting the client's WireGuard service may be necessary to resolve it again.

## Security and revocation

The helper accepts validated peer lists, not shell commands. Its intended firewall policy allows clients to reach only the private OpenFrame TCP port and blocks forwarding to the home LAN, Internet, or other peers. OpenFrame authentication remains required. Validate these rules on the actual Docker host before trusting network isolation.

The app refreshes the peer list every 10 seconds. A helper-side 45-second lease, checked every five seconds, removes peers when control-plane refresh stops; command execution and scheduling can extend those timings. The helper starts without peers until the application authorizes them again. This fails closed for VPN access when the app/control channel is unavailable; players retain their local content cache.

The lease requires the helper process to be running. An uncatchable helper crash or forced kill can leave its kernel interface alive while the app still holds the shared namespace. Docker restart normally recreates the helper and clears peers, but this is not an independent kernel lease. If the helper cannot restart, stop both services to tear down the shared namespace; do not leave the app alone with an orphaned interface. Include this failure mode in deployment monitoring and acceptance testing.

Deleting a managed screen invalidates its OpenFrame token immediately and requests peer removal. If the helper cannot be reached, deletion can return 503 even though the device record is already gone. Refresh the UI; reconciliation, a running helper's lease expiry, or complete namespace teardown removes the remaining peer. Revocation cannot remotely erase offline cached media. Imported peers on an external VPN server still require manual revocation there.

The first-boot web form binds only to the temporary hotspot address, restricts Host/Origin, requires an unpredictable request token, limits payloads, and processes one setup at a time. Its HTTP connection is protected by the temporary Wi-Fi password, not TLS; anyone with physical access to the displayed password can join and configure an unprovisioned screen. Keep initial setup physically supervised. Pending Wi-Fi/Access settings and the temporary private key are root-only and removed on success; installed Wi-Fi and VPN credentials necessarily remain on the Pi. Never publish configured SD-card images or setup state.

## Backup and restore

Stop both services before a consistent backup. Preserve the full `openframe-data` volume (including any `provisioning.key` for imported configurations) **and** the `wireguard-state` volume containing `server-key.json`. Encrypt and restrict access to these backups. `wireguard-control` holds a transient Unix socket and does not need to be restored.

Restore the matching application and VPN state together. The app pins the helper's public key and subnet; unexpected changes produce a 503 and do not silently register old clients to a new identity. Restore the original state to recover. Intentional server-key or subnet changes currently require an operator-led reprovisioning process, not a UI toggle. Restoring an old database can restore old approvals: audit revoked devices before reconnecting the restored service.

## Acceptance checks

Before unattended deployment, use isolated test data and actual hardware:

- Build/start the stack on Linux, verify volume/socket permissions and kernel support, and check both services' health.
- Flash a clean Zero 2 W, verify the initial country setting, HDMI QR/password, phone-sized form, and setup with no preconfigured Wi-Fi.
- Enter a wrong Wi-Fi password; verify hotspot recovery. Interrupt power at enrollment and VPN activation; verify identity reuse and recovery without duplicate peers.
- Confirm unapproved players receive neither VPN settings nor content. Approve, inspect a real WireGuard handshake, and publish a playlist.
- Verify peers cannot reach the host LAN, one another, or the Internet through the server. Remove the Pi's VPN route and confirm its guard blocks private-origin traffic over LAN.
- Test offline cached playback, app/helper interruption, lease expiry, device deletion during helper failure, and restoration of matching/mismatched backups.
- Run the [playback soak tests](playback-testing.md) on Zero 2 W and Pi 4/5. Desktop tests do not establish memory use, boot time, or slide-transition performance on a Pi.

## References

- [WireGuard quick start](https://www.wireguard.com/quickstart/) and [network namespaces](https://www.wireguard.com/netns/).
- [NetworkManager nmcli](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html).
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).
