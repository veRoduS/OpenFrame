# Widget extension contract

The built-in widgets are a clock, a count-up/countdown counter, and [NWS weather](weather.md). Clock and counter work without a network connection; weather uses cached server snapshots. All share typography, alignment, and auto-sizing with text layers. Widgets are trusted source-code extensions, not remotely installed packages.

## Clock configuration

Clock layers accept `clock: { "showSeconds": false, "hour12": true }`. The editor's Clock format selects HH:MM or HH:MM:SS, and the 24-hour time toggle selects between 12-hour time with AM/PM and 00-23-hour time. Defaults are HH:MM and 12-hour time, including older layers without clock settings. Both editor and player use the machine's local timezone.

The player prepares a reusable formatter per clock and only runs its timer while visible: once per minute without seconds, or once per second with seconds. Existing Pis need the updated complete `player/web` directory, including `clock.js`, before these settings take effect. Updating the Docker server does not update installed player files.

## Counter configuration

```json
{
  "type": "counter",
  "counter": {
    "direction": "auto",
    "prefix": "Only more...",
    "suffix": "... until New Years",
    "targetAt": "2026-12-31T23:59:00Z",
    "unit": "days",
    "showUnit": true
  }
}
```

This is the widget-specific portion of a layer; normal ID, geometry, and typography fields still apply. Direction is always automatic. Legacy direction values are accepted and normalized to `auto` on save, and ignored by the updated renderer. `unit` is `seconds`, `minutes`, `hours`, or `days`. Count up floors complete elapsed units; count down rounds remaining units up. Values never go below zero. Days are fixed 24-hour periods. The target includes a time-zone offset and is stored as UTC by the editor. A correct player system clock is essential; timing is based on the target timestamp, not on elapsed browser uptime.

Future targets count down; past targets count up. Optional `goalMessage` (up to 500 characters) replaces the entire counter, including prefix/suffix, at or after the target and stops its update timer. The message remains after offline restarts. An empty or whitespace-only message leaves normal automatic counting enabled. Goal messages are plain text and use the widget's typography and auto-sizing.

Optional `prefix` and `suffix` are plain text, each limited to 500 characters. Nonempty affixes are separated from the number/unit by a space; outer whitespace is trimmed for display. They share the counter's font, alignment, and auto-sizing, including on the Pi. Clock and counter layers have four corner resize handles with independently adjustable width and height.

The shared `counter.js` module handles formatting and next-update boundaries. The player does not tick every second for a day-granularity counter. Update the complete `player/web` directory on existing Pis before publishing goal messages; updating the server alone does not update installed player code.

## Add a widget

1. Add its type and validated configuration fields to `server/schema.mjs`. Keep bounds on strings, URLs, update rates, and numeric values. Update `app/types.ts` with the same fields.
2. Add an insertion control and property fields in `app/page.tsx`; add the matching editor rendering to `app/canvas.tsx`.
3. Register a renderer in `player/web/widgets.js`. It receives `(element, layer, { onChange, signal })` and returns `{ ready, activate, dispose }`.
4. Rebuild the server and distribute the updated agent and complete `player/web` directory to players. There is no automatic player-code update service yet. Incompatible manifest changes must increment `schemaVersion` and ship with a compatible agent.

The lifecycle separates preparation from display:

- Render initial content into `element` during preparation. `ready` must resolve only when initial data and visual assets are complete. Reject if it cannot render; the player holds the current slide and retries. Readiness is bounded by a 15-second frame timeout.
- Do not start animation or recurring updates during preparation. `activate()` runs synchronously immediately before the prepared frame becomes visible. Refresh time-dependent values there, without waiting for a network call.
- Call `onChange()` after changing text so auto-sizing can be recomputed.
- `dispose()` must release every timer, listener, observer, and fetch, even if activation never happened. The supplied abort signal is cancelled when pending preparation is replaced or fails. Use it for preparation fetches, and also clean up in `dispose()` when the visible slide ends.
- Cleanup-only return functions are supported for older widgets, but cannot provide explicit asynchronous readiness or deferred activation. New widgets should use the controller contract.

```js
registerWidget('example', (element, layer, { onChange }) => {
  let timer;
  const paint = () => {
    element.textContent = new Date().toLocaleTimeString();
    onChange();
  };
  paint();
  return {
    ready: Promise.resolve(),
    activate() {
      paint();
      timer = setInterval(paint, 1000);
    },
    dispose() {
      clearInterval(timer);
    },
  };
});
```

Use `textContent` or DOM construction; never inject arbitrary HTML. Reuse the existing layer geometry and typography fields instead of building a second layout system. Registering a renderer alone does not extend the server's allowlist or editor.

For calendars, feeds, or business data, follow the weather widget's pattern: fetch and normalize data on the home server with restricted destinations and timeouts. Weather uses timestamped snapshots in the sync response's `weather` map, outside the immutable publication. The agent persists them with playback state, and `setWeatherSnapshots` updates active weather renderers without restarting the playlist. Prepared weather frames resolve immediately with the last snapshot or an explicit unavailable state; they subscribe and start their timer only on activation. Data never comes from an arbitrary layer-provided URL.

Avoid full web-page embeds on Zero 2 W. A simple DOM renderer and cached data keep resource usage predictable. A server-rendered bitmap widget is another option for expensive layouts, but is not implemented yet.
