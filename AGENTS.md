# Working on OpenFrame

- Keep ordinary work local. Do not push, create a GitHub repository/release, publish packages/images, or run a deployment unless the owner explicitly authorizes that milestone.
- Each completed logical revision or bug fix gets one patch bump and a changelog entry: `pnpm version:patch "Summary"`. Do not bump once per file, intermediate retry, or review correction within the same revision.
- Only an explicitly approved GitHub milestone gets a minor bump: `pnpm version:milestone --milestone-approved "Milestone summary"`. This resets the patch to zero. Approval flags are safeguards, not permission to approve your own release.
- Major releases are reserved for an explicit owner request: `pnpm version:major --major-approved "Major release summary"`. Never infer major-release approval from scope or breaking changes.
- Use the version scripts, not `npm version` or manual edits. `package.json` is canonical; the standalone Python agent is synchronized by the tool. Manifest schemaVersion and playlist publication revisions are independent.
- A local commit is not a GitHub push. Preserve local patch commits; publish their accumulated history only with the approved milestone. Never squash, reset, or force-push without permission.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) and [the release checklist](docs/releases.md). Run version/repository checks, Node and Python tests, lint, typecheck, and build before calling a milestone ready.
- Never commit real media, databases, credentials, provisioning JSON, configured disk images, caches, or generated build output. Use example configurations containing placeholders only.
- Keep player resource use bounded: one visible/one prepared frame, timers only while visible, disposal on cancellation. Do not claim Pi performance from desktop tests.
- Update user/deployment/API documentation when behavior changes. Preserve existing user data and worktree edits. No automatic player-code/OS update service exists.
