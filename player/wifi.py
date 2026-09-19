"""Local, bounded editing of persistent personal/open wlan0 keyfiles."""
import configparser
import hashlib
import hmac
import io
import json
from pathlib import Path
import re
import secrets
import subprocess
import uuid

from wireguard import atomic_write

DIRECTORY = Path('/etc/NetworkManager/system-connections')
SETTINGS = Path('/etc/openframe/wifi.json')
LIMIT = 20
REVISION_KEY = secrets.token_bytes(32)


class Conflict(ValueError):
    pass


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=15).stdout.strip()


def parser(text):
    value = configparser.ConfigParser(interpolation=None, delimiters=('=',), comment_prefixes=('#',), strict=True)
    value.optionxform = str
    value.read_string(text)
    return value


def unescape(value):
    return re.sub(r'\\([\\snrt;])', lambda match: {'\\': '\\', 's': ' ', 'n': '\n', 'r': '\r', 't': '\t', ';': ';'}[match[1]], value)


def escape(value):
    return value.replace('\\', '\\\\').replace(' ', '\\s')


def ssid_text(value):
    if re.fullmatch(r'(?:[0-9]{1,3};)+', value):
        return bytes(int(part) for part in value.split(';')[:-1]).decode('utf-8')
    return unescape(value)


def valid_ssid(value):
    return isinstance(value, str) and 1 <= len(value.encode('utf-8')) <= 32 and all(ord(c) >= 32 and ord(c) != 127 for c in value)


def inventory():
    records = {}
    paths = sorted(DIRECTORY.glob('*'))
    if len(paths) > 128:
        raise ValueError('Too many system connection files')
    for path in paths:
        if path.is_symlink() or not path.is_file() or path.name.startswith('.'):
            continue
        if path.stat().st_size > 65536:
            continue
        text = path.read_text(encoding='utf-8')
        try:
            value = parser(text)
            connection = value['connection']
            wireless = 'wifi' if 'wifi' in value else '802-11-wireless'
            security = 'wifi-security' if 'wifi-security' in value else '802-11-wireless-security'
            if connection.get('type') not in ('wifi', '802-11-wireless') or wireless not in value:
                continue
            if connection.get('interface-name', '') not in ('', 'wlan0') or value[wireless].get('mode', 'infrastructure') != 'infrastructure':
                continue
            if connection.get('id') in ('openframe-setup', 'openframe-recovery'):
                continue
            kind = value.get(security, 'key-mgmt', fallback='open')
            if kind not in ('open', 'wpa-psk', 'sae') or '802-1x' in value:
                continue
            identifier = str(uuid.UUID(connection['uuid']))
            ssid = ssid_text(value[wireless]['ssid'])
            if not valid_ssid(ssid):
                continue
            public = {'id': identifier, 'ssid': ssid, 'security': kind,
                      'hidden': value[wireless].getboolean('hidden', False),
                      'hasPassword': bool(value.get(security, 'psk', fallback='')),
                      'priority': int(connection.get('autoconnect-priority', '0'))}
        except (ValueError, KeyError, configparser.Error):
            continue
        if identifier in records:
            raise ValueError('Duplicate system connection identity')
        records[identifier] = dict(path=path, text=text, value=value, wireless=wireless, security=security, public=public)
    if len(records) > LIMIT:
        raise ValueError('Too many saved Wi-Fi networks')
    return records


def settings_text():
    return SETTINGS.read_text(encoding='utf-8') if SETTINGS.exists() else ''


def revision(records, settings):
    content = json.dumps([settings, [(key, str(record['path']), record['text']) for key, record in sorted(records.items())]]).encode()
    return hmac.new(REVISION_KEY, content, hashlib.sha256).hexdigest()


def snapshot(records=None):
    records = inventory() if records is None else records
    settings = settings_text()
    country = json.loads(settings).get('country', '') if settings else ''
    if not re.fullmatch('[A-Z]{2}', country):
        country = ''
    networks = sorted((record['public'] for record in records.values()), key=lambda item: (-item['priority'], item['ssid'], item['id']))
    return {'revision': revision(records, settings), 'country': country, 'networks': networks, 'limit': LIMIT}


def save(body):
    if not isinstance(body, dict) or set(body) != {'revision', 'country', 'networks'}:
        raise ValueError('Invalid network settings')
    if not isinstance(body['country'], str) or not re.fullmatch('[A-Z]{2}', body['country']):
        raise ValueError('Enter a two-letter country code')
    rows = body['networks']
    if not isinstance(rows, list) or not 1 <= len(rows) <= LIMIT:
        raise ValueError('Save between 1 and 20 networks')
    records = inventory()
    old_settings = settings_text()
    if body['revision'] != revision(records, old_settings):
        raise Conflict('Saved networks changed. Reload the page before editing again.')
    writes, retained, ssids = {}, set(), set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) - {'id', 'ssid', 'security', 'hidden', 'password'}:
            raise ValueError('Invalid network fields')
        identifier, ssid, kind = row.get('id'), row.get('ssid'), row.get('security')
        if not valid_ssid(ssid) or kind not in ('open', 'wpa-psk', 'sae') or type(row.get('hidden')) is not bool:
            raise ValueError('Check the network name and security')
        if ssid in ssids:
            raise ValueError('Each network name can appear only once')
        ssids.add(ssid)
        if identifier is not None and (not isinstance(identifier, str) or identifier not in records or identifier in retained):
            raise ValueError('Unknown or repeated saved network')
        record = records.get(identifier)
        if record:
            retained.add(identifier)
            value, path, wireless, security = record['value'], record['path'], record['wireless'], record['security']
        else:
            identifier = str(uuid.uuid4())
            value = parser(f'[connection]\nid=openframe-wifi-{identifier}\nuuid={identifier}\ntype=wifi\ninterface-name=wlan0\n[wifi]\nmode=infrastructure\n[ipv4]\nmethod=auto\n[ipv6]\nmethod=auto\n')
            path, wireless, security = DIRECTORY / f'openframe-wifi-{identifier}.nmconnection', 'wifi', 'wifi-security'
            if path.exists() or path.is_symlink():
                raise ValueError('Network file already exists')
        password = row.get('password')
        if password is not None and (not isinstance(password, str) or any(ord(c) < 32 or ord(c) > 126 for c in password)):
            raise ValueError('Invalid Wi-Fi password')
        if kind != 'open':
            if password is None:
                if not record or record['public']['security'] != kind or not record['public']['hasPassword']:
                    raise ValueError('Enter a password for this network')
            elif not (8 <= len(password) <= 63 or (kind == 'wpa-psk' and re.fullmatch('[a-fA-F0-9]{64}', password))):
                raise ValueError('Use an 8-63 character Wi-Fi password')
            if security not in value:
                value.add_section(security)
            value[security]['key-mgmt'] = kind
            if password is not None:
                value[security]['psk'] = escape(password)
                value[security]['psk-flags'] = '0'
        elif security in value:
            value.remove_section(security)
            value[wireless].pop('security', None)
        value[wireless]['ssid'] = ''.join(f'{byte};' for byte in ssid.encode('utf-8'))
        value[wireless]['hidden'] = str(row['hidden']).lower()
        value['connection']['autoconnect'] = 'true'
        value['connection']['autoconnect-priority'] = str(999 - index)
        value['connection']['autoconnect-retries'] = '1'
        stream = io.StringIO()
        value.write(stream, space_around_delimiters=False)
        writes[path] = stream.getvalue()
    # Stage/validate the entire request before touching files. Preserve other profile settings.
    originals = {record['path']: record['text'] for record in records.values()}
    removed = [key for key in records if key not in retained]
    try:
        for path, text in writes.items():
            atomic_write(path, text, 0o600)
        for path in writes:
            command('nmcli', 'connection', 'load', str(path))
        for key in removed:
            command('nmcli', 'connection', 'delete', 'uuid', key)
            records[key]['path'].unlink(missing_ok=True)
        atomic_write(SETTINGS, json.dumps({'country': body['country']}), 0o600)
    except Exception:
        # Best-effort rollback of a failed save, including files already removed by NM.
        for path in writes.keys() - originals.keys():
            try:
                identifier = parser(writes[path])['connection']['uuid']
                command('nmcli', 'connection', 'delete', 'uuid', identifier)
            except Exception:
                pass
            path.unlink(missing_ok=True)
        for path, text in originals.items():
            atomic_write(path, text, 0o600)
        if old_settings:
            atomic_write(SETTINGS, old_settings, 0o600)
        else:
            SETTINGS.unlink(missing_ok=True)
        try:
            command('nmcli', 'connection', 'reload')
        except Exception:
            pass
        raise RuntimeError('Could not save Wi-Fi networks. Reopen the list and check the player.') from None
    return snapshot()


def apply_country():
    settings = settings_text()
    country = json.loads(settings).get('country', '') if settings else ''
    if re.fullmatch('[A-Z]{2}', country):
        command('raspi-config', 'nonint', 'do_wifi_country', country)
