# Public website

The server hosts a public OpenFrame landing page at `/`. Its login links open `/login`; successful sign-in opens `/dashboard`. Bookmark `/dashboard` to go straight to Slides when signed in. Other workspace sections use `/dashboard/playlists`, `/dashboard/screens`, `/dashboard/media`, `/dashboard/users`, `/dashboard/password`, and `/dashboard/settings`; section filters are carried in the query string. Users and Settings are admin-only; non-admin direct links redirect to Slides. Visiting `/login` or the legacy `/app` route with an active session also opens `/dashboard`; otherwise the workspace requests sign-in at `/login`. Signing out returns to `/login`. Player routes and synchronization authorization are unchanged.

Sessions use persistent 30-day cookies and renew during authenticated activity, at most once a day. Reloading, revisiting a bookmark, or normally closing and reopening the browser does not require another sign-in. Private browsing, clearing cookies, signing out, or account/password changes can end a session earlier. See [users and groups](users-and-groups.md#staying-signed-in).

The landing page makes no account or library API requests. Its images are public product illustrations, not live content from the installation. The management application loads separately when needed. No analytics, externally hosted fonts, or third-party image requests are added. Documentation and source links point to the project on GitHub. The installation command block can be copied; FAQ entries and mobile navigation work without an account.

The **Android player** section always links directly to the [latest signed APK on GitHub](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk). Rendering the landing page makes no release-metadata or GitHub requests. The server mirrors GitHub releases through `/downloads/android/` for installed players and TV downloader apps. See [Android downloads and updates](android-tv.md#github-downloads-and-server-updates).

Password invitations now use `/login#activate=...`. Previously issued `/#activate=...` links still open account activation directly. Tokens stay in the URL fragment until activation completes.

## Assets

- `public/images/openframe-studio.webp`: an AI-generated, fictional community-space signage scene created for OpenFrame. It illustrates a possible installation and does not depict an actual customer or a verified hardware deployment.
- `public/images/openframe-workspace.webp`: a screenshot of the real management UI, captured from the temporary sample database in `tests/landing.browser.mjs`. All names and slide content are fictional; no installed-user media or credentials are included.

Both images are bundled locally and encoded as WebP. UI symbols use the existing Lucide library. Regenerate the workspace capture with the documented browser test flag, review it for sample content only, and rebuild before checking the landing page.
