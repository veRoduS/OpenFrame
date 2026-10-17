package org.openframe.player;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class MediaResponseTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    @Test public void streamsWholeFilesAndBoundedRangesWithoutLeakingAdjacentBytes() throws Exception {
        File file = temp.newFile("clip.mp4");
        Files.writeString(file.toPath(), "0123456789", StandardCharsets.UTF_8);
        String[][] cases = {{null, "0123456789", null}, {"bytes=2-4", "234", "bytes 2-4/10"},
                {"bytes=7-", "789", "bytes 7-9/10"}, {"bytes=-3", "789", "bytes 7-9/10"},
                {"bytes=8-99", "89", "bytes 8-9/10"}};
        for (String[] entry : cases) {
            MediaResponse response = new MediaResponse(file, entry[0]);
            assertEquals(entry[0] == null ? 200 : 206, response.status);
            assertEquals("bytes", response.headers.get("Accept-Ranges"));
            assertEquals(Integer.toString(entry[1].length()), response.headers.get("Content-Length"));
            assertEquals(entry[2], response.headers.get("Content-Range"));
            try (java.io.InputStream body = response.body) {
                assertEquals(entry[1], new String(body.readAllBytes(), StandardCharsets.UTF_8));
                assertEquals(-1, body.read());
            }
        }
    }

    @Test public void rejectsInvalidUnsatisfiableAndMultipleRanges() throws Exception {
        File file = temp.newFile("clip.mp4");
        Files.writeString(file.toPath(), "0123456789");
        for (String range : new String[]{"bytes=10-", "bytes=4-2", "bytes=-0", "bytes=-", "bytes=1-2,4-5", "bad", "bytes=999999999999999999999999-"}) {
            MediaResponse response = new MediaResponse(file, range);
            assertEquals(416, response.status);
            assertEquals("bytes */10", response.headers.get("Content-Range"));
            assertEquals("0", response.headers.get("Content-Length"));
            try (java.io.InputStream body = response.body) { assertEquals(-1, body.read()); }
        }
    }

    @Test public void skipsStayWithinRangeAndEmptyFilesRemainValid() throws Exception {
        File file = temp.newFile("clip.mp4");
        Files.writeString(file.toPath(), "0123456789");
        try (java.io.InputStream body = new MediaResponse(file, "bytes=2-4").body) {
            assertEquals(2, body.skip(2));
            assertEquals('4', body.read());
            assertEquals(0, body.skip(20));
            assertEquals(-1, body.read());
        }
        File empty = temp.newFile("empty.mp4");
        MediaResponse response = new MediaResponse(empty, null);
        assertEquals(200, response.status);
        assertEquals("0", response.headers.get("Content-Length"));
        response.body.close();
        assertEquals(416, new MediaResponse(empty, "bytes=0-").status);
    }
}
