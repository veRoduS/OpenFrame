package org.openframe.player;

import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

public class KioskPreferencesTest {
    private final Map<String, Object> values = new HashMap<>();
    private SharedPreferences storage() {
        SharedPreferences.Editor editor = (SharedPreferences.Editor) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class[]{SharedPreferences.Editor.class}, (p,m,a) -> {
                    if (m.getName().startsWith("put")) { values.put((String)a[0], a[1]); return p; }
                    if (m.getName().equals("commit")) return true;
                    return null;
                });
        return (SharedPreferences) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class[]{SharedPreferences.class}, (p,m,a) -> {
                    if (m.getName().equals("edit")) return editor;
                    if (m.getName().equals("contains")) return values.containsKey(a[0]);
                    if (m.getName().startsWith("get")) return values.getOrDefault(a[0], a[1]);
                    return null;
                });
    }
    @Test public void initialStorePinDoesNotReplaceAnAdministratorPin() {
        KioskPreferences config = new KioskPreferences(storage());
        assertTrue(config.seedStorePin("42"));
        String hash = (String) values.get("pin");
        assertTrue(KioskPin.verify("0042", (String) values.get("salt"), hash));
        assertFalse(config.seedStorePin("999"));
        assertEquals(hash, values.get("pin"));
    }
    @Test public void missingAssignmentDoesNotInventAPin() {
        KioskPreferences config = new KioskPreferences(storage());
        assertFalse(config.seedStorePin(""));
        assertFalse(values.containsKey("pin"));
    }
    @Test public void freshInstallIsOptIn() {
        KioskPreferences config = new KioskPreferences(storage());
        assertFalse(config.enabled()); assertFalse(config.startup()); assertFalse(config.recovery());
        assertEquals(true, values.get("offer"));
    }
    @Test public void upgradeIsAdditiveAndLaterPersists() {
        values.put("server", "https://example.invalid"); values.put("name", "Existing TV");
        new KioskPreferences(storage());
        values.put("offer", false);
        new KioskPreferences(storage());
        assertEquals("https://example.invalid", values.get("server"));
        assertEquals("Existing TV", values.get("name")); assertEquals(false, values.get("offer"));
    }
    @Test public void enabledConfigurationSurvivesRecreationAndUpdate() {
        new KioskPreferences(storage());
        values.put("enabled", true); values.put("startup", true); values.put("recovery", false);
        values.put("pin", "stored hash");
        KioskPreferences reopened = new KioskPreferences(storage());
        assertTrue(reopened.enabled()); assertTrue(reopened.startup()); assertFalse(reopened.recovery());
        assertEquals("stored hash", values.get("pin"));
    }
}
