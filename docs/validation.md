# Validation record

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
