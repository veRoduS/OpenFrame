# Sites and shared metric layouts

Server **0.29.3** and player **0.15.2** support site enrollment, local metrics in
shared layouts, reviewed screen transfers, legacy feed assignment, site access
groups, audit history, and saved site filters. Initial enrollment/site support
started in server 0.29.2 / player 0.15.1. These changes remain local until
separately published.

## New location

1. In **Settings → Data feeds → Sites**, create a site number and name. Numbers
   are strings of 1–20 digits: `001` and `1` identify different sites.
2. Create or select an application and generate an application API key for that
   site. Configure the external application with that key. Use the same source
   name at every site, for example `production`; each site's values are separate.
3. Enter the site number in Android setup, Pi first-boot setup, or **Screen
   setup** when generating the Pi configuration. Older players may omit it.
4. Under **Screens**, enter the pairing code and confirm the approved site. The
   requested number supplies a suggestion; it does not authorize the player.
   Once any site exists, pairing requires an active site selection.
   Any signed-in member of the store's configured **Access group**, including
   its subgroups, can approve a pending screen that requested that store.
   Group administrator status is not required. Other stores' pending screens
   are hidden, and members cannot change the requested store during approval.
5. Assign a published playlist. Keep existing user/group sharing in place: site
   matching is an additional delivery restriction, not a replacement for grants.
   Share the relevant local feeds and screen with the appropriate group.

Use the Site selectors to filter Screens and Data feeds. Screen connected,
offline, and pending counts follow that filter. All sites remains available to
central administrators. Existing group and resource permissions control what each
signed-in user can access. Optionally choose an **Access group** for a site:
non-admin users must belong to that group or one of its descendants AND have the
usual resource permissions. An ancestor/sibling group or an explicit user share
cannot bypass that site gate. Administrators retain access. Leave the field at
**Resource sharing only** to preserve existing access rules. Templates and media
continue using their existing resource permissions; the site gate covers screens
and feeds. Revoked membership removes access on the server immediately.

To enable store staff to pair screens, an administrator selects the site's
**Access group** and adds staff accounts to that group (or its subgroups).
When creating a site, the form preselects the one group whose name contains the
site number as a whole number (for example `Store 042` for site `042`). Matching
is exact, so `Store 42` is not suggested for `042`; with no match or several
matches nothing is preselected. Review the suggestion before creating the site.
Members see their eligible pending screens even before the store has any feeds
or approved screens. Member approval records the acting user in site history and
shares the screen with the store access group, including subgroup members. The
screen does not depend on the approving user's personal account remaining active.
Share local feeds and playlists with the appropriate recipients separately;
approval does not grant access to metric data or content. If no access group is
configured, or an older player supplied no site number, an administrator must
approve the screen. Changing an already approved screen's site, site settings,
API keys, and screen revocation remain administrator operations.

## One layout, local values

In a data widget's **Data source** section, choose a source listed under
**Follows each screen’s store**. Each application source appears once, however
many stores send it, and new data widgets pick one automatically when it has a
suitable field. Authors do not handle API keys or per-store feeds: the server
selects the concrete feed using each screen's approved site. One store's feed
supplies the example fields in the editor. Feeds listed under **One fixed feed**
always show the same values.

Publish the shared playlist once and assign it to multiple sites. Goals, deltas,
series, and category/table bindings must have compatible fields at each site.
Missing, inaccessible, or incompatible local sources display unavailable data;
values never fall back to another location. A source first created later becomes
available through normal sync without republishing the layout. Ordinary value
updates do not change the effective playlist revision or restart slides.

Playlist previews have a **Preview site** selector and use the same resolver as
player sync. Without a preview site, relative bindings are unavailable. Editor
field selection uses the chosen example feed. Fixed-feed widgets retain their
explicit binding and can play only on a screen in that feed's site; unassigned
legacy feeds play only on unassigned screens.

## Existing location

Back up the server's data before conversion. Upgrade existing Pi/Android players
to **0.15.1** and wait for their version heartbeat. In the application's key
dialog, choose **Site for existing integration → Assign existing integration**.
This assigns all that application's unassigned keys and sources together, keeping
secret hashes, feed IDs, values, fields, and published references intact. Already
assigned keys and sources remain at their sites.

For a manually defined legacy feed, open its details, choose **Original site**,
and select **Assign feed site**. This preserves its feed ID, existing feed-specific
keys, fields, values, and published bindings. Its site is then fixed. New manual
feeds require a site once locations exist. Application-managed feeds must be
assigned together through their application, rather than individually.

The destination must not already have a same-named source for that application.
A conflict rejects the entire operation without overwriting or partially moving
data. Retrying a completed assignment is harmless. If legacy data already mixed
multiple locations, it cannot be split automatically; review it before assigning.

Under Screens, use **Assign site** for an approved unassigned screen. The server
requires a 0.15.1-or-newer heartbeat for this operation. On receiving the assignment,
the upgraded agent clears old metric snapshots and active content before trying
to download replacement media. If the download fails or the player restarts
offline, the previous site's metric values do not return. During conversion a
screen can temporarily show unavailable metrics until both feed and screen
assignments agree.

## Transfer a screen

Upgrade the screen to **0.15.2**, let it report its version, and choose **Transfer
site**. Select the destination and **Review transfer**. The review lists missing
local sources or field mismatches. Shared playlists remain assigned; a playlist
with fixed metrics from another site is unassigned. The server rejects a stale
review if the assignment, publication, bindings, or sharing changed meanwhile.

A transfer resets the screen's access to administrators and cancels outstanding
commands. Previous location shares are removed. Re-share the screen with the
appropriate destination group afterward. Data feeds, user accounts, and playlist
content are not moved by this operation.

The screen shows **Transfer pending** until the player confirms it has persisted
a cleared cache for the new assignment. Assignment revisions prevent delayed
responses from restoring older site data, even after a failed download or offline
restart. “Previous site cache cleared” confirms cache invalidation, not successful
media download or physical-panel playback. Another transfer stays blocked until
that confirmation arrives.

A disconnected screen can keep showing its old content until it reconnects. Wait
for the clearing confirmation before physically moving it. If it cannot reconnect,
retire its server record and reset its local identity/cache before enrolling it at
the destination. On Android, clear app data; on Pi, stop the agent and kiosk, clear
their local identity/playback cache, and re-provision the dedicated player. Never
reuse another screen's token or provisioning bundle.

## History and saved views

Open **Settings → Data feeds → Site history** to load administrative events.
History records actor/resource names, scope and action, excluding raw credentials
and metric payloads. It includes site edits, key issuance/revocation, approvals,
legacy assignments, transfer requests, and player clearing confirmations. Filter
by site or load older entries. Failed changes roll back their audit record and
resource mutation together. Existing pre-upgrade actions are not reconstructed.

Screens, metrics and preview site selections survive navigation and reload in the
current browser session. They are isolated by user, cleared on sign-out, and
removed when the selected site is no longer accessible.

## Operations and compatibility

Archiving a site stops new enrollments, new keys, and metric ingestion; saved
values remain available to already approved screens. It does not remotely blank
or revoke those screens. Restore the site to resume writes.

The player receives concrete feed IDs and only the permitted snapshot values.
Site-relative authoring fields are removed from the delivered manifest. Existing
manifest schema versions stay unchanged. A site's effective publication revision
includes its resolved bindings, so a changed mapping refreshes correctly while
metric-value updates remain independent. Revoked/removed snapshot values are
cleared before replacement media downloads, so a failed download cannot preserve
values the server has stopped authorizing.

Application ingestion allows 60 requests/minute per application/site across all
its keys and sources, plus 600/minute across the application. Unassigned legacy
keys share their own 60/minute scope. Denied requests for a saturated site do not
consume other sites' aggregate budget. Feed-specific keys retain 60/minute per
feed. The global 200-feed and 20-active-keys-per-application limits remain.

New players can still use older servers, but those servers ignore the optional
site number and cannot provide multi-site separation. New servers accept older
players for initial pairing; upgrade existing approved players before assigning
their first site. Older servers reject `siteBinding` during authoring. Rollback
requires restoring the matching pre-upgrade server and database together. Once a
0.15.2 player has seen a positive assignment revision, it rejects older or missing
revisions on that server origin; reset/re-provision its state when deliberately
rolling the server back. Fresh players can still connect to older servers.

Physical TV/Pi enrollment, installation, and long-running playback still require
device acceptance. No APK, source branch, or deployment is published by this work.
