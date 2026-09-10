# Playback acceptance on Raspberry Pi

Automated tests validate sequencing, decoding/readiness gates, cleanup, offline publication commits, and state reporting. They use modeled DOM/history and timers where appropriate. They do not measure Chromium painting, GPU uploads, HDMI output, or a physical Zero 2 W. No hardware performance claim has been established for this release.

## Test setup

Use the intended Pi model, display resolution, OS/Chromium version, power supply, SD card, and Wi-Fi conditions. Update the complete player code before testing counters and crops. Verify the system clock, especially after offline startup. Record the version and resolution with the results.

Create a published loop with representative content: full-slide photos, a few layered photos, long auto-sized text, clocks and counters at each granularity, and a plain white slide that makes transient blanks easy to notice. Include short two-second slides as a stress case and the durations you actually intend to deploy. A loop of very complex 50-layer slides is not an appropriate baseline for a 512 MB device.

## Acceptance checks

1. Film at least 100 transitions, including repeated loop boundaries. Content should appear as a complete slide, without an intermediate empty frame or late image/widget pop-in. Check crop and text alignment against the editor. Camera rolling shutter can create artifacts, so inspect suspected failures over repeated transitions.
2. Check Screens for preparation times, waiting errors, and delayed-switch counts. A ready next slide should switch at its deadline. When preparation is deliberately delayed in a development widget, the old complete slide should remain visible until it is ready; its replacement should then receive its full duration.
3. Introduce a failing development widget or unreadable local image in a disposable player cache. The old slide should remain, an error should be reported, and playback should recover after correcting the fault. Do not damage a production cache for this check.
4. Republish while a photo-heavy slide is visible. Verify the old frame stays intact until the new publication's first frame is ready. Repeat with rotation and refresh. Blanking and revocation are intentional exceptions that stop display immediately when received.
5. Disconnect Wi-Fi after a successful sync, loop content, and reboot offline. Cached slides should play. Interrupt a new publication download; the prior complete publication should remain active. Restore connectivity and verify recovery.
6. Run for at least 24 hours. Inspect Chromium and agent memory, CPU, SD storage, and system logs. Live frame count should stay at one visible plus at most one next frame, but decoded-image caches and Chromium overhead still need measurement. There should be no continuing memory growth, OOM kills, browser crashes, or increasing delays.
7. Exercise display rotation, HDMI reconnect, monitor sleep/wake, remote blank/unblank, restart, and credential revocation. Check stalled reporting by stopping only Chromium while leaving the agent running.

## If it falls behind

Compare preparation time with the current slide's duration. Reduce simultaneous photo layers or widget complexity, reduce output resolution, or lengthen durations and repeat the test. Images are limited to 1920 pixels per dimension at upload, but each decoded image still consumes substantially more memory than its compressed WebP file. Two prepared frames bound live renderer resources; they do not establish a fixed total RAM limit for Chromium.

The player intentionally favors a complete held slide over a partially loaded next slide. Sustained missed deadlines mean the content or device needs adjustment, not that the issue should be hidden by forcing a transition.
