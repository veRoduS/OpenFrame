# Public website

The server hosts a public OpenFrame landing page at `/`. Its login links open `/login`; successful sign-in opens `/dashboard`. Bookmark `/dashboard` to go straight to Slides when signed in. Other workspace sections use `/dashboard/playlists`, `/dashboard/screens`, `/dashboard/media`, `/dashboard/users`, `/dashboard/password`, and `/dashboard/settings`; section filters are carried in the query string. Users and Settings are admin-only; non-admin direct links redirect to Slides. Visiting `/login` or the legacy `/app` route with an active session also opens `/dashboard`; otherwise the workspace requests sign-in at `/login`. Signing out returns to `/login`. Player routes and synchronization authorization are unchanged.

Sessions use persistent 30-day cookies and renew during authenticated activity, at most once a day. Reloading, revisiting a bookmark, or normally closing and reopening the browser does not require another sign-in. Private browsing, clearing cookies, signing out, or account/password changes can end a session earlier. See [users and groups](users-and-groups.md#staying-signed-in).

The landing page makes no account or library API requests and loads nothing from another origin. Its images are public product illustrations, not live content from the installation. The management application loads separately when needed. No analytics, externally hosted fonts, or third-party image requests are added; its two typefaces are bundled with the build. Documentation and source links point to the project on GitHub. The installation command block can be copied; FAQ entries and mobile navigation work without an account.

## Sample playlist

Every screen drawn on the page plays the same fictional four-slide playlist: the display in the opening photograph, the three small screens in the network diagram, and the strip above the closing link. The slides are drawn by the page itself and laid out like 1920 x 1080 OpenFrame slides; nothing is read from the installation. The slide with a clock uses the player's own clock formatter and the visitor's local time.

One timer advances the playlist every six seconds, and only while the page is visible and the playlist is playing. The control under the display pauses it and selects a slide. Visitors who ask their system for reduced motion start paused, with no transitions, and can still step through the slides.

## Android player

The **Android player** section always links directly to the [latest signed APK on GitHub](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk). Rendering the landing page makes no release-metadata or GitHub requests. The server mirrors GitHub releases through `/downloads/android/` for installed players and TV downloader apps. See [Android downloads and updates](android-tv.md#github-downloads-and-server-updates).

Its pairing steps show the address the visitor used to reach the server, which is the address to enter in OpenFrame Player. When the page is opened through `localhost` or another loopback address, which a TV cannot use, it shows an example network address instead.

## Invitations

Password invitations now use `/login#activate=...`. Previously issued `/#activate=...` links still open account activation directly. Tokens stay in the URL fragment until activation completes.

## Assets

- `public/images/openframe-studio.webp`: an AI-generated, fictional community-space signage scene created for OpenFrame. It illustrates a possible installation and does not depict an actual customer or a verified hardware deployment. The page labels it as an illustrated space. The sample playlist is drawn over the display in this image, using that display's measured corners in `app/landing.tsx`; measure them again if the image is ever replaced.
- `public/images/openframe-editor.webp`, `openframe-playlist.webp`, and `openframe-screens.webp`: screenshots of the real management UI, captured at twice their displayed density from the temporary sample database in `tests/landing.browser.mjs`. The first is the whole slide editor; the other two are cropped to a playlist's sequence and to one screen's card. All names and slide content are fictional; no installed-user media or credentials are included. The three screens are stand-ins created by the test, which enrolls them, downloads the playlist as a player would, and reports playback.
- Fraunces (headings) and Figtree (text): Latin subsets from the `@fontsource-variable/fraunces` and `@fontsource-variable/figtree` development dependencies, emitted by the build under `/assets/`. Both use the SIL Open Font License 1.1; see the [bundled third-party notices](../public/THIRD_PARTY_NOTICES.txt). Slides on the page use Arial, the editor's default.

The images are bundled locally and encoded as WebP. UI symbols use the existing Lucide library. Regenerate the workspace captures with the documented browser test flag, review them for sample content only, and rebuild before checking the landing page. If a capture changes size, update its `width` and `height` in `app/landing.tsx`.
