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
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
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
    private int lifecycleGeneration;
    private int generation;
    private static final ScheduledExecutorService updateWorker = Executors.newSingleThreadScheduledExecutor();
    private static final long UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000L;
    private static final String AUTO_UPDATES = "automaticUpdatesEnabled";
    private ScheduledFuture<?> updatePolling;
    private Future<?> updateTask;
    private int updateGeneration;
    private boolean updateBusy, waitingForInstallPermission;
    private String activeServer;
    private UpdateSource.Release availableUpdate, readyUpdate;
    private TextView updateNotice;
    private boolean displayBlank;
    private AlertDialog updateProgress;
    private TextView deviceSleepStatus;
    private KioskPreferences kiosk;
    private boolean offerShown;
    private final android.os.Handler recoveryHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable pendingRecovery;


    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        kiosk = new KioskPreferences(this);
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
        // TV keyboards float over the lower half of the screen, so leave room to scroll the focused control above them.
        layout.setPadding(inset, inset / 2, inset, Math.max(inset / 2, getResources().getDisplayMetrics().heightPixels / 2));
        layout.setBackgroundColor(Color.rgb(22, 45, 39));
        layout.addView(text("OpenFrame Player", 28));
        layout.addView(text("Connect this TV to your OpenFrame server. Use Android settings to connect Wi-Fi first.", 18));
        layout.addView(text("Server address", 16));
        EditText server = new EditText(this);
        server.setSingleLine(true);
        server.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        server.setImeOptions(EditorInfo.IME_ACTION_NEXT | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        server.setHint("https://screens.example.com");
        server.setText(getPreferences(MODE_PRIVATE).getString("server", ""));
        layout.addView(server);
        layout.addView(text("Screen name", 16));
        EditText name = new EditText(this);
        name.setSingleLine(true);
        name.setImeOptions(EditorInfo.IME_ACTION_NEXT | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        name.setText(getPreferences(MODE_PRIVATE).getString("name", "Android TV"));
        layout.addView(name);
        layout.addView(text("Site number (optional for existing single-site servers)", 16));
        EditText site = new EditText(this);
        site.setSingleLine(true);
        site.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        site.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        site.setText(getPreferences(MODE_PRIVATE).getString("siteNumber", ""));
        layout.addView(site);
        layout.addView(text("A user from your store or an administrator confirms the site during pairing. Changing this field does not move an already paired screen.", 14));
        TextView error = text("", 16);
        Button connect = new Button(this);
        connect.setText("Connect and show pairing code");
        connect.setOnClickListener(view -> {
            try {
                String origin = PlayerAgent.normalizeServer(server.getText().toString());
                String screenName = name.getText().toString().trim();
                String siteNumber = PlayerAgent.normalizeSiteNumber(site.getText().toString());
                if (screenName.isEmpty() || screenName.length() > 100) throw new IllegalArgumentException("Use a screen name between 1 and 100 characters.");
                Runnable save = () -> {
                    getPreferences(MODE_PRIVATE).edit().putString("server", origin).putString("name", screenName).putString("siteNumber", siteNumber).apply();
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
        View.OnFocusChangeListener lift = (view, focused) -> {
            if (focused) scroll.post(() -> scroll.smoothScrollTo(0, Math.max(0, view.getTop() - inset * 2)));
        };
        server.setOnFocusChangeListener(lift);
        name.setOnFocusChangeListener(lift);
        site.setOnFocusChangeListener(lift);
        connect.setOnFocusChangeListener(lift);
        site.setOnEditorActionListener((view, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(view.getWindowToken(), 0);
            connect.requestFocus();
            return true;
        });
        layout.addView(error);
        layout.addView(text("During playback, press Back or Menu for settings. Approve the displayed code under Screens on your server.", 16));
        deviceSleepStatus = text(deviceSleepSummary(), 16);
        layout.addView(deviceSleepStatus);
        Button sleepSettings = new Button(this);
        sleepSettings.setText("Prevent device sleep");
        sleepSettings.setOnClickListener(view -> showDeviceSleepSettings());
        layout.addView(sleepSettings);
        scroll.addView(layout);
        setContentView(scroll);
        server.requestFocus();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void startPlayer(String server, String name) {
        deviceSleepStatus = null;
        stopUpdates();
        activeServer = server;
        stopPolling();
        disposeWeb();
        int request = ++generation;
        setContentView(text("Opening OpenFrame…", 24));
        // Construct after any in-flight sync finishes, so changing settings cannot race identity/state writes.
        String siteNumber = getPreferences(MODE_PRIVATE).getString("siteNumber", "");
        worker.execute(() -> {
            try {
                PlayerAgent current = new PlayerAgent(new File(getFilesDir(), "players"), server, name, BuildConfig.VERSION_NAME, siteNumber);
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
            web.getSettings().setMediaPlaybackRequiresUserGesture(false);
            web.getSettings().setAllowFileAccess(false);
            web.getSettings().setAllowContentAccess(false);
            web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            web.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
            // The only JavaScript bridge method accepts bounded playback telemetry.
            web.addJavascriptInterface(new PlaybackBridge(current), "OpenFrameAndroid");
            web.setWebViewClient(new WebViewClient() {
                @Override public void onPageFinished(WebView view, String url) {
                    if (web == view && !resumed) view.evaluateJavascript(backgroundScript(true, lifecycleGeneration), null);
                }
                @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                    if (web == view) {
                        disposeWeb();
                        recoverPlayback();
                    }
                    return true;
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                    if (web == view && request.isForMainFrame()) recoverPlayback();
                }
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
                                    try { if (new org.json.JSONObject(snapshot).optBoolean("approved") && !blank) showKioskOffer(); } catch (org.json.JSONException ignored) { }
                                    updateNotice.setVisibility(availableUpdate != null && !blank ? View.VISIBLE : View.GONE);
                                }
                            });
                            return response("application/json", new ByteArrayInputStream(snapshot.getBytes(StandardCharsets.UTF_8)));
                        }
                        if (path != null && path.matches("/media/[a-f0-9-]{36}\\.(webp|mp4|woff2|woff|ttf|otf)")) {
                            String filename = path.substring(7);
                            String mime = filename.endsWith(".mp4") ? "video/mp4"
                                    : filename.endsWith(".webp") ? "image/webp"
                                    : filename.endsWith(".woff2") ? "font/woff2"
                                    : filename.endsWith(".woff") ? "font/woff"
                                    : filename.endsWith(".otf") ? "font/otf" : "font/ttf";
                            String range = null;
                            for (java.util.Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                                if ("Range".equalsIgnoreCase(header.getKey())) range = header.getValue();
                            }
                            MediaResponse media = new MediaResponse(new File(current.media, filename), range);
                            return new WebResourceResponse(mime, null, media.status,
                                    media.status == 206 ? "Partial Content" : media.status == 416 ? "Range Not Satisfiable" : "OK", media.headers, media.body);
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
        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
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

    private boolean automaticUpdatesEnabled() {
        return getPreferences(MODE_PRIVATE).getBoolean(AUTO_UPDATES, false);
    }

    private void startUpdates() {
        if (automaticUpdatesEnabled() && resumed && activeServer != null && web != null && updatePolling == null) {
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
        if ((!manual && !automaticUpdatesEnabled()) || !resumed || activeServer == null || updateBusy) return;
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
                    if (!manual && !automaticUpdatesEnabled()) {
                        availableUpdate = null;
                        if (updateNotice != null) updateNotice.setVisibility(View.GONE);
                        return;
                    }
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
            if (web.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) web.getParent()).removeView(web);
            web.stopLoading();
            web.removeJavascriptInterface("OpenFrameAndroid");
            web.destroy();
            web = null;
        }
    }
    private static String backgroundScript(boolean background, int sequence) {
        return "window.openFrameSetBackground && window.openFrameSetBackground(" + background + "," + sequence + ")";
    }
    @Override protected void onResume() {
        super.onResume();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (deviceSleepStatus != null) deviceSleepStatus.setText(deviceSleepSummary());
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        resumed = true;
        lifecycleGeneration++;
        if (web != null) {
            web.onResume(); web.resumeTimers();
            web.evaluateJavascript(backgroundScript(false, lifecycleGeneration), null);
        }
        startPolling();
        if (web == null && agent != null) recoverPlayback();
        if (waitingForInstallPermission) {
            waitingForInstallPermission = false;
            if (getPackageManager().canRequestPackageInstalls()) requestInstallation();
            else updateMessage("Update not installed", "Installation permission was not enabled. You can try again from Check for updates.");
        }
        startUpdates();
    }
    @Override protected void onPause() {
        if (pendingRecovery != null) recoveryHandler.removeCallbacks(pendingRecovery);
        pendingRecovery = null;
        resumed = false;
        final int pausedGeneration = ++lifecycleGeneration;
        stopPolling();
        stopUpdates();
        if (web != null) {
            WebView current = web;
            // Release media before suspending JS. A bounded native fallback also
            // pauses the WebView if its renderer cannot answer the cleanup call.
            Runnable pause = new Runnable() {
                @Override public void run() {
                    current.removeCallbacks(this);
                    if (web == current && !resumed && lifecycleGeneration == pausedGeneration) {
                        current.onPause();
                        current.pauseTimers();
                    }
                }
            };
            current.evaluateJavascript(backgroundScript(true, pausedGeneration), result -> pause.run());
            current.postDelayed(pause, 1000);
        }
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
        if (web == null) { authorize(() -> showPlayerMenu()); return; }
        showPlayerMenu();
    }
    private void showPlayerMenu() {
        boolean localUpdates = UpdateSource.SERVER.equals(getPreferences(MODE_PRIVATE).getString("updateSource", UpdateSource.GITHUB));
        boolean automatic = automaticUpdatesEnabled();
        new AlertDialog.Builder(this).setTitle("OpenFrame Player")
                .setItems(new String[]{"Resume playback", "Connection settings", "Check for updates", "Automatic updates: " + (automatic ? "On" : "Off"), "Update source: " + (localUpdates ? "This server" : "GitHub"), "Prevent device sleep", "Kiosk Mode", "Exit player"}, (dialog, which) -> {
                    if (which == 1) authorize(this::setup);
                    if (which == 2) checkUpdates(true);
                    if (which == 3) chooseAutomaticUpdates();
                    if (which == 4) chooseUpdateSource();
                    if (which == 5) authorize(this::showDeviceSleepSettings);
                    if (which == 6) authorize(this::showKiosk);
                    if (which == 7) authorize(this::exitKiosk);
                }).show();
    }

    private void showKioskOffer() {
        if (offerShown || !resumed || !kiosk.prefs.getBoolean("offer", false)) return;
        offerShown = true;
        // Nonmodal notice; playback and pairing continue behind it.
        android.widget.FrameLayout root = findViewById(android.R.id.content);
        Button offer = new Button(this);
        offer.setText("Kiosk Mode is now available. Configure now / Later");
        android.widget.FrameLayout.LayoutParams params = new android.widget.FrameLayout.LayoutParams(
                -2, -2, android.view.Gravity.BOTTOM | android.view.Gravity.RIGHT);
        root.addView(offer, params);
        offer.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Kiosk Mode is now available.")
                .setPositiveButton("Configure now", (d, w) -> {
                    kiosk.prefs.edit().putBoolean("offer", false).apply(); root.removeView(offer); authorize(this::showKiosk);
                }).setNegativeButton("Later", (d, w) -> {
                    kiosk.prefs.edit().putBoolean("offer", false).apply(); root.removeView(offer);
                }).show());
    }
    private void recoverPlayback() {
        if (pendingRecovery != null || !resumed) return;
        long now = System.currentTimeMillis();
        long since = now - kiosk.prefs.getLong("recoveryWindow", 0);
        int attempts = since < 0 || since > 600000 ? 0 : kiosk.prefs.getInt("recoveryAttempts", 0);
        if (!kiosk.recovery() || attempts >= 3) {
            new AlertDialog.Builder(this).setTitle("Playback needs attention")
                    .setMessage("Automatic recovery is disabled or paused after repeated failures. Cached content and pairing are retained.")
                    .setPositiveButton("Retry playback", (d,w) -> startPlayer(activeServer, getPreferences(MODE_PRIVATE).getString("name", "Android TV")))
                    .setNegativeButton("Settings", (d,w) -> authorize(this::showKiosk)).show();
            return;
        }
        kiosk.prefs.edit().putLong("recoveryWindow", attempts == 0 ? now : kiosk.prefs.getLong("recoveryWindow", now))
                .putInt("recoveryAttempts", attempts + 1).apply();
        pendingRecovery = () -> {
            pendingRecovery = null;
            if (resumed && activeServer != null) startPlayer(activeServer, getPreferences(MODE_PRIVATE).getString("name", "Android TV"));
        };
        recoveryHandler.postDelayed(pendingRecovery, 5000L * (attempts + 1));
    }
    private boolean isHome() {
        android.content.pm.ResolveInfo home = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        return home != null && home.activityInfo != null && getPackageName().equals(home.activityInfo.packageName);
    }
    private void openHomeSettings() {
        // Only expose the Home candidate after an explicit user request.
        getPackageManager().setComponentEnabledSetting(new android.content.ComponentName(this, getPackageName() + ".KioskHome"),
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED, android.content.pm.PackageManager.DONT_KILL_APP);
        try { startActivity(new Intent(Settings.ACTION_HOME_SETTINGS)); }
        catch (RuntimeException ex) { updateMessage("Home selection unavailable", "This firmware does not expose Home selection. Use the normal TV launcher to open OpenFrame. Startup is best effort."); }
    }
    private void showKiosk() {
        String[] items = {"Kiosk Mode: " + (kiosk.enabled() ? "Enabled" : "Disabled"),
            "Launch at startup: " + (kiosk.startup() ? "Requested (firmware dependent)" : "Disabled"),
            "Default Home application: " + (isHome() ? "OpenFrame" : "Not configured"),
            "Fullscreen playback: Enabled", "Automatic playback recovery: " + (kiosk.recovery() ? "Enabled" : "Disabled"),
            "Device sleep prevention / Open settings", "Administrator PIN: " + (kiosk.prefs.contains("pin") ? "Change" : "Configure"),
            "Device compatibility: Partial", "Enable Kiosk Features", "Return to playback"};
        new AlertDialog.Builder(this).setTitle("OpenFrame — Kiosk Mode").setItems(items, (d,w) -> {
            if (w == 0) { if (!kiosk.enabled()) { configurePinThenEnable(); return; } kiosk.prefs.edit().putBoolean("enabled", false).apply(); }
            if (w == 1) kiosk.prefs.edit().putBoolean("startup", !kiosk.prefs.getBoolean("startup", false)).apply();
            if (w == 2) openHomeSettings();
            if (w == 4) kiosk.prefs.edit().putBoolean("recovery", !kiosk.prefs.getBoolean("recovery", true)).apply();
            if (w == 5) showDeviceSleepSettings();
            if (w == 6) configurePin();
            if (w == 7) updateMessage("Partial kiosk support", "Home and boot startup depend on firmware. Home, power, system settings and other apps remain controlled by Android. OpenFrame does not provide full device lockdown.");
            if (w == 8) configurePinThenEnable();
            if (w == 0 || w == 1 || w == 4) showKiosk();
        }).setNegativeButton("Back", null).show();
    }
    private void configurePinThenEnable() {
        if (!kiosk.prefs.contains("pin")) { configurePin(); return; }
        new AlertDialog.Builder(this).setTitle("Enable Kiosk Features")
            .setMessage("Enable PIN protected settings, best effort boot startup and bounded playback recovery? Next, Android may let you choose OpenFrame as Home. Canceling Home selection leaves your existing Home unchanged. Check device sleep settings separately.")
            .setPositiveButton("Enable and choose Home", (d,w) -> {
                kiosk.prefs.edit().putBoolean("enabled", true).putBoolean("startup", true).putBoolean("recovery", true).apply(); openHomeSettings();
            }).setNegativeButton("Cancel", null).show();
    }
    private void configurePin() {
        LinearLayout fields = new LinearLayout(this); fields.setOrientation(LinearLayout.VERTICAL);
        EditText first = pinField("New PIN (4–12 digits)"); EditText second = pinField("Confirm PIN");
        fields.addView(first); fields.addView(second);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Administrator PIN")
            .setMessage("Remember this PIN. There is no remote PIN reset. After saving, select Enable Kiosk Features.")
            .setView(fields).setPositiveButton("Save", null).setNegativeButton("Cancel", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(-1).setOnClickListener(v -> {
            String pin = first.getText().toString();
            if (!pin.matches("[0-9]{4,12}") || !pin.equals(second.getText().toString())) { second.setError("PINs must match and contain 4–12 digits"); return; }
            String salt = KioskPin.salt(); kiosk.prefs.edit().putString("salt", salt).putString("pin", KioskPin.hash(pin, salt)).apply(); dialog.dismiss(); showKiosk();
        })); dialog.show();
    }
    private EditText pinField(String hint) {
        EditText input = new EditText(this); input.setHint(hint); input.setSingleLine(true);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        return input;
    }
    private void authorize(Runnable action) {
        if (!kiosk.prefs.contains("pin")) { action.run(); return; }
        if (System.currentTimeMillis() < kiosk.prefs.getLong("pinBlockedUntil", 0)) { updateMessage("Try later", "Wait 30 seconds before trying the administrator PIN again."); return; }
        EditText input = pinField("Administrator PIN");
        new AlertDialog.Builder(this).setTitle("Administrator PIN").setView(input)
            .setPositiveButton("Unlock", (d,w) -> {
                if (KioskPin.verify(input.getText().toString(), kiosk.prefs.getString("salt", ""), kiosk.prefs.getString("pin", ""))) {
                    kiosk.prefs.edit().putInt("pinFailures", 0).apply(); action.run();
                } else {
                    int failures = kiosk.prefs.getInt("pinFailures", 0) + 1;
                    kiosk.prefs.edit().putInt("pinFailures", failures % 5).putLong("pinBlockedUntil", failures >= 5 ? System.currentTimeMillis() + 30000 : 0).apply();
                    updateMessage("Incorrect PIN", "Try again from the player menu.");
                }
            }).setNegativeButton("Cancel", null).show();
    }
    private void exitKiosk() {
        new AlertDialog.Builder(this).setTitle("Exit player")
            .setMessage("Exit pauses boot startup and disables the OpenFrame Home candidate so Android can return to its launcher. Pairing and cache are retained.")
            .setPositiveButton("Exit", (d,w) -> {
                kiosk.prefs.edit().putBoolean("enabled", false).apply();
                getPackageManager().setComponentEnabledSetting(new android.content.ComponentName(this, getPackageName() + ".KioskHome"),
                    android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED, android.content.pm.PackageManager.DONT_KILL_APP);
                try { startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)); } catch (RuntimeException ignored) { }
                finish();
            }).setNegativeButton("Cancel", null).show();
    }

    private String deviceSleepSummary() {
        // Some TV firmware has a separate inactivity shutdown timer that ignores
        // KEEP_SCREEN_ON. Read it without requesting permission to change it.
        // A missing/unreadable setting is unknown, not proof that sleep is disabled.
        try {
            int timeout = Settings.Secure.getInt(getContentResolver(), "attentive_timeout");
            if (timeout <= 0) return "Android's inactivity shutdown timer is disabled. OpenFrame keeps the display awake while open; other device power settings may still apply.";
            long minutes = ((long) timeout + 59999) / 60000;
            return "This device has an inactivity shutdown timer of about " + minutes + " minute" + (minutes == 1 ? "" : "s") + ". It can interrupt playback even while OpenFrame is open.";
        } catch (Settings.SettingNotFoundException | SecurityException ignored) {
            return "OpenFrame keeps the display awake while open. Check device power settings for a separate inactivity shutdown timer; this device does not expose its timeout to OpenFrame.";
        }
    }
    private void showDeviceSleepSettings() {
        new AlertDialog.Builder(this).setTitle("Prevent device sleep")
                .setMessage(deviceSleepSummary() + "\n\nOpen device settings and look for System → Power & Energy, Energy saver, or Sleep. For continuous playback, choose Never for inactivity shutdown or turning off the display, if available. Menu names vary by device.\n\nPress Back to return to OpenFrame. No developer options are needed when your device provides this setting. If there is no Never option, contact your device administrator for continuous playback setup.")
                .setNegativeButton("Back", null)
                .setPositiveButton("Open device settings", (dialog, which) -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (android.content.ActivityNotFoundException | SecurityException ex) {
                        new AlertDialog.Builder(this).setTitle("Open settings from Home")
                                .setMessage("This device does not let OpenFrame open its settings. Press Home on your remote, open device settings, and check Power & Energy or Sleep. Then reopen OpenFrame.")
                                .setPositiveButton("OK", null).show();
                    }
                }).show();
    }
    private void chooseAutomaticUpdates() {
        boolean enabled = automaticUpdatesEnabled();
        new AlertDialog.Builder(this).setTitle("Automatic updates")
                .setMessage("When enabled, OpenFrame checks for player updates when it opens and every six hours while it is open.")
                .setSingleChoiceItems(new String[]{"Off (default)", "On"}, enabled ? 1 : 0, (dialog, which) -> {
                    boolean next = which == 1;
                    getPreferences(MODE_PRIVATE).edit().putBoolean(AUTO_UPDATES, next).apply();
                    if (next) startUpdates();
                    else {
                        if (updatePolling != null) updatePolling.cancel(false);
                        updatePolling = null;
                        availableUpdate = null;
                        if (updateNotice != null) updateNotice.setVisibility(View.GONE);
                    }
                    dialog.dismiss();
                }).setNegativeButton("Cancel", null).show();
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
