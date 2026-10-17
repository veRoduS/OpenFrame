package org.openframe.player;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Local-only bounded media stream, shared by WebView interception and JVM tests. */
final class MediaResponse {
    final int status;
    final Map<String, String> headers = new HashMap<>();
    final InputStream body;

    MediaResponse(File file, String range) throws IOException {
        if (!file.isFile()) throw new IOException("Missing media");
        long size = file.length(), start = 0, end = size - 1;
        headers.put("Accept-Ranges", "bytes");
        headers.put("Cache-Control", "private, max-age=31536000, immutable");
        headers.put("X-Content-Type-Options", "nosniff");
        boolean valid = true;
        if (range != null) {
            try {
                Matcher match = Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);
                if (!match.matches() || size == 0 || (match.group(1).isEmpty() && match.group(2).isEmpty())) {
                    throw new IllegalArgumentException();
                }
                if (match.group(1).isEmpty()) {
                    long suffix = Long.parseLong(match.group(2));
                    if (suffix <= 0) throw new IllegalArgumentException();
                    start = Math.max(0, size - suffix);
                } else {
                    start = Long.parseLong(match.group(1));
                    if (!match.group(2).isEmpty()) end = Math.min(Long.parseLong(match.group(2)), end);
                }
                if (start >= size || end < start) throw new IllegalArgumentException();
            } catch (IllegalArgumentException ex) { valid = false; }
        }
        if (!valid) {
            status = 416;
            headers.put("Content-Range", "bytes */" + size);
            headers.put("Content-Length", "0");
            body = new ByteArrayInputStream(new byte[0]);
        } else {
            status = range == null ? 200 : 206;
            long length = end - start + 1;
            headers.put("Content-Length", Long.toString(length));
            if (range != null) headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            FileInputStream input = new FileInputStream(file);
            try { input.getChannel().position(start); }
            catch (IOException ex) { input.close(); throw ex; }
            body = new LimitedStream(input, length);
        }
    }

    private static final class LimitedStream extends InputStream {
        private final InputStream input;
        private long remaining;
        LimitedStream(InputStream input, long remaining) { this.input = input; this.remaining = remaining; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int result = input.read();
            if (result != -1) remaining--;
            return result;
        }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = input.read(buffer, offset, (int) Math.min(length, remaining));
            if (count > 0) remaining -= count;
            return count;
        }
        @Override public long skip(long count) throws IOException {
            long skipped = input.skip(Math.min(Math.max(0, count), remaining));
            remaining -= skipped;
            return skipped;
        }
        @Override public void close() throws IOException { input.close(); }
    }
}
