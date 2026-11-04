package org.openframe.player;

/** A failed/canceled attempt must never consume the successful-check cooldown. */
final class UpdateCheckSchedule {
    static final long INTERVAL_MS = 6 * 60 * 60 * 1000L;
    static final long RETRY_MS = 60 * 1000L;
    static boolean due(boolean checkedThisSession, String source, String lastSource, long now, long lastSuccess) {
        return !checkedThisSession || !source.equals(lastSource) || lastSuccess <= 0
                || now < lastSuccess || now - lastSuccess >= INTERVAL_MS;
    }
}
