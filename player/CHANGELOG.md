# Player changelog

The Pi agent and Android TV app share this player version. Server versions are
tracked independently in the root `CHANGELOG.md`. Earlier combined history also
remains in that file.

## [0.12.1] - 2026-10-20

- Render up to 40 table rows with bounded adaptive layouts, selectable row ranges, and visible truncation status.

## [0.12.0] - 2026-10-20

- Release the shared split header card renderer with live statistics, centered gauges, compact goals, and normalized value typography.

## [0.11.5] - 2026-10-20

- Render live line-series minimum, average, and maximum summaries and centered gauges with bottom-right goal badges.

## [0.11.4] - 2026-10-20

- Expand split card gauges, plots, and primary values; fit goal badges to their labels and remove radial supporting text.

## [0.11.3] - 2026-10-20

- Place raised percent and magnitude units directly beside values without estimated-width gaps.

## [0.11.2] - 2026-10-20

- Normalize split card decimal digits to the main value size and baseline in the shared editor/player renderer.

## [0.11.1] - 2026-10-19

- Render split header data cards with the shared lightweight SVG renderer, live feed comparisons, bounded category rows, freshness states, and classic fallback compatibility.

## [0.11.0] - 2026-10-18

- Release bounded offline video playback and player resource cleanup from local revisions 0.10.15–0.10.16.
- Support schema 5 video with verified 256 MiB local caches, byte ranges, one active decoder, silent loops, and poster fallback. Multiple players can replay independently without repeatedly downloading clips.
- Bound Pi API responses and release unused custom fonts. Retain schemas 1–4 and existing pairing; physical Onn/Pi video and long-duration acceptance remain outstanding.

## [0.10.16] - 2026-10-17

- Bound Pi API responses to Android's 4 MiB limit, preserving the current cached publication on oversized responses.
- Reference-count custom fonts across visible/prepared frames and release unused faces, including late completions after cancellation. Existing schemas 1–5 and media contracts remain supported.

## [0.10.15] - 2026-10-17

- Cache and play silent video locally with bounded storage, byte ranges, lifecycle cleanup, and poster fallback.
- Accept schema 5 from server 0.24.1 while preserving schemas 1–4; cap media at 25 MiB per file and 256 MiB total, protecting current playback during downloads.
- Use one active video with poster-only preparation, cut transitions, silent loops, startup/stall error reporting, and guarded Android background/resume cleanup. Desktop and native tests pass; physical Onn/Pi and long-duration playback acceptance remain outstanding.

## [0.10.14] - 2026-10-07

- Allow workspace previews to display the actual published playlist without saving the draft.

## [0.10.13] - 2026-10-06

- Render live data metrics, progress bars and charts with cached snapshots and manifest schema 4

## [0.10.12] - 2026-10-05

- Add hosted server code shortcut

## [0.10.11] - 2026-10-04

- Render shapes, vertical weather and stock quotes; accept schema 3 and retain schema 1/2 support

## [0.10.10] - 2026-10-04

- Accept existing OPENFRAME_ANDROID signing secret names in GitHub APK builds

## [0.10.9] - 2026-10-04

- Add Android device sleep guidance and normal power settings access

## [0.10.8] - 2026-10-03

- Accept playlist schema 2 on Android and Pi players

## [0.10.7] - 2026-10-03

- Render removed media placeholders from synchronized playlists

## [0.10.6] - 2026-10-03

- Cache custom fonts with published playlists

## [0.10.5] - 2026-10-02

- Make automatic update checks optional and off by default while preserving manual checks

## [0.10.4] - 2026-10-02

- Fix Android enrollment status handling and use GitHub updates independently of the server version

## [0.10.3] - 2026-10-02

- Establish the independent player version at the existing Android/Pi baseline,
  including Android update discovery, verified downloads, and user-confirmed
  installation. No player behavior changes accompany this separation.
