"""Provision an optional WireGuard client; wg-quick owns the actual networking."""

import argparse
import base64
import binascii
import os
from pathlib import Path
import subprocess
import sys
import tempfile

DROP_IN = 'openframe-wg.conf'
INTERFACE = 'wg-openframe'
SERVICE = 'wg-quick@wg-openframe.service'
MANAGED = '# Managed by the OpenFrame player installer.\n'
CONFIG = Path('/etc/wireguard/wg-openframe.conf')
OVERRIDE = Path('/etc/systemd/system/wg-quick@wg-openframe.service.d/openframe.conf')
NETWORK_MANAGER = Path('/etc/NetworkManager/conf.d/90-openframe-wireguard.conf')
MAX_SIZE = 65536

SERVICE_SETTINGS = MANAGED + '''[Unit]
StartLimitIntervalSec=0
[Service]
Environment=WG_ENDPOINT_RESOLUTION_RETRIES=2
Restart=on-failure
RestartSec=15s
TimeoutStartSec=30s
'''
NETWORK_SETTINGS = MANAGED + '''[device-openframe-wireguard]
match-device=interface-name:wg-openframe
managed=0
'''


def validate(text):
    # This is a provisioning safety filter, not a replacement for wg-quick's parser.
    allowed = {
        'Interface': {'PrivateKey', 'Address', 'DNS', 'MTU', 'Table', 'ListenPort', 'FwMark', 'SaveConfig'},
        'Peer': {'PublicKey', 'PresharedKey', 'AllowedIPs', 'Endpoint', 'PersistentKeepalive'},
    }
    sections, lines = [], []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.split('#', 1)[0].strip()
        if not line:
            continue
        if line in ('[Interface]', '[Peer]'):
            section = line[1:-1]
            if (not sections and section != 'Interface') or (sections and section == 'Interface'):
                raise ValueError('WireGuard requires one Interface followed by Peer sections.')
            sections.append((section, set()))
            lines.append(line)
            continue
        key, separator, value = line.partition('=')
        key, value = key.strip(), value.strip()
        if key.lower() in ('preup', 'postup', 'predown', 'postdown'):
            raise ValueError('WireGuard shell hooks are not supported. Supply a client config without PreUp/PostUp/PreDown/PostDown.')
        if not sections or not separator or key not in allowed[sections[-1][0]] or not value:
            raise ValueError(f'Unsupported or incomplete WireGuard setting on line {number}.')
        if any(ord(char) < 32 or ord(char) > 126 for char in value):
            raise ValueError(f'Invalid WireGuard setting on line {number}.')
        fields = sections[-1][1]
        if key in fields and key not in ('Address', 'DNS', 'AllowedIPs'):
            raise ValueError(f'Duplicate WireGuard setting on line {number}.')
        if key == 'SaveConfig' and value != 'false':
            raise ValueError('WireGuard SaveConfig must be false or omitted; installed files must not rewrite themselves.')
        if key in ('PrivateKey', 'PublicKey', 'PresharedKey'):
            try:
                valid = len(base64.b64decode(value, validate=True)) == 32
            except (ValueError, binascii.Error):
                valid = False
            if not valid:
                raise ValueError(f'Invalid WireGuard key on line {number}; expected a 32-byte base64 key.')
        fields.add(key)
        lines.append(f'{key} = {value}')
    if len(sections) < 2 or not {'PrivateKey', 'Address'} <= sections[0][1]:
        raise ValueError('WireGuard requires Interface PrivateKey/Address and at least one Peer.')
    if any(not {'PublicKey', 'AllowedIPs'} <= fields for _, fields in sections[1:]):
        raise ValueError('Each WireGuard Peer requires PublicKey and AllowedIPs.')
    if not any('Endpoint' in fields for _, fields in sections[1:]):
        raise ValueError('A player WireGuard config requires a Peer Endpoint to reach the home VPN.')
    return '\n'.join(lines) + '\n'


def source_config(player_config):
    path = Path(player_config).absolute().parent / DROP_IN
    if path.is_symlink():
        raise ValueError('The WireGuard drop-in must be a regular file, not a symbolic link.')
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError('The WireGuard drop-in must be a regular file.')
    with path.open('rb') as stream:
        data = stream.read(MAX_SIZE + 1)
    if len(data) > MAX_SIZE:
        raise ValueError('WireGuard configuration exceeds 64 KiB.')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeError:
        raise ValueError('WireGuard configuration must be UTF-8 text.') from None
    return path, validate(text)


def atomic_write(path, text, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.openframe-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def check_owned(path):
    if path.is_symlink() or (path.exists() and not path.read_text(encoding='utf-8').startswith(MANAGED)):
        raise ValueError('An unmanaged file occupies an OpenFrame WireGuard destination; resolve it before installing.')


def install(text):
    for path in (CONFIG, OVERRIDE, NETWORK_MANAGER):
        check_owned(path)
    # Stop with the old settings still present, so wg-quick removes the old routes/DNS.
    if CONFIG.exists():
        subprocess.run(['systemctl', 'stop', SERVICE], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atomic_write(CONFIG, MANAGED + text)
    atomic_write(OVERRIDE, SERVICE_SETTINGS, 0o644)
    atomic_write(NETWORK_MANAGER, NETWORK_SETTINGS, 0o644)


def clean_boot(source):
    path, text = source
    if CONFIG.is_symlink() or not CONFIG.exists() or CONFIG.read_text(encoding='utf-8') != MANAGED + text:
        raise ValueError('Refusing to remove the boot WireGuard config before its secure copy is installed.')
    path.unlink()


def main():
    parser = argparse.ArgumentParser(description='Optional OpenFrame WireGuard drop-in provisioning')
    parser.add_argument('action', choices=('check', 'stage', 'install', 'clean-boot'))
    parser.add_argument('player_config', help='Path to openframe.json; looks beside it for openframe-wg.conf')
    parser.add_argument('--destination', help='Boot partition directory for stage')
    args = parser.parse_args()
    try:
        source = source_config(args.player_config)
        if args.action == 'check':
            print('wireguard-dns' if source and any(line.startswith('DNS = ') for line in source[1].splitlines()) else 'wireguard' if source else 'direct')
        elif source:
            if args.action == 'stage':
                if not args.destination:
                    raise ValueError('A staging destination is required.')
                atomic_write(Path(args.destination) / DROP_IN, source[1])
            else:
                if os.name != 'posix' or os.geteuid() != 0:
                    raise ValueError('WireGuard installation and boot cleanup require root on Linux.')
                if args.action == 'install':
                    install(source[1])
                else:
                    clean_boot(source)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, subprocess.SubprocessError):
        # Network tools and file errors can include config contents; do not echo them.
        print('WireGuard provisioning failed. Check file permissions and the dedicated wg-quick service.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
