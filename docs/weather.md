# National Weather Service widget

## Add weather to a slide

1. Open a slide and select **Add weather widget** (the sun/cloud icon).
2. Enter a five-digit **US ZIP code** and select the search button, or press Enter. Pick a location if the ZIP has multiple places. The lookup fills the location name and coordinates. You can still enter latitude/longitude manually and customize the name.
3. Choose **Current weather** or **Next 6 hours** under **Weather display**, then Fahrenheit or Celsius.
4. Place the widget and resize with its corner handles. Typography, color, alignment, and auto-size work like other widgets. Save the slide and publish its playlist. Weather then updates without republishing.

ZIP lookup uses [Zippopotam.us](https://docs.zippopotam.us/docs/getting-started/) for approximate ZIP-area coordinates, not an exact street address or a guarantee of NWS coverage. Leading zeros are preserved. City-name search is not implemented. Unknown ZIP codes and lookup failures leave the existing location unchanged; manual coordinates remain available.

No API key or subscription is needed. Weather coverage is limited to locations served by the [NWS API](https://www.weather.gov/documentation/services-web-api). Unsupported locations show a message; some coastal/marine points lack hourly forecasts. This is an informational widget, not an emergency-alert system.

## Weather displays

- **Current weather** uses a nearby reporting station's latest temperature and condition, with its observation age. It is not necessarily a live measurement at the exact ZIP centroid. The server tries up to two NWS-listed stations when readings are missing or old. Null temperatures are not treated as zero. If there has never been a usable observation, an hourly forecast may be displayed instead, explicitly labeled as a forecast with its fetch age and an observation-unavailable note.
- **Next 6 hours** shows the next six hourly forecast start times after now, through six hours ahead: time, temperature, condition, and icon for each. Times use the weather location's timezone, not the player's. The forecast's own offset is the fallback for older cached data. Missing hours produce a labeled partial forecast; hours outside that window are not substituted. Expired windows show unavailable.
- Icons cover sun/clear skies, night, partly/scattered/few clouds, mostly cloudy/overcast, cloud, drizzle, rain, heavy rain, thunderstorms, snow, freezing/mixed precipitation/hail, fog/mist, haze/smoke/dust, wind, and tornado conditions. Similar conditions share an icon family. Text always accompanies the symbol. Icons use bundled Lucide vector geometry, not remote NWS image URLs. They remain sharp when resized and render offline without image downloads.

## Shared requests

The home server alone contacts NWS. Latitude/longitude rounded to four decimal places identifies a shared cache entry. Names, display modes, units, slide IDs, and screen counts do not create separate requests. Screens using the same ZIP lookup reuse the same coordinates. Nearby but different coordinates remain separate entries, even if NWS maps them to the same grid.

A normal cold lookup needs four requests: points, hourly forecast, station list, and latest observation. Point/grid and station-list mappings last one day. Weather refreshes on demand at most once every 15 minutes per location, with one in-flight job per location. Normally this means approximately 192 forecast/observation requests plus two mapping requests per day for a continuously used location, regardless of screen count. A missing/stale first station can add one observation request per refresh. Unused locations are not polled.

The SQLite cache survives restarts. At most two refresh jobs run concurrently and 256 locations are held. Entries unused for a day can be evicted. Requests have eight-second timeouts, fixed NWS destinations, redirect rejection, and response-size limits. Forecast and observation failures preserve their last successful values independently. Retries wait at least 15 minutes, respecting longer `Retry-After` values up to a day; unsupported points retry after a day. Refreshes never block player heartbeat responses or slide transitions.

ZIP lookup is administrator-only, with a separate bounded 256-entry, one-day memory cache and in-flight deduplication. New upstream ZIP lookups are limited to one per second, at most two in flight. Its fixed US endpoint rejects redirects and oversized responses. ZIP searches happen only when requested in the editor, not during player sync.

## Offline players and upgrades

Only locations in the player's assigned, published playlist are sent through authenticated sync. Weather snapshots are independent of publication revisions, so refreshes do not restart the playlist. Up to 48 hourly periods and one observation are persisted per location. The agent preserves old forecasts and observations independently if a restarted server has not replaced them yet; locations removed from the assigned publication are dropped.

Only visible weather widgets have a one-minute timer and a snapshot subscription. Prepared frames render immediately from cached data, including inline icons, with no weather network calls or timers. There is still only one visible and one prepared frame.

Observations at least two hours old, or retained after a reported observation failure, display **Cached observation**. Forecasts an hour past their fetch time, or retained after a forecast failure, display **Cached forecast**. A current-view forecast fallback with no valid current period is labeled **Expired forecast**. Missing data never stops slide rotation. Keep player clocks accurate.

Update the server and the **complete player directory**, including `agent.py`, `weather.js`, `weather-icons.js`, and `widgets.js`, before using these settings. Existing weather widgets default to Current weather. Older players ignore the new mode and cannot show the new icons. A Docker server update does not update installed player code; there is no automatic player updater. Existing slides are preserved; the disposable weather cache upgrades as locations refresh. No additional configuration or database migration is needed.

## Operations and privacy

Allow outbound HTTPS from the server to `api.weather.gov` and, for ZIP search, `api.zippopotam.us`. No new inbound ports or direct Pi access to those services is needed. ZIP codes are sent to Zippopotam.us and coordinates to NWS; neither receives player tokens, Wi-Fi/VPN credentials, location labels, or screen names. Both are external services with possible missing data, limits, and outages. Coordinates and public weather snapshots are stored in the weather cache; the optional source ZIP is stored in the slide.

Deterministic tests cover lookup, sharing, limits, station fallback, persistence, rendering, and offline state. Read-only live ZIP, station-list, and observation requests have also been checked for Chicago. These checks are not a physical-Pi performance or uptime guarantee. Test transitions and recovery on your target devices before unattended use.

Icon geometry and its bundled license are in `player/web/weather-icons.js`. Maintainers can regenerate it from the pinned Lucide dependency with `node scripts/generate-weather-icons.mjs`, then run `pnpm format`. It is a checked-in source asset, not a runtime dependency on React or an external image service.
