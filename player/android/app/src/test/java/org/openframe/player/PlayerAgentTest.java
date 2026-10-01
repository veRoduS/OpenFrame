package org.openframe.player;

import com.sun.net.httpserver.HttpServer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.Rule;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class PlayerAgentTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private HttpServer server;
    private String origin;
    private JSONObject response, lastRequest;
    private String unauthorizedCode;
    private int status = 200;
    private final AtomicInteger enrollments = new AtomicInteger();
    private final byte[] image = "test image bytes".getBytes(StandardCharsets.UTF_8);
    private static final String FILE = "12345678-1234-1234-1234-123456789012.webp";

    @Before public void start() throws Exception {
        response = new JSONObject().put("approved", false).put("code", "ABC123");
        server = HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath();
                byte[] body;
                int code = 200;
                if (path.equals("/api/player/enroll")) {
                    enrollments.incrementAndGet();
                    body = "{\"id\":\"device\",\"token\":\"secret-token\",\"code\":\"ABC123\"}".getBytes(StandardCharsets.UTF_8);
                } else if (!"Bearer secret-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
                    code = 403; body = new byte[0];
                } else if (path.equals("/api/player/sync")) {
                    lastRequest = new JSONObject(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                    code = status;
                    body = (code == 200 ? response.toString() : new JSONObject().put("code", unauthorizedCode).toString()).getBytes(StandardCharsets.UTF_8);
                } else if (path.equals("/media/" + FILE)) {
                    body = image;
                } else { code = 404; body = new byte[0]; }
                exchange.sendResponseHeaders(code, body.length);
                exchange.getResponseBody().write(body);
            } catch (Exception ex) { throw new java.io.IOException(ex); }
            finally { exchange.close(); }
        });
        server.start();
        origin = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    @After public void stop() { server.stop(0); }

    private PlayerAgent agent() throws Exception { return new PlayerAgent(temp.getRoot(), origin, "Test TV", "0.10.1"); }

    private void publish(String revision, String checksum) throws Exception {
        JSONObject asset = new JSONObject().put("filename", FILE).put("url", "/media/" + FILE).put("sha256", checksum);
        response = new JSONObject().put("approved", true).put("rotation", 90).put("blank", false)
                .put("manifest", new JSONObject().put("schemaVersion", 1).put("revision", revision)
                        .put("items", new JSONArray()).put("assets", new JSONArray().put(asset)));
    }

    @Test public void pairsPersistsAndHidesCredentials() throws Exception {
        PlayerAgent first = agent(); first.tick();
        assertEquals("ABC123", new JSONObject(first.snapshot()).getString("code"));
        assertFalse(first.snapshot().contains("secret-token"));
        assertFalse(first.snapshot().contains(origin));
        agent().tick();
        assertEquals(1, enrollments.get());
    }

    @Test public void cachesOnlyCompleteVerifiedPublicationsAndRestartsOffline() throws Exception {
        publish("one", PlayerAgent.sha256(image));
        PlayerAgent player = agent(); player.tick();
        assertEquals("one", new JSONObject(player.snapshot()).getJSONObject("manifest").getString("revision"));
        assertArrayEquals(image, Files.readAllBytes(new java.io.File(player.media, FILE).toPath()));
        publish("two", "0".repeat(64)); player.tick();
        assertEquals("one", new JSONObject(player.snapshot()).getJSONObject("manifest").getString("revision"));
        status = 503;
        PlayerAgent restarted = agent(); restarted.tick();
        JSONObject offline = new JSONObject(restarted.snapshot());
        assertEquals("one", offline.getJSONObject("manifest").getString("revision"));
        assertFalse(offline.getJSONObject("connection").getBoolean("connected"));
    }

    @Test public void proxyFailurePreservesPairingButExplicitRevocationClearsIt() throws Exception {
        publish("one", PlayerAgent.sha256(image));
        PlayerAgent player = agent(); player.tick();
        status = 401; unauthorizedCode = "ACCESS_DENIED"; player.tick();
        assertTrue(new JSONObject(player.snapshot()).getBoolean("approved"));
        unauthorizedCode = "DEVICE_CREDENTIALS_INVALID"; player.tick();
        assertFalse(new JSONObject(player.snapshot()).optBoolean("approved"));
        status = 200; player.tick();
        assertEquals(2, enrollments.get());
    }

    @Test public void acknowledgesCommandsOnceAndReportsUnsupportedReboot() throws Exception {
        publish("one", PlayerAgent.sha256(image));
        response.put("command", new JSONObject().put("id", "command-1").put("type", "reboot"));
        PlayerAgent player = agent(); player.tick();
        assertTrue(new JSONObject(player.snapshot()).getString("error").contains("reboot"));
        player.tick();
        assertEquals("command-1", lastRequest.getString("commandAck"));
        assertEquals(1, new JSONObject(player.snapshot()).getLong("generation"));
    }

    @Test public void serverChangesNeverReuseCredentialsOrContent() throws Exception {
        PlayerAgent player = agent(); player.tick();
        PlayerAgent other = new PlayerAgent(temp.getRoot(), "https://example.invalid", "Other", "0.10.1");
        assertNotEquals(player.directory, other.directory);
        assertFalse(new JSONObject(other.snapshot()).has("code"));
    }

    @Test public void validatesOriginsPathsAndResponseSizes() throws Exception {
        assertEquals("https://example.com", PlayerAgent.normalizeServer(" https://EXAMPLE.com:443/ "));
        for (String value : new String[]{"file:///etc/passwd", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=x", "https://example.com#x", "http://example.com:99999"}) {
            assertThrows(IllegalArgumentException.class, () -> PlayerAgent.normalizeServer(value));
        }
        publish("one", PlayerAgent.sha256(image));
        JSONObject asset = response.getJSONObject("manifest").getJSONArray("assets").getJSONObject(0);
        asset.put("url", "https://evil.example/steal");
        assertThrows(java.io.IOException.class, () -> PlayerAgent.validateAsset(asset));
        assertThrows(java.io.IOException.class, () -> PlayerAgent.readBounded(new java.io.ByteArrayInputStream(new byte[10]), 9));
    }

    @Test public void telemetryIsValidatedAndForwarded() throws Exception {
        PlayerAgent player = agent();
        player.reportPlayback("{\"phase\":\"playing\",\"slideId\":\"slide-1\",\"preparationMs\":12,\"extra\":\"ignored\"}");
        player.tick();
        assertEquals("playing", lastRequest.getJSONObject("playback").getString("phase"));
        assertFalse(lastRequest.getJSONObject("playback").has("extra"));
        player.reportPlayback("{\"phase\":\"invalid\"}"); player.tick();
        assertEquals("playing", lastRequest.getJSONObject("playback").getString("phase"));
    }

    @Test public void weatherRetainsCachedForecastDuringServerWarmup() throws Exception {
        JSONObject old = new JSONObject("{\"weather\":{\"point\":{\"periods\":[{\"name\":\"Today\"}],\"fetchedAt\":1,\"observation\":{\"temperature\":20}}}}");
        JSONObject next = new JSONObject("{\"weather\":{\"point\":{\"periods\":[],\"observation\":null}}}");
        PlayerAgent.mergeWeather(next, old);
        assertEquals("stale", next.getJSONObject("weather").getJSONObject("point").getString("status"));
        assertEquals(1, next.getJSONObject("weather").getJSONObject("point").getJSONArray("periods").length());
    }
}
