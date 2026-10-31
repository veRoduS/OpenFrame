package org.openframe.player;

import org.junit.Test;
import static org.junit.Assert.*;

public class KioskPinTest {
    @Test public void pinRoundTripAndRejection() {
        String salt = KioskPin.salt();
        String hash = KioskPin.hash("012345", salt);
        assertTrue(KioskPin.verify("012345", salt, hash));
        assertFalse(KioskPin.verify("12345", salt, hash));
        assertFalse(KioskPin.verify("012346", salt, hash));
        assertNotEquals(hash, KioskPin.hash("012345", KioskPin.salt()));
    }
}
