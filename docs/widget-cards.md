# Split header widget cards

In the slide editor, add or select a data widget and choose **Card style → Split header**. Select a data feed and value field as usual. Existing widgets keep **Classic** until you change their style; switching back retains the card settings.

| Data widget | Split header appearance | Value field |
| --- | --- | --- |
| Metric | Large value with raised prefix, decimals, and unit | Number |
| Progress bar | Circular gauge with a separate goal badge | Number |
| Line graph | Latest value and filled sparkline | Series |
| Bar chart | Mini table or channel breakdown with white pill rows | Categories |

Cards use the fixed blue, navy, yellow, white, and Sky Blue palette. Choose **True Blue** or **Bentonville Blue** for the header. Body text stays navy. The classic accent, track, and orientation settings are retained but do not control this style. Resize the layer to fit your slide; a landscape card around 1.4 times as wide as it is tall is a useful starting point.

## Values and comparisons

Use **Value prefix** for a currency symbol such as `$`, **Unit / suffix** for `%`, `B`, or `m`, and **Decimal places** for the displayed precision. A feed value of `78.45`, prefix `$`, and two decimal places produces a financial lockup. Values are not automatically divided into millions or billions; send the intended display scale from your integration.

Choose **Header badge → Delta pill** to place a comparison in the header. **Delta field** selects a number in the same feed; **Custom label** lets you enter text such as `+4.2% YoY` or `−6m faster`. The comparison is supplied by you or your integration, not calculated from previous snapshots. Metric cards with **Spark** or **None** display an optional comparison beside the main value instead.

For a progress card, **Gauge maximum** controls the ring scale, while **Fixed target** or **Target field** controls the goal badge. For example, value `94.2`, unit `%`, maximum `100`, and target `92` show a 94.2% ring and a 92% goal. Reaching the goal does not change the scale of the ring.

For a bar-chart card, choose **Row layout → Mini table** or **Channel breakdown**. **Visible rows** limits the display to the first 1–8 categories; four is the default. A mini table can select a second categories field as **Row delta field**. Deltas match the primary rows by exact category label, so reordering the comparison data does not move changes to the wrong row. Missing matches omit the badge. Changing the data feed clears comparison bindings to the previous feed.

**Supporting text** describes the metric. Optional **Footer labels** add context at the bottom of the card. Labels are user-entered text; OpenFrame does not certify or verify the underlying metric. Keep the existing last-updated display enabled when data freshness matters. Unavailable data and stale snapshots retain their normal status handling.

## Publication and players

Save the slide and publish its playlist to send card settings to assigned screens. Feed value updates continue through the existing snapshot sync and do not require republishing or restarting the active slide. Cards add no charting dependency, network request, animation, or timer of their own.

The editor supports these cards from server **0.25.1**. Install shared player **0.11.1** or newer for their appearance on Pi and Android TV. Updating the server alone does not update the Android APK or Pi player files. Include the complete `player/web/` directory and Pi agent when updating manually.

The manifest schema and feed ingestion payloads are unchanged. Older players that already support data widgets display their existing classic layout from the same primary value. Updated players still display older publications. Older servers do not accept the new card settings when saving an edited slide; switch affected widgets to Classic and remove their optional `card` configuration before importing into an older server.

Browser checks cover editor/player rendering, live updates, and compact layouts. They do not establish performance on a physical Onn stick or Pi; include the cards in your normal device playback check before relying on a dense dashboard.
