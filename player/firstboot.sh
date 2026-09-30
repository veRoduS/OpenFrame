#!/usr/bin/env bash
set -euo pipefail
config=/boot/firmware/openframe.json
[[ -f "$config" ]] || { echo 'Add openframe.json to the boot partition.' >&2; exit 1; }
# Optional Wi-Fi settings allow provisioning without interactive network setup.
python3 - "$config" <<'PY'
import json, subprocess, sys
with open(sys.argv[1], encoding='utf-8') as stream:
    config = json.load(stream)
if config.get('wifi_ssid'):
    try:
        if config.get('wifi_country'):
            subprocess.run(['raspi-config', 'nonint', 'do_wifi_country', config['wifi_country']], check=True, capture_output=True)
        subprocess.run(['nmcli', 'radio', 'wifi', 'on'], check=True, capture_output=True)
        subprocess.run(['nmcli', '--wait', '60', 'device', 'wifi', 'connect', config['wifi_ssid'], 'password', config.get('wifi_password', '')], check=True, capture_output=True)
    except (subprocess.CalledProcessError, OSError):
        # Command arguments and nmcli diagnostics can contain the Wi-Fi password.
        print('Wi-Fi connection failed. Check the configured network and try again.', file=sys.stderr)
        raise SystemExit(1) from None
PY
bash /opt/openframe/install.sh "$config"
python3 /opt/openframe/wireguard.py clean-boot "$config"
python3 - "$config" <<'PY'
import json, sys
path = sys.argv[1]
config = json.load(open(path))
for field in ('wifi_ssid', 'wifi_password', 'wifi_country', 'cloudflare_access'):
    config.pop(field, None)
with open(path, 'w') as f:
    json.dump(config, f, indent=2)
PY
systemctl disable openframe-firstboot.service
touch /var/lib/openframe/provisioned
systemctl reboot
