# Linked playlists and library organization

See the [user guide](user-guide.md#linked-playlist-forks) for the complete workflow and [View and Edit permissions](users-and-groups.md#view-and-edit) for group access.

For example, Group A manages a master safety playlist. Groups B and C below A can view and use it. B creates a linked fork managed by B, adds local announcements, changes selected durations, and chooses a custom order. Publishing A updates B's inherited entries while keeping B's published local changes. C's playlist and the master remain independent of B's overrides.

B's direct members can edit its fork. A can view it through the hierarchy; C does not inherit access to its sibling. Direct Edit grants and global admin permissions remain available when collaboration across these boundaries is needed.

In a fork's Sequence, turn on **Skip** beside a slide to omit that entry from
playback while keeping it available for restoration. Skipping does not change
the master or another fork. Repeated uses of the same slide have independent
Skip settings. Skipped entries remain in the editor, marked **Skipped in this
fork**, and do not contribute to playback counts or duration. Turn Skip off to
include the entry again. At least one entry must remain included to publish.

Use **Save draft** to stage Skip changes, then **Publish playlist** to apply
them to screens. Automatic master publications retain the fork's published Skip
settings without publishing its local draft. Following master order keeps local
entries anchored even when their preceding master entry is skipped; custom order
and timing overrides continue to work. A fork of a fork inherits only the entries
its master actually published. Players receive ordinary flattened playlists and
need no player update for Skip.

Slides and Playlists each have separate nested folders and lowercase tags. Use these together with group, status, name, and sort filters. Moves and tags only organize content: putting a slide in a group-managed folder does not share it, and moving a fork does not change its managing group or master.

Existing publications, user credentials, player tokens, and content are preserved on upgrade. Old direct grants retain Edit, while inherited hierarchy access becomes View. Configure managing groups and review old direct grants when adopting the new model. Existing players receive ordinary flattened playlists and need no update for these features.
