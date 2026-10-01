# Android TV player: install from USB

OpenFrame includes an experimental Android TV app, separate from the Raspberry Pi installer. It packages the shared slide renderer and an Android sync agent in a single signed APK. No Play Store account, ADB, Python installation, or Docker installation is needed on the TV box.

## Requirements

- Android 9 (API 28) or newer, with Android System WebView 100 or newer. Keep WebView updated. Some inexpensive TV boxes ship without a usable or updatable WebView; check before buying hardware.
- A USB port and a file manager that can open APKs from USB. The box must permit installation from unknown apps; managed/restricted boxes may disable it.
- A reachable OpenFrame server for initial pairing and content downloads. HDMI and a remote with directional buttons, OK, and Back are sufficient for setup. A USB keyboard is optional.
- Enough app storage for the downloaded playlist. Individual images are limited to 25 MiB; the media cache is limited to 256 MiB. Leave room for both the old and incoming playlist during updates.

The APK contains no native CPU libraries, so the same package targets ARM32, ARM64, and x86 Android devices meeting these requirements. Physical device compatibility and unattended operation still require the checks below.

## Install and pair

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

Copy a newer signed APK to USB and install it over the existing app. Android preserves pairing and content when the application ID and signing key match and the version code increases. Do not uninstall first. Server updates do not update this APK automatically. Downgrades may be rejected by Android.

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

This runs Android unit tests and release lint, then builds the signed release APK and writes the APK, SHA-256 file, `INSTALL.txt`, and USB ZIP under `outputs/android/`. Missing signing variables fail the release build; there is no silent debug-key fallback. The Android version reads `package.json`; version codes are `major * 1000000 + minor * 1000 + patch`, with minor/patch each below 1000. Use the repository's version scripts for updates.

If Maven is unavailable but the SDK is already installed, `pnpm build:android --sdk` compiles the same source directly using the official SDK tools and verifies APK signing/alignment. This fallback does **not** run Gradle lint or unit tests; run those separately when dependencies are available. It produces the same package ID/version and can use the same release key. It requires no additional runtime dependencies in the APK.

For development without release credentials:

```sh
cd player/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

On Windows use `gradlew.bat`. The debug package has a separate `.debug` application ID and cannot update a release installation. Generated build output and signing material are excluded from Git.

## Supported behavior and limits

The app supports pairing, 15-second sync polling while open, image/slide playback, schedules, transitions, widgets, weather snapshots, rotation, blanking, refresh commands, and playback status reporting. Assets are checksum-verified and the active publication changes only after every asset downloads. Network redirects are rejected so device credentials cannot follow a redirect to another server. The bundled WebView can load only bundled files and cached images; device credentials remain in native app storage. Cloudflare Access service-token headers and Pi provisioning ZIP imports are not implemented in this version. Use a directly reachable origin or configure network/VPN access separately in Android.

This is a foreground signage app. It keeps the display awake while open and pauses polling/timers when backgrounded. It does not automatically launch after power-on, replace the Android home launcher, lock the device into kiosk mode, configure Wi-Fi/VPN, create a recovery hotspot, or install its own updates. Reopen it after reboot, or use a separately configured device-management/launcher solution. Remote reboot is acknowledged with an unsupported-operation status; restart the box through Android settings.

## Physical acceptance checklist

Before unattended use, record the box model, Android firmware, and WebView version, then verify:

- USB installation, launcher visibility, and setup with only the remote.
- Pairing, assignment, image rendering, rotation, schedules, transitions, clocks, counters, and weather.
- Network loss during playback and during an incoming publication; the previous complete publication must survive a failed download.
- Closing and reopening offline, server recovery, blank/unblank, refresh, and device revocation.
- Installing a newer APK signed with the same key without losing pairing/cache.
- Back/Menu behavior, resuming after Home, screen sleep behavior, power-cycle startup procedure, storage pressure, and a 24-hour playback run.

Host-side unit tests and APK validation do not establish physical TV compatibility or long-run performance. See the [validation record](validation.md).
