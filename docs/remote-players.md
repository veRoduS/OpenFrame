# Off-site players through Cloudflare Tunnel

Already have a WireGuard server? [WireGuard drop-in provisioning](wireguard-players.md) is a separate supported option; each player can use the appropriate server address for its chosen transport.

OpenFrame's server can stay at home while players run on other Internet connections. The player uses your HTTPS hostname for enrollment, heartbeats, and downloads. No VPN client or cloudflared process is needed on the Pi. The framework-free renderer still plays cached files locally.

```text
Remote Pi -- HTTPS --> Cloudflare --> Tunnel --> OpenFrame at home
                         |
                 Optional Access policies
```

The home connector initiates outbound connections, so this arrangement does not need a publicly forwarded OpenFrame port. Cloudflare proxies the traffic; your application, database, and original media stay on your home server. See [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) and [published application routing](https://developers.cloudflare.com/tunnel/routing/).

## Two different credentials

- The **tunnel token** is used only by cloudflared on the home server. It connects that server to your Cloudflare account. Never put it on players.
- An optional **Access service token** is used by a player to pass an Access policy protecting the hostname. It has a Client ID and Client Secret. The player additionally uses its own OpenFrame pairing token; these are separate authentication layers.

Tunnel alone provides connectivity, not an Access login policy. If you enable Access, add an administrator Allow policy for your identity and a Service Auth policy for player service tokens. An ordinary interactive login policy cannot authenticate an unattended player. Each player should have a separate service token so its access can be revoked independently. Configure the normal two-header method, not an Authorization-header override: OpenFrame already uses Authorization for its own device token. [Cloudflare service-token configuration](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

## Existing tunnel

If cloudflared is already running at home, there is no need to create a second tunnel. Add a published application route for your chosen hostname, with no path restriction, pointing at the OpenFrame HTTP service reachable from that connector. Examples:

| Connector location | Origin service |
| --- | --- |
| Same Docker network as an `openframe` service | `http://openframe:3100` |
| Directly on the same host as the local Node server | `http://127.0.0.1:3100` |
| Another machine on the home LAN | `http://SERVER_LAN_IP:3100` |

Inside a container, localhost refers to that container, not the host computer. Make sure the selected origin is reachable from cloudflared. Set these environment variables on OpenFrame itself and restart it:

```dotenv
PUBLIC_URL=https://openframe.example.com
COOKIE_SECURE=true
```

Replace the example with your real HTTPS hostname. Access the management UI through that hostname afterward; writes from an unrelated localhost/LAN origin are intentionally rejected. Do not expose port 3100 publicly or disable certificate checking on players.

## Included Docker deployment

`compose.cloudflare.yaml` is a standalone alternative to `compose.yaml`. It runs OpenFrame plus a remotely managed cloudflared connector, publishes no host ports, and uses the same `openframe-data` volume declaration. Do not merge it with the LAN Compose file, which would retain its port mapping.

1. In Cloudflare, create the Access application and administrator policy first, before exposing a fresh OpenFrame installation. If not using Access, initialize OpenFrame privately before making its hostname public.
2. Create a remotely managed Cloudflare Tunnel. Put its connector token in `.secrets/cloudflare-tunnel-token` on the home server as a single line. This is a local secret file, not an API token or a player's Access credential. Keep it out of chat, Git, Docker images, and public archives.
3. Set `OPENFRAME_PUBLIC_URL` in `.env.cloudflare` using `deploy/cloudflare.env.example` as the format. Use your real HTTPS hostname. This local environment file is ignored by Git.
4. In the tunnel's published application routes, map that exact hostname to HTTP service `openframe:3100`. Cloudflare manages the external HTTPS endpoint; the HTTP hop is confined to the Docker network.
5. Validate and start from the project directory:

```sh
docker compose --env-file .env.cloudflare -f compose.cloudflare.yaml config
docker compose --env-file .env.cloudflare -f compose.cloudflare.yaml up -d --build
```

Create the OpenFrame administrator password through the protected hostname before distributing player credentials. Then complete normal pairing and playlist assignment.

The connector reads its token from a mounted Docker secret, using cloudflared's [token-file option](https://developers.cloudflare.com/tunnel/advanced/run-parameters/). On Linux, use a private `.secrets` directory (mode 700), with the token file readable by the container's non-root user. One option is file mode 444 inside that private directory. Docker Compose file-backed secrets preserve source permissions; setting `mode` in Compose does not change them. On Windows, restrict the host directory with its ACLs and use Docker's Linux-container mode. [Docker secret permissions](https://docs.docker.com/reference/compose-file/services/#secrets).

Keep the same Compose project name when switching an existing Docker installation, so it continues to use the same named volume. Do not use `down -v`. The desktop Node server's `./data` directory is separate from a Docker named volume; this deployment does not automatically migrate that development database. Back it up consistently and migrate it deliberately before replacing the development installation.

## Configure an off-site player

Without an Access application, only `server` and `name` are needed. With Access enabled, the configuration is:

```json
{
  "server": "https://openframe.example.com",
  "name": "Off-site lobby",
  "cloudflare_access": {
    "client_id": "PLAYER_SERVICE_TOKEN_CLIENT_ID",
    "client_secret": "PLAYER_SERVICE_TOKEN_CLIENT_SECRET"
  }
}
```

Use your actual hostname. Provide this configuration to the installer or image builder. The updated installer retains the Access credentials in `/etc/openframe/config.json` with root ownership, group `openframe`, and mode 640. The first-boot script removes them from the boot-partition JSON after successful installation. The original configured image and configuration still contain secrets; treat them as private. Do not publish a flash image containing real service tokens.

For an existing Pi, update `agent.py` and the complete player files, then edit the installed configuration and restart `openframe-agent`. Changing from the old LAN server URL to the new HTTPS origin requires pairing again. Rotating only the Access credentials for the same server URL retains the OpenFrame pairing.

Check connectivity on the Pi before enrollment or before sending it to the remote site:

```sh
sudo -u openframe python3 /opt/openframe/agent.py --config /etc/openframe/config.json --check-connection
```

This checks the health endpoint using the configured Access credentials and normal certificate validation. It does not enroll a device, create a cache, or print secrets. A successful result includes `reachable: true`. Then restart the agent, approve its displayed code in OpenFrame, and assign a published playlist. Repeat the connectivity check on the remote network, such as a phone hotspot, rather than testing only at home.

The agent sends both Access headers on every server request, including health checks, enrollment, sync, and media downloads. They are never sent to the localhost browser renderer. Redirects to a different origin, including HTTPS-to-HTTP downgrades, are rejected before forwarding credentials.

## Operation and troubleshooting

- Access and OpenFrame are separate gates. Access admission does not make a player an OpenFrame administrator or approve its pairing.
- An Access 401/403 response, expired service token, tunnel outage, or home Internet failure leaves the last complete cached playlist available. Only OpenFrame's explicit invalid-device response clears pairing and stops playback. Manage Access-token expiry and rotation before a screen is left unattended.
- A login redirect or HTML response instead of JSON usually indicates an Access policy or browser challenge. Headless players cannot complete interactive login or bot challenges. Verify the Service Auth policy and the headers before weakening other security settings.
- Bypass CDN caching for this hostname's `/api/*` and `/media/*`; do not use a Cache Everything rule over authenticated content. The local player retains its own verified media cache.
- A 502 from Cloudflare usually requires checking the connector-to-origin address, Docker network, and whether OpenFrame is healthy. The service URL must point at the application, not back at its public hostname.
- Changing slides still uses local files. Home upload bandwidth affects new publication downloads, not every slide transition. The current complete frame stays visible until its replacement is prepared.
- Run `docker compose --env-file .env.cloudflare -f compose.cloudflare.yaml logs --tail=100 cloudflared openframe` on the home server, and inspect `journalctl -u openframe-agent` on the Pi for failures. Avoid debug request-header logging when credentials are in use.

No Cloudflare account, DNS route, Access policy, or tunnel has been created automatically by these project changes. Docker/Tunnel operation and a real off-site Pi need deployment verification; automated tests cover the application-side headers, origin rules, credential preservation, and connection diagnostic.
