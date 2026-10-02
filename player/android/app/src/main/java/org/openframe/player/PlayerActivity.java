package org.openframe.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageInfo;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.view.Gravity;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Future;

public final class PlayerActivity extends Activity {
    private static final String ORIGIN = "https://player.openframe.invalid";
    // One process-wide queue also serializes a closing Activity with its replacement.
    private static final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private ScheduledFuture<?> polling;
    private PlayerAgent agent;
    private WebView web;
    private boolean resumed;
    private int generation;
    private static final ScheduledExecutorService updateWorker = Executors.newSingleThreadScheduledExecutor();
    private static final long UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000L;
    private ScheduledFuture<?> updatePolling;
    private Future<?> updateTask;
    private int updateGeneration;
    private boolean updateBusy, waitingForInstallPermission;
    private String activeServer;
    private UpdateSource.Release availableUpdate, readyUpdate;
    private TextView updateNotice;
    private boolean displayBlank;
    private AlertDialog updateProgress;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        String server = getPreferences(MODE_PRIVATE).getString("server", "");
        if (server.isEmpty()) setup();
        else startPlayer(server, getPreferences(MODE_PRIVATE).getString("name", "Android TV"));
        if (saved != null && server.equals(saved.getString("updateServer"))) {
            try {
                String json = saved.getString("readyUpdate");
                if (json != null) readyUpdate = UpdateSource.Release.restore(new org.json.JSONObject(json), server);
                waitingForInstallPermission = saved.getBoolean("waitingForInstallPermission");
            } catch (Exception ignored) { readyUpdate = null; }
        }
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.WHITE);
        view.setPadding(0, 12, 0, 12);
        return view;
    }

    private void setup() {
        generation++;
        stopUpdates();
        activeServer = null;
        availableUpdate = readyUpdate = null;
        waitingForInstallPermission = false;
        stopPolling();
        disposeWeb();
        agent = null;
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int inset = (int) (36 * getResources().getDisplayMetrics().density);
        layout.setPadding(inset, inset / 2, inset, inset / 2);
        layout.setBackgroundColor(Color.rgb(22, 45, 39));
        layout.addView(text("OpenFrame Player", 28));
        layout.addView(text("Connect this TV to your OpenFrame server. Use Android settings to connect Wi-Fi first.", 18));
        layout.addView(text("Server address", 16));
        EditText server = new EditText(this);
        server.setSingleLine(true);
        server.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        server.setHint("https://screens.example.com");
        server.setText(getPreferences(MODE_PRIVATE).getString("server", ""));
        layout.addView(server);
        layout.addView(text("Screen name", 16));
        EditText name = new EditText(this);
        name.setSingleLine(true);
        name.setText(getPreferences(MODE_PRIVATE).getString("name", "Android TV"));
        layout.addView(name);
        TextView error = text("", 16);
        Button connect = new Button(this);
        connect.setText("Connect and show pairing code");
        connect.setOnClickListener(view -> {
            try {
                String origin = PlayerAgent.normalizeServer(server.getText().toString());
                String screenName = name.getText().toString().trim();
                if (screenName.isEmpty() || screenName.length() > 100) throw new IllegalArgumentException("Use a screen name between 1 and 100 characters.");
                Runnable save = () -> {
                    getPreferences(MODE_PRIVATE).edit().putString("server", origin).putString("name", screenName).apply();
                    startPlayer(origin, screenName);
                };
                if (origin.startsWith("http:")) {
                    new AlertDialog.Builder(this).setTitle("Use an unencrypted connection?")
                            .setMessage("HTTP sends screen credentials and content without encryption. Use it only on a trusted local network; use HTTPS for remote screens.")
                            .setNegativeButton("Cancel", null).setPositiveButton("Use local HTTP", (dialog, which) -> save.run()).show();
                } else save.run();
            } catch (Exception ex) { error.setText(ex.getMessage()); }
        });
        layout.addView(connect);
        layout.addView(error);
        layout.addView(text("During playback, press Back or Menu for settings. Approve the displayed code under Screens on your server.", 16));
        scroll.addView(layout);
        setContentView(scroll);
        server.requestFocus();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void startPlayer(String server, String name) {
        stopUpdates();
        activeServer = server;
        stopPolling();
        disposeWeb();
        int request = ++generation;
        setContentView(text("Opening OpenFrame…", 24));
        // Construct after any in-flight sync finishes, so changing settings cannot race identity/state writes.
        worker.execute(() -> {
            try {
                PlayerAgent current = new PlayerAgent(new File(getFilesDir(), "players"), server, name, BuildConfig.VERSION_NAME);
                runOnUiThread(() -> {
                    if (!isDestroyed() && request == generation) openPlayer(current);
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (!isDestroyed() && request == generation) showFailure(ex);
                });
            }
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void openPlayer(PlayerAgent current) {
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider == null || Integer.parseInt(provider.versionName.split("\\.")[0]) < 100) {
                throw new IllegalStateException("Update Android System WebView to version 100 or newer before running this player.");
            }
            agent = current;
            web = new WebView(this);
            web.setBackgroundColor(Color.BLACK);
            web.getSettings().setJavaScriptEnabled(true);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setAllowContentAccess(false);
            web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            // The only JavaScript bridge method accepts bounded playback telemetry.
            web.addJavascriptInterface(new PlaybackBridge(current), "OpenFrameAndroid");
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (!request.getMethod().equals("GET") || !url.startsWith(ORIGIN + "/")) return missing();
                    String path = request.getUrl().getPath();
                    try {
                        if ("/local/state".equals(path)) {
                            String snapshot = current.snapshot();
                            boolean blank = new org.json.JSONObject(snapshot).optBoolean("blank");
                            runOnUiThread(() -> {
                                if (web == view && updateNotice != null) {
                                    displayBlank = blank;
                                    updateNotice.setVisibility(availableUpdate != null && !blank ? View.VISIBLE : View.GONE);
                                }
                            });
                            return response("application/json", new ByteArrayInputStream(snapshot.getBytes(StandardCharsets.UTF_8)));
                        }
                        if (path != null && path.matches("/media/[a-f0-9-]{36}\\.webp")) {
                            return response("image/webp", new FileInputStream(new File(current.media, path.substring(7))));
                        }
                        if (path != null && path.matches("/[a-z-]+\\.(html|js|css|svg)")) {
                            String type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css"
                                    : path.endsWith(".svg") ? "image/svg+xml" : "text/html";
                            return response(type, getAssets().open(path.substring(1)));
                        }
                    } catch (Exception ignored) { /* Do not fall through to actual network requests. */ }
                    return missing();
                }
            });
            FrameLayout screen = new FrameLayout(this);
            screen.addView(web, new FrameLayout.LayoutParams(-1, -1));
            updateNotice = text("", 16);
            updateNotice.setPadding(20, 10, 20, 10);
            updateNotice.setBackgroundColor(Color.rgb(22, 62, 52));
            updateNotice.setVisibility(View.GONE);
            screen.addView(updateNotice, new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL));
            setContentView(screen);
            web.loadUrl(ORIGIN + "/index.html");
            if (resumed) { web.onResume(); web.resumeTimers(); }
            else { web.onPause(); web.pauseTimers(); }
            startPolling();
            startUpdates();
        } catch (Exception ex) {
            showFailure(ex);
        }
    }

    private void showFailure(Exception ex) {
        setup();
        new AlertDialog.Builder(this).setTitle("Player needs attention").setMessage(ex.getMessage()).setPositiveButton("OK", null).show();
    }

    private static WebResourceResponse response(String type, java.io.InputStream body) {
        java.util.Map<String, String> headers = new java.util.HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
        return new WebResourceResponse(type, "UTF-8", 200, "OK", headers, body);
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static final class PlaybackBridge {
        private final PlayerAgent agent;
        PlaybackBridge(PlayerAgent agent) { this.agent = agent; }
        @JavascriptInterface public void reportPlayback(String report) { agent.reportPlayback(report); }
    }

    private void startPolling() {
        if (resumed && agent != null && polling == null) {
            PlayerAgent current = agent;
            polling = worker.scheduleWithFixedDelay(current::tick, 0, 15, TimeUnit.SECONDS);
        }
    }
    private void stopPolling() {
        if (polling != null) polling.cancel(true);
        polling = null;
    }

    private void startUpdates() {
        if (resumed && activeServer != null && web != null && updatePolling == null) {
            updatePolling = updateWorker.scheduleWithFixedDelay(() -> runOnUiThread(() -> checkUpdates(false)),
                    0, 6, TimeUnit.HOURS);
        }
    }

    private void cancelUpdateTask() {
        updateGeneration++;
        if (updateTask != null) updateTask.cancel(true);
        updateTask = null;
        updateBusy = false;
        if (updateProgress != null) updateProgress.dismiss();
        updateProgress = null;
    }

    private void stopUpdates() {
        if (updatePolling != null) updatePolling.cancel(false);
        updatePolling = null;
        cancelUpdateTask();
    }

    private void updateMessage(String title, String message) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK", null).show();
    }

    private void progress(String message) {
        updateProgress = new AlertDialog.Builder(this).setTitle("OpenFrame update").setMessage(message)
                .setNegativeButton("Cancel", (dialog, which) -> cancelUpdateTask()).create();
        updateProgress.setOnCancelListener(dialog -> cancelUpdateTask());
        updateProgress.show();
    }

    private void checkUpdates(boolean manual) {
        if (!resumed || activeServer == null || updateBusy) return;
        boolean localUpdates = UpdateSource.SERVER.equals(getPreferences(MODE_PRIVATE).getString("updateSource", UpdateSource.GITHUB));
        UpdateSource source = localUpdates ? new UpdateSource(activeServer) : new UpdateSource();
        String sourceKey = localUpdates ? UpdateSource.SERVER + ":" + activeServer : UpdateSource.GITHUB;
        long now = System.currentTimeMillis();
        long last = getPreferences(MODE_PRIVATE).getLong("updateCheckedAt", 0);
        if (!manual && sourceKey.equals(getPreferences(MODE_PRIVATE).getString("updateCheckedSource", "")) &&
                now >= last && now - last < UPDATE_INTERVAL_MS) return;
        getPreferences(MODE_PRIVATE).edit().putLong("updateCheckedAt", now).putString("updateCheckedSource", sourceKey).apply();
        updateBusy = true;
        int request = ++updateGeneration;
        if (manual) progress("Checking for an update…");
        updateTask = updateWorker.submit(() -> {
            try {
                UpdateSource.Release release = source.check();
                PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), 0);
                boolean newer = release != null && release.newerThan(getPackageName(), installed.getLongVersionCode(), android.os.Build.VERSION.SDK_INT);
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    availableUpdate = newer ? release : null;
                    if (updateNotice != null) {
                        updateNotice.setText(newer ? "OpenFrame " + release.versionName + " available — press Menu or Back to update" : "");
                        updateNotice.setVisibility(newer && !displayBlank ? View.VISIBLE : View.GONE);
                    }
                    if (!manual) return;
                    if (newer) new AlertDialog.Builder(this).setTitle("OpenFrame " + release.versionName + " is available")
                            .setMessage("Download and verify this update, then approve installation in Android. Your screen pairing and saved content will be kept.")
                            .setNegativeButton("Later", null).setPositiveButton("Download and install", (dialog, which) -> downloadUpdate(release)).show();
                    else updateMessage("Player updates", release == null
                            ? "No Android player release is available from the selected update source yet."
                            : "You're up to date. Installed version: " + BuildConfig.VERSION_NAME);
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    if (manual) updateMessage("Could not check for updates", source.checkFailureMessage(ex));
                });
            }
        });
    }

    private void downloadUpdate(UpdateSource.Release release) {
        if (!resumed || activeServer == null || updateBusy) return;
        updateBusy = true;
        int request = ++updateGeneration;
        progress("Downloading and verifying the update. Playback continues behind this message.");
        updateTask = updateWorker.submit(() -> {
            try {
                File file = new UpdateSource().download(release, new File(getFilesDir(), "updates"));
                UpdateInstaller.verify(this, release, file);
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    readyUpdate = release;
                    requestInstallation();
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    updateMessage("Update not installed", UpdateSource.userMessage(ex));
                });
            }
        });
    }

    private void requestInstallation() {
        if (readyUpdate == null || !resumed) return;
        if (!getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this).setTitle("Allow OpenFrame updates")
                    .setMessage("In Android settings, allow OpenFrame Player to install unknown apps, then press Back to continue this update.")
                    .setNegativeButton("Cancel", (dialog, which) -> readyUpdate = null)
                    .setPositiveButton("Open settings", (dialog, which) -> {
                        try {
                            waitingForInstallPermission = true;
                            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                        } catch (Exception ex) {
                            waitingForInstallPermission = false;
                            updateMessage("Installation unavailable", "This device does not allow OpenFrame to open installation settings. Install the APK through your file manager instead.");
                        }
                    }).show();
            return;
        }
        // Revalidate after returning from Settings; the installer also verifies APK signatures.
        UpdateSource.Release release = readyUpdate;
        int request = ++updateGeneration;
        updateBusy = true;
        progress("Verifying the update before opening Android’s installer…");
        updateTask = updateWorker.submit(() -> {
            try {
                UpdateInstaller.verify(this, release, new File(getFilesDir(), "updates/player-update.apk"));
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    readyUpdate = null;
                    try { startActivity(UpdateInstaller.intent(this)); }
                    catch (Exception ex) { updateMessage("Installation unavailable", "No Android package installer is available. Install the APK through your file manager instead."); }
                });
            } catch (Exception ex) {
                runOnUiThread(() -> {
                    if (!resumed || isDestroyed() || request != updateGeneration) return;
                    cancelUpdateTask();
                    readyUpdate = null;
                    updateMessage("Update not installed", "The downloaded APK could not be verified for this app. Check for updates again.");
                });
            }
        });
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (readyUpdate != null) {
            try {
                state.putString("readyUpdate", readyUpdate.json().toString());
                state.putString("updateServer", activeServer);
                state.putBoolean("waitingForInstallPermission", waitingForInstallPermission);
            } catch (Exception ignored) { /* The user can restart the check from the menu. */ }
        }
    }
    private void disposeWeb() {
        if (web != null) {
            web.stopLoading();
            web.removeJavascriptInterface("OpenFrameAndroid");
            web.destroy();
            web = null;
        }
    }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (web != null) { web.onResume(); web.resumeTimers(); }
        startPolling();
        if (waitingForInstallPermission) {
            waitingForInstallPermission = false;
            if (getPackageManager().canRequestPackageInstalls()) requestInstallation();
            else updateMessage("Update not installed", "Installation permission was not enabled. You can try again from Check for updates.");
        }
        startUpdates();
    }
    @Override protected void onPause() {
        resumed = false;
        stopPolling();
        stopUpdates();
        if (web != null) { web.onPause(); web.pauseTimers(); }
        super.onPause();
    }
    @Override protected void onDestroy() {
        generation++;
        stopPolling();
        stopUpdates();
        disposeWeb();
        super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        boolean localUpdates = UpdateSource.SERVER.equals(getPreferences(MODE_PRIVATE).getString("updateSource", UpdateSource.GITHUB));
        new AlertDialog.Builder(this).setTitle("OpenFrame Player")
                .setItems(new String[]{"Resume playback", "Connection settings", "Check for updates", "Update source: " + (localUpdates ? "This server" : "GitHub"), "Exit player"}, (dialog, which) -> {
                    if (which == 1) setup();
                    if (which == 2) checkUpdates(true);
                    if (which == 3) chooseUpdateSource();
                    if (which == 4) finish();
                }).show();
    }
    private void chooseUpdateSource() {
        boolean localUpdates = UpdateSource.SERVER.equals(getPreferences(MODE_PRIVATE).getString("updateSource", UpdateSource.GITHUB));
        new AlertDialog.Builder(this).setTitle("Update source")
                .setSingleChoiceItems(new String[]{"GitHub (recommended)", "This server"}, localUpdates ? 1 : 0, (dialog, which) -> {
                    stopUpdates();
                    availableUpdate = readyUpdate = null;
                    waitingForInstallPermission = false;
                    if (updateNotice != null) updateNotice.setVisibility(View.GONE);
                    getPreferences(MODE_PRIVATE).edit().putString("updateSource", which == 1 ? UpdateSource.SERVER : UpdateSource.GITHUB)
                            .remove("updateCheckedAt").remove("updateCheckedSource").apply();
                    dialog.dismiss();
                    checkUpdates(true);
                    startUpdates();
                }).setNegativeButton("Cancel", null).show();
    }
    @Override public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) { onBackPressed(); return true; }
        return super.onKeyUp(keyCode, event);
    }
}
