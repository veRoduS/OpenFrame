# Changelog

Versions follow the project's [milestone policy](docs/releases.md), not feature-based SemVer increments. Entries are local development history unless identified by a published Git tag/release. No historical release dates or GitHub publications are implied.

## [0.17.5] - 2026-10-04

- Compact phone library filters into expandable controls, remove duplicate result counts, align desktop sorting, and place slide-list actions on a shared row.
- Improve secondary-text contrast, field boundaries, focus states, mobile input sizes, and touch targets across the workspace.
- Add collapsible Media folder branches and a phone folder picker with full paths; align card access footers and bound image/access tag summaries with full-detail disclosures.
- Use compact expandable group rows, preserve admin drag/drop and Add existing user, and remove the redundant admin Join form.
- Split user access into persistent Account, Groups, and Content tabs with keyboard navigation, searchable content, and explicit inherited/direct membership labels.
- Keep grant controls visible above separate Groups/Users access lists, align named remove buttons, and retain the direct-user distinction in sharing summaries.
- Give the phone slide editor a readable title row, Canvas/Layers/Properties navigation, retained previews, and an inspector that responds to viewport changes.
- Move screen diagnostics into Details and show Recovery Wi-Fi only for players reporting the supported recovery service, preserving existing assigned-user permissions.
- Preserve player 0.10.11, sync/publication contracts, and APKs; this is a server/web UI revision.

## [0.17.4] - 2026-10-04

- Add slide name and modified-time sorting across list and grid layouts

## [0.17.3] - 2026-10-04

- Remove Sharing & assignments from Users & Groups

## [0.17.2] - 2026-10-04

- Restrict Users & Groups to admins and generate one-time displayed passwords for new users

## [0.17.1] - 2026-10-04

- Add icon-only slide layouts, simplify folder labels and remove the top-level group drop area

## [0.17.0] - 2026-10-04

- Administrator controls, sharing summaries and library usability

## [0.16.1] - 2026-10-04

- Restrict group creation to global admins. Show admins as unrestricted group administrators, protect their group access, and preserve explicit memberships when account roles change.
- Show the signed-in name beside the sidebar version and sign-out control. Split sharing into Groups and Users menus and display tags for group grants and individual users assigned outside those groups.
- Keep admin group dragging and the Add existing user dropdown; remove user dragging. Use a confirmed + button for missing memberships and organize individual content access under Slides, Playlists, Screens, Media, and Folders.
- Align playlist actions, remove the playlist publication reminder and slide draft-library text, and show active published playlists when hovering or focusing a slide's Live badge.
- Keep player 0.10.11 compatible; player manifests and APKs are unchanged.

## [0.16.0] - 2026-10-04

- Publish admin/group controls, media drag-and-drop, shapes, vertical weather, stocks and workspace filters
- Include player 0.10.11 support for schema 3; update players before publishing shapes, stocks or vertical weather.
- Publish the owner-approved 0.16.0 GitHub release as latest after image verification, with a digest-pinned Compose bundle.

## [0.15.3] - 2026-10-04

- Add combined name, nested-group and status filters to slides, playlists and screens.
- Correct published slide IDs in library summaries so Live badges and filters use actual published slides.

## [0.15.2] - 2026-10-04

- Add media/user/group drag-and-drop, shapes, vertical weather and a shared Finnhub stock tracker; preserve separate admin identities on migration.
- Playlists using shapes, stocks, or vertical weather require player 0.10.11 or newer; existing playlists retain schema 2.

## [0.15.1] - 2026-10-04

- Add admin account and membership controls, inherited group access and moves, user access editing, and draggable indented media folders

## [0.15.0] - 2026-10-04

- Show live playlist badges on slides, support nested media folders, and preserve existing screen settings when renaming.
- Allow referenced media deletion with removed-media placeholders, and support nested groups with independent permissions.
- Published removed-media placeholders require player 0.10.8 or newer; update older players before deleting published media.
- Include player 0.10.9's Android device sleep setup guidance; server and player versions remain independent. Physical Onn sleep behavior still requires validation.

## [0.14.2] - 2026-10-03

- Add live playlist badges, nested media folders, and repair screen renaming

## [0.14.1] - 2026-10-03

- Allow deletion of referenced media with placeholders and add independently permissioned nested groups

## [0.14.0] - 2026-10-03

- Rename screens from the dashboard.
- Confirm and apply the required sharing for playlist slides and referenced media before saving or publishing.
- Add built-in font choices and super-admin custom-font uploads; published playlists bundle their custom fonts for offline Pi and Android playback. Custom-font playlists require player 0.10.6 or newer.
- Normalize edge-aligned layer sizes so items can reach 100% without slide-bound errors.

## [0.13.4] - 2026-10-03

- Normalize canvas-edge dimensions when saving slides

## [0.13.3] - 2026-10-03

- Add dashboard custom fonts and slide font choices

## [0.13.2] - 2026-10-03

- Confirm and share playlist dependencies before saving

## [0.13.1] - 2026-10-03

- Add dashboard screen renaming

## [0.13.0] - 2026-10-03

- Publish OpenFrame 0.13.0 with corrected shared-media access checks

## [0.12.0] - 2026-10-03

- Publish OpenFrame 0.12.0 after aligning checks with automatic slide refresh

## [0.11.0] - 2026-10-03

- Publish OpenFrame 0.11.0 multi-architecture server image

## [0.10.6] - 2026-10-03

- Refresh published slides, share uploaded media, and preserve GIF animation

## [0.10.5] - 2026-10-03

- Document the direct GitHub APK address for Android TV Downloader apps

## [0.10.4] - 2026-10-02

- Publish Android APKs to GitHub, link the latest download, and track independent player/server compatibility

## [0.10.3] - 2026-10-01

- Add webpage APK downloads and verified Android in-app update checks

## [0.10.2] - 2026-10-01

- Fix browser timer binding that blocked player startup with Illegal invocation

## [0.10.1] - 2026-10-01

- Add an Android TV player with signed APK builds and USB installation

## [0.10.0] - 2026-09-30

- Publish the reviewed account, media-sharing, editor, and security fixes
- Owner-approved GitHub milestone containing local revisions 0.9.1 and 0.9.2, preserving the local fix commit and earlier milestone history.
- Apply the eight-character password minimum consistently across account setup, activation, password changes, and login. Share login attempt budgets across equivalent route spellings.
- Show attached media as read-only through shared slides, playlists, and screens, including published snapshots. Reject forged non-image media references and preserve owner access when collaborators update referenced content.
- Add Full Lock and movement locks for text, images, and widgets; keep locked coordinates fixed during dimension edits. Separate Add image from Replace image and organize the slide sidebar into compact property sections.
- Secure player JSON replacement and file ownership against symlinks; redact first-boot Wi-Fi failures. Update the affected development dependencies; the full dependency audit reports zero advisories.
- Upgrade the server while preserving the complete existing data directory. Update installed `agent.py`, `bootstrap.py`, and `recovery.py` together; customized player images also need the updated `firstboot.sh`. Server upgrades do not update player files automatically. Playback manifests and database schemas require no destructive migration.
- To roll back to 0.9.0, first change any new 8-11 character passwords to at least 12 characters, since the old server rejects shorter login credentials. Restore the prior server/player code with the preserved data; older editors do not enforce layer locks or provide derived read-only media access.
- Physical Pi/radio behavior and real privileged provisioning remain unverified and experimental. Desktop, browser, and mocked player checks do not establish hardware performance or isolation.
- Local checks pass with 117 Node tests, 89 Python tests, both account/editor browser suites, build, typecheck, lint, and zero dependency advisories. Local Docker acceptance is blocked by the cloud environment's Docker Hub policy; the GitHub workflow performs native container verification before publishing.
- The milestone tag triggers CI and native AMD64/ARM64 container checks before publishing images under `0.10.0` and `latest`. This does not deploy a running installation or create a GitHub Release automatically.

## [0.9.2] - 2026-09-30

- Resolve security audit findings in sharing, authentication, player provisioning, and layer editing; update vulnerable development dependencies
- Restrict derived media access to image attachments, include published media from shared playlists/screens, preserve read-only metadata controls, and validate referenced content for its owner as well as recipients.
- Apply the eight-character password policy to setup, activation, and password-change forms; accept valid shorter passwords at browser login and share throttling budgets across route aliases.
- Secure player JSON replacement and ownership changes against symlinks, and redact first-boot Wi-Fi failure diagnostics. Existing players require updated Python files; customized images require the updated first-boot script.
- Keep image insertion separate from replacement and preserve movement-locked coordinates when editing dimensions. Add isolated API, browser, and player regressions for the reviewed cases.
- Update brace-expansion to 5.0.12, fast-uri to 3.1.8, and ip-address to 10.7.2; the full dependency audit reports no advisories.

## [0.9.1] - 2026-09-30

- Compact the slide properties sidebar into organized sections, paired fields, and expandable crop controls

## [0.9.0] - 2026-09-30

- Approved GitHub milestone preserving local revision 0.8.1 and its history.
- Document provider-neutral HTTPS proxy setup, cookie security, and origin-error recovery for deployments behind different reverse proxies.
- Add a Codex Cloud guide for connecting this GitHub repository, preparing the toolchain, validating cloud tasks, and preserving patch/milestone release controls.
- No application runtime or player behavior changes. The milestone workflow publishes server images under `0.9.0` and `latest` only after CI and native AMD64/ARM64 container checks pass. No deployment or physical Pi validation is included.

## [0.8.1] - 2026-09-30

- Document provider-neutral HTTPS proxy setup and origin-error recovery

## [0.8.0] - 2026-09-30

- Approved GitHub milestone containing local revision 0.7.1, preserving its commit history.
- Add labeled Manage access controls on Slides, Playlists, Screens, and Media, with dedicated slide/media card footers and responsive layouts.
- Reuse the access dialog across resource pages and account management; constrain dialogs and wrap long names to prevent clipping.
- Add an invitation-copy fallback when the browser Clipboard API is unavailable, and remove the Self-hosted and Local server Connected dashboard labels.
- No database schema, pairing, VPN, or player behavior changes. Upgrade the server while preserving its existing data volume; installed players do not need updating for these UI changes. Roll back to the prior server image with the preserved data volume if needed.
- The milestone workflow publishes 0.8.0 and latest only after its checks pass. Docker and physical Pi validation remain incomplete; managed networking and hardware performance remain experimental.

## [0.7.1] - 2026-09-29

- Improve sharing controls and dialog layout

## [0.7.0] - 2026-09-29

- Approved GitHub milestone follow-up: fix the seeded-administrator Docker smoke test so the multi-platform image can complete publishing. Preserve the existing `v0.6.0` tag and history.
- Verify that fresh installations reject public administrator setup and that the unique startup credential signs in; mask it before any failure-log output.
- Publish this milestone's GHCR image under both `0.7.0` and `latest` after the general and AMD64/ARM64 container checks pass. `latest` remains unchanged if any check fails.
- No additional application schema or player behavior changes beyond the accumulated 0.6.0 milestone. Existing data volumes remain in place during upgrades. Physical Pi Zero 2 W performance and roaming are still unvalidated.

## [0.6.0] - 2026-09-29

- Approved GitHub milestone: public homepage, persistent sign-in, team access, smoother slide playback, and a `latest` GHCR image alias. Includes local revisions 0.5.1 through 0.5.9 without squashing their history.
- Add a public product homepage, 30-day renewable sign-in sessions, and the bookmarkable `/dashboard` route. Existing `/app` links remain compatible.
- Add individual accounts, password invitations, groups, resource sharing and screen assignments; generate a unique initial super-admin credential for every fresh installation.
- Prepare slide transitions only after the next frame is ready, and add editable prioritized recovery Wi-Fi networks with automatic return to higher-priority connections.
- Publish each successful milestone image under both its fixed `X.Y.0` version and the mutable `latest` alias. GitHub publication still uses an immutable `vX.Y.0` milestone tag; `latest` advances only after its CI and image workflow succeeds. It does not update running servers automatically.
- Upgrade Multer to 2.4.0 to address the moderate denial-of-service advisory affecting aborted multipart uploads.
- Compatibility: preserve the server data volume during upgrades. Older shared-admin installations migrate their password to the `admin` super-admin account; old browser sessions are cleared during account migration. Server container upgrades do not update Pi code or its local recovery page; follow the player update instructions for the accumulated Wi-Fi and playback changes. No automatic player updater is included.
- Experimental limitations: physical Pi Zero 2 W memory/performance, HDMI transitions, and Wi-Fi priority roaming remain unvalidated. The milestone workflow runs AMD64 and ARM64 container checks; consult the actual GitHub Actions result and hardware checklist before unattended deployment.

## [0.5.9] - 2026-09-29

- Keep user sessions signed in for 30 days with daily renewal and a bookmarkable dashboard

## [0.5.8] - 2026-09-29

- Add a public landing page with local imagery and connected login navigation

## [0.5.7] - 2026-09-29

- Seed a unique random super-admin on each fresh server installation

## [0.5.6] - 2026-09-29

- Add individual users, password invitations, group sharing, and assigned screen access

## [0.5.5] - 2026-09-22

- Consolidate app source and remove unused scaffolding and dependencies

## [0.5.4] - 2026-09-19

- Clarify example Wi-Fi network names in recovery previews

## [0.5.3] - 2026-09-19

- Add draggable Wi-Fi priorities and automatic promotion from backup networks
- Replace arrow controls with left-side drag grips supporting mouse, touch, keyboard reordering, and cancellation. Preserve unsaved edits and require Save networks to apply the order.
- Check higher saved priorities about once a minute while connected to a backup. Require two stable scans and matching security; attempt restoration after failed activation, with increasing candidate cooldowns. Do not scan or promote during recovery-hotspot windows.
- Compatibility: update the complete player source and setup web assets, then restart the recovery service or reboot. No new dependency, service, data migration, or automatic player update. Existing pairing, VPN, and cached playback are preserved. Switching briefly interrupts networking; physical Pi/radio behavior remains unvalidated. See [recovery acceptance](docs/player-recovery.md) and [upgrade/rollback](docs/operations.md).

## [0.5.2] - 2026-09-19

- Add saved Wi-Fi networks and priority ordering to the recovery portal
- Add/edit/remove up to 20 personal/open networks, reorder with arrow controls, retain stored passwords, and support hidden networks. Save without ending a recovery pause; reconnect explicitly when ready.
- Persist priority in root-only NetworkManager profiles, preserve other settings on retained profiles, reject stale edits, and attempt rollback after save failures. Keep Wi-Fi secrets off the home server and out of browser responses and command arguments.
- Compatibility: update the complete player source and rerun the installer, including `wifi.py` and all `setup-web` assets; a Docker-only update cannot update the local recovery page. Existing pairing, VPN, and cached content remain intact. No server data migration or automatic player update is included. See [recovery setup and hardware acceptance](docs/player-recovery.md) and [private backup/rollback guidance](docs/operations.md). Physical NetworkManager/radio failover remains untested; priority does not force roaming from a healthy Wi-Fi connection or detect server-only outages.

## [0.5.1] - 2026-09-18

- Add prepared whole-slide fade and slide transitions with playlist controls
- Keep Cut as the default; offer Fade, Slide left, and Slide right with 0.2-2.0 second durations. Save and publish transition settings with the playlist.
- Wait for decoded photos, widget readiness, fonts, and layout before transitioning. Retain at most two frames, dispose outgoing resources before preparing another, and give each incoming slide its full duration after animation.
- Cancel effects on replacement, expiration, blanking, and revocation. Use Cut for initial/replacement frames, reduced motion, and unsupported animation backends.
- Compatibility: update the server and complete `player/web` directory, then restart the kiosk. Existing publications default to Cut; older players ignore these additive settings. No database migration or automatic player update is included. Follow [upgrade/rollback operations](docs/operations.md) and [Pi acceptance checks](docs/playback-testing.md); physical-device smoothness is not validated.

## [0.5.0] - 2026-09-17

- Approved documentation milestone: concise project overview, features, and setup in the README; detailed usage and Raspberry Pi instructions now live in dedicated guides.
- Present OpenFrame independently, remove product comparisons, and update documentation links. Preserve the local 0.4.1 revision in history.
- Documentation and version metadata only; no application behavior, stored-data format, configuration, or player protocol changes. No player reinstall is needed solely for this milestone. Existing backup/rollback guidance and experimental hardware limitations still apply.

## [0.4.1] - 2026-09-17

- Simplify the README and separate user and Pi installation guides

## [0.4.0] - 2026-09-17

- Approved GitHub milestone: player recovery, branded onboarding, and shared weather widgets. Includes all local revisions 0.3.1 through 0.3.4 without squashing their history.
- Add branded first-boot QR guidance, last-heartbeat labels, cached playback with a subtle disconnection indicator, and reconnect attempts approximately every 15 seconds.
- Add single-radio hidden recovery Wi-Fi when needed, server-managed recovery credentials, and reconnect pauses of one minute, five minutes, fifteen minutes, or indefinitely.
- Add NWS weather with shared per-location requests, US ZIP lookup, current observations or the next six forecast hours, bundled offline condition icons, and independent forecast/observation caching.
- Compatibility: update the server and complete player directory together for the new widgets and recovery features; server container updates do not update Pi code or the OS. Existing slides, media, pairing, and manifest schemaVersion remain compatible. Review [weather upgrades](docs/weather.md), [recovery setup](docs/player-recovery.md), and [backup/rollback operations](docs/operations.md). Preserve application data and matching VPN state backups before upgrading; restore the matching backup and previous image/source for rollback.
- Experimental limitations: physical Pi Wi-Fi switching, QR scanning, HDMI performance, and Zero 2 W memory/soak testing remain unvalidated. No automatic player updater or hardware-tested SD-card image is included. The milestone workflow publishes the application image and Compose artifact, not the optional source-built WireGuard helper.

## [0.3.4] - 2026-09-17

- Add weather ZIP lookup, current observations, six-hour forecasts, and offline condition icons

## [0.3.3] - 2026-09-17

- Add NWS weather widgets with shared location caching and offline player snapshots

## [0.3.2] - 2026-09-16

- Polish first-boot branding and add timed or indefinite recovery reconnect pauses

## [0.3.1] - 2026-09-16

- Add setup QR guidance, offline indicators, heartbeat labels and single-radio hidden Wi-Fi recovery

## [0.3.0] - 2026-09-13

- Approved GitHub milestone: screen setup bundles and experimental managed WireGuard onboarding.
- Add encrypted imported WireGuard inventory, one-client-per-setup allocation, and private ZIP downloads containing player, optional Wi-Fi, and Cloudflare Access configuration.
- Add opt-in, source-built WireGuard hosting, approval-gated peer allocation, managed VPN status, and a Pi first-boot hotspot form. Client private keys remain on the Pi; verified setup switches playback to the private VPN origin.
- Include simple installation instructions, security/recovery guidance, and native AMD64/ARM64 helper build checks in CI. The managed helper is source-built; the existing publishing workflow publishes the application image and Compose artifact only.
- Compatibility: existing players, external VPN imports, stored media, and manifest schema remain unchanged. Back up application data before upgrading; managed deployments also require the matching WireGuard state backup. Server upgrades do not update Pi code or the OS. Use matching player source when provisioning the new hotspot flow; see [setup](docs/quick-start.md) and [upgrade/rollback operations](docs/operations.md).
- Experimental limitations: real managed Docker networking, image building, Pi Wi-Fi/HDMI boot, and Zero 2 W performance remain unvalidated. No prebuilt hardware-tested SD-card image, automatic public fallback, or OTA update service is included.

## [0.2.2] - 2026-09-13

- Add optional managed WireGuard hosting and Pi first-boot hotspot setup

## [0.2.1] - 2026-09-11

- Add screen setup bundles with encrypted WireGuard inventory and per-screen allocation

## [0.2.0] - 2026-09-10

- First GitHub milestone: ARM64/AMD64 container publishing, native architecture CI, and digest-pinned Compose stack.

## [0.1.1] - 2026-09-09

- Prepare GitHub documentation, release policy, synchronized versions, CI, and repository hygiene checks.
- Remove unused server-component/cloud-hosting scaffold dependencies; update Sharp, Vite, and UUID to patched versions. Rebuild the server image to use these dependency changes. This does not change stored media or player protocol.
- Pin Vite's optional esbuild development peer to a patched version and use Vite's client types directly.

## [0.1.0] - Initial Development Baseline (Unpublished)

- Self-hosted Docker server, authenticated single-admin management, SQLite persistence, and image uploads.
- Text/image slide editor with cropping, resizing, automatic text sizing, backgrounds, and clock/counter widgets.
- Media folders/tags, playlist scheduling and status indicators, duplicate-slide confirmation, and unsaved-change navigation.
- Published snapshots, device pairing/commands, verified offline cache, and prepared-frame playback.
- Raspberry Pi installation/image customization scripts, optional Cloudflare Access credentials, and WireGuard drop-in provisioning.
- Automated API, editor, renderer, and agent checks. Docker and physical Pi acceptance testing remain outstanding.
