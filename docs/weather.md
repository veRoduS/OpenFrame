# National Weather Service widget

## Add weather to a slide

1. Open a slide and select **Add weather widget** (the sun/cloud icon).
2. Set a **Location name**, **Latitude**, and **Longitude**. Use coordinates from your map application; US longitudes are usually negative. For example, Chicago is `41.8781, -87.6298`. City-name and ZIP-code search are not implemented.
3. Choose **Fahrenheit** or **Celsius**, place the widget, and drag its corner handles to resize it. Typography, color, horizontal/vertical alignment, and auto-size work like the other widgets.
4. Save the slide and publish its playlist. Later weather updates arrive automatically without republishing.

No API key or subscription is needed. The widget displays the **current hourly forecast**, not a live weather-station observation: location, forecast temperature, short forecast, source, and the age of the last successful fetch. Coverage is limited to points served by NWS hourly forecasts. Unsupported locations show an explicit message; coastal marine locations may not provide hourly forecasts. This is an informational widget, not an emergency-alert system.

## Shared requests

The home server alone contacts `https://api.weather.gov`. Each latitude/longitude pair, rounded to four decimal places, identifies a shared cache entry. Different screen names, location labels, units, slide IDs, and playlists do not create extra requests for that pair. Nearby but different coordinates are separate entries, even if they happen to map to the same NWS forecast grid. Reuse the same coordinates for all screens at one location.

A cold location needs two requests: a points lookup followed by an hourly forecast. The points-to-grid mapping lasts one day. Forecasts refresh on demand, at most once every 15 minutes per location, with one in-flight refresh per location. For 100 screens at identical coordinates this is still approximately 96 forecast requests plus one mapping lookup per day, not 100 times that amount. Weather refresh is triggered by player sync, administrator preview, or the slide editor; unused locations are not continuously polled.

The cache is stored in the existing SQLite database and survives server restarts. At most two refresh jobs run concurrently and 256 locations are held per server. Inactive entries can be evicted after a day; additional locations may display unavailable until capacity is free. Requests have eight-second timeouts, reject redirects, allow only fixed NWS endpoints, and limit response size. Failures retain the last successful forecast and wait at least 15 minutes before retrying, respecting longer `Retry-After` values up to a day. Unsupported points retry after a day. A loading or failed weather request never delays a player heartbeat or slide transition.

## Player behavior

The server sends only the locations from that player's assigned, published playlist through normal authenticated sync. Forecast data is separate from the publication revision, so changing weather does not restart the playlist. Up to 48 hourly periods are cached per location. Players select the current period locally, including while offline, and only visible weather widgets run a one-minute timer. Prepared frames have no weather network requests or active timers.

The most recent snapshot persists with the player's offline state. A cold server cache cannot erase a player's already-cached forecast for an assigned location. After an hour without a successful weather fetch, or after a reported upstream failure, the widget labels the data **Cached forecast**. When all applicable cached periods have expired it labels the last period **Expired forecast**, rather than presenting it as current. New installations with no weather snapshot show a waiting/unavailable state and keep rotating slides. A correct system clock remains essential.

Update the server and the **complete player directory**, including `agent.py`, `widgets.js`, `weather.js`, and `clock.js`, before publishing weather slides. Older players cannot render this new widget. A Docker server update does not update player code automatically. There is no database migration of existing slides; the new cache table is created automatically and is disposable (it contains coordinates and public forecasts, not credentials).

## Operations and privacy

Allow outbound HTTPS from the server to `api.weather.gov`; no new inbound ports or Pi Internet access are required. The request identifies OpenFrame through its User-Agent. Coordinates configured for the widget are sent to NWS; player tokens, Wi-Fi/VPN credentials, location labels, and screen names are not. NWS publishes free public data with anti-abuse limits and no application-specific uptime guarantee. Its API can return missing data or be temporarily unavailable.

Tests use deterministic NWS fixtures for request sharing, persistence, backoff, limits, protected endpoints, rendering, and offline state. A live points and hourly forecast smoke check succeeded for the Chicago example; this is not a reliability or physical-Pi performance guarantee. Test offline transitions and restoration on your target devices before unattended use.

Reference: [official NWS API documentation](https://www.weather.gov/documentation/services-web-api).
