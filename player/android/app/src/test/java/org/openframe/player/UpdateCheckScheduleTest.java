package org.openframe.player;

import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateCheckScheduleTest {
    private static final long LAST = 100000000L;
    @Test public void startupChecksEvenAfterRecentSuccessSoNoticeCanBeRestored() {
        assertTrue(UpdateCheckSchedule.due(false, "github", "github", LAST + 1, LAST));
    }
    @Test public void successfulCheckThrottlesUntilSixHours() {
        assertFalse(UpdateCheckSchedule.due(true, "github", "github", LAST + 1, LAST));
        assertTrue(UpdateCheckSchedule.due(true, "github", "github", LAST + UpdateCheckSchedule.INTERVAL_MS, LAST));
    }
    @Test public void returningFromHomeDoesNotRestartCooldown() {
        assertFalse(UpdateCheckSchedule.due(true, "github", "github", LAST + UpdateCheckSchedule.INTERVAL_MS - 1, LAST));
        assertTrue(UpdateCheckSchedule.due(true, "github", "github", LAST + UpdateCheckSchedule.INTERVAL_MS + UpdateCheckSchedule.RETRY_MS, LAST));
    }
    @Test public void failedOrCanceledFirstCheckRemainsDue() {
        assertTrue(UpdateCheckSchedule.due(false, "github", "github", LAST + 1, LAST));
        assertTrue(UpdateCheckSchedule.due(true, "github", "github", LAST, 0));
    }
    @Test public void changedSourceAndClockRollbackAreNotSuppressed() {
        assertTrue(UpdateCheckSchedule.due(true, "server", "github", LAST + 1, LAST));
        assertTrue(UpdateCheckSchedule.due(true, "github", "github", LAST - 1, LAST));
    }
}
