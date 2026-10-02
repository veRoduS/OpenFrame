package org.openframe.player;

import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.net.HttpURLConnection;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class UpdateSourceTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private HttpServer server;
    private String origin;
    private JSONObject metadata;
    private int status = 200;
    private String metadataBody;
    private String metadataType = "application/json";
    private byte[] apk = "test update bytes".getBytes(StandardCharsets.UTF_8);
    private final AtomicInteger outsideRequests = new AtomicInteger();

    @Before public void start() throws Exception {
        metadata = new JSONObject().put("versionName", "0.10.3").put("versionCode", 10003)
                .put("packageName", "org.openframe.player").put("minSdk", 28)
                .put("size", apk.length).put("sha256", PlayerAgent.sha256(apk))
                .put("apkUrl", "/downloads/android/openframe-player-0.10.3.apk");
        server = HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
                assertNull(exchange.getRequestHeaders().getFirst("Authorization"));
                String path = exchange.getRequestURI().getPath();
                if (path.equals("/elsewhere")) outsideRequests.incrementAndGet();
                byte[] body = path.endsWith(".json") ? (metadataBody == null ? metadata.toString() : metadataBody).getBytes(StandardCharsets.UTF_8) : apk;
                if (path.endsWith(".json")) exchange.getResponseHeaders().add("Content-Type", metadataType);
                if (status == 302) exchange.getResponseHeaders().add("Location", origin + "/elsewhere");
                exchange.sendResponseHeaders(status, body.length);
                exchange.getResponseBody().write(body);
            } finally { exchange.close(); }
        });
        server.start();
        origin = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    @After public void stop() { server.stop(0); }

    @Test public void discoversOnlyNewerCompatibleReleases() throws Exception {
        UpdateSource.Release release = new UpdateSource(origin).check();
        assertTrue(release.newerThan("org.openframe.player", 10002, 28));
        assertFalse(release.newerThan("org.openframe.player", 10003, 28));
        assertFalse(release.newerThan("org.openframe.player", 10004, 28));
        assertThrows(java.io.IOException.class, () -> release.newerThan("other.package", 10002, 28));
        assertThrows(java.io.IOException.class, () -> release.newerThan("org.openframe.player", 10002, 27));
        UpdateSource.Release restored = UpdateSource.Release.restore(release.json(), origin);
        assertEquals(release.sha256, restored.sha256);
        assertEquals(UpdateSource.SERVER, restored.source);
        assertEquals(origin + release.apkUrl, restored.downloadUrl());
    }

    @Test public void handlesUnpublishedReleasesAndRejectsRedirects() throws Exception {
        status = 404;
        assertNull(new UpdateSource(origin).check());
        status = 302;
        assertThrows(java.io.IOException.class, () -> new UpdateSource(origin).check());
        assertEquals(0, outsideRequests.get());
    }

    @Test public void rejectsInvalidMetadataAndForeignPaths() throws Exception {
        for (String path : new String[]{"https://evil.example/app.apk", "//evil.example/app.apk", "/downloads/android/../app.apk", "/downloads/android/openframe-player-0.10.3.apk?secret=x"}) {
            JSONObject bad = new JSONObject(metadata.toString()).put("apkUrl", path);
            assertThrows(java.io.IOException.class, () -> new UpdateSource.Release(bad));
        }
        assertThrows(java.io.IOException.class, () -> new UpdateSource.Release(new JSONObject(metadata.toString()).put("size", UpdateSource.MAX_APK + 1)));
        assertThrows(java.io.IOException.class, () -> new UpdateSource.Release(new JSONObject(metadata.toString()).put("versionCode", 1)));
        assertThrows(java.io.IOException.class, () -> new UpdateSource.Release(new JSONObject(metadata.toString()).put("minSdk", 28.5)));
    }

    @Test public void verifiesDownloadsAndPreservesPriorFileOnFailure() throws Exception {
        UpdateSource source = new UpdateSource(origin);
        UpdateSource.Release release = source.check();
        File result = source.download(release, temp.getRoot());
        assertArrayEquals(apk, Files.readAllBytes(result.toPath()));
        byte[] original = apk.clone();
        apk[0] ^= 1;
        assertThrows(java.io.IOException.class, () -> source.download(release, temp.getRoot()));
        assertArrayEquals(original, Files.readAllBytes(result.toPath()));
        assertFalse(new File(temp.getRoot(), "player-update.apk.part").exists());
        apk = new byte[apk.length + 1];
        assertThrows(java.io.IOException.class, () -> source.download(release, temp.getRoot()));
    }

    @Test public void interruptionDoesNotReplaceStagedApk() throws Exception {
        UpdateSource source = new UpdateSource(origin);
        UpdateSource.Release release = source.check();
        Thread.currentThread().interrupt();
        try { assertThrows(java.io.IOException.class, () -> source.download(release, temp.getRoot())); }
        finally { Thread.interrupted(); }
        assertFalse(new File(temp.getRoot(), "player-update.apk").exists());
    }

    private UpdateSource github(List<String> requests) {
        return new UpdateSource(UpdateSource.GITHUB, "https://unused-server.example", uri -> {
            requests.add(uri.toString());
            assertEquals("https", uri.getScheme());
            assertEquals("raw.githubusercontent.com", uri.getHost());
            assertTrue(uri.getPath().startsWith("/veRoduS/OpenFrame/android-releases/apks/"));
            assertNull(uri.getUserInfo());
            assertNull(uri.getQuery());
            assertNull(uri.getFragment());
            return (HttpURLConnection) new URI(origin + uri.getRawPath()).toURL().openConnection();
        });
    }

    @Test public void githubUsesPinnedPathsWithoutDependingOnTheConfiguredServer() throws Exception {
        List<String> requests = new ArrayList<>();
        UpdateSource source = github(requests);
        // GitHub raw files may be text/plain. Metadata cannot switch the source.
        metadataType = "text/plain; charset=utf-8";
        metadata.put("updateSource", UpdateSource.SERVER).put("updateOrigin", "https://evil.example");
        UpdateSource.Release release = source.check();
        assertEquals(UpdateSource.GITHUB, release.source);
        assertEquals("", release.server);
        assertEquals(UpdateSource.GITHUB_METADATA, requests.get(0));
        assertEquals(UpdateSource.GITHUB_BASE + "/apks/0.10.3/openframe-player.apk", release.downloadUrl());
        UpdateSource.Release restored = UpdateSource.Release.restore(release.json(), "https://different-server.example");
        File result = source.download(restored, temp.getRoot());
        assertArrayEquals(apk, Files.readAllBytes(result.toPath()));
        assertEquals(release.downloadUrl(), requests.get(1));
        assertEquals(2, requests.size());
    }

    @Test public void checkedReleaseKeepsItsSourceAfterSettingsChange() throws Exception {
        UpdateSource.Release local = new UpdateSource(origin).check();
        UpdateSource.Release restored = UpdateSource.Release.restore(local.json(), origin);
        // A newly selected GitHub source still downloads this checked local release
        // from its captured server, never from the newly selected source.
        File result = new UpdateSource().download(restored, temp.getRoot());
        assertArrayEquals(apk, Files.readAllBytes(result.toPath()));
        assertThrows(java.io.IOException.class, () -> UpdateSource.Release.restore(local.json(), "https://other.example"));
        UpdateSource.Release legacy = UpdateSource.Release.restore(metadata, origin);
        assertEquals(UpdateSource.SERVER, legacy.source);
        assertEquals(origin + local.apkUrl, legacy.downloadUrl());
        assertThrows(java.io.IOException.class, () -> UpdateSource.Release.restore(new JSONObject(metadata.toString()).put("updateSource", "unknown"), origin));
    }

    @Test public void htmlAndMalformedMetadataProduceShortSafeDiagnostics() throws Exception {
        UpdateSource local = new UpdateSource(origin);
        metadataBody = "<!doctype html><html>private page contents</html>";
        metadataType = "text/html";
        Exception html = assertThrows(java.io.IOException.class, local::check);
        assertTrue(local.checkFailureMessage(html).contains("Choose GitHub"));
        assertFalse(local.checkFailureMessage(html).contains("private page contents"));
        assertFalse(local.checkFailureMessage(html).contains("<!doctype"));
        UpdateSource github = github(new ArrayList<>());
        Exception githubHtml = assertThrows(java.io.IOException.class, github::check);
        assertTrue(github.checkFailureMessage(githubHtml).contains("GitHub returned an unexpected web page"));
        metadataType = "application/json";
        metadataBody = "{\"private contents\": broken";
        Exception invalid = assertThrows(java.io.IOException.class, local::check);
        assertTrue(local.checkFailureMessage(invalid).contains("invalid release information"));
        assertFalse(local.checkFailureMessage(invalid).contains("private contents"));
        metadataBody = new String(new char[16385]).replace('\0', 'x');
        assertThrows(java.io.IOException.class, local::check);
        assertFalse(local.checkFailureMessage(new java.io.IOException("private transport details")).contains("private"));
        assertFalse(UpdateSource.userMessage(new java.io.IOException("private transport details")).contains("private"));
    }

    @Test public void githubRejectsRedirectsForeignApkPathsAndCorruptDownloads() throws Exception {
        List<String> requests = new ArrayList<>();
        UpdateSource source = github(requests);
        status = 302;
        assertThrows(java.io.IOException.class, source::check);
        assertEquals(0, outsideRequests.get());
        status = 200;
        metadata.put("apkUrl", "https://evil.example/openframe-player.apk");
        assertThrows(java.io.IOException.class, source::check);
        metadata.put("apkUrl", "/downloads/android/openframe-player-0.10.3.apk");
        UpdateSource.Release release = source.check();
        status = 302;
        assertThrows(java.io.IOException.class, () -> source.download(release, temp.getRoot()));
        assertEquals(0, outsideRequests.get());
        status = 200;
        apk[0] ^= 1;
        assertThrows(java.io.IOException.class, () -> source.download(release, temp.getRoot()));
        assertFalse(new File(temp.getRoot(), "player-update.apk").exists());
        assertFalse(new File(temp.getRoot(), "player-update.apk.part").exists());
    }
}
