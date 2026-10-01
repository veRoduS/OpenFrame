# Android TV player: downloads and updates

OpenFrame includes an experimental Android TV app, separate from the Raspberry Pi installer. It packages the shared slide renderer and an Android sync agent in a single signed APK. No Play Store account, ADB, Python installation, or Docker installation is needed on the TV box.

## Requirements

- Android 9 (API 28) or newer, with Android System WebView 100 or newer. Keep WebView updated. Some inexpensive TV boxes ship without a usable or updatable WebView; check before buying hardware.
- A downloader/file-manager app that can open APKs, or a USB port for flash-drive installation. A USB port is **not** required: streaming sticks can download over Wi-Fi. The box must permit installation from unknown apps; managed/restricted boxes may disable it.
- A reachable OpenFrame server for initial pairing and content downloads. HDMI and a remote with directional buttons, OK, and Back are sufficient for setup. A USB keyboard is optional.
- Enough app storage for the downloaded playlist. Individual images are limited to 25 MiB; the media cache is limited to 256 MiB. Leave room for both the old and incoming playlist during updates.

The APK contains no native CPU libraries, so the same package targets ARM32, ARM64, and x86 Android devices meeting these requirements. Physical device compatibility and unattended operation still require the checks below.

## Install and pair

On a stick without USB, use **Download Android APK** in the server's public homepage, or enter `https://YOUR-SERVER/downloads/android/openframe-player.apk` in a TV downloader app. Substitute your actual server address (including its port for a local HTTP server). Allow that downloader/file manager to install unknown apps when Android prompts. You can also transfer the downloaded APK from a phone over Wi-Fi. Then continue at step 4 below.

1. Obtain the signed `openframe-player-VERSION.apk` from the local `outputs/android/` build folder, or extract the matching `-usb.zip`. Copy the APK to a flash drive in a format your box supports, usually FAT32.
2. Insert the flash drive into the box. Open its file manager, browse the USB drive, and select the APK.
3. If prompted, open Android's **Install unknown apps** settings and allow that file manager to install apps. Older/custom firmware may call this **Unknown sources**. Return to the APK and choose **Install**.
4. Open **OpenFrame Player** from the TV app launcher. Connect the box to Wi-Fi or Ethernet through Android settings first.
5. Enter the server origin (for example `https://screens.example.com` or `http://192.168.1.10:3100`) and a screen name. Use HTTPS for remote connections. HTTP requires an explicit local-network confirmation because it carries device credentials without encryption.
6. On the OpenFrame server, open **Screens**, approve the displayed pairing code, and assign a published playlist.
7. Wait for the first successful download. The flash drive can then be removed. Content and pairing are stored in the app's private storage.

Installing the APK itself works without Internet access. Pairing and initial playback require access to your server. Once synchronized, the app keeps the latest complete playlist playing through a network outage and can reopen that cached playlist offline. Scheduling uses the box's clock, so configure its time and timezone correctly.

Press **Back** or **Menu** during playback to resume, edit connection settings, or exit. A server-address change uses separate pairing/cache storage, preventing one server's credentials from being sent to another. Changing the name in setup affects a future enrollment; rename an already paired screen on the server. Clearing Android app data or uninstalling removes pairing and cache.

## Updates and signing keys

Starting with 0.10.3, the player checks its configured OpenFrame server for APK updates at startup and every six hours while open. Checks are remembered across restarts, so reopening within six hours does not repeatedly poll. An available-update notice does not stop playback and is hidden while the screen is blanked. Press **Back/Menu → Check for updates** at any time for an immediate check.

Choose **Download and install**. The player downloads into private app storage, verifies the declared size and SHA-256, checks the actual APK's package/version and signing certificates against the installed app, and opens Android's package installer. The first time, allow **OpenFrame Player** under **Install unknown apps**, then press Back to continue. Approve **Update/Install** in Android. Some firmwares require reopening OpenFrame afterward. Cancelling or failing a download leaves the installed app and cached playlists intact. Returning Home cancels active checks/downloads; retry from the menu. The player rejects redirects, cross-origin paths, mismatched signatures, incompatible Android versions, and downgrades.

Android requires user approval on ordinary unmanaged boxes; this is not a silent/unattended update system. Device policy may prohibit installation. If installer settings are unavailable, install the downloaded APK through a file manager. Versions 0.10.1/0.10.2 must receive 0.10.3 or newer manually once to gain this feature.

You can still install a newer signed APK over the existing app by Wi-Fi or USB. Android preserves pairing and content when the application ID and signing key match and the version code increases. Do not uninstall first. Updating the server alone does not replace the installed player or publish an APK.

Keep the release keystore, alias, and passwords backed up privately. Losing the key prevents in-place updates to installations signed with it. Never put signing files, passwords, paired-device data, or server configuration into Git or the USB distribution. The APK and USB ZIP contain application files and installation instructions only.

## Build the USB package

Use JDK 17 or 21, the Android SDK with platform 35/build-tools 35.0.0, and the repository's Node/pnpm toolchain. Set `ANDROID_HOME` to your SDK directory; accept its licenses with `sdkmanager --licenses`. The checked-in Gradle wrapper pins Gradle 8.13 and its distribution checksum. Gradle downloads build dependencies on the first build.

Create a release key once, outside source control (the example directory is ignored):

```sh
mkdir -p .secrets/android
keytool -genkeypair -keystore .secrets/android/openframe-release.jks \
  -alias openframe -keyalg RSA -keysize 3072 -validity 10000
```

Supply signing settings through your shell or secret manager. Use an absolute keystore path and your actual passwords; do not commit an environment file. For a PKCS12 keystore use the same store and key password.

```sh
export OPENFRAME_ANDROID_KEYSTORE="$PWD/.secrets/android/openframe-release.jks"
export OPENFRAME_ANDROID_KEY_ALIAS=openframe
read -rs -p 'Keystore password: ' OPENFRAME_ANDROID_STORE_PASSWORD
export OPENFRAME_ANDROID_STORE_PASSWORD
export OPENFRAME_ANDROID_KEY_PASSWORD="$OPENFRAME_ANDROID_STORE_PASSWORD"
pnpm build:android
```

This runs Android unit tests and release lint, then builds the signed release APK and writes the APK, SHA-256 file, `latest.json` update metadata, `INSTALL.txt`, and USB ZIP under `outputs/android/`. The build replaces the APK before atomically replacing `latest.json`. Missing signing variables fail the release build; there is no silent debug-key fallback. The Android version reads `package.json`; version codes are `major * 1000000 + minor * 1000 + patch`, with minor/patch each below 1000. Use the repository's version scripts for updates.

If Maven is unavailable but the SDK is already installed, `pnpm build:android --sdk` compiles the same source directly using the official SDK tools and verifies APK signing/alignment. This fallback does **not** run Gradle lint or unit tests; run those separately when dependencies are available. It produces the same package ID/version and can use the same release key. It requires no additional runtime dependencies in the APK.

For development without release credentials:

```sh
cd player/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

On Windows use `gradlew.bat`. The debug package has a separate `.debug` application ID and cannot update a release installation. Generated build output and signing material are excluded from Git.

## Make the download available on your server

The public homepage displays **Download Android APK** when a valid release is available. Missing or invalid releases display an unavailable message instead of a broken button. No OpenFrame login or device token is required to download the application; no screen credentials are included. The endpoints are:

- `/downloads/android/latest.json`: version name/code, package ID, minimum Android API, byte size, SHA-256, and the versioned APK path.
- `/downloads/android/openframe-player.apk`: stable address for TV downloader apps; serves the latest APK directly without redirecting.
- `/downloads/android/openframe-player-VERSION.apk`: the version-specific address consumed by the updater.

Source installs (`pnpm start` or `pnpm dev`) read `outputs/android/` by default, so a local signed build is immediately available there. Set `ANDROID_RELEASE_DIR` to use another directory. Release files are read at request time; no restart is needed after replacing a release.

For Docker, APKs and signing keys are excluded from the server image. Build the APK on your build machine, place the generated APK and `latest.json` under `outputs/android/` alongside your Compose files, then use the read-only release mount:

```sh
docker compose -f compose.yaml -f compose.android.yaml up -d --build
```

Use `compose.registry.yaml` as the first file if running a prebuilt server image that includes this feature. Alternatively the image defaults to `/data/android-releases` in the persistent volume. Always transfer the APK **before** replacing `latest.json`; use a temporary manifest file followed by a rename. Keep both files readable by the server process. Future APK updates do not require rebuilding the server container. Only put release files in the distribution directory; never signing keys or private configuration. Keep the signing key used for the first installed APK.

The server validates metadata, file size, and checksum before advertising or sending a release. The Android client independently verifies these and checks the installed signing identity. Use HTTPS off the trusted local network. If a reverse proxy requires interactive login for all paths, make these public download endpoints reachable to the device as well; the updater does not send administrator sessions or follow login redirects.

## Supported behavior and limits

The app supports pairing, 15-second sync polling while open, image/slide playback, schedules, transitions, widgets, weather snapshots, rotation, blanking, refresh commands, and playback status reporting. Assets are checksum-verified and the active publication changes only after every asset downloads. Network redirects are rejected so device credentials cannot follow a redirect to another server. The bundled WebView can load only bundled files and cached images; device credentials remain in native app storage. Cloudflare Access service-token headers and Pi provisioning ZIP imports are not implemented in this version. Use a directly reachable origin or configure network/VPN access separately in Android.

This is a foreground signage app. It keeps the display awake while open and pauses polling/timers when backgrounded. It does not automatically launch after power-on, replace the Android home launcher, lock the device into kiosk mode, configure Wi-Fi/VPN, create a recovery hotspot, or install updates silently. Reopen it after reboot, or use a separately configured device-management/launcher solution. Remote reboot is acknowledged with an unsupported-operation status; restart the box through Android settings.

## Physical acceptance checklist

Before unattended use, record the box model, Android firmware, and WebView version, then verify:

- USB installation, launcher visibility, and setup with only the remote.
- Pairing, assignment, image rendering, rotation, schedules, transitions, clocks, counters, and weather.
- Network loss during playback and during an incoming publication; the previous complete publication must survive a failed download.
- Closing and reopening offline, server recovery, blank/unblank, refresh, and device revocation.
- Installing a newer APK signed with the same key without losing pairing/cache.
- Downloading from the homepage on a stick without USB; automatic/manual update detection; installer permission grant and return; install/cancel flows; rejecting another signing key or interrupted download; reopening after a successful update.
- Back/Menu behavior, resuming after Home, screen sleep behavior, power-cycle startup procedure, storage pressure, and a 24-hour playback run.

Host-side unit tests and APK validation do not establish physical TV compatibility or long-run performance. See the [validation record](validation.md).
