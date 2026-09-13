# Validation record

## Local revision 0.2.2

Checked on 2026-09-12, locally only. Optional managed WireGuard and hotspot onboarding are experimental, not a published appliance release.

- 80 Node tests passed, zero skipped, including real Python-agent integration and injected managed-VPN approval, allocation, retry, outage, revocation, and identity-pinning cases.
- 40 Python tests passed. First-boot country/AP commands, route guarding, public-to-private pairing preservation, enrollment retries, portal request boundaries, and existing agent/import paths use mocked privileged networking.
- Typecheck, lint, formatting, production build, three Pi shell syntax checks, version consistency, repository hygiene, documentation links, and Compose/CI YAML parsing passed.
- First-boot phone form passed at 900/390/320px. Screen setup/import/export and managed-status layouts passed at 1280/390/320px using an ephemeral database and fake credentials. Playlist picker regression passed at the same three sizes against mocked APIs. Screenshots were visually inspected for the phone form and setup views.
- The normal local preview reports version 0.2.2. No VPN service, router change, image publication, GitHub push, or deployment was performed.

Docker is unavailable in this Windows environment. Live WireGuard/iptables/network-namespace behavior, hotspot radio switching, image chroot/package installation, fresh Pi boot, and physical Zero 2 W/Pi 4/5 performance remain untested. CI's new helper build/binary checks have not been run remotely for this local revision. Complete the [managed VPN acceptance checklist](managed-wireguard.md#acceptance-checks), including forced-helper-failure recovery, before unattended use. No new dependency audit or independent security audit was performed for this revision.

## GitHub milestone 0.2.0

Local checks for the first GitHub milestone: 67 Node tests (including real Python-agent integration), 32 Python tests, lint, typecheck, production build, version/repository checks, and production dependency audit passed. The production audit reported zero advisories at check time.

The new workflow adds native AMD64 and ARM64 Docker health, persistence, SQLite startup, and image-codec checks before image publication. Consult the [actual Actions runs](https://github.com/veRoduS/OpenFrame/actions) for remote results; adding a workflow is not proof it passed. Physical Pi testing remains outstanding. This milestone builds a server container and Compose artifact, not a tested SD-card image or containerized HDMI kiosk.

## Local baseline 0.1.1

Local release-preparation revision: **0.1.1**, checked on **2026-09-09**. These results describe this source revision, not a published GitHub release or a certified appliance image.

| Check | Result |
| --- | --- |
| Node test suite with real Python agent integration | 65 passed, zero skips |
| Python agent and WireGuard provisioning suite | 32 passed; system networking mocked |
| TypeScript, Oxlint, production Vite build | Passed |
| Isolated locked dependency installation | Passed on Windows with Node 24 / pnpm 11.19.0 |
| Playlist picker browser regression | Passed at 1280px, 390px, and 320px using Edge with mocked API fixtures |
| Local server health | HTTP 200, version 0.1.1 |
| Package/player/changelog consistency | Passed |
| Candidate-file hygiene and local documentation links | Passed; not a comprehensive secret scan |
| Pi shell syntax and Compose/CI YAML parsing | Passed; not runtime validation |
| npm advisory audit through pnpm, including development dependencies | Zero reported advisories at check time; not a security audit |

## Still required

- Execute the newly added GitHub CI workflow after the first approved publication.
- Build/start Docker on a Docker host and rehearse volume backup/restore and upgrades. Docker was not available in this development environment.
- Provision and soak-test a physical Raspberry Pi/Zero 2 W, including real networking, display timing, memory, and offline reboot behavior.
- Validate actual Cloudflare and WireGuard deployments; unit/integration test doubles are not proof of those external services.
- Review staged content and dependency licenses, configure a real Git author/repository, and approve the milestone before publishing.

Repeat the [release checklist](releases.md#pre-publication-checklist) for every milestone. Do not reuse this dated record as evidence for a later version.
