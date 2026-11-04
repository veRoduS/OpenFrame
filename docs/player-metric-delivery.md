# Selective metric delivery: proposed follow-up

Status: assessed, not implemented. Players currently receive the complete data
snapshot for every referenced feed. The configurable field-limit revision does
not change delivery.

This is a moderate server-side change with focused compatibility tests. Existing
players consume named fields from snapshot objects, so an APK change is not
expected. Benefits depend on unused data size, player count and sync frequency;
there is no measured throughput or device-performance claim yet.

## Implementation scope

1. Resolve each shared widget to its approved screen's store feed using existing
   authorization. Preserve unavailable-data behavior without cross-store fallback.
2. Collect the union of required fields per feed across the entire published
   playlist. Include the main metric/series/table field, dynamic goal field,
   numeric delta field, table comparison field and threshold goal dependencies.
   The entire playlist matters for transitions and offline playback.
3. Project only those fields into sync and preview snapshots. Keep full feeds
   in the database and authenticated management API. Send complete selected
   series/table arrays initially; filtering individual rows/points adds separate
   pagination and comparison concerns.
4. Include the field selection in the effective snapshot revision, so republishing
   with a different field set updates cached snapshots even when source values
   have not changed. Confirm that omitted fields are removed from cached snapshots
   and do not reappear during offline playback or screen/store reassignment.
5. Test all widget modes, goals/deltas/comparison rows, shared stores, publication
   edits, blank/revoked screens, mixed playlists, browser previews and Python/Android
   cached delivery. Retain authorization and revocation checks before projection.
6. Compare serialized response bytes, server work and player parsing/cache behavior
   for representative numeric feeds and larger table/series feeds. Most savings
   should come from leaving unused arrays and fields on the server. Database writes
   will still process the full incoming source data.

This can be delivered as one focused follow-up revision without changing SMCC's
payload contract. Small numeric feeds may see modest savings; large unused tables
and many players offer greater potential savings. Compression and real device
checks are still needed before quantifying the improvement.
