package org.openframe.player;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Credential-free updates from pinned GitHub paths or the explicitly selected server. */
final class UpdateSource {
    static final long MAX_APK = 64L * 1024 * 1024;
    static final String GITHUB = "github", SERVER = "server";
    static final String GITHUB_BASE = "https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases";
    static final String GITHUB_METADATA = GITHUB_BASE + "/apks/latest.json";
    private final String source, server;
    private final Connections connections;

    interface Connections { HttpURLConnection open(URI uri) throws Exception; }

    UpdateSource() { this(GITHUB, "", uri -> (HttpURLConnection) uri.toURL().openConnection()); }
    // An explicit origin retains local distribution and its existing test interface.
    UpdateSource(String server) { this(SERVER, server, uri -> (HttpURLConnection) uri.toURL().openConnection()); }
    UpdateSource(String source, String server, Connections connections) {
        if (!GITHUB.equals(source) && !SERVER.equals(source)) throw new IllegalArgumentException("Invalid update source");
        this.source = source;
        this.server = SERVER.equals(source) ? PlayerAgent.normalizeServer(server) : "";
        this.connections = connections;
    }

    static final class UpdateFailure extends IOException {
        UpdateFailure(String message) { super(message); }
    }

    static final class Release {
        final String versionName, packageName, apkUrl, sha256, source, server;
        final long versionCode, size;
        final int minSdk;

        Release(JSONObject json) throws Exception { this(json, GITHUB, ""); }

        private Release(JSONObject json, String source, String server) throws Exception {
            this.source = source;
            this.server = server;
            versionName = json.getString("versionName");
            if (!versionName.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) throw new UpdateFailure("Invalid update version");
            String[] parts = versionName.split("\\.");
            long major = Long.parseLong(parts[0]), minor = Long.parseLong(parts[1]), patch = Long.parseLong(parts[2]);
            versionCode = json.getLong("versionCode");
            if (major > 2100 || minor >= 1000 || patch >= 1000 || versionCode < 1 || versionCode > 2100000000L ||
                    versionCode != major * 1000000 + minor * 1000 + patch || json.getDouble("versionCode") != versionCode)
                throw new UpdateFailure("Invalid update version code");
            packageName = json.getString("packageName");
            apkUrl = json.getString("apkUrl");
            sha256 = json.getString("sha256");
            size = json.getLong("size");
            minSdk = json.getInt("minSdk");
            if (!packageName.equals("org.openframe.player") || !apkUrl.equals("/downloads/android/openframe-player-" + versionName + ".apk") ||
                    !sha256.matches("[a-f0-9]{64}") || size < 1 || size > MAX_APK || json.getDouble("size") != size ||
                    minSdk < 28 || minSdk > 100 || json.getDouble("minSdk") != minSdk)
                throw new UpdateFailure("Invalid update metadata");
        }

        // Read this only from this Activity's saved state. Network metadata never
        // chooses a source or origin: check() supplies that binding itself.
        static Release restore(JSONObject saved, String currentServer) throws Exception {
            String source = saved.optString("updateSource", SERVER);
            if (!GITHUB.equals(source) && !SERVER.equals(source)) throw new UpdateFailure("Invalid saved update source");
            String server = "";
            if (SERVER.equals(source)) {
                server = PlayerAgent.normalizeServer(saved.optString("updateOrigin", currentServer));
                if (!server.equals(PlayerAgent.normalizeServer(currentServer))) throw new UpdateFailure("The update server changed. Check for updates again.");
            }
            return new Release(saved, source, server);
        }

        JSONObject json() throws Exception {
            return new JSONObject().put("versionName", versionName).put("versionCode", versionCode)
                    .put("packageName", packageName).put("apkUrl", apkUrl).put("sha256", sha256).put("size", size).put("minSdk", minSdk)
                    .put("updateSource", source).put("updateOrigin", server);
        }

        String downloadUrl() {
            return GITHUB.equals(source) ? GITHUB_BASE + "/apks/" + versionName + "/openframe-player.apk" : server + apkUrl;
        }

        boolean newerThan(String installedPackage, long installedVersion, int sdk) throws IOException {
            if (!packageName.equals(installedPackage)) throw new UpdateFailure("This release is for a different app. Debug builds cannot install release updates.");
            if (minSdk > sdk) throw new UpdateFailure("This update needs a newer Android version.");
            return versionCode > installedVersion;
        }
    }

    Release check() throws Exception {
        long deadline = System.nanoTime() + 30_000_000_000L;
        HttpURLConnection connection = open(GITHUB.equals(source) ? GITHUB_METADATA : server + "/downloads/android/latest.json");
        try {
            if (connection.getResponseCode() == 404) return null;
            requireOk(connection);
            String body;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[2048];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new UpdateFailure("Update check stopped. Try again.");
                    if (output.size() + count > 16384) throw new UpdateFailure("Update information exceeds its size limit. Try again later.");
                    output.write(buffer, 0, count);
                }
                body = new String(output.toByteArray(), StandardCharsets.UTF_8).trim();
            }
            if (body.startsWith("<") || (connection.getContentType() != null && connection.getContentType().toLowerCase(java.util.Locale.ROOT).contains("text/html"))) {
                throw new UpdateFailure(SERVER.equals(source)
                        ? "This server returned a web page instead of update information. Choose GitHub in Update source, or update the server."
                        : "GitHub returned an unexpected web page. Check your internet connection and try again.");
            }
            try { return new Release(new JSONObject(body), source, server); }
            catch (Exception invalid) { throw new UpdateFailure("The update source returned invalid release information. Try again later."); }
        } finally { connection.disconnect(); }
    }

    File download(Release release, File directory) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new UpdateFailure("Cannot create update storage");
        File temporary = new File(directory, "player-update.apk.part");
        File target = new File(directory, "player-update.apk");
        // Use the checked release's source even if settings changed in the meantime.
        HttpURLConnection connection = open(release.downloadUrl());
        long deadline = System.nanoTime() + 120_000_000_000L;
        try {
            requireOk(connection);
            long announced = connection.getContentLengthLong();
            if (announced != -1 && announced != release.size) throw new UpdateFailure("The update size changed. Check for updates again.");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[16384];
                long total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new UpdateFailure("Update download stopped");
                    total += count;
                    if (total > release.size) throw new UpdateFailure("Update exceeds declared size");
                    output.write(buffer, 0, count);
                }
                if (total != release.size) throw new UpdateFailure("Incomplete update download. Try again.");
                output.getFD().sync();
            }
            verifyFile(release, temporary);
            Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return target;
        } finally {
            connection.disconnect();
            Files.deleteIfExists(temporary.toPath());
        }
    }

    static void verifyFile(Release release, File file) throws Exception {
        if (!file.isFile() || file.length() != release.size || !release.sha256.equals(PlayerAgent.hashFile(file)))
            throw new UpdateFailure("Update verification failed. Check for updates again.");
    }

    static String userMessage(Exception error) {
        if (error instanceof UpdateFailure) return error.getMessage();
        return "The update could not be downloaded or verified. Check your connection and try again.";
    }

    String checkFailureMessage(Exception error) {
        if (error instanceof UpdateFailure) return error.getMessage();
        return GITHUB.equals(source) ? "Could not reach GitHub. Check your internet connection and try again."
                : "Could not reach this server's Android download. Check the server connection or choose GitHub in Update source.";
    }

    private HttpURLConnection open(String url) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new UpdateFailure("Update check stopped");
        HttpURLConnection connection = connections.open(new URI(url));
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        return connection;
    }

    private static void requireOk(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) throw new UpdateFailure("The update source redirected this request. Check its address or try again later.");
        if (status != 200) throw new UpdateFailure("The update source returned HTTP " + status + ". Try again later.");
    }
}
