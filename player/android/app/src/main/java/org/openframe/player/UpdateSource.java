package org.openframe.player;

import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Credential-free, same-origin release checks and bounded, verified APK downloads. */
final class UpdateSource {
    static final long MAX_APK = 64L * 1024 * 1024;
    private final String server;

    UpdateSource(String server) { this.server = PlayerAgent.normalizeServer(server); }

    static final class Release {
        final String versionName, packageName, apkUrl, sha256;
        final long versionCode, size;
        final int minSdk;

        Release(JSONObject json) throws Exception {
            versionName = json.getString("versionName");
            if (!versionName.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) throw new IOException("Invalid update version");
            String[] parts = versionName.split("\\.");
            long major = Long.parseLong(parts[0]), minor = Long.parseLong(parts[1]), patch = Long.parseLong(parts[2]);
            versionCode = json.getLong("versionCode");
            if (major > 2100 || minor >= 1000 || patch >= 1000 || versionCode < 1 || versionCode > 2100000000L ||
                    versionCode != major * 1000000 + minor * 1000 + patch || json.getDouble("versionCode") != versionCode)
                throw new IOException("Invalid update version code");
            packageName = json.getString("packageName");
            apkUrl = json.getString("apkUrl");
            sha256 = json.getString("sha256");
            size = json.getLong("size");
            minSdk = json.getInt("minSdk");
            if (!packageName.equals("org.openframe.player") || !apkUrl.equals("/downloads/android/openframe-player-" + versionName + ".apk") ||
                    !sha256.matches("[a-f0-9]{64}") || size < 1 || size > MAX_APK || json.getDouble("size") != size ||
                    minSdk < 28 || minSdk > 100 || json.getDouble("minSdk") != minSdk)
                throw new IOException("Invalid update metadata");
        }

        JSONObject json() throws Exception {
            return new JSONObject().put("versionName", versionName).put("versionCode", versionCode)
                    .put("packageName", packageName).put("apkUrl", apkUrl).put("sha256", sha256).put("size", size).put("minSdk", minSdk);
        }

        boolean newerThan(String installedPackage, long installedVersion, int sdk) throws IOException {
            if (!packageName.equals(installedPackage)) throw new IOException("This release is for a different app. Debug builds cannot install release updates.");
            if (minSdk > sdk) throw new IOException("This update needs a newer Android version.");
            return versionCode > installedVersion;
        }
    }

    Release check() throws Exception {
        HttpURLConnection connection = open("/downloads/android/latest.json");
        try {
            if (connection.getResponseCode() == 404) return null;
            requireOk(connection);
            try (InputStream input = connection.getInputStream()) {
                return new Release(new JSONObject(new String(PlayerAgent.readBounded(input, 16384), StandardCharsets.UTF_8)));
            }
        } finally { connection.disconnect(); }
    }

    File download(Release release, File directory) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create update storage");
        File temporary = new File(directory, "player-update.apk.part");
        File target = new File(directory, "player-update.apk");
        HttpURLConnection connection = open(release.apkUrl);
        long deadline = System.nanoTime() + 120_000_000_000L;
        try {
            requireOk(connection);
            long announced = connection.getContentLengthLong();
            if (announced != -1 && announced != release.size) throw new IOException("The update size changed. Check for updates again.");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[16384];
                long total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted() || System.nanoTime() > deadline) throw new IOException("Update download stopped");
                    total += count;
                    if (total > release.size) throw new IOException("Update exceeds declared size");
                    output.write(buffer, 0, count);
                }
                if (total != release.size) throw new IOException("Incomplete update download. Try again.");
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
            throw new IOException("Update verification failed. Check for updates again.");
    }

    private HttpURLConnection open(String path) throws Exception {
        if (Thread.currentThread().isInterrupted()) throw new IOException("Update check stopped");
        HttpURLConnection connection = (HttpURLConnection) new URI(server + path).toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(15000);
        connection.setUseCaches(false);
        return connection;
    }

    private static void requireOk(HttpURLConnection connection) throws Exception {
        if (connection.getResponseCode() != 200) throw new IOException("Cannot reach this server's Android download. Try again later.");
    }
}
