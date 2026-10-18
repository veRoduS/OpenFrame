# Project health punchlist

Review started October 17, 2026 (America/Chicago), from local commit `ad73b70`.
Scope: tracked source, dependencies, automated checks, player resource lifecycle,
upload consistency, and documentation. Changes stay local. This is a targeted
engineering review, not a claim of exhaustive security or hardware acceptance.

| ID | Priority | Finding and intended result | Owner | Status |
| --- | --- | --- | --- | --- |
| H1 | High | Bound multipart text fields/parts as well as files; invalid uploads return 4xx. A tiny image plus 10 MiB of unused fields previously succeeded. | Sol 6.1, server | Done; limit and normal-upload regressions pass |
| H2 | High | Roll back image metadata/grants and remove the new file after a failed save. An injected database failure previously left an orphan file. | Sol 6.1, server | Done; asset/grant fault-injection checks pass |
| H3 | Medium | Tolerate missing font files and preserve metadata when unlink unexpectedly fails. | Sol 6.1, server | Done; missing-file and retry checks pass |
| H4 | High | Bound Pi API JSON responses to Android's 4 MiB limit and preserve the cached publication after rejection. | Sol 6.1, player | Done; exact-limit and oversized-response checks pass |
| H5 | Medium | Release player font faces when no visible/prepared frame uses them, including cancelled pending loads. | Sol 6.1, player | Done; unit and real-font browser checks pass |
| H6 | Medium | Ignore stale editor font-load completions after deletion/replacement or unmount. | Luna, frontend | Done; deferred-load browser regression passes |
| H7 | High | Patch source-map-js and formatter/tinypool; remove shadcn's unused CLI dependency tree, including vulnerable braces and MCP SDK. | Root + Luna | Done; full and production audits report zero advisories |
| H8 | Medium | Require FFmpeg, dependency audit, Chromium regressions, and Android JVM checks in CI. | Sol 6.1, automation + Root | Configured and locally validated; GitHub execution awaits an authorized push |
| H9 | Low | Remove the one-off 0.16.0 publication retry workflow; retain current release workflows. | Root | Done |
| H10 | Medium | Correct stale current-state documentation and record repeatable maintenance/acceptance checks. | Root | Done |
| H11 | Low | Replace leftover image-only library/search/batch/delete wording now that the library supports video. | Root | Done |

## Verification and reduction

Local server **0.24.2** and player **0.10.16**: 228 Node tests, 97 Python tests,
33 native Java tests, and ten Chromium suites pass. Browser coverage includes
both font lifecycles, video/startup/transitions, uploads/editor locks, selection,
workspace flows, and responsive layouts. A clean frozen install, lint, TypeScript,
production build, shell syntax, version/repository checks, and explicit
compatibility review pass. See the [validation record](validation.md).

The audit initially reported five development-tool advisories across braces,
source-map-js, tinypool, and MCP SDK. The advertised braces fix was not available
from the registry. Instead of retaining the unused generator, the application now
owns the eight CSS variants it uses, with the upstream MIT notice. Oxfmt 0.70.0
uses patched tinypool 2.1.2; source-map-js is 1.2.2. The audit package total drops
from **529 to 301**. Both full and production-only audits report zero known
vulnerabilities at this review. No runtime dependency family was upgraded.

An adapted local amd64 Docker build passes with the environment CA mounted only
during networked steps. Network-isolated runtime checks verify login, real video
optimization, poster/media integrity, container replacement, and stopped-volume
backup/restore. Disposable containers, volumes, and archives were removed; no
deployment or publication occurred.

## Keep deliberately

- Account migrations, old player schema support, and the small `create-superadmin`
  compatibility alias still protect existing installations.
- Release notes, changelogs, and compatibility review history provide an audit
  trail; age alone is not a reason to remove them.
- Direct dependencies initially had source/configuration references. The shadcn
  dependency was removed after replacing its sole CSS import; `components.json`
  remains for intentional generator use. Other packages retain live consumers.
- Ignored `node_modules`, `work`, and `dist` are local dependencies, test tools,
  screenshots, and build outputs. They are excluded from source and container
  context. Do not confuse these with application payload or delete private data,
  signing keys, or immutable APK archives during cleanup.

## Acceptance outside this source cleanup

- Physical Onn/Pi video and offline power-cycle testing, including a 24-hour run.
- Signed APK build/installation with the existing key.
- Native ARM64 container acceptance and execution of the updated GitHub CI jobs;
  local amd64 build/start and backup/restore checks have passed.
- Consider extracting cohesive editor/server modules when modifying those areas;
  avoid a broad rewrite of large working modules solely to reduce line counts.
