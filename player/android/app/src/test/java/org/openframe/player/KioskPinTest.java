package org.openframe.player;

import org.junit.Test;
import static org.junit.Assert.*;

public class KioskPinTest {
    @Test public void storeNumberPadsOnlyShortNumbers() {
        assertEquals("0007", KioskPin.fromStoreNumber("7"));
        assertEquals("0042", KioskPin.fromStoreNumber("42"));
        assertEquals("0123", KioskPin.fromStoreNumber("123"));
        assertEquals("1962", KioskPin.fromStoreNumber("1962"));
        assertEquals("12345", KioskPin.fromStoreNumber("12345"));
        assertEquals("0042", KioskPin.fromStoreNumber("0042"));
        assertNull(KioskPin.fromStoreNumber(null));
        assertNull(KioskPin.fromStoreNumber(""));
        assertNull(KioskPin.fromStoreNumber("Fort Deposit"));
    }
    @Test public void pinRoundTripAndRejection() {
        String salt = KioskPin.salt();
        String hash = KioskPin.hash("012345", salt);
        assertTrue(KioskPin.verify("012345", salt, hash));
        assertFalse(KioskPin.verify("12345", salt, hash));
        assertFalse(KioskPin.verify("012346", salt, hash));
        assertNotEquals(hash, KioskPin.hash("012345", KioskPin.salt()));
    }
}
