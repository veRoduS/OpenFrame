# Player connection and Wi-Fi recovery

## First boot

A hotspot-prepared, unconfigured Pi shows a Wi-Fi QR code, network name, password, and three short setup steps on HDMI. The screen uses the administrator interface's OpenFrame monitor mark, green accents, typography, and a Connect / Configure / Pair screen progress strip. The QR and credentials stay together on 800x480 and full-HD displays. Scan the code, join the network, and open `http://192.168.50.1` to enter Wi-Fi and server details. After connecting, the display switches to pairing instructions. Use the [hotspot image preparation flow](quick-start.md); a stock Raspberry Pi OS image does not contain this application.

The setup hotspot is visible only during initial provisioning. Its NetworkManager profile has autoconnect disabled. A successfully configured player does not keep advertising that visible setup name.

## Connection loss and playback

The player keeps the last complete synchronized playlist and verified images when the server cannot be reached, including after an offline restart. A small, stationary Wi-Fi-off icon appears at the bottom right until contact resumes. The icon is not shown in administrator previews, on unpaired screens, or when the screen is intentionally blanked. Losing the local agent also shows the indicator without replacing an already displayed frame.

Server connection attempts target a 15-second start-to-start cadence. The control-request socket timeout is 10 seconds; requests never overlap. Slow DNS, large media transfers, OS scheduling, and networking timeouts can extend that interval. Incomplete downloads never replace the last complete playlist. A screen with no previously downloaded playlist cannot play content offline. Normal offline schedules and counters still depend on a correct system clock.

**Screens** now labels the most recent authenticated sync explicitly as **Last heartbeat**, using the administrator browser's local date/time. That view refreshes every 10 seconds. It is the server's receipt time, not proof that HDMI output works. Recovery Wi-Fi status is likewise the last reported status, not a live measurement while the device is unreachable.

## Single-radio hidden recovery network

This implementation follows the single-radio choice for Zero 2 W: recovery is temporary, not an always-on simultaneous hotspot. It targets NetworkManager-managed `wlan0` on a dedicated Pi.

1. While normal Wi-Fi is connected, recovery remains in standby with **no recovery SSID broadcast**, hidden or visible. A VPN/server-only outage does not take over a working Wi-Fi connection.
2. After Wi-Fi remains disconnected for 60 seconds, the player opens a **hidden WPA2 recovery hotspot for 90 seconds by default**. You can extend that window from the recovery page. During ordinary disconnected periods it requests saved-network reconnection about every 15 seconds, without restarting an association already in progress.
3. The hotspot name is the player UUID with hyphens removed, producing exactly 32 ASCII characters. The password is a unique, server-generated 24-character random value. Hidden SSIDs are not a security boundary; WPA2 and the password provide access control.
4. In OpenFrame, open **Screens**, find the player, and click **Show recovery credentials** next to Recovery Wi-Fi. The full player ID is always visible for approved screens; the hidden network name and password appear only after explicit reveal. Hide them again when finished.
5. On a phone, manually add/join that hidden WPA2 network, then open **http://192.168.50.1**. Under **Automatic reconnection**, choose **1 minute**, **5 minutes**, **15 minutes**, or **Indefinite**, then select **Pause reconnects**. Joining the network or reading the page alone does not pause it. Submit the replacement Wi-Fi name, password, and deployment country when ready. Pairing, VPN configuration, and cached content remain unchanged.
6. Submission ends the pause/window and attempts the supplied Wi-Fi. **Resume reconnects** (or **Reconnect now** when not paused) ends the window immediately and tries the saved network. Otherwise the current countdown must expire before that attempt. After another disconnected grace period, a new recovery window opens. Failed attempts do not erase the previous saved network configuration.

Timed pauses start when accepted by the player and replace the previous deadline. The countdown is maintained on the Pi, not the phone: refreshing, closing the browser, or disconnecting the phone does not cancel or extend it. **Indefinite** keeps the recovery hotspot available until you resume, submit Wi-Fi, or restart the player/recovery service. Service failure, credential invalidation, and DHCP failure still end the hotspot for cleanup. New recovery windows and restarts return to the default 90 seconds. Changing pause settings preserves an open form's edits; refreshing does not intentionally store or restore Wi-Fi passwords.

The normal server-poll loop continues during a recovery window, but a single radio cannot reach its normal Wi-Fi while hosting the recovery network. Those requests fail until client mode returns; cached playback continues. Timings are approximate and include NetworkManager transitions. The phone should stay connected despite the lack of Internet. This local recovery network does not provide NAT, DNS forwarding, or general player/LAN access; its intended firewall permits DHCP and the Wi-Fi recovery page only.

Approved, updated agents retrieve their own settings after a successful sync and store them in private `recovery.json`, separately from playback state. Normal library responses, player state, logs, and the HDMI playback screen never contain that password. An older player shows no available recovery credentials until its code is updated and it contacts this server. Losing the server before the first successful settings retrieval means this recovery path is not yet available.

The administrator reveal endpoint requires an administrator session; players can retrieve only their own settings using their pairing token. Server storage uses authenticated encryption and the existing `provisioning.key`. Back up that key with the database. Missing/mismatched keys fail closed instead of generating replacement passwords. Password editing/rotation is not implemented in this revision. Revoking a device removes its server-side recovery record, and a player that receives revocation clears its local copy. An offline player cannot learn that it has been revoked until it reconnects.

## Install or upgrade

Build new images from matching server/player source. Existing Pis need the complete updated `player/` directory and an installer rerun, not just a Docker server update:

```sh
sudo bash player/install.sh /etc/openframe/config.json
sudo reboot
```

Preserve each Pi's identity, cache, and VPN configuration. The installer adds NetworkManager, iptables, dnsmasq-base, and the root `openframe-recovery.service`; it also updates the complete renderer and setup web assets. Recovery configuration and firewall changes are confined to the reserved `openframe-recovery` profile and `OF-RECOVERY` / `OF-RECOVERY-FWD` chains. Do not use those names for unrelated networking. Do not distribute configured images or `recovery.json`.

To turn off automatic recovery locally:

```sh
sudo systemctl disable --now openframe-recovery.service
```

The service normally cleans up its hotspot/DHCP/firewall when a window ends or it receives a normal stop. A forced kill or power loss needs startup cleanup on the next service start or reboot. Keep console access when testing; this is not a recovery guarantee for a broken OS, missing adapter, SD-card failure, or disabled service. Only personal/open Wi-Fi is supported; enterprise/captive-portal networks and remote VPN endpoint edits are outside this page's scope.

## Validation before unattended use

Automated tests cover approval/access controls, encrypted credential storage, outage timers, cleanup calls, form request boundaries, cache persistence, and desktop/mobile rendering. Networking is mocked: actual NetworkManager, DHCP, firewall, hidden-network association, and radio recovery on Zero 2 W/Pi 4/5 still require hardware testing.

Test first-boot QR scanning on an actual phone; loss/restoration of Wi-Fi; wrong replacement credentials; an unused recovery window; each timed pause and indefinite pause past the original 90 seconds; page reload/phone disconnect while paused; resume and Wi-Fi submission while paused; service/player restart while paused; repeated outages and offline reboot; normal server/VPN outage without hotspot takeover; hidden-network association; absence of an open setup SSID after provisioning; and continued slideshow transitions throughout each change. Verify the recovery subnet `192.168.50.0/24` does not overlap the normal network, and confirm recovery clients cannot reach SSH, cached media, the upstream LAN, or the VPN.

References: [Raspberry Pi wireless access point configuration](https://www.raspberrypi.com/documentation/configuration/wireless/wireless-access-point.md) and [NetworkManager hidden SSID behavior](https://www.networkmanager.dev/docs/api/latest/settings-802-11-wireless.html).
