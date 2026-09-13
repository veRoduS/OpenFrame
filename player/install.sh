#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config_file="${1:-/boot/firmware/openframe.json}"
prepare=false
if [[ "$config_file" == --prepare-setup ]]; then
  [[ ! -e /etc/openframe/config.json && ! -e /var/lib/openframe/identity.json && ! -e /var/lib/openframe/provisioned ]] || { echo 'Setup preparation requires an unprovisioned dedicated Pi.' >&2; exit 1; }
  prepare=true
  [[ "${OPENFRAME_SETUP_COUNTRY:-}" =~ ^[A-Z]{2}$ ]] || { echo 'Set OPENFRAME_SETUP_COUNTRY to the deployment country, for example US.' >&2; exit 1; }
  wireguard_mode=direct
else
if [[ ! -f "$config_file" ]]; then echo "Missing configuration: $config_file" >&2; exit 1; fi
python3 - "$config_file" "$source_dir" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
from agent import connection_settings
config = json.load(open(sys.argv[1]))
connection_settings(config)
PY
wireguard_mode="$(python3 "$source_dir/wireguard.py" check "$config_file")"
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3 ca-certificates xserver-xorg xinit x11-xserver-utils openbox chromium sudo fonts-dejavu-core fonts-liberation
if $prepare; then
  apt-get install -y --no-install-recommends wireguard-tools iptables network-manager dnsmasq-base qrencode
fi
if [[ "$wireguard_mode" != direct ]]; then
  apt-get install -y --no-install-recommends wireguard-tools
  if [[ "$wireguard_mode" == wireguard-dns ]] && ! command -v resolvconf >/dev/null; then
    apt-get install -y --no-install-recommends openresolv
  fi
  python3 "$source_dir/wireguard.py" install "$config_file"
  if command -v nmcli >/dev/null; then nmcli general reload conf; fi
fi
id openframe &>/dev/null || useradd --create-home --shell /bin/bash openframe
usermod -a -G video,render,input,tty openframe
install -d -m 755 /opt/openframe /etc/openframe /var/lib/openframe
if [[ "$source_dir" != /opt/openframe ]]; then
  install -m 644 "$source_dir/agent.py" /opt/openframe/agent.py
  install -m 644 "$source_dir/wireguard.py" /opt/openframe/wireguard.py
  cp -R "$source_dir/web" /opt/openframe/
  if $prepare; then
    install -m 644 "$source_dir/bootstrap.py" "$source_dir/managed_network.py" /opt/openframe/
    cp -R "$source_dir/setup-web" /opt/openframe/
  fi
fi
if ! $prepare; then
python3 - "$config_file" <<'PY'
import json, os, sys
data = json.load(open(sys.argv[1]))
os.umask(0o077)
with open('/etc/openframe/config.json', 'w') as f:
    json.dump({k: data[k] for k in ('server', 'name', 'cloudflare_access') if k in data}, f)
PY
chown root:openframe /etc/openframe/config.json
chmod 640 /etc/openframe/config.json
fi
chown -R openframe:openframe /var/lib/openframe
chmod 700 /var/lib/openframe
cat > /etc/systemd/system/openframe-agent.service <<'SERVICE'
[Unit]
Description=OpenFrame content and device agent
After=network.target
ConditionPathExists=/etc/openframe/config.json
[Service]
User=openframe
Group=openframe
ExecStart=/usr/bin/python3 /opt/openframe/agent.py --allow-reboot
Restart=always
RestartSec=5
UMask=0077
[Install]
WantedBy=multi-user.target
SERVICE
cat > /etc/sudoers.d/openframe-reboot <<'SUDO'
openframe ALL=(root) NOPASSWD: /usr/sbin/reboot
SUDO
chmod 440 /etc/sudoers.d/openframe-reboot
visudo -cf /etc/sudoers.d/openframe-reboot
cat > /home/openframe/.bash_profile <<'PROFILE'
if [ -z "$DISPLAY" ] && [ "$(tty)" = /dev/tty1 ]; then
  exec startx -- -nocursor
fi
PROFILE
cat > /home/openframe/.xinitrc <<'XINIT'
#!/bin/sh
xset s off
xset -dpms
xset s noblank
openbox &
target="$(python3 - <<'PY'
import time, urllib.request
while True:
    for port, endpoint in ((8080, '/local/state'), (8081, '/setup/state')):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}{endpoint}', timeout=3).close()
            print(f'http://127.0.0.1:{port}')
            raise SystemExit(0)
        except OSError:
            pass
    time.sleep(2)
PY
)"
exec chromium --kiosk --no-first-run --noerrdialogs --disable-session-crashed-bubble --disable-infobars --disable-extensions --disable-background-networking --autoplay-policy=no-user-gesture-required --password-store=basic --disk-cache-size=33554432 "$target"
XINIT
chmod +x /home/openframe/.xinitrc
chown openframe:openframe /home/openframe/.bash_profile /home/openframe/.xinitrc
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/openframe.conf <<'GETTY'
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin openframe --noclear %I $TERM
Restart=always
RestartSec=3
GETTY
systemctl set-default multi-user.target
systemctl enable openframe-agent.service getty@tty1.service
if $prepare; then
  cat > /etc/systemd/system/openframe-setup.service <<SERVICE
[Unit]
Description=OpenFrame first-boot Wi-Fi and VPN enrollment
After=NetworkManager.service
Wants=NetworkManager.service
ConditionPathExists=!/var/lib/openframe/provisioned
[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/openframe/bootstrap.py
Environment=OPENFRAME_SETUP_COUNTRY=$OPENFRAME_SETUP_COUNTRY
Restart=on-failure
RestartSec=15
UMask=0077
[Install]
WantedBy=multi-user.target
SERVICE
  systemctl enable NetworkManager.service openframe-setup.service
fi
if [[ "${OPENFRAME_IMAGE_BUILD:-0}" != 1 ]]; then
  systemctl daemon-reload
  if ! $prepare; then systemctl restart openframe-agent.service; fi
fi
if [[ "$wireguard_mode" != direct ]]; then
  systemctl enable wg-quick@wg-openframe.service
  # Do not wait for Internet, DNS, or a handshake before starting cached playback.
  systemctl --no-block restart wg-quick@wg-openframe.service
fi
echo 'OpenFrame installed. Reboot to start the display.'
