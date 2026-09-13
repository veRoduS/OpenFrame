#!/usr/bin/env bash
# Customize an official Raspberry Pi OS Lite .img without modifying the source.
set -euo pipefail
if [[ $EUID -ne 0 || $# -ne 3 ]]; then
  echo 'Usage: sudo bash player/build-image.sh raspberry-pi-os-lite.img openframe.json|--hotspot output.img' >&2
  exit 1
fi
for tool in losetup parted partprobe e2fsck resize2fs mount umount mountpoint truncate python3; do command -v "$tool" >/dev/null; done
base_image="$(realpath "$1")"
hotspot=false
config_file=''
if [[ "$2" == --hotspot ]]; then
  hotspot=true
  [[ "${OPENFRAME_SETUP_COUNTRY:-}" =~ ^[A-Z]{2}$ ]] || { echo 'Set OPENFRAME_SETUP_COUNTRY to the deployment country, for example US.' >&2; exit 1; }
else config_file="$(realpath "$2")"; fi
output_image="$(realpath -m "$3")"
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$base_image" && ! -e "$output_image" ]] && { $hotspot || [[ -f "$config_file" ]]; } || { echo 'Base/config must exist and output must not exist.' >&2; exit 1; }
[[ "$base_image" != "$output_image" ]] || exit 1
if ! $hotspot; then
python3 - "$config_file" "$source_dir" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
from agent import connection_settings
config = json.load(open(sys.argv[1]))
connection_settings(config)
PY
python3 "$source_dir/wireguard.py" check "$config_file" >/dev/null
fi
cp --reflink=auto -- "$base_image" "$output_image"
truncate -s +2G "$output_image"
loop_device="$(losetup --find --show --partscan "$output_image")"
mount_dir="$(mktemp -d)"
resolv_changed=false
policy_changed=false
cleanup() {
  if $hotspot; then
    if $resolv_changed; then
      rm -f -- "$mount_dir/etc/resolv.conf"
      if [[ -e "$mount_dir/etc/resolv.conf.openframe-original" || -L "$mount_dir/etc/resolv.conf.openframe-original" ]]; then
        mv -- "$mount_dir/etc/resolv.conf.openframe-original" "$mount_dir/etc/resolv.conf"
      fi
    fi
    if $policy_changed && [[ -e "$mount_dir/usr/sbin/policy-rc.d.openframe-original" || -L "$mount_dir/usr/sbin/policy-rc.d.openframe-original" ]]; then
      mv -f -- "$mount_dir/usr/sbin/policy-rc.d.openframe-original" "$mount_dir/usr/sbin/policy-rc.d"
    elif $policy_changed && [[ -f "$mount_dir/usr/sbin/policy-rc.d.openframe-created" ]]; then
      rm -f -- "$mount_dir/usr/sbin/policy-rc.d" "$mount_dir/usr/sbin/policy-rc.d.openframe-created"
    fi
    mountpoint -q "$mount_dir/proc" && umount "$mount_dir/proc" || true
    mountpoint -q "$mount_dir/dev" && umount "$mount_dir/dev" || true
  fi
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
if $hotspot; then
  for directory in etc usr usr/sbin opt dev proc; do [[ ! -L "$mount_dir/$directory" ]] || { echo 'Unsupported image layout.' >&2; exit 1; }; done
  [[ ! -e "$mount_dir/etc/resolv.conf.openframe-original" && ! -L "$mount_dir/etc/resolv.conf.openframe-original" && ! -e "$mount_dir/usr/sbin/policy-rc.d.openframe-original" && ! -L "$mount_dir/usr/sbin/policy-rc.d.openframe-original" ]] || { echo 'Image contains an unfinished setup build.' >&2; exit 1; }
  chroot "$mount_dir" /bin/true || { echo 'Use a native ARM Linux builder, or configure ARM binfmt/QEMU first.' >&2; exit 1; }
  mkdir -p "$mount_dir/opt/openframe" "$mount_dir/dev" "$mount_dir/proc"
  cp "$source_dir/agent.py" "$source_dir/wireguard.py" "$source_dir/bootstrap.py" "$source_dir/managed_network.py" "$source_dir/install.sh" "$mount_dir/opt/openframe/"
  cp -R "$source_dir/web" "$source_dir/setup-web" "$mount_dir/opt/openframe/"
  if [[ -e "$mount_dir/etc/resolv.conf" || -L "$mount_dir/etc/resolv.conf" ]]; then mv -- "$mount_dir/etc/resolv.conf" "$mount_dir/etc/resolv.conf.openframe-original"; fi
  resolv_changed=true
  cp -- /etc/resolv.conf "$mount_dir/etc/resolv.conf"
  if [[ -e "$mount_dir/usr/sbin/policy-rc.d" || -L "$mount_dir/usr/sbin/policy-rc.d" ]]; then
    mv -- "$mount_dir/usr/sbin/policy-rc.d" "$mount_dir/usr/sbin/policy-rc.d.openframe-original"
  else
    touch "$mount_dir/usr/sbin/policy-rc.d.openframe-created"
  fi
  policy_changed=true
  printf '#!/bin/sh\nexit 101\n' > "$mount_dir/usr/sbin/policy-rc.d"
  chmod 755 "$mount_dir/usr/sbin/policy-rc.d"
  mount --bind /dev "$mount_dir/dev"
  mount -t proc proc "$mount_dir/proc"
  chroot "$mount_dir" /usr/bin/env OPENFRAME_IMAGE_BUILD=1 OPENFRAME_SETUP_COUNTRY="$OPENFRAME_SETUP_COUNTRY" /bin/bash /opt/openframe/install.sh --prepare-setup
  # Do not bake a shared machine identity into a reusable image.
  rm -f -- "$mount_dir/etc/machine-id"
  touch "$mount_dir/etc/machine-id"
  if [[ -d "$mount_dir/var/lib/dbus" && ! -L "$mount_dir/var" && ! -L "$mount_dir/var/lib" && ! -L "$mount_dir/var/lib/dbus" ]]; then
    rm -f -- "$mount_dir/var/lib/dbus/machine-id"
    ln -s /etc/machine-id "$mount_dir/var/lib/dbus/machine-id"
  fi
  sync
  echo 'Experimental hotspot image prepared. Flash it, then enter Wi-Fi and the public HTTPS OpenFrame URL.'
  echo 'Do not distribute an image that has been booted/enrolled or contains personal Imager settings.'
  exit 0
fi
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
