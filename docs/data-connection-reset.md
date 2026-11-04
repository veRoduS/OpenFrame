# Reset data connections and keep widgets

Server **0.30.2** lets administrators remove old metric connections while keeping
the slide layouts ready for replacement sources. This is a server/web feature;
no new APK is required.

## Delete selected connections

- Open a feed under **Settings → Data feeds**, select **Delete feed**, and
  confirm. Its feed-specific API keys and stored values are deleted. Widgets
  pointing at that feed become disconnected in drafts and published playlists.
- Expand **Applications**, select **Manage keys** for an application, then
  **Delete application**. Confirming deletes that application's feeds, source
  mappings and all application/feed API keys together. Its referenced widgets
  become disconnected, including store-relative sources.

Deleting just one feed leaves its application keys active; a later application
push can recreate a feed. Delete the application, or use the full reset below,
when you need those keys to stop accepting data too. Other applications and feeds
are retained by individual deletion. A relative widget using another remaining
example feed keeps its source binding; a missing local feed remains unavailable.

## Reset all connections

1. Select **Reset all data connections** under **Settings → Data feeds**.
2. Review the counts of applications, feeds, API keys and affected widgets.
   The reset covers **all sites**, including connections outside the current filter.
3. Type **RESET** and select **Delete connections and keep widgets**.

This deletes application definitions, feeds, metric values, source mappings and
their API keys. Sites, groups, screens, slides, playlists, media and widget
positions/sizes/formatting remain. A changed scope requires another review.
Cancel leaves connections unchanged. Deletions and widget disconnections commit
together; an error rolls back the entire operation. Deletion events remain in
site history.

Published playlist snapshots receive a new revision with disconnected widgets.
Screens clear the old values on their next successful sync and render
**Waiting for data**. Offline screens retain their cached content until they
can sync; the reset cannot contact an offline player.

## Reconnect widgets later

Create a new application/key for the correct site and push its metrics, or
create a replacement manual feed. Open a slide, select a retained widget, and
choose its replacement under **Data source → Data feed**. Compatible value,
goal, delta and table-field choices are kept. Review choices that are absent or
have a different type in the replacement source. Existing card appearance and
table range settings remain.

Select a source under **Follows each screen’s store** to restore local metrics,
or deliberately select a fixed feed. Save the slide; saved updates to already
published content reach screens through the normal sync flow. The new feed or
application has a new identity, so matching names do not silently reconnect it.

Disconnected widgets can be edited, saved, shared and published while waiting
for the replacement integration. Their source is `feedId:null` with no
`siteBinding`; field names and presentation settings are retained.

## Management API

These are administrator-session operations with the normal origin checks, not
API-key ingestion methods:

| Request | Behavior |
| --- | --- |
| `DELETE /api/data-feeds/:id?disconnectWidgets=true` | Delete the feed and feed-specific keys; disconnect referencing widgets. |
| `DELETE /api/data-feeds/applications/:id?disconnectWidgets=true` | Delete the application, its feeds and keys; disconnect referencing widgets. |
| `POST /api/data-feeds/reset/preview` | Return `revision` and `counts` for a full reset. |
| `POST /api/data-feeds/reset` | Require `{ "confirmation": "RESET", "revision": "<review revision>" }`; delete all metric connections and disconnect widgets. |

A stale review returns 409 `RESET_CHANGED` without changing anything. Ordinary
users and ingestion keys cannot perform these operations. Without the explicit
`disconnectWidgets=true` option, existing delete APIs keep their 409 protections
for used feeds or applications that still contain feeds. Arbitrary missing feed
IDs remain invalid; an intentionally disconnected widget uses `feedId:null`.
