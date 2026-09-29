# Public website

The server hosts a public OpenFrame landing page at `/`. Its login links open `/login`; successful sign-in opens `/app`. Visiting `/login` with an active session also opens the workspace. Signing out returns to `/login`. Player routes and API authorization are unchanged.

The landing page makes no account or library API requests. Its images are public product illustrations, not live content from the installation. The management application loads separately when needed. No analytics, externally hosted fonts, or third-party image requests are added. Documentation and source links point to the project on GitHub. The installation command block can be copied; FAQ entries and mobile navigation work without an account.

Password invitations now use `/login#activate=...`. Previously issued `/#activate=...` links still open account activation directly. Tokens stay in the URL fragment until activation completes.

## Assets

- `public/images/openframe-studio.webp`: an AI-generated, fictional community-space signage scene created for OpenFrame. It illustrates a possible installation and does not depict an actual customer or a verified hardware deployment.
- `public/images/openframe-workspace.webp`: a screenshot of the real management UI, captured from the temporary sample database in `tests/landing.browser.mjs`. All names and slide content are fictional; no installed-user media or credentials are included.

Both images are bundled locally and encoded as WebP. UI symbols use the existing Lucide library. Regenerate the workspace capture with the documented browser test flag, review it for sample content only, and rebuild before checking the landing page.
