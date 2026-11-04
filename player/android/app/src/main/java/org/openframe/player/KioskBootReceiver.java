package org.openframe.player;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class KioskBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!new KioskPreferences(context).startup()) return;
        try {
            context.startActivity(new Intent(context, PlayerActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException ignored) {
            // Firmware may reject background activity launches. Never retry in a loop.
        }
    }
}
