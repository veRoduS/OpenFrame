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
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class UpdateSourceTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private HttpServer server;
    private String origin;
    private JSONObject metadata;
    private int status = 200;
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
                byte[] body = path.endsWith(".json") ? metadata.toString().getBytes(StandardCharsets.UTF_8) : apk;
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
        assertEquals(release.sha256, new UpdateSource.Release(release.json()).sha256);
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
}
