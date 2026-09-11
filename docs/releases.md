# Versioning and releases

## Policy

OpenFrame uses three numeric components with a project-specific cadence. Feature size alone does not choose the component:

| Work | Example | Publication |
| --- | --- | --- |
| Completed routine revision, feature, documentation change, or bug fix | `0.1.1` -> `0.1.2` | Local only |
| Owner-approved GitHub milestone | `0.1.12` -> `0.2.0` | Explicit push after review |
| Owner-requested major release | `0.8.4` -> `1.0.0` | Explicitly approved major publication |

Patch resets at each minor milestone. Minor and patch reset at each major release. After 1.0.0 the same rules apply, for example `1.2.3` -> `1.3.0`. Breaking changes do not automatically authorize a major version; document compatibility and ask the owner. This is not strict feature-based Semantic Versioning.

Patch commits accumulate locally and are included in the next milestone's pushed history. Users receive a milestone tag ending in `.0`, not a public release per patch. A failed push retried for the **same unchanged milestone** is not another version bump. Do not push an unprepared patch just to trigger CI or back up work; use private local/offline backups instead. Contributor pull requests are grouped into agreed milestones, with the maintainer assigning the integrated version.

The initial `0.1.0` source was an unpublished development baseline. The GitHub-preparation revision is recorded as local `0.1.1`; the first approved GitHub milestone is `0.2.0`. Repository: [veRoduS/OpenFrame](https://github.com/veRoduS/OpenFrame), default branch `main`. Version tools themselves never create a remote, commit, tag, or publish.

## Local revisions

Finish and verify the logical change, then run once:

```sh
pnpm version:patch "Describe the completed change"
pnpm version:check
```

The script updates `package.json`, the standalone Python agent version, and `CHANGELOG.md`. The UI and server read the package version. Existing Pi installations continue reporting their installed version until updated. The lockfile does not store this workspace's version and needs no bump-only rewrite. Review all changes and make a local commit. Do not use `npm version`, which can automatically commit/tag, or edit version literals separately.

## Approved milestone preparation

Only after the owner approves a GitHub milestone:

```sh
pnpm version:milestone --milestone-approved "Summarize the milestone"
```

For a major release, only on an explicit owner request:

```sh
pnpm version:major --major-approved "Summarize the requested major release"
```

Flags prevent accidental invocation; they do not authorize an assistant or contributor to make its own release decision. Tools only edit local files. Neither command commits, tags, pushes, creates releases, or modifies deployment state. Expand the new changelog section into release notes summarizing all accumulated changes and compatibility requirements. Keep historical patch entries.

## Pre-publication checklist

- Confirm the exact GitHub owner/repository, visibility, default branch, and milestone approval. No real hostname, owner, or remote URL is hardcoded in these templates.
- Run every [contributor check](../CONTRIBUTING.md#verification), including Python integration, and `pnpm repository:check`. Review the entire staged diff and all staged filenames for secrets/private assets, including files already tracked before an ignore rule existed.
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

Enable private vulnerability reporting before inviting security reports. See [GitHub's configuration guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository). Configure branch protection to require successful checks and review; enable secret protection where available. Keep verification workflow permissions read-only; only the image publishing job receives `packages: write`. Repository settings must be applied on GitHub and cannot be enabled by adding documentation alone.

CI runs on incoming branch pushes/PRs, manual dispatch, and calls from the publication workflow. It does not originate pushes or publish releases/images. The separate [milestone image workflow](container-images.md) accepts `vX.Y.0` tags, runs CI against the tagged commit including native ARM64/AMD64 Docker checks, then publishes images and a Compose artifact. Version tags must match the package and have a zero patch. There is no image publishing on ordinary branch/PR activity and no automatic deployment. Local-only patches trigger neither workflow. GitHub Releases remain manual.

The workflow uses GitHub's maintained [checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), and [Python setup](https://github.com/actions/setup-python) actions, plus Docker's [multi-platform build actions](https://docs.docker.com/build/ci/github-actions/multi-platform/).
