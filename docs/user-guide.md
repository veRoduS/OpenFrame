# OpenFrame user guide

## First playlist

The playlist's Add slides tab marks slides already included with **In playlist**, including their entry count when repeated. Adding another copy requires confirmation; Cancel leaves the playlist unchanged. Existing repeated entries remain supported and can have independent durations and schedules.

1. Create a slide. New slides have a white background; change it with the Background color swatch in the editor header. Add text, images, a clock, a count-up/countdown widget, or [NWS weather](weather.md). Weather supports US ZIP lookup, current observations or a six-hour forecast, and offline weather icons. Matching locations share server requests and cached player snapshots; no API key is needed.
2. Drag layers on the canvas or resize photos with the four corner handles. Proportions stay locked unless disabled in Properties. Text supports top/middle/bottom alignment and automatic sizing to fit its box. With Image fit set to Fill, choose Adjust crop to drag the photo inside its frame. Zoom and horizontal/vertical sliders adjust the crop without changing the source file. Reset crop restores the centered, unzoomed view. Save the slide.
3. Create a playlist, add slides, choose durations, and reorder them with the arrows.
4. Publish the playlist. Publishing stores a snapshot; later slide edits do not change screens until you publish again.
5. Pair a player using its displayed code, then assign the published playlist in Screens.

Screens supports naming, assignment, last-seen status, rotation, a black display, refresh, restart, and credential revocation. Changes normally reach a connected player within 15 seconds, plus download time. Online status means a recent agent heartbeat, not proof that a physical monitor is working.

Choose **Screens > Screen setup** to import WireGuard clients, track available/allocated configurations, and download a per-screen ZIP with server, optional VPN, first-boot Wi-Fi, and Cloudflare Access settings. Secrets are encrypted on the server; downloaded bundles are private plaintext files. See the [setup builder guide](screen-setup.md) before copying files onto an SD card. Normal pairing approval is still required.

When leaving an edited slide or playlist, choose Save and continue, Discard changes, or Keep editing. Save and continue waits for a successful save; a failed save leaves the editor open. This covers the editor Back action, browser Back from the editor, closing the playlist editor, and same-window links. Reloading, closing a tab, or entering another address uses the browser's native unsaved-changes warning; browsers do not permit a custom Save button there. Cancel that warning and save in the editor first. Saving a playlist draft does not publish it.

Counters automatically count down to future targets and count up from past targets; there is no direction selector. An optional Goal message replaces the entire counter at the target and stays visible instead of counting up afterward. Leave it empty for normal automatic counting. Choose seconds, minutes, hours, or days as the granularity. Count up shows complete elapsed units; count down rounds remaining units up. A day is 24 hours, not a calendar-day boundary. Prefix and suffix fields add plain text around the number and optional unit label. Clock and counter widgets have four corner resize handles; auto-sizing fits the complete text or goal message into the resized box. The editor accepts local time and stores an explicit UTC timestamp; players need a correct system clock, including after an offline reboot. Existing Pis need the updated complete `player/web` directory for this behavior, including automatic handling of legacy counters and goal messages.

Images are decoded, resized to at most 1920 pixels per dimension, and stored as WebP. Upload limit: 15 MB and 25 megapixels. Text is rendered as text, never as executable HTML.

## Organize media

Media supports named folders, image tags, filename/tag search, tag filtering, and grid/list views. Sort by name, upload date, or file size in either direction. The editor's image picker includes the same folder and search controls.

Select individual images or all visible results to move, add/remove tags, or delete them together. Click an image to rename it or edit its folder and full tag list. Select a folder, then choose Rename folder in the Media toolbar to change its name without moving its images. Tags are normalized to lowercase and deduplicated, with a limit of 30 per image. Uploading multiple files puts them in the current folder. Folders are single-level and must be empty before deletion.

Deletion is blocked if any selected image is used by a saved slide or a published playlist; no images in that selection are deleted on failure. A published snapshot can still reference an image even after the draft slide changes. Existing untagged media remains available under Unfiled; its original URL is unchanged.

To use cropping, counters, and prepared-frame playback on an existing Pi installation, update `player/agent.py` and the complete `player/web/` directory, then restart the agent and kiosk. Include all JavaScript modules, not just `player.js`. Updating the Docker server alone does not update installed player code. Existing slide backgrounds, colors, and saved formatting are preserved. Older images default to a centered crop at 1x zoom, with no data migration.

## Prepared playback

Each playlist entry has a **Schedule** toggle. Date/time fields are hidden when it is off, and the entry plays without date limits. Turning it back on restores retained dates. Entries saved before this toggle was added are enabled automatically when they already contain a start or expiration date. Save and publish toggle changes to apply them to players.

In Edit playlist, each entry has optional **Starts at** and **Expires at** date/time fields. Empty fields mean no lower or upper limit. Times are entered in the browser's local timezone and saved as absolute UTC instants; expiration must be later than start. Save and publish to apply changes to devices. The same slide can have different windows in different playlist entries.

Players evaluate these windows locally, including offline. Start is inclusive; expiration is exclusive and can interrupt a slide before its duration ends. If no entries are eligible, the screen stays empty until one becomes eligible. All publication assets, including future entries, are downloaded ahead of time; frames still require preparation before display. Keep Pi clocks synchronized and update the complete `player/web` directory before publishing schedules: older players ignore these fields. Recurring weekday/time-of-day schedules are not included.

The agent downloads and checksum-verifies every image in a publication before committing its manifest to disk. The browser then maintains one visible slide and one next-slide frame. It constructs the next frame offscreen, decodes its actual image elements, waits for widget readiness and fonts, and completes text layout before making it eligible to display. At the deadline it activates the prepared widgets and swaps frame visibility in one synchronous operation; the outgoing frame is then disposed.

If the next frame is late, the current complete slide remains visible. If preparation fails or exceeds its 15-second readiness timeout, the player reports the error and retries after two seconds. The next slide receives its full scheduled duration once displayed. New publications, rotation changes, and refreshes also keep the current frame up until their replacement is ready. Blanking and revocation deliberately clear the display immediately. A one-slide playlist stays mounted rather than repeatedly rebuilding.

Only visible widgets run update timers. Counters wake at their selected unit boundary. Clock format supports HH:MM or HH:MM:SS plus a 24-hour time toggle; defaults are HH:MM in 12-hour time with AM/PM. Clocks wake once per minute or once per second according to that setting. Editor and player use their machine's local timezone. Existing Pis need the updated complete `player/web` directory, including `clock.js`. Cancelled frames release image elements, widget resources, and timers. Local images use immutable browser caching and are streamed by the agent without copying the entire response into memory.

Screens shows the browser's playback phase, last preparation time, delayed-switch count, and readiness error. A delayed-switch count means the player held a slide past its deadline; it is cumulative for the browser session. The browser reports to the local agent every five seconds, and the agent includes this in its normal server heartbeat. No browser report for 30 seconds is reported as stalled.

This removes the clear-then-load transition path, but is not a guarantee of zero dropped frames on every device. Two complex slides can still exceed a small device's memory or rendering capacity, and browser decoding/layout tests do not measure HDMI output or GPU composition. Start with a representative photo/widget loop and measure on your target Pi. See [docs/playback-testing.md](playback-testing.md) for the hardware acceptance checklist.
