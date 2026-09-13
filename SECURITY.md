# Security

OpenFrame is pre-1.0 software. There is no independent security audit, long-term-support branch, or guaranteed response SLA. Security fixes target the latest maintained milestone; older versions may require an upgrade of both server and player.

## Reporting vulnerabilities

Do not open a public issue containing exploit details, credentials, private media, databases, or player identities. Private vulnerability reporting is enabled for [veRoduS/OpenFrame](https://github.com/veRoduS/OpenFrame/security/advisories/new). Use **Security > Report a vulnerability**. If that action is unavailable, ask the maintainer to establish a private reporting channel without disclosing the vulnerability. No private email address is configured in this source tree.

Include affected server/player versions, deployment mode, impact, minimal reproduction, and a proposed fix if available. Redact administrator passwords, cookies, device tokens, Cloudflare credentials, WireGuard keys, Wi-Fi passwords, and private hostnames.

## Deployment boundaries

- Optional [managed WireGuard and hotspot onboarding](docs/managed-wireguard.md) adds an explicitly enabled root Pi setup service and a separate network-capable Docker helper. The Pi retains its private key; public HTTPS enrollment and administrator approval precede peer registration. The temporary Wi-Fi form requires physically displayed credentials and must be supervised. Its HTTP page is not TLS-protected. Native firewall/hotspot behavior still needs real-host validation; do not infer isolation from mocked tests.
- Managed VPN backups include the private `wireguard-state/server-key.json` as well as application data. Restore matching state, encrypt backups, and never commit it or configured images. Managed screen deletion requests peer revocation, with lease expiry as a fallback if the helper is unavailable; external imported VPN peers still require manual revocation.
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

## Screen provisioning vault

The optional [screen setup builder](docs/screen-setup.md) accepts WireGuard client keys, Wi-Fi passwords, and Cloudflare service tokens through administrator-only endpoints. Use a protected management connection. These secrets are encrypted in SQLite using AES-256-GCM; allocation metadata stays plaintext. `DATA_DIR/provisioning.key` is generated with mode 600 on POSIX and must be included in restricted, externally encrypted backups. On Windows, protect the data directory with appropriate ACLs. This is not protection against a compromised server or access to both the database and its adjacent key.

Explicit administrator ZIP downloads contain plaintext secrets and are marked no-store. Do not share ZIPs, extracted files, or configured SD images. A downloaded client belongs to one screen; copying it onto multiple devices can cause address/key conflicts. Issued setups are retained for re-download and currently have no purge or key-rotation UI. Revoke leaked/retired peers and service tokens on their respective servers; OpenFrame device revocation is separate. Imported configs cannot contain WireGuard shell hooks, and the unprivileged Pi agent never reads the root-owned WireGuard key.
