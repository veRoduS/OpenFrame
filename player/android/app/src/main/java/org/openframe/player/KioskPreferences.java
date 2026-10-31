package org.openframe.player;

import android.content.Context;
import android.content.SharedPreferences;

/** Additive schema: never touches the activity preferences or player/cache files. */
final class KioskPreferences {
    final SharedPreferences prefs;
    KioskPreferences(Context context) {
        this(context.getSharedPreferences("kiosk", Context.MODE_PRIVATE));
    }
    KioskPreferences(SharedPreferences storage) {
        prefs = storage;
        if (!prefs.contains("schema")) prefs.edit().putInt("schema", 1)
                .putBoolean("offer", true).apply();
    }
    boolean enabled() { return prefs.getBoolean("enabled", false); }
    boolean startup() { return enabled() && prefs.getBoolean("startup", false); }
    boolean recovery() { return enabled() && prefs.getBoolean("recovery", true); }
}
