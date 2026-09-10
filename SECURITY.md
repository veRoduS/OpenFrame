# Security

OpenFrame is pre-1.0 software. There is no independent security audit, long-term-support branch, or guaranteed response SLA. Security fixes target the latest maintained milestone; older versions may require an upgrade of both server and player.

## Reporting vulnerabilities

Do not open a public issue containing exploit details, credentials, private media, databases, or player identities. Once the repository is published and private vulnerability reporting is enabled, use its **Security > Report a vulnerability** action. If that action is absent, ask the maintainer in a public issue to establish a private reporting channel without disclosing the vulnerability. No private email address or reporting endpoint has been configured in this source tree.

Include affected server/player versions, deployment mode, impact, minimal reproduction, and a proposed fix if available. Redact administrator passwords, cookies, device tokens, Cloudflare credentials, WireGuard keys, Wi-Fi passwords, and private hostnames.

## Deployment boundaries

- Complete first-administrator setup on a trusted LAN or behind an Access policy before making a hostname public. The first caller can initialize an unconfigured server. Passwords require 12-256 characters; there is one administrator, no MFA/roles, and no password-reset UI.
- Use HTTPS for off-site access, or HTTP strictly inside your WireGuard tunnel/trusted LAN. Set `PUBLIC_URL` to the exact public origin and `COOKIE_SECURE=true` when using HTTPS. Do not disable certificate verification.
- Cloudflare Tunnel supplies connectivity; Access policies supply an additional access boundary. An unattended player needs Service Auth, not an interactive login. Keep OpenFrame pairing enabled in either case.
- Do not forward the Pi's local service. It binds to loopback; players initiate connections to the server. Physical access to an SD card can reveal cached content and device credentials.
- Revocation takes effect only when a device reaches the server. It cannot remotely erase content on an offline or stolen device. Rotate separate Cloudflare/WireGuard credentials when removing a device.
- Widgets are trusted application source, not sandboxed third-party plugins. Do not add arbitrary script or remote HTML execution.
- Rate limits are process-local and proxy requests may share a bucket. They are not a substitute for an edge policy, firewall, or abuse protection. Do not enable arbitrary proxy trust to bypass this.
- Backups contain passwords' hashes, session/device records, media, and publication history. Restrict access and encrypt backups at rest. Provisioning JSON and configured images may contain plaintext secrets.
- Maintain the Pi OS, Chromium, Docker host, Node dependencies, and optional VPN/tunnel packages. OpenFrame does not install fleet security updates automatically.

Ignore rules and `pnpm repository:check` catch known private filenames, not every possible secret. Review staged content and enable GitHub secret scanning/push protection where available. If a credential enters Git history, revoke it first; deleting the current file does not remove it from history.
