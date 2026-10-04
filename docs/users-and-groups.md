# Users and groups

Open **Users & Groups** in the sidebar. Each person signs in with their own username and password.

Select **Log in** on the public homepage, or bookmark `/dashboard` for the management workspace. Existing `/app` links still work. A valid session opens the workspace directly without asking for a password again.

## Staying signed in

Sign-ins last 30 days. Authenticated activity renews the session back to 30 days, at most once a day, so a regularly used account stays signed in. Both the persistent browser cookie and the server's saved session are renewed together. Existing unexpired user sessions receive the longer duration on their next authenticated visit; expired sessions require sign-in.

Sessions survive normal browser restarts and server restarts/upgrades that retain the data volume. Private browsing or clearing site cookies removes the saved sign-in. Use **Sign out** on shared computers. Signing out revokes that browser's session; a password change revokes other sessions, a password reset revokes existing sessions, and disabling an account blocks access immediately. An idle session expires 30 days after its last renewal.

## First sign-in

Each fresh installation automatically creates `admin` with its own cryptographically random, 32-character password before the server accepts connections. For Docker, read it with `docker compose logs openframe`; for a local server, read the startup terminal output. Sign in and change it under **My password**. No account database or reusable password is bundled with the source or container image.

The password is printed only at creation; only its salted hash is saved to SQLite. Protect startup logs, which may retain that initial password. Restarts and upgrades never regenerate existing credentials or add an extra seeded account. A genuinely empty data volume creates a new independent installation; copying an existing volume copies its accounts. If the initial log is lost, use the local recovery command below with an unused username.

## Invite a user

1. As an admin, select **Users**, enter the person's name and a unique username, then select **Invite user**.
2. Send the displayed password link privately. It expires after 24 hours and works once.
3. The recipient opens the link and sets a password of 8-256 characters. No email service is required.

Use **Password invitation** to issue a replacement or reset link. Issuing it replaces earlier invitations; accepting it changes the password and signs out existing sessions. **Disable** immediately blocks a user's sessions and invitations. A group's last active admin must be replaced before being disabled.

Every user can change their password under **My password**, using their current password. Other sessions are signed out. Passwords are stored as salted scrypt hashes; invitation and session tokens are stored as hashes. There is no MFA or automated email recovery.

## Groups

Any signed-in user can create a top-level group and becomes its admin. Choose a parent group to create a subgroup; only admins of that parent can create its children. Group admins generate one-use, 24-hour invitation codes. An existing user enters the code under **Join a group**. Group admins can promote direct members, demote group admins, and remove direct members. Each group must keep an active group admin. Global admins can manage every group.

Groups form a hierarchy. Membership in Group A includes access to content shared with Group A and every descendant (for example Groups 1, 2, and 3), at any depth. Membership in a child does not grant access to its parent or siblings. Group admins can also manage descendants. Use **Parent group** on an existing group to move it beneath another group or back to the top level. Moves take effect on the next request and can add or remove inherited access; moving a group inside itself or a descendant is rejected. A group admin must manage both parents to move a group between them; global admins can move any group.

Global admins can select **Add existing user** on a group without generating an invitation. In **Users**, click a person's name to edit their account role, direct group memberships, and individual content grants. The access editor identifies group access, ownership, and read-only media access separately. Removing a direct grant or direct membership does not override another source of access. Admins have access to all content; regular users receive only their owned, assigned, or group content. You cannot disable or demote your own admin account, and the server retains at least one active admin.

Members collaborate as editors on content shared with the group, including editing and deleting where normal reference checks permit. Group admins manage membership; owning an item or being a admin is required to change its sharing. Removing someone from a group removes that group's access on their next request. They retain their own items and any separate assignments.

## Screen assignments and sharing

Manage sharing from **Sharing & assignments** or select **Manage access** on a slide, playlist, screen, or media item to open its access settings in place. Slides and media have a labeled access footer; playlists and screens have a button beside their other controls. Choose a group to share with; admins can also assign individual users. Folders remain available in the central sharing list.

- Admins can assign screens and other resources to individual users or groups.
- Owners can share their own items with groups they belong to.
- New content is private to its creator until shared. Legacy content and newly enrolled screens are initially visible only to admins.
- Sharing a screen also shares its current playlist and slides. Images attached to accessible slides or published playlists/screens appear as **Read-only** unless the recipient also has direct media access. Published images remain visible even after they are removed from the live draft. Recipients can view and pick those images, but cannot rename, retag, move, delete, or manage access to them. Sharing a folder includes direct access to its current images; sharing an individual image does not share its siblings.
- Sharing is an explicit grant, not a live folder rule. Share newly referenced slides or playlists with the resource owner and the same recipients before adding them to a shared playlist or screen. The server rejects references whose owner or recipients cannot access them. Attached images receive derived read-only access without a separate grant.
- Removing a grant from a screen or playlist does not revoke grants on its contents. Remove those separately when appropriate. Access can also come from ownership, another group, or a direct assignment.

Read-only media can be reused in a slide you can edit. That new slide supplies its own media-view reference, which remains until removed; revoking the original share does not remove copies or other accessible references.

Only admins can pair/revoke screens, manage the VPN inventory, or export setup bundles. Assigned users can edit their screens, select accessible playlists, queue refresh/reboot commands, and reveal those screens' recovery Wi-Fi credentials. Player bearer-token authentication and offline playback are unchanged.

## Upgrade and recovery

Back up the complete data directory before upgrading. Existing `superadmin` roles migrate to `admin`; existing usernames (including a username of `superadmin`), passwords, and user sessions are preserved. Fresh installations create the username `admin`. When migrating a much older installation that used a shared password, that password becomes the `admin` account password; its anonymous legacy sessions are signed out. Existing media, slides, publications, and player credentials are preserved. Account tables are added to the existing SQLite database.

To create an additional admin from a trusted local server terminal:

```sh
node scripts/create-admin.mjs admin
```

For Docker Compose (replace the service name if customized):

```sh
docker compose exec openframe node scripts/create-admin.mjs admin
```

The command uses `DATA_DIR`, refuses an existing username, and prints a randomly generated password once. Store it securely. It never resets an existing account. Use the new account to issue a password invitation if an existing administrator is locked out.

Rolling back to a release without user management removes these access protections. Restore the matching pre-upgrade data backup and server version together; do not run an old server against the upgraded database.
