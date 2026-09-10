#!/usr/bin/env bash
# Customize an official Raspberry Pi OS Lite .img without modifying the source.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 3 ]]; then
  echo 'Usage: sudo bash player/build-image.sh raspberry-pi-os-lite.img openframe.json output.img' >&2
  exit 1
fi
for tool in losetup parted partprobe e2fsck resize2fs mount umount mountpoint truncate python3; do command -v "$tool" >/dev/null; done
base_image="$(realpath "$1")"
config_file="$(realpath "$2")"
output_image="$(realpath -m "$3")"
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$base_image" && -f "$config_file" && ! -e "$output_image" ]] || { echo 'Base/config must exist and output must not exist.' >&2; exit 1; }
[[ "$base_image" != "$output_image" ]] || exit 1
python3 - "$config_file" "$source_dir" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
from agent import connection_settings
config = json.load(open(sys.argv[1]))
connection_settings(config)
PY
python3 "$source_dir/wireguard.py" check "$config_file" >/dev/null
cp --reflink=auto -- "$base_image" "$output_image"
truncate -s +2G "$output_image"
loop_device="$(losetup --find --show --partscan "$output_image")"
mount_dir="$(mktemp -d)"
cleanup() {
  mountpoint -q "$mount_dir/boot/firmware" && umount "$mount_dir/boot/firmware" || true
  mountpoint -q "$mount_dir" && umount "$mount_dir" || true
  losetup -d "$loop_device"
  rmdir "$mount_dir"
}
trap cleanup EXIT
[[ -b "${loop_device}p1" && -b "${loop_device}p2" && ! -b "${loop_device}p3" ]] || { echo 'Expected the standard two-partition Raspberry Pi OS Lite image.' >&2; exit 1; }
parted -s "$loop_device" resizepart 2 100%
partprobe "$loop_device"
e2fsck -f -p "${loop_device}p2" || [[ $? -eq 1 ]]
resize2fs "${loop_device}p2"
mount "${loop_device}p2" "$mount_dir"
mkdir -p "$mount_dir/boot/firmware"
mount "${loop_device}p1" "$mount_dir/boot/firmware"
[[ -f "$mount_dir/etc/os-release" && -d "$mount_dir/etc/systemd/system" ]] || { echo 'Not a supported OS image.' >&2; exit 1; }
mkdir -p "$mount_dir/opt/openframe" "$mount_dir/etc/systemd/system/multi-user.target.wants"
cp "$source_dir/agent.py" "$source_dir/wireguard.py" "$source_dir/install.sh" "$source_dir/firstboot.sh" "$mount_dir/opt/openframe/"
cp -R "$source_dir/web" "$mount_dir/opt/openframe/"
cp "$config_file" "$mount_dir/boot/firmware/openframe.json"
python3 "$source_dir/wireguard.py" stage "$config_file" --destination "$mount_dir/boot/firmware"
cat > "$mount_dir/etc/systemd/system/openframe-firstboot.service" <<'SERVICE'
[Unit]
Description=Provision OpenFrame player
After=NetworkManager.service
Wants=NetworkManager.service
ConditionPathExists=!/var/lib/openframe/provisioned
[Service]
Type=oneshot
ExecStart=/bin/bash /opt/openframe/firstboot.sh
Restart=on-failure
RestartSec=45
TimeoutStartSec=0
[Install]
WantedBy=multi-user.target
SERVICE
ln -s ../openframe-firstboot.service "$mount_dir/etc/systemd/system/multi-user.target.wants/openframe-firstboot.service"
sync
echo "Flashable image created: $output_image"
echo 'First boot needs Internet access to install OS packages. Then approve the displayed pairing code.'
echo 'Images containing Wi-Fi, Access, or WireGuard credentials are private; do not distribute them.'
