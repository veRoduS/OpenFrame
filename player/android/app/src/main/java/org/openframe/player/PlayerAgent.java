package org.openframe.player;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/** Owns credentials and networking. Only a credential-free snapshot reaches the WebView. */
final class PlayerAgent {
    static final String HOSTED_SERVER_CODE = "1962";
    static final String HOSTED_SERVER_ORIGIN = "https://openframe.blackfalcon.cloud";
    static final int JSON_LIMIT = 4 * 1024 * 1024;
    static final int IMAGE_LIMIT = 25 * 1024 * 1024;
    static final long CACHE_LIMIT = 256L * 1024 * 1024;
    final File directory;
    final File media;
    private final String server, name, version;
    private final long started = System.nanoTime();
    private JSONObject identity, state;
    private volatile String snapshot = "{\"approved\":false}";
    private volatile String playback;
    private volatile long playbackAt;
    private String error, verifiedRevision;
    private boolean connected;
    private long lastContact;

    PlayerAgent(File root, String server, String name, String version) throws Exception {
        this.server = normalizeServer(server);
        this.name = name;
        this.version = version;
        // Server changes cannot reuse another server's token or offline content.
        directory = new File(root, sha256(this.server.getBytes(StandardCharsets.UTF_8)));
        media = new File(directory, "media");
        if (!media.isDirectory() && !media.mkdirs()) throw new IOException("Cannot create player storage");
        identity = readJson(new File(directory, "identity.json"));
        state = readJson(new File(directory, "state.json"));
        publish();
    }

    static String normalizeServer(String value) {
        try {
            if (value.trim().equals(HOSTED_SERVER_CODE)) return HOSTED_SERVER_ORIGIN;
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme();
            if (!("https".equals(scheme) || "http".equals(scheme)) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))
                    || uri.getPort() < -1 || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException();
            }
            int port = uri.getPort();
            if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
            return new URI(scheme, null, uri.getHost().toLowerCase(java.util.Locale.ROOT), port, null, null, null).toString();
        } catch (Exception ex) {
            throw new IllegalArgumentException("Enter a server origin such as https://screens.example.com (no path or login details).");
        }
    }

    String snapshot() { return snapshot; }

    void reportPlayback(String report) {
        if (report == null || report.length() > 4096) return;
        try {
            JSONObject input = new JSONObject(report);
            String phase = input.getString("phase");
            if (!java.util.Arrays.asList("playing", "preparing", "waiting", "blank", "empty", "unpaired").contains(phase)) return;
            JSONObject clean = new JSONObject().put("phase", phase);
            for (String key : new String[]{"error", "slideId"}) {
                if (!input.isNull(key)) clean.put(key, input.getString(key).substring(0,
                        Math.min(input.getString(key).length(), key.equals("error") ? 500 : 100)));
            }
            for (String key : new String[]{"preparationMs", "missedDeadlines"}) {
                if (input.has(key)) {
                    double number = input.getDouble(key);
                    if (!Double.isFinite(number) || number < 0 || number > 1e12) return;
                    clean.put(key, number);
                }
            }
            playback = clean.toString();
            playbackAt = System.nanoTime();
        } catch (Exception ignored) { /* Reject malformed browser telemetry. */ }
    }

    void tick() {
        try {
            sync();
        } catch (Exception ex) {
            connected = false;
            error = ex instanceof Revoked ? "Screen removed. Pair this player again."
                    : ex instanceof ConnectionFailure ? ex.getMessage()
                    : ex instanceof java.net.UnknownHostException ? "Cannot find the server. Check the server address and network."
                    : ex instanceof javax.net.ssl.SSLException ? "Cannot establish a secure server connection. Check the server certificate and the device date."
                    : ex instanceof java.net.SocketTimeoutException ? "The server connection timed out. Check the network and try again."
                    : ex instanceof java.net.ConnectException ? "Cannot connect to the server. Check the server address and network."
                    : "Unable to sync. Check the server address, network, and available storage.";
            if (ex instanceof Revoked) {
                identity = new JSONObject();
                state = new JSONObject();
                verifiedRevision = null;
                try {
                    saveJson(new File(directory, "identity.json"), identity);
                    saveJson(new File(directory, "state.json"), state);
                } catch (Exception ignored) { /* Revoked credentials remain invalid on the server. */ }
            }
        }
        try { publish(); } catch (Exception ignored) { /* Keep the last valid snapshot. */ }
    }

    private void sync() throws Exception {
        if (!identity.has("token")) {
            JSONObject enrolled = request("/api/player/enroll", new JSONObject().put("name", name));
            enrolled.getString("token");
            saveJson(new File(directory, "identity.json"), enrolled);
            identity = enrolled;
        }
        JSONObject oldManifest = state.optJSONObject("manifest");
        JSONObject report = playback == null ? null : new JSONObject(playback);
        if (System.nanoTime() - (playbackAt == 0 ? started : playbackAt) > 30_000_000_000L) {
            report = new JSONObject().put("phase", "stalled").put("error", "No recent status from the browser player");
        }
        JSONObject response = request("/api/player/sync", new JSONObject()
                .put("revision", oldManifest == null ? JSONObject.NULL : oldManifest.opt("revision"))
                .put("version", version).put("uptime", (System.nanoTime() - started) / 1e9)
                .put("error", error == null ? JSONObject.NULL : error)
                .put("commandAck", state.opt("commandAck"))
                .put("playback", report == null ? JSONObject.NULL : report));
        connected = true;
        lastContact = System.currentTimeMillis() / 1000;
        JSONObject command = response.optJSONObject("command");
        boolean execute = command != null && !command.getString("id").equals(state.optString("commandAck"));
        String nextRevision = null;
        if (response.getBoolean("approved")) {
            JSONObject manifest = response.getJSONObject("manifest");
            int schemaVersion = manifest.getInt("schemaVersion");
            if (schemaVersion != 1 && schemaVersion != 2 && schemaVersion != 3 && schemaVersion != 4) throw new IOException("Unsupported playlist schema");
            nextRevision = manifest.getString("revision");
            JSONArray assets = manifest.getJSONArray("assets");
            boolean verify = !nextRevision.equals(verifiedRevision) || execute;
            // Remove leftovers from failed downloads and publications no longer active.
            Set<String> keep = new HashSet<>();
            if (oldManifest != null) {
                JSONArray old = oldManifest.getJSONArray("assets");
                for (int i = 0; i < old.length(); i++) keep.add(old.getJSONObject(i).getString("filename"));
            }
            for (int i = 0; i < assets.length(); i++) keep.add(assets.getJSONObject(i).getString("filename"));
            File[] files = media.listFiles();
            if (files != null) for (File file : files) if (!keep.contains(file.getName())) Files.deleteIfExists(file.toPath());
            for (int i = 0; i < assets.length(); i++) {
                checkInterrupted();
                JSONObject asset = assets.getJSONObject(i);
                validateAsset(asset);
                if (verify || !new File(media, asset.getString("filename")).isFile()) download(asset);
            }
            mergeWeather(response, state);
        }
        response.remove("command");
        response.put("commandAck", execute ? command.getString("id") : state.opt("commandAck"));
        response.put("generation", state.optLong("generation") + (execute ? 1 : 0));
        // Atomic commit occurs only after every image has passed its checksum.
        checkInterrupted();
        saveJson(new File(directory, "state.json"), response);
        state = response;
        verifiedRevision = nextRevision;
        error = execute && "reboot".equals(command.optString("type"))
                ? "Remote reboot is unavailable on Android TV; restart using Android settings." : null;
    }

    static void mergeWeather(JSONObject next, JSONObject previous) throws Exception {
        JSONObject weather = next.optJSONObject("weather"), old = previous.optJSONObject("weather");
        if (weather == null || old == null) return;
        java.util.Iterator<String> keys = weather.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject value = weather.getJSONObject(key), prior = old.optJSONObject(key);
            if (prior == null) continue;
            JSONArray periods = value.optJSONArray("periods"), cached = prior.optJSONArray("periods");
            if ((periods == null || periods.length() == 0) && cached != null && cached.length() > 0) {
                value.put("periods", cached).put("fetchedAt", prior.opt("fetchedAt")).put("status", "stale");
            }
            if (value.isNull("observation") && !prior.isNull("observation")) {
                value.put("observation", prior.get("observation")).put("observationStatus", "unavailable");
            }
        }
    }

    private void publish() throws Exception {
        // Explicit allowlist: never expose tokens or the configured server to page scripts.
        JSONObject visible = new JSONObject();
        for (String key : new String[]{"approved", "code", "blank", "rotation", "manifest", "weather", "dataFeeds", "generation"}) {
            if (state.has(key)) visible.put(key, state.get(key));
        }
        // Enrollment already supplied a pairing code even if the first sync is
        // temporarily unavailable. Keep credentials private while showing that code.
        if (!visible.optBoolean("approved") && !visible.has("code") && identity.has("code"))
            visible.put("code", identity.getString("code"));
        visible.put("error", error == null ? JSONObject.NULL : error);
        visible.put("connection", new JSONObject().put("connected", connected)
                .put("lastContactAt", lastContact == 0 ? JSONObject.NULL : lastContact));
        snapshot = visible.toString();
    }

    static void validateAsset(JSONObject asset) throws Exception {
        String filename = asset.getString("filename");
        if (!filename.matches("[a-f0-9-]{36}\\.(webp|woff2|woff|ttf|otf)") || !asset.getString("url").equals("/media/" + filename)
                || !asset.getString("sha256").matches("[a-f0-9]{64}")) throw new IOException("Invalid asset");
    }

    private void download(JSONObject asset) throws Exception {
        File target = new File(media, asset.getString("filename"));
        String checksum = asset.getString("sha256");
        if (target.isFile() && checksum.equals(hashFile(target))) return;
        long used = 0;
        File[] files = media.listFiles();
        if (files != null) for (File file : files) used += file.length();
        HttpURLConnection connection = open(asset.getString("url"));
        File temporary = new File(media, target.getName() + ".part");
        try {
            checkStatus(connection, false);
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[16384];
                long total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    checkInterrupted();
                    total += count;
                    if (total > IMAGE_LIMIT || used + total > CACHE_LIMIT) throw new IOException("Media cache full");
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (!checksum.equals(hashFile(temporary))) throw new IOException("Image checksum mismatch");
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            connection.disconnect();
            Files.deleteIfExists(temporary.toPath());
        }
    }

    private HttpURLConnection open(String path) throws Exception {
        checkInterrupted();
        HttpURLConnection connection = (HttpURLConnection) new URI(server + path).toURL().openConnection();
        connection.setInstanceFollowRedirects(false); // Never forward credentials to another origin.
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        if (identity.has("token")) connection.setRequestProperty("Authorization", "Bearer " + identity.getString("token"));
        return connection;
    }

    private JSONObject request(String path, JSONObject body) throws Exception {
        HttpURLConnection connection = open(path);
        try {
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            connection.setDoOutput(true);
            byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
            // Buffer this small JSON request so HttpURLConnection exposes 401 response
            // bodies instead of treating them as an unrepeatable authentication retry.
            try (java.io.OutputStream out = connection.getOutputStream()) { out.write(data); }
            // Creating a player returns 201; legacy enrollment endpoints may return 200.
            // Sync and media requests still require 200, not arbitrary 2xx statuses.
            checkStatus(connection, path.equals("/api/player/enroll"));
            try (InputStream input = connection.getInputStream()) {
                String bodyText = new String(readBounded(input, JSON_LIMIT), StandardCharsets.UTF_8).trim();
                String contentType = connection.getContentType();
                if ((contentType != null && contentType.toLowerCase(java.util.Locale.ROOT).contains("text/html"))
                        || bodyText.startsWith("<")) {
                    throw new ConnectionFailure("The server returned a webpage instead of the player API. Check the server address and any sign-in proxy.");
                }
                try { return new JSONObject(bodyText); }
                catch (org.json.JSONException ex) {
                    throw new ConnectionFailure("The server returned an invalid player API response. Check the server address and OpenFrame server version.");
                }
            }
        } finally { connection.disconnect(); }
    }

    private static void checkStatus(HttpURLConnection connection, boolean enrollment) throws Exception {
        int status = connection.getResponseCode();
        if (status == 401 && connection.getErrorStream() != null) {
            try (InputStream input = connection.getErrorStream()) {
                String body = new String(readBounded(input, 65536), StandardCharsets.UTF_8);
                try {
                    if ("DEVICE_CREDENTIALS_INVALID".equals(new JSONObject(body).optString("code"))) throw new Revoked();
                } catch (org.json.JSONException ignored) { /* Proxy login pages are not device revocation. */ }
            }
        }
        if (status == 200 || (enrollment && status == 201)) return;
        if (status >= 300 && status < 400)
            throw new ConnectionFailure("The server redirected the player request. Use the final server address and check any sign-in proxy.");
        if (status == 401 || status == 403)
            throw new ConnectionFailure("Server access was denied (HTTP " + status + "). Check proxy access rules for the player API.");
        if (status == 404)
            throw new ConnectionFailure("The player API was not found (HTTP 404). Check the server address and OpenFrame server version.");
        if (status == 429)
            throw new ConnectionFailure(enrollment
                    ? "The server has too many pending pairing requests (HTTP 429). Remove unused pending screens on the server and try again."
                    : "The server is limiting requests (HTTP 429). Wait a few minutes before reconnecting.");
        throw new ConnectionFailure("The server returned HTTP " + status + ". Check the server and try again.");
    }

    // Only fixed, locally generated messages may be shown. Never echo response
    // bodies, URLs, tokens, or raw JSON parser exceptions into the renderer.
    private static class ConnectionFailure extends IOException {
        ConnectionFailure(String message) { super(message); }
    }

    private static class Revoked extends IOException {}

    private static void checkInterrupted() throws java.io.InterruptedIOException {
        if (Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException("Player paused");
    }

    static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count;
        while ((count = input.read(buffer)) != -1) {
            checkInterrupted();
            if (bytes.size() + count > limit) throw new IOException("Response exceeds size limit");
            bytes.write(buffer, 0, count);
        }
        return bytes.toByteArray();
    }

    private static JSONObject readJson(File file) {
        try (InputStream input = new FileInputStream(file)) {
            return new JSONObject(new String(readBounded(input, JSON_LIMIT), StandardCharsets.UTF_8));
        } catch (Exception ignored) { return new JSONObject(); }
    }

    private static void saveJson(File file, JSONObject value) throws Exception {
        File temporary = new File(file.getParentFile(), file.getName() + ".part");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    }

    static String sha256(byte[] data) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(data)); }

    static String hashFile(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
}
