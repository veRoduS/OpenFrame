# Codex Cloud

OpenFrame can be developed in Codex Cloud from its GitHub repository. Cloud tasks use isolated workspaces, so local changes and commits are not automatically shared with this checkout. Treat GitHub as the handoff point and review each task's diff before integrating it.

## Create the environment

1. In Codex, choose **Work in > Cloud > Create environment**.
2. Connect GitHub if prompted, then select `veRoduS/OpenFrame`.
3. Let Codex inspect the repository and prepare dependencies. Confirm Node.js 24, pnpm 11.19.0, and Python 3.9 or newer are available.
4. In the setup conversation, ask Codex to run `pnpm install --frozen-lockfile`, the Node and Python tests, lint, typecheck, and production build. Review the setup results; Docker and physical Raspberry Pi acceptance require separate hardware/runner access.
5. Publish the environment. Start future tasks from this published environment and ask Codex to work from the current `main` branch unless a different branch is intentional.

An install script can be recorded by Codex after it verifies setup. Do not add personal credentials, production databases/media, or real provisioning files to the repository or environment image. Add secrets only through the environment's secret settings, with the narrowest required access. Most development and verification do not need application secrets.

## Working and publishing

- Ask Codex to make changes on a task branch and report tests and hardware checks separately. Inspect the diff and run the repository checks before merging.
- Keep ordinary revisions as local/task commits. Each completed logical fix gets one patch bump and changelog entry using `pnpm version:patch "Summary"`.
- Do not push routine patch commits to `main`. An explicitly approved GitHub milestone uses `pnpm version:milestone --milestone-approved "Summary"`; this increments the minor version, resets the patch to zero, and publishes the accumulated history. Major versions require a separate explicit owner request.
- Preserve patch commits and never squash, reset, or force-push without approval. A pull request or cloud task is not, by itself, authorization to publish a milestone.
- Before a milestone, follow [the release checklist](releases.md) and [the validation record](validation.md). The tagged GitHub workflow validates and publishes server images; it does not deploy them or update installed player code.

Cloud validation does not establish Raspberry Pi performance, display behavior, Wi-Fi roaming, Docker acceptance if unavailable in the environment, or other hardware-specific claims. Record those limitations instead of marking them passed.
