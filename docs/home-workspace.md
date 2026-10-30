# Home workspaces and group filters

Admins other than the account whose username is `admin` can choose a home
workspace using **Set home store/group** beneath their name in the bottom-left
sidebar. Choose either a store or a group. A store needs an access group
configured under **Settings → Data feeds → Sites**, so its slides and playlists
can be matched to the right group.

Choosing a home workspace starts **Home mode**. The switch beside the account
controls changes between Home mode and Admin mode:

- Home mode focuses slides and playlists on the home group, its subgroups, and
  shared ancestor templates. Screens and metrics follow the selected store, or
  stores belonging to the chosen group. Referenced media remains available.
  Admin-only navigation, screen transfers, revocation, and global setup controls
  are hidden.
- Admin mode restores the normal workspace and admin controls. Switching modes
  clears the list filters so a previous selection does not hide the new scope.
- Choosing **None — full workspace** removes the preference and restores the
  previous behavior. With no home selected, no mode switch is shown. If the
  store is archived or its group becomes unavailable, the full workspace is
  used until a valid home is selected or the store becomes available again.

The home selection is saved to the user's account. The mode is remembered per
user in the current browser. The built-in `admin` account always keeps its normal
workspace; regular users' permissions and navigation are unchanged. Home mode is
a visibility preference: it does not change the admin's account role or API
authorization.

**Slides**, **Playlists**, and **Screens** have a Group selector beside the
search controls, including on phones. Choose All groups, a group (including its
subgroups), or No visible group. Slides and playlists include shared ancestor
content. Group selection combines with the existing search, status, tag, and
screen-site filters; Clear filters resets the list controls. In Home mode, group
filters operate inside the home workspace and cannot expand its visible scope.

For custom management clients, `GET /api/auth` includes nullable `user.home` with
`siteId`, resolved `groupId`, and `label`. An eligible admin can update only their
own preference through `PATCH /api/account/home` with either `{ "siteId": "UUID"
}` or `{ "groupId": "UUID" }`. Send both fields as null to clear it; supplying
both identifiers is invalid. Other accounts cannot be targeted through this
endpoint. Selecting an unavailable store/group is rejected. The `admin` account
and non-admin users receive 403 when attempting to set a home preference.
