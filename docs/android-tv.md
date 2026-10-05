# Android TV player: downloads and updates

OpenFrame includes an experimental Android TV app, separate from the Raspberry Pi installer. It packages the shared slide renderer and an Android sync agent in a single signed APK. No Play Store account, ADB, Python installation, or Docker installation is needed on the TV box.

## Requirements

- Android 9 (API 28) or newer, with Android System WebView 100 or newer. Keep WebView updated. Some inexpensive TV boxes ship without a usable or updatable WebView; check before buying hardware.
- A downloader/file-manager app that can open APKs, or a USB port for flash-drive installation. A USB port is **not** required: streaming sticks can download over Wi-Fi. The box must permit installation from unknown apps; managed/restricted boxes may disable it.
- A reachable OpenFrame server for initial pairing and content downloads. HDMI and a remote with directional buttons, OK, and Back are sufficient for setup. A USB keyboard is optional.
- Enough app storage for the downloaded playlist. Individual images are limited to 25 MiB; the media cache is limited to 256 MiB. Leave room for both the old and incoming playlist during updates.

The APK contains no native CPU libraries, so the same package targets ARM32, ARM64, and x86 Android devices meeting these requirements. Physical device compatibility and unattended operation still require the checks below.

## Install and pair

On a stick without USB, use **Download Android APK** on the OpenFrame homepage, or paste this direct address into your TV Downloader app:

```text
https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk
```

The address downloads the latest signed APK from GitHub. You can also use `https://YOUR-SERVER/downloads/android/openframe-player.apk` with your actual server address (including its port for a local HTTP server). Allow that downloader/file manager to install unknown apps when Android prompts. You can also transfer the downloaded APK from a phone over Wi-Fi. Then continue at step 4 below.

1. Obtain the signed `openframe-player-VERSION.apk` from the local `outputs/android/` build folder, or extract the matching `-usb.zip`. Copy the APK to a flash drive in a format your box supports, usually FAT32.
2. Insert the flash drive into the box. Open its file manager, browse the USB drive, and select the APK.
3. If prompted, open Android's **Install unknown apps** settings and allow that file manager to install apps. Older/custom firmware may call this **Unknown sources**. Return to the APK and choose **Install**.
4. Open **OpenFrame Player** from the TV app launcher. Connect the box to Wi-Fi or Ethernet through Android settings first.
5. Enter the server origin (for example `https://screens.example.com` or `http://192.168.1.10:3100`) and a screen name. Enter `1962` to connect to `https://openframe.blackfalcon.cloud`. Use HTTPS for remote connections. HTTP requires an explicit local-network confirmation because it carries device credentials without encryption.
6. On the OpenFrame server, open **Screens**, approve the displayed pairing code, and assign a published playlist.
7. Wait for the first successful download. The flash drive can then be removed. Content and pairing are stored in the app's private storage.

Installing the APK itself works without Internet access. Pairing and initial playback require access to your server. Once synchronized, the app keeps the latest complete playlist playing through a network outage and can reopen that cached playlist offline. Scheduling uses the box's clock, so configure its time and timezone correctly.

Press **Back** or **Menu** during playback to resume, edit connection settings, or exit. A server-address change uses separate pairing/cache storage, preventing one server's credentials from being sent to another. Changing the name in setup affects a future enrollment; rename an already paired screen on the server. Clearing Android app data or uninstalling removes pairing and cache.

### Recovering a missing pairing code

Player 0.10.4 fixes enrollment against the real OpenFrame API: successful registration returns HTTP 201, which older Android players incorrectly treated as an error. They could create a pending screen on the server without saving its credentials or displaying the pairing code, then repeat registration on the next attempt.

Download player 0.10.4 or newer from the [direct GitHub APK link](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk) and install it **over the existing app** once. Do not uninstall or clear app data; the signed update preserves any saved settings, pairing, and cached content. Open the player and approve the code it displays under **Screens**.

If enrollment reports **HTTP 429 / Too many pending devices**, remove only unused pending entries left by the failed attempts under **Screens**, then retry. Preserve active or otherwise needed screens. A general **Too many attempts** response is a short rate limit; wait a minute before retrying. Clearing the player's pairing data does not resolve either server-side limit.

## Updates and signing keys

Starting with player 0.10.4, the default **GitHub** update source reads release metadata and downloads the APK directly from the fixed OpenFrame GitHub APK folder. It does not depend on your content server's version or download endpoints. Internet access to GitHub is required for this source; pairing and playlists continue to use your configured OpenFrame server.

Starting with player 0.10.5, automatic update checks are **off by default**. On the remote, press **Back/Menu → Automatic updates → On** to enable checks at startup and every six hours while open; select **Off** to disable them for this device. The setting is saved across restarts. **Back/Menu → Check for updates** always performs an immediate manual check, even while automatic checks are off. An available-update notice does not stop playback and is hidden while the screen is blanked. Choose **Back/Menu → Update source → This server** for a local/private APK distribution served by your configured OpenFrame server, or select **GitHub** to restore the default.

Choose **Download and install**. The player downloads into private app storage, verifies the declared size and SHA-256, checks the actual APK's package/version and signing certificates against the installed app, and opens Android's package installer. The first time, allow **OpenFrame Player** under **Install unknown apps**, then press Back to continue. Approve **Update/Install** in Android. Some firmwares require reopening OpenFrame afterward. Cancelling or failing a download leaves the installed app and cached playlists intact. Returning Home cancels active checks/downloads; retry from the menu. The player rejects redirects, cross-origin paths, mismatched signatures, incompatible Android versions, and downgrades.

Android requires user approval on ordinary unmanaged boxes; this is not a silent/unattended update system. Device policy may prohibit installation. If installer settings are unavailable, install the downloaded APK through a file manager.

Player 0.10.3 checks only its configured server. An older server without the Android download endpoints can return the webpage's HTML instead of update JSON, causing a parsing error. Install 0.10.4 or newer manually over 0.10.1–0.10.3 once to gain the enrollment fix and direct GitHub updates; no server upgrade is needed for that default update source. Do not uninstall first.

The optional **This server** source requires a server with Android update endpoints. Server 0.10.4 mirrors the GitHub APK folder by default; a server configured with a local APK directory can instead serve a private/offline-network release. See the distribution settings below.

You can still install a newer signed APK over the existing app by Wi-Fi or USB. Android preserves pairing and content when the application ID and signing key match and the version code increases. Do not uninstall first. Updating the server alone does not replace the installed player or publish an APK.

Keep the release keystore, alias, and passwords backed up privately. Losing the key prevents in-place updates to installations signed with it. Never put signing files, passwords, paired-device data, or server configuration into Git or the USB distribution. The APK and USB ZIP contain application files and installation instructions only.

## Build the USB package

Use JDK 17 or 21, the Android SDK with platform 35/build-tools 35.0.0, and the repository's Node/pnpm toolchain. Set `ANDROID_HOME` to your SDK directory; accept its licenses with `sdkmanager --licenses`. The checked-in Gradle wrapper pins Gradle 8.13 and its distribution checksum. Gradle downloads build dependencies on the first build.

For this project, restore the existing release keystore from its private backup. The public certificate fingerprint in `player/android/release-signing.json` pins the expected key; builds and uploads reject a different signer. For a new independent distribution only, create a key once outside source control and deliberately configure its own public fingerprint (the example directory is ignored):

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

This checks component versions and compatibility, runs Android unit tests and release lint, then builds the signed release APK and writes the APK, SHA-256 file, `latest.json` update metadata, `INSTALL.txt`, and USB ZIP under `outputs/android/`. The build replaces the APK before atomically replacing `latest.json`. Missing signing variables fail the release build; there is no silent debug-key fallback. The Android version reads `player/version.json`, independently of the server in `package.json`; version codes are `major * 1000000 + minor * 1000 + patch`, with minor/patch each below 1000. Use `pnpm version:player:patch "Summary"` for a player revision and `pnpm version:patch "Summary"` for a server revision. Record contract reviews as described in [player compatibility](player-compatibility.md). Commit reviewed changes before publishing.

After building, the command publishes the signed APK and public release metadata to the `apks/` folder on the dedicated `android-releases` GitHub branch. It uses your normal Git push credentials and requires a clean, committed source tree. Publication verifies the APK package, version, minimum Android API, alignment, and pinned signing certificate. Its source commit must match the current clean checkout; a dirty `--local` build has no publishable source record. Each version gets an immutable folder; `apks/latest/openframe-player.apk` is the stable download. The source branch is not pushed. Use `pnpm build:android --local` for an unpublished build, or `pnpm publish:android` to retry uploading an existing build. If an upload fails, local build files remain available. Never rebuild and replace a published version: bump the player version first.

If Maven is unavailable but the SDK is already installed, `pnpm build:android --sdk` compiles the same source directly using the official SDK tools and verifies APK signing/alignment. This fallback does **not** run Gradle lint or unit tests; run those separately when dependencies are available. It produces the same package ID/version and can use the same release key. It requires no additional runtime dependencies in the APK.

For development without release credentials:

```sh
cd player/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

On Windows use `gradlew.bat`. Run `pnpm install --frozen-lockfile` at the repository root first and keep Node available on `PATH`: `PlayerAgentIntegrationTest` starts the real Express API with disposable server data and checks HTTP 201 enrollment, displayed pairing codes, saved-credential reuse after reopening, and approval. It does not connect to your running server or modify its screens. `UpdateSourceTest` covers the direct GitHub and explicit server update sources. Gradle compiles the host JVM fixtures with the JDK’s `jdk.httpserver` module, while production compilation retains Android’s Java system image. The debug package has a separate `.debug` application ID and cannot update a release installation. Generated build output and signing material are excluded from Git.

## GitHub downloads and server updates

The public homepage always links directly to the [latest APK on GitHub](https://raw.githubusercontent.com/veRoduS/OpenFrame/android-releases/apks/latest/openframe-player.apk). Browse previous builds in the [GitHub APK folder](https://github.com/veRoduS/OpenFrame/tree/android-releases/apks). These files contain no screen credentials. Each version's `release.json` records its checksum, requirements, source commit when available, and compatibility review. Server and player version numbers need not match.

Player 0.10.4 and newer use GitHub directly by default, so these server endpoints are optional for those players. They remain available for player 0.10.3 and for the **This server** setting. By default, server 0.10.4 mirrors the latest GitHub release through them:

- `/downloads/android/latest.json`: version name/code, package ID, minimum Android API, byte size, SHA-256, and the same-origin versioned APK path.
- `/downloads/android/openframe-player.apk`: stable address for TV downloader apps; sends the latest APK directly without redirecting.
- `/downloads/android/openframe-player-VERSION.apk`: the current release's version-specific address consumed by the updater.

The server fetches only the fixed project repository, validates metadata, byte size and checksum, rejects redirects, and caches one verified APK in memory for five minutes. Concurrent checks share the download; failures are cached for 30 seconds. A cold fetch has a combined 12-second deadline. Only the current advertised release is served through these endpoints; older archives remain on GitHub. No administrator session or device token is required. Installed players independently verify checksums and signing identity. Keep these paths reachable through any reverse proxy without an interactive login.

For offline/custom distribution, choose **Update source → This server** in the player, then set `ANDROID_RELEASE_SOURCE=local` and `ANDROID_RELEASE_DIR` on that server to the folder containing the generated APK and `latest.json`. Supplying a release directory also selects local mode unless the source is explicitly set. Local mode defaults to `outputs/android/`; transfer the APK before atomically replacing `latest.json`. For Docker, the optional read-only mount selects local mode explicitly:

```sh
docker compose -f compose.yaml -f compose.android.yaml up -d --build
```

Use `compose.registry.yaml` first when running a prebuilt image containing this feature. The normal Docker configuration uses GitHub and needs no APK volume or signing key. Future player releases require no server rebuild. Use HTTPS off the trusted local network.

## Automated GitHub builds

The checked-in `Publish Android player` workflow builds and publishes when `player/version.json` changes on `main`, or when manually dispatched. It skips an already archived version. To enable it after the source workflow reaches GitHub, configure the `android-releases` environment with the **existing** release key and these Actions secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded keystore.
- `ANDROID_STORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing alias.
- `ANDROID_KEY_PASSWORD`: key password.

The workflow also accepts `OPENFRAME_ANDROID_KEYSTORE`, `OPENFRAME_ANDROID_STORE_PASSWORD`, `OPENFRAME_ANDROID_KEY_ALIAS`, and `OPENFRAME_ANDROID_KEY_PASSWORD` as aliases for those secrets, respectively. The `ANDROID_*` names take precedence when both are set. In GitHub, **`OPENFRAME_ANDROID_KEYSTORE` must contain the base64-encoded keystore file**, not the local path used by the shell environment variable with the same name. Existing environments using these aliases do not need their secrets renamed.

Use the same key as the first distributed APK; a replacement key cannot update installed players. The workflow uses its scoped `GITHUB_TOKEN` to write only the APK branch and removes its temporary keystore. Do not put secrets into the repository, APK folder, workflow file, or USB package. Local builds can publish immediately with configured Git credentials; the hosted workflow additionally needs these secrets and the workflow on GitHub.

## Supported behavior and limits

The app supports pairing, 15-second sync polling while open, image/slide playback, schedules, transitions, widgets, weather snapshots, rotation, blanking, refresh commands, and playback status reporting. Assets are checksum-verified and the active publication changes only after every asset downloads. Network redirects are rejected so device credentials cannot follow a redirect to another server. The bundled WebView can load only bundled files and cached images; device credentials remain in native app storage. Cloudflare Access service-token headers and Pi provisioning ZIP imports are not implemented in this version. Use a directly reachable origin or configure network/VPN access separately in Android.

This is a foreground signage app. It keeps the display awake while open and pauses polling/timers when backgrounded. It does not automatically launch after power-on, replace the Android home launcher, lock the device into kiosk mode, configure Wi-Fi/VPN, create a recovery hotspot, or install updates silently. Reopen it after reboot, or use a separately configured device-management/launcher solution. Remote reboot is acknowledged with an unsupported-operation status; restart the box through Android settings.

## Preventing device sleep

Player 0.10.9 adds **Prevent device sleep** to connection setup and the **Back/Menu** menu. It reads Android's separate `attentive_timeout` setting when accessible and explains how to open the device's normal power settings. Choose **Open device settings**, then look for **System → Power & Energy**, **Energy saver**, or **Sleep** and select **Never** for inactivity shutdown/display shutdown when offered. Return with Back. Setup refreshes its status when returning. Menu names and available options depend on firmware; OpenFrame opens the general settings screen rather than relying on a manufacturer-specific shortcut.

OpenFrame already sets `FLAG_KEEP_SCREEN_ON` and reapplies it on resume. Android TV can also have an inattentiveness timer that ignores app wake locks; background battery exemptions do not disable that timer. If the timeout is missing or unreadable, the app reports it as unknown, not safe. Even a disabled Android timer does not prove that a manufacturer's additional sleep settings are disabled. Test the actual stick beyond its configured timeout before unattended use.

This helper uses no new permissions, developer options, ADB, accessibility service, or artificial remote input. It guides a user through a one-time normal settings change; it cannot silently change protected device settings or guarantee that a particular model offers **Never**. Fully automatic fleet setup needs a managed-device deployment with supported administrator power policies (or hardware/firmware that supports continuous playback), separately from ordinary Play Store installation. Do not describe the helper as a complete sleep-prevention fix or physical Onn validation.

For administrator diagnostics only, an authorized ADB connection can disable Android's specific inattentiveness timer with `adb shell settings --user current put secure attentive_timeout -1`. That is not required by the normal in-app setup flow and does not address every manufacturer-specific policy.

## Physical acceptance checklist

Before unattended use, record the box model, Android firmware, and WebView version, then verify:

- USB installation, launcher visibility, and setup with only the remote.
- Pairing, assignment, image rendering, rotation, schedules, transitions, clocks, counters, and weather.
- Network loss during playback and during an incoming publication; the previous complete publication must survive a failed download.
- Closing and reopening offline, server recovery, blank/unblank, refresh, and device revocation.
- Installing a newer APK signed with the same key without losing pairing/cache.
- Downloading from the homepage on a stick without USB; automatic/manual update detection from default GitHub and explicit **This server** sources; GitHub updates with an older content server; installer permission grant and return; install/cancel flows; rejecting another signing key or interrupted download; reopening after a successful update.
- Back/Menu behavior, resuming after Home, screen sleep behavior, power-cycle startup procedure, storage pressure, and a 24-hour playback run.
- **Prevent device sleep** from setup and playback, readable/unreadable timer status, opening normal settings and returning without losing pairing/cache, and continuous playback beyond the stick's previous shutdown-warning interval.

Host-side unit tests and APK validation do not establish physical TV compatibility or long-run performance. See the [validation record](validation.md).
