# Users and groups

Admins open **Users & Groups** in the sidebar. This page is visible only to admins. Each person signs in with their own username and password. Regular users have a separate **My password** page.

Select **Log in** on the public homepage, or bookmark `/dashboard` for the management workspace. Existing `/app` links still work. A valid session opens the workspace directly without asking for a password again.

## Staying signed in

Sign-ins last 30 days. Authenticated activity renews the session back to 30 days, at most once a day, so a regularly used account stays signed in. Both the persistent browser cookie and the server's saved session are renewed together. Existing unexpired user sessions receive the longer duration on their next authenticated visit; expired sessions require sign-in.

Sessions survive normal browser restarts and server restarts/upgrades that retain the data volume. Private browsing or clearing site cookies removes the saved sign-in. Use **Sign out** on shared computers. Signing out revokes that browser's session; a password change revokes other sessions, a password reset revokes existing sessions, and disabling an account blocks access immediately. An idle session expires 30 days after its last renewal.

## First sign-in

Each fresh installation automatically creates `admin` with its own cryptographically random, 32-character password before the server accepts connections. For Docker, read it with `docker compose logs openframe`; for a local server, read the startup terminal output. Sign in and change it under **My password**. No account database or reusable password is bundled with the source or container image.

The password is printed only at creation; only its salted hash is saved to SQLite. Protect startup logs, which may retain that initial password. Restarts and upgrades never regenerate existing credentials or add an extra seeded account. A genuinely empty data volume creates a new independent installation; copying an existing volume copies its accounts. If the initial log is lost, use the local recovery command below with an unused username.

## Add a user

1. As an admin, select **Users**, enter the person's name and a unique username, then select **Add user**.
2. The pop-up displays the username and a cryptographically random 12-character password. Copy and share these credentials privately; the password is shown once and only its salted hash is stored.
3. The user can sign in immediately and change their password on **My password**. No email service is required.

Use **Password invitation** to issue a replacement or reset link. Issuing it replaces earlier invitations; accepting it changes the password and signs out existing sessions. **Disable** immediately blocks a user's sessions and invitations. A group's last active admin must be replaced before being disabled.

Admins can change their password under **Users & Groups > My password**; regular users use **My password** in the sidebar. Both require the current password. Other sessions are signed out. Passwords are stored as salted scrypt hashes; invitation and session tokens are stored as hashes. There is no MFA or automated email recovery.

## Groups

Only global admins can create groups, including subgroups. Choose a parent group when creating a subgroup. Global admins automatically administer every group without being added as ordinary members; their access cannot be removed or reduced through group or content sharing controls. Demoting an account removes this implicit access, while any explicit memberships remain. Global admins add existing accounts with **Add existing user**. The admin page does not show a Join form, since global admins already have unrestricted access. Existing one-use, 24-hour group invitation codes and the group-join API remain supported. Group admins can promote direct members, demote group admins, and remove direct members. An existing direct group admin cannot be removed or disabled until another direct group admin is assigned. Global admins can manage every group even without a direct membership.

Groups form a hierarchy. Slides and playlists shared with a group can be viewed by its ancestors and descendants; siblings do not inherit access to each other. For example, Group A's master slides are visible to Groups B and C below it. Content managed by B is also visible to A, but not to sibling C. This does not add direct memberships. Screen and media grants retain their existing downward-only inheritance.

Global admins can select **Add existing user** on a group without generating an invitation. Users are not draggable. In **Users**, click a person's name, then use **Account**, **Groups**, and **Content** to edit their role, direct group memberships, and individual content grants. These tabs remain visible while each panel scrolls. Content has search and a type filter. Arrow keys and Home/End navigate the tabs. Groups without a direct membership show a **+** button and confirmation. Inherited membership is labeled separately; the plus adds direct membership and does not mean inherited access is missing. The content access editor groups items under Slides, Playlists, Screens, Media, and Folders and identifies group access, ownership, and read-only media access separately. Admin accounts show unrestricted access and Group admin status instead of editable membership controls. Removing a direct grant or direct membership does not override another source of access. Admins have access to all content; regular users receive only their owned, assigned, or group content. You cannot disable or demote your own admin account, and the server retains at least one active admin.

### View and Edit

For slides and playlists, **Manage access** offers a **Managing group** and separate **View** / **Edit** grants. Direct members of the managing group can edit; inherited access is View only, regardless of a group's grant being Edit. A direct Edit grant to a user or a group they directly belong to can elevate access. Admins always have unrestricted access.

Without a managing group, the original creator remains the personal owner and can edit. Assigning a managing group replaces this ownership-based editing permission; being the original creator no longer overrides that group. The managing group, personal owner, or global admin controls sharing and management. An explicit Edit recipient can edit content but cannot change its managing group or grant access.

View permits browsing, previewing, and using slides in editable playlists. It blocks content edits, deletion, publishing, moving, and tagging. Published playlists can be forked by viewers who want local changes. All mutation endpoints enforce these rules on the server.

Existing direct grants retain Edit permission on upgrade. Their inherited hierarchy access becomes View. New grants default to View. Existing ownership, sessions, publications, and player tokens are preserved. Configure a managing group on existing items when you want that group to control editing, and review old direct Edit grants if they should become View.

Removing a membership or grant removes only that source of access. Ownership, management, other groups, and direct assignments can still provide access. See [linked playlists and library organization](linked-playlists.md).

## Screen assignments and sharing

Select **Manage access** on a slide, playlist, screen, or media item to open its access settings in place. Slides and media have a labeled access footer; playlists and screens have a button beside their other controls. Use the separate **Groups** and **Users** dropdowns; only admins can assign individual users. Tags beside Manage access summarize current group grants and directly assigned users who do not already inherit access through a granted group. At most two tags appear, with a **+N more** control opening the full access dialog; compact Media cards show one tag. When both groups and direct users are present, the standard summary includes one of each. The dialog keeps its separate grant dropdowns above a scrollable list of existing Groups and Users, with full group paths and named removal controls. Admin access is automatic and does not require a grant. For individual user access to content, click a user under **Users & Groups > Users**. Users & Groups contains Groups, Users, and My password; the Sharing & assignments tab is removed.

- Admins can assign screens and other resources to individual users or groups.
- Personal owners and direct managing-group members can share with groups they belong to. Only global admins assign individual users.
- New content is private to its creator until shared. Legacy content and newly enrolled screens are initially visible only to admins.
- Sharing a screen also shares its current playlist and slides. Images attached to accessible slides or published playlists/screens appear as **Read-only** unless the recipient also has direct media access. Published images remain visible even after they are removed from the live draft. Recipients can view and pick those images, but cannot rename, retag, move, delete, or manage access to them. Sharing a folder includes direct access to its current images; sharing an individual image does not share its siblings.
- Sharing is an explicit grant, not a live folder rule. Share newly referenced slides or playlists with the resource owner and the same recipients before adding them to a shared playlist or screen. The server rejects references whose owner or recipients cannot access them, including every descendant of a group audience. A slide shared only with subgroup B cannot be added to a Group A playlist visible to sibling C until its viewing access is expanded. Attached images receive derived read-only access without a separate grant.
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

The sidebar footer shows the signed-in name beside the version and sign-out control. Hover or focus a slide’s **Live** badge to see the published playlists assigned to online screens that make the slide live.

Folders on Slides, Playlists, and Media are shared navigation metadata: all signed-in users can see every folder and its nesting, but only global admins can create, edit, reparent, delete, or manage access to folders. Legacy folder owners and Edit recipients no longer have folder management permission. Users can move their editable content into any existing folder; private and inherited read-only contents stay protected. No existing folder, content record, or grant is deleted by this policy change.
