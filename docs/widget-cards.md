# Split header widget cards

In the slide editor, add or select a data widget and choose **Card style → Split header**. Select a data feed and value field as usual. Existing widgets keep **Classic** until you change their style; switching back retains the card settings.

**Widgets → Table** adds a ready-made split-header table using a Categories field. Choose the application's table feed, such as **SMCC · production-tables**, then its table field. The preset starts with eight visible rows and a taller box. Set the unit and decimal places for the numbers supplied by your integration.

| Data widget | Split header appearance | Value field |
| --- | --- | --- |
| Metric | Large value with full-size decimals and raised prefix and unit | Number |
| Progress bar | Circular gauge with a separate goal badge | Number |
| Line graph | Latest value and filled sparkline | Series |
| Bar chart | Mini table or channel breakdown with white pill rows | Categories |

Cards use the fixed blue, navy, yellow, white, and Sky Blue palette. Choose **True Blue** or **Bentonville Blue** for the header. Body text stays navy. The classic accent, track, and orientation settings are retained but do not control this style. Resize the layer to fit your slide; a landscape card around 1.4 times as wide as it is tall is a useful starting point.

## Property groups

The sidebar groups settings by task. **Card style and title**, **Data source**, and **Value and number format** cover the basics. Open **Header and delta badge**, **Text size and alignment**, or **Card padding** for appearance changes. Gauge targets, maximum, and thresholds are together in **Goals and status colors**. Line statistics are under **Chart details**; table layout and row ranges are under **Table rows**. **Footer and freshness** combines footer labels, update time, and the stale-data limit.

Each section can be collapsed independently with its heading (or Enter/Space when focused). Appearance and footer sections start collapsed to reduce scrolling. The reorganization changes only the editor; existing saved settings and player rendering are unchanged.

## Values and comparisons

Open **Text size and alignment** to choose **Value alignment → Center**, Left, or Right for metric and line cards. Table alignment applies within the numeric column; row labels stay on the left. **Default** retains the original alignment, and radial gauges always stay centered. Centered metric cards put their optional comparison in the lower-right corner so it does not shift the main value off-center.

Set **Header text size (%)**, **Value text size (%)**, and **Detail text size (%)** independently, from 50% to 200%. Detail size controls supporting text, row labels, badges, statistics, and footer copy. Values still fit the available space, so long numbers and dense rows may stop growing before the requested size. **Horizontal body padding** and **Vertical body padding** accept 0–48 design pixels (16 by default); these scale with the card. Header and footer bands remain flush with the card edges. Existing cards keep their original sizes and padding.

To tidy a grid, **Ctrl+click** items on the slide or in the Layers list (**Command+click** on Mac) to add or remove them from the alignment selection. The first modifier-click keeps the previously selected item and opens arrangement controls. Alternatively, choose **Arrange layers** in the Layers panel. Select cards using the layer checkboxes or by clicking cards on the canvas; **Select all cards** selects every data widget. In Properties, align two or more selected layers by their left/right/top/bottom edges or horizontal/vertical centers. Select three or more to **Space evenly horizontally** or **Space evenly vertically**. Spacing uses equal gaps, including when card sizes differ, and preserves the selection's outside edges. Select one row or column at a time for a grid. If the cards cannot fit without overlapping, spread the outside cards farther apart first. Locked selections must be unlocked before arranging. Each operation is one Undo step; **Done arranging** returns to normal editing and dragging. On a phone, use Layers to select and Properties to arrange.

Use **Value prefix** for a currency symbol such as `$`, **Unit / suffix** for `%`, `B`, or `m`, and **Decimal places** for the displayed precision. A feed value of `78.45`, prefix `$`, and two decimal places produces a financial lockup. Values are not automatically divided into millions or billions; send the intended display scale from your integration.

Choose **Header badge → Delta pill** to place a comparison in the header. **Delta field** selects a number in the same feed; **Custom label** lets you enter text such as `+4.2% YoY` or `−6m faster`. The comparison is supplied by you or your integration, not calculated from previous snapshots. Metric cards with **Spark** or **None** display an optional comparison beside the main value instead.

For a progress card, **Gauge maximum** controls the ring scale, while **Fixed target** or **Target field** controls the goal badge. For example, value `94.2`, unit `%`, maximum `100`, and target `92` show a 94.2% ring and a 92% goal. Reaching the goal does not change the scale of the ring.

**Goals and status colors → Color thresholds** optionally adds red/yellow/green status. It starts **Off**. Choose **Higher is better** for percentages or output: green is at or above **Green goal**, yellow is at or above **Yellow threshold** but below the goal, and red is below the warning level. Choose **Lower is better** for wait times or exception counts: green is at or below the goal, yellow extends up to the warning level, and red is above it. Zero, negative, and fractional custom goals are supported. The warning must be on the correct side of the goal; equal cutoffs skip the yellow band. Comparisons use the unrounded feed value in its original units.

Circle cards default to **Use gauge target as green goal**, following the fixed Target or live Target field. Uncheck it to enter a custom Green goal; the goal badge then shows that same custom goal while colors are enabled. Switching colors Off restores the ordinary gauge target. Metric and line cards use the custom goal; line status uses the latest point. Headers, borders, and circle arcs change color; main values stay navy. Yellow headers use navy text and icons, and yellow circle arcs have a navy outline. Tables evaluate each row separately, coloring its outline and optional bar rather than giving the whole table one status. Accessible descriptions include the status. Missing data never appears successful; missing or incorrectly ordered live goals retain neutral colors with a message to check the goal/thresholds. Stale snapshots keep their last-value status and normal freshness label.

Circle cards display only the value in their center; the former **Score** caption is removed. The complete visible value, including decimal places and raised prefixes/units, is centered using the font’s measured glyph bounds. This centering refinement requires player **0.13.3**.

For a Categories card, choose **Row layout → Mini table** or **Channel breakdown**. **First row** selects the starting row (1–40), and **Visible rows** selects up to 40 rows. Larger tables need a taller box; use two cards with First row 1 and 21 and 20 visible rows each to split a 40-row field. A footer indicates the displayed range when rows are omitted. Under **Table rows**, uncheck **Show row range** to hide that label. It starts enabled; update times and custom footer labels remain independent. If the selected range is beyond a smaller incoming snapshot, the card shows **No rows in this range**. Changing feeds resets First row to 1.

A mini table can select a second categories field as **Row delta field**. Deltas match the primary rows by exact category label, so reordering comparison data does not move changes to the wrong row. Missing matches omit the badge. Changing feeds clears comparison bindings. Existing cards retain their configured visible-row counts; four remains the default outside the Table preset.

Line cards have a **Show min / avg / max** option, off by default. When enabled, the bottom row displays the minimum, arithmetic average, and maximum of the values in the current series snapshot, using the card's prefix, unit, and precision. This replaces the date labels without reducing the plot area. Statistics update with the feed and do not require additional requests or stored history.

**Supporting text** describes metric, line, and breakdown cards. Radial cards center the gauge and put a compact goal badge in the bottom-right corner, without supporting text underneath. Optional labels in **Footer and freshness** add context at the bottom of the card. Labels are user-entered text; OpenFrame does not certify or verify the underlying metric. Keep the existing last-updated display enabled when data freshness matters. Unavailable data and stale snapshots retain their normal status handling.

## Publication and players

Save the slide and publish its playlist to send card settings to assigned screens. Feed value updates continue through the existing snapshot sync and do not require republishing or restarting the active slide. Cards add no charting dependency, network request, animation, or timer of their own.

The editor supports these cards from server **0.25.1**. Install shared player **0.11.1** or newer for their appearance on Pi and Android TV. Updating the server alone does not update the Android APK or Pi player files. Include the complete `player/web/` directory and Pi agent when updating manually.

The Table preset, 40-row views, and First row control require server **0.26.1** and player **0.12.1**. Update affected players before publishing row ranges: older card players show at most the first eight rows and ignore First row. For downgrade saves, omit `rowOffset` and reduce `maxRows` to eight or fewer before editing with an older server. Tables still use the existing categories/bar contract and manifest schema 4, with no feed migration.

Text sizing, value alignment, and body padding require server **0.26.2** and player **0.12.2**. Older card players ignore these presentation fields and retain their original appearance. Arrangement updates the existing layer coordinates and works on older players. For downgrade saves, remove `valueAlign`, `titleScale`, `valueScale`, `detailScale`, `paddingX`, and `paddingY` before importing into an older server.

Goal colors and caption-free circles require server **0.27.1** and shared player **0.13.1**. Older players ignore the threshold settings and still display Score. To save on an older server, remove `thresholdMode`, `thresholdGoal`, `thresholdWarning`, and `thresholdUseTarget`. Feed and manifest schemas remain unchanged.

The manifest schema and feed ingestion payloads are unchanged. Older players that already support data widgets display their existing classic layout from the same primary value. Updated players still display older publications. Older servers do not accept the new card settings when saving an edited slide; switch affected widgets to Classic and remove their optional `card` configuration before importing into an older server.

Browser checks cover editor/player rendering, live updates, and compact layouts. They do not establish performance on a physical Onn stick or Pi; include the cards in your normal device playback check before relying on a dense dashboard.

Hiding the row-range footer requires server **0.27.3** and player **0.13.2**. Older players ignore `showRowRange: false` and continue showing the range. Omit `showRowRange` when saving on an older server.
