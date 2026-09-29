# Users and groups

Open **Users & Groups** in the sidebar. Each person signs in with their own username and password.

Select **Log in** on the public homepage, or go directly to `/login`. The management workspace is at `/app`.

## First sign-in

Each fresh installation automatically creates `superadmin` with its own cryptographically random, 32-character password before the server accepts connections. For Docker, read it with `docker compose logs openframe`; for a local server, read the startup terminal output. Sign in and change it under **My password**. No account database or reusable password is bundled with the source or container image.

The password is printed only at creation; only its salted hash is saved to SQLite. Protect startup logs, which may retain that initial password. Restarts and upgrades never regenerate existing credentials or add an extra seeded account. A genuinely empty data volume creates a new independent installation; copying an existing volume copies its accounts. If the initial log is lost, use the local recovery command below with an unused username.

## Invite a user

1. As a super-admin, select **Users**, enter the person's name and a unique username, then select **Invite user**.
2. Send the displayed password link privately. It expires after 24 hours and works once.
3. The recipient opens the link and sets a password of 12-256 characters. No email service is required.

Use **Password invitation** to issue a replacement or reset link. Issuing it replaces earlier invitations; accepting it changes the password and signs out existing sessions. **Disable** immediately blocks a user's sessions and invitations. A group's last active admin must be replaced before being disabled.

Every user can change their password under **My password**, using their current password. Other sessions are signed out. Passwords are stored as salted scrypt hashes; invitation and session tokens are stored as hashes. There is no MFA or automated email recovery.

## Groups

Any signed-in user can create a group and becomes its admin. Group admins generate one-use, 24-hour invitation codes. An existing user enters the code under **Join a group**. Admins can promote members, demote admins, and remove members. Each group must keep an active admin. Super-admins can manage every group.

Members collaborate as editors on content shared with the group, including editing and deleting where normal reference checks permit. Group admins manage membership; owning an item or being a super-admin is required to change its sharing. Removing someone from a group removes that group's access on their next request. They retain their own items and any separate assignments.

## Screen assignments and sharing

Under **Sharing & assignments**, choose Screens, Slides, Playlists, Media, or Folders, then **Access** beside an item.

- Super-admins can assign screens and other resources to individual users or groups.
- Owners can share their own items with groups they belong to.
- New content is private to its creator until shared. Legacy content and newly enrolled screens are initially visible only to super-admins.
- Sharing a screen also shares its current playlist, slides, and images. Sharing a playlist or slide includes its current contents. Sharing a folder includes its current images; sharing an individual image does not share its siblings.
- Sharing is an explicit grant, not a live folder rule. Share newly added content with the same recipients before adding it to a shared slide, playlist, or screen. The server rejects references whose recipients cannot access them.
- Removing a grant from a screen or playlist does not revoke grants on its contents. Remove those separately when appropriate. Access can also come from ownership, another group, or a direct assignment.

Only super-admins can pair/revoke screens, manage the VPN inventory, or export setup bundles. Assigned users can edit their screens, select accessible playlists, queue refresh/reboot commands, and reveal those screens' recovery Wi-Fi credentials. Player bearer-token authentication and offline playback are unchanged.

## Upgrade and recovery

Back up the complete data directory before upgrading. The old shared administrator password becomes the `admin` super-admin account automatically. Its password is preserved, but old browser sessions are signed out. Existing media, slides, publications, and player credentials are preserved. Account tables are added to the existing SQLite database.

To create an additional super-admin from a trusted local server terminal:

```sh
node scripts/create-superadmin.mjs superadmin
```

For Docker Compose (replace the service name if customized):

```sh
docker compose exec openframe node scripts/create-superadmin.mjs superadmin
```

The command uses `DATA_DIR`, refuses an existing username, and prints a randomly generated password once. Store it securely. It never resets an existing account. Use the new account to issue a password invitation if an existing administrator is locked out.

Rolling back to a release without user management removes these access protections. Restore the matching pre-upgrade data backup and server version together; do not run an old server against the upgraded database.
