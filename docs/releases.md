# Versioning and releases

## Policy

OpenFrame versions its server/web app and installed players independently. `package.json` and the root `CHANGELOG.md` track the server; `player/version.json` and `player/CHANGELOG.md` track the player release shared by the Pi agent and Android app. Android builds read the player version directly, and the player version tool synchronizes the Pi agent. A server-only change does not require an APK or player bump; a player-only change does not require a server bump. For example, server 0.10.4 and player 0.10.3 can be compatible.

Each component uses three numeric components with a project-specific cadence. Feature size alone does not choose the version component:

| Work | Example | Publication |
| --- | --- | --- |
| Completed routine revision, feature, documentation change, or bug fix | `0.1.1` -> `0.1.2` | Source stays local; signed APKs may use the authorized publication path below |
| Owner-approved GitHub milestone | `0.1.12` -> `0.2.0` | Explicit push after review |
| Owner-requested major release | `0.8.4` -> `1.0.0` | Explicitly approved major publication |

Patch resets at each minor milestone. Minor and patch reset at each major release. After 1.0.0 the same rules apply, for example `1.2.3` -> `1.3.0`. Breaking changes do not automatically authorize a major version; document compatibility and ask the owner. This is not strict feature-based Semantic Versioning.

Source patch commits accumulate locally and are included in the next milestone's pushed history. Server milestone tags end in `.0`; APK archives can publish player patch versions under the owner's separate authorization. A failed publication retried for the **same unchanged version** is not another version bump. Do not push an unprepared source patch just to trigger CI or back up work; use private local/offline backups instead. Contributor pull requests are grouped into agreed milestones, with the maintainer assigning the integrated version.

The initial `0.1.0` source was an unpublished development baseline. The GitHub-preparation revision is recorded as local `0.1.1`; the first approved GitHub milestone is `0.2.0`. Repository: [veRoduS/OpenFrame](https://github.com/veRoduS/OpenFrame), default branch `main`. Version tools themselves never create a remote, commit, tag, or publish.

## Local revisions

Finish and verify the logical change, then run once for each component that changed:

```sh
pnpm version:patch "Describe the server/web change"
pnpm version:player:patch "Describe the Pi/Android player change"
pnpm version:check
```

Run only the applicable bump command when one component changes. The server command updates `package.json` and `CHANGELOG.md`; the player command updates `player/version.json`, the standalone Python agent version, and `player/CHANGELOG.md`. The UI and server read the package version. Existing players continue reporting their installed version until updated. The lockfile does not store this workspace's version and needs no bump-only rewrite. Review all changes and make a local commit. Do not use `npm version`, which can automatically commit/tag, or edit version literals separately.

Run `pnpm compatibility:check` before release. It flags changes to the server/player contract sources or declared protocol support since the latest engineering review. Investigate their impact on the other component, run affected tests, and record the result after the final source changes and version bumps:

```sh
pnpm compatibility:review --impact compatible "Summarize the contracts reviewed and relevant test evidence"
pnpm compatibility:check
```

Use `--impact breaking` for a migration and document the minimum compatible component versions and upgrade order. Never refresh the record automatically to silence a failing check. The history in `compatibility.json` records independent versions, protocol support, summaries, and source fingerprints; it does not prove device compatibility or negotiate versions at runtime. See [server/player compatibility](player-compatibility.md) for the full workflow. A version-number-only change does not itself require a new compatibility review.

## Approved milestone preparation

Only after the owner approves a GitHub milestone:

```sh
pnpm version:milestone --milestone-approved "Summarize the milestone"
```

For an approved player milestone, use `pnpm version:player:milestone --milestone-approved "Summarize the player milestone"`. Do not bump the unchanged counterpart just to match numbers.

For a major release, only on an explicit owner request:

```sh
pnpm version:major --major-approved "Summarize the requested major release"
```

The player equivalent is `pnpm version:player:major --major-approved "Summarize the requested player major release"`.

Flags prevent accidental invocation; they do not authorize an assistant or contributor to make its own release decision. Version tools only edit local files. None of these version commands commits, tags, pushes, creates releases, or modifies deployment state. Expand the applicable changelog section into release notes summarizing accumulated changes and compatibility requirements. Keep historical patch entries.

## Android APK publication

The owner has authorized new signed Android builds to be published to the existing `veRoduS/OpenFrame` repository on the dedicated `android-releases` branch. This authorization covers APKs and public release metadata only; it does not authorize pushing source branches/tags, publishing server images, or deploying a server. The source branch continues to ignore generated APK output.

The publication branch contains:

| Path | Purpose |
| --- | --- |
| `apks/VERSION/openframe-player.apk` | Immutable APK archive for a player version |
| `apks/VERSION/release.json` | Checksum, version, requirements, source revision, and compatibility review metadata |
| `apks/latest/openframe-player.apk` | Stable direct download used by the landing page |
| `apks/latest.json` | Latest release metadata consumed by the server's Android update source |

[Browse APKs](https://github.com/veRoduS/OpenFrame/tree/android-releases/apks) or [download the latest APK](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk). Android still requires installation approval; preserve the existing release signing key for in-place updates.

After tests, the relevant version bump, compatibility review, and a reviewed local source commit:

```sh
pnpm build:android
```

The command builds and verifies the signed APK, writes local files under `outputs/android/`, and publishes the allowlisted files through a temporary checkout of the APK branch. Publication requires clean, committed source, a current compatibility review, normal GitHub write credentials, and configured Git author details. The artifact must come from the current source commit and pass SDK checks for its package/version, alignment, and the public signing-certificate pin in `player/android/release-signing.json`. It never force-pushes or pushes the source branch. A previously published version cannot be replaced with different APK bytes; bump the player version for a changed build. Latest cannot move backward to an older version.

Use `pnpm build:android --local` to keep a development build local, adding `--sdk` when using the documented SDK-only fallback. If upload fails, the local files remain available; fix the cause and run `pnpm publish:android` to retry those exact files without rebuilding. Source work can be committed locally without being pushed.

`.github/workflows/publish-android.yml` runs after an approved source push changes `player/version.json`, the Android app build configuration, or the publisher workflow on `main`, or by manual dispatch. It checks versions, compatibility, and tests, then builds and publishes a player version that has not already been archived. A server-only version change does not trigger it. The job uses the `android-releases` GitHub environment and a `GITHUB_TOKEN` with `contents: write` for the publication branch.

Configure these environment or repository secrets using the **existing** Android release key:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded existing release keystore |
| `ANDROID_STORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Existing signing alias |
| `ANDROID_KEY_PASSWORD` | Signing-key password |

The workflow also accepts the existing `OPENFRAME_ANDROID_KEYSTORE`, `OPENFRAME_ANDROID_STORE_PASSWORD`, `OPENFRAME_ANDROID_KEY_ALIAS`, and `OPENFRAME_ANDROID_KEY_PASSWORD` secret names as aliases, with valid `ANDROID_*` names taking precedence. Keystore aliases are tried in order and accepted only when their decoded file opens with the configured store password and matches the pinned release signer; an invalid keystore alias does not hide a valid alternate. The GitHub `OPENFRAME_ANDROID_KEYSTORE` secret must contain base64-encoded file contents, not a local keystore path.

The workflow decodes the key only into the runner's temporary directory and removes it at completion. Do not place keys or passwords in repository files or APK metadata. Missing signing secrets block the workflow; generating a replacement key would prevent existing installations from accepting updates. See [Android builds and updates](android-tv.md) for local signing variables, platform tests, and physical-device acceptance.

## Pre-publication checklist

- For source milestones, confirm the exact GitHub owner/repository, visibility, default branch, and milestone approval. The separately authorized APK publisher targets `veRoduS/OpenFrame` and `android-releases`; a fork must deliberately configure its own publication target and download URLs.
- Run every [contributor check](../CONTRIBUTING.md#verification), including Python integration, `pnpm compatibility:check`, and `pnpm repository:check`. Review the entire staged diff and all staged filenames for secrets/private assets, including files already tracked before an ignore rule existed.
- Test a clean locked dependency install. Build and boot the Docker deployment, verify health, initial administrator setup, media persistence across replacement, and a stopped-volume backup/restore. CI includes a container smoke job, but its first remote run is still required.
- Run the [physical-player checklist](playback-testing.md) on the supported OS/device, including Zero 2 W before claiming support/performance. Record OS architecture, browser version, memory, long-run transitions, and offline behavior. If not tested, mark the release experimental and explicitly list the gap; do not publish a hardware-validated image claim.
- Review dependency advisories/licenses and any redistributed artwork. Run `pnpm audit --prod` with registry access; triage findings before release, not blind major dependency upgrades.
- Include upgrade/rollback steps, server/player compatibility, and any configuration/schema changes. Distinguish software versions from playlist revisions and manifest schemaVersion.
- Review `git status`, commit the milestone locally, and create an annotated version tag matching `package.json`. Never replace an existing published tag.

## First GitHub publication

The original source started with no remote and no commits; its local baseline is now recorded. For a fresh independent repository, local history can be started with reviewed files using these **manual operator commands**, not instructions to publish without approval:

```sh
git add .
git diff --cached --stat
git diff --cached
git commit -m "Prepare OpenFrame local baseline"
```

Set Git author name/email yourself if not configured; do not invent another person's identity. The ignore rules protect known private files but are not a general secret detector. Review before committing. Create an empty GitHub repository without a generated README/license to avoid unrelated starting history. Add the URL chosen by the owner with `git remote add origin REPOSITORY_URL`, then verify `git remote -v`.

After the approved version bump and milestone commit, create a tag such as `git tag -a v0.2.0 -m "OpenFrame 0.2.0"`. Check `git show v0.2.0:package.json` and ensure `git status --short` is empty. Push the selected branch and **that exact tag** explicitly, for example `git push --atomic origin HEAD refs/tags/v0.2.0`. This example assumes the local branch name is the intended remote branch; verify before executing. Do not force-push or use `--tags` to publish unrelated tags.

Wait for CI to pass, then manually draft/publish the GitHub Release from that tag with the reviewed notes. While hardware acceptance is incomplete, mark it as a prerelease/experimental. Do not attach configured Pi images, private JSON, data, or local workspace ZIPs. GitHub's tag source archives contain committed files. For a local source ZIP use `git archive --format=zip --prefix=openframe-0.2.0/ --output=outputs/openframe-0.2.0-source.zip v0.2.0` after creating `outputs/`; archive the reviewed tag, never the whole working directory.

Enable private vulnerability reporting before inviting security reports. See [GitHub's configuration guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-for-a-repository). Configure branch protection to require successful checks and review; enable secret protection where available. Keep verification workflow permissions read-only; only the image publishing job receives `packages: write`, and the Android publication job receives `contents: write` to update its APK branch. Repository settings must be applied on GitHub and cannot be enabled by adding documentation alone.

CI runs on incoming branch pushes/PRs, manual dispatch, and calls from the publication workflow. The verification workflow does not originate pushes or publish releases/images. The separate [milestone image workflow](container-images.md) accepts `vX.Y.0` tags, runs CI against the tagged commit including native ARM64/AMD64 Docker checks, then publishes images and a Compose artifact. Server version tags must match the package and have a zero patch; the player version is independent. There is no image publishing on ordinary branch/PR activity and no automatic deployment. The separate Android workflow follows the APK policy above. Local source patches alone trigger no remote workflow, though an authorized local Android build can publish APKs directly. GitHub Releases normally remain manual. The owner-approved 0.16.0 and 0.17.0 milestones are explicitly allowlisted in the image workflow to publish its reviewed notes and digest-pinned Compose ZIP as the latest GitHub Release after image verification. This does not authorize automatic GitHub Releases for future milestones.

The workflow uses GitHub's maintained [checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), and [Python setup](https://github.com/actions/setup-python) actions, plus Docker's [multi-platform build actions](https://docs.docker.com/build/ci/github-actions/multi-platform/).
