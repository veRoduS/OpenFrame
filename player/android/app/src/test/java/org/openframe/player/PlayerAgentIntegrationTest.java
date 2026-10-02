package org.openframe.player;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

/** Exercises the native client against the real Express API, including its HTTP status codes. */
public class PlayerAgentIntegrationTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private Process server;

    @After public void stop() throws Exception {
        if (server != null) {
            server.destroy();
            if (!server.waitFor(5, TimeUnit.SECONDS)) server.destroyForcibly();
        }
    }

    @Test(timeout = 30000) public void enrollsOnceShowsCodeAndResumesAfterApproval() throws Exception {
        File root = new File(System.getProperty("openframe.root", System.getProperty("user.dir")));
        File fixture = new File(root, "tests/fixtures/android-server.mjs");
        assertTrue("Run from the repository root or set -Dopenframe.root", fixture.isFile());
        server = new ProcessBuilder("node", fixture.getAbsolutePath(), temp.newFolder("server").getAbsolutePath())
                .directory(root).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        BufferedReader replies = new BufferedReader(new InputStreamReader(server.getInputStream(), StandardCharsets.UTF_8));
        PrintWriter commands = new PrintWriter(server.getOutputStream(), true);
        String origin = replies.readLine();
        assertNotNull("Real server did not start", origin);
        assertTrue(origin.startsWith("http://127.0.0.1:"));
        File cache = temp.newFolder("player");
        PlayerAgent first = new PlayerAgent(cache, origin, "Native integration TV", "0.10.4");
        first.tick();
        JSONObject pending = new JSONObject(first.snapshot());
        assertFalse(pending.optBoolean("approved"));
        assertTrue("Enrollment must show the actual server pairing code: " + pending,
                pending.optString("code").matches("[A-F0-9]{8}"));
        assertTrue(pending.getJSONObject("connection").getBoolean("connected"));
        assertTrue(pending.isNull("error"));

        PlayerAgent reopened = new PlayerAgent(cache, origin, "Native integration TV", "0.10.4");
        reopened.tick();
        assertEquals(pending.getString("code"), new JSONObject(reopened.snapshot()).getString("code"));
        commands.println("count");
        assertEquals("Restart must reuse saved credentials instead of enrolling again", 1,
                new JSONObject(replies.readLine()).getInt("count"));
        commands.println("approve");
        assertEquals(1, new JSONObject(replies.readLine()).getInt("count"));
        reopened.tick();
        JSONObject approved = new JSONObject(reopened.snapshot());
        assertTrue(approved.getBoolean("approved"));
        assertEquals("empty", approved.getJSONObject("manifest").getString("revision"));
        assertTrue(approved.isNull("error"));
    }
}
