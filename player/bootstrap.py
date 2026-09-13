#!/usr/bin/env python3
"""First-boot Wi-Fi portal and approved managed-WireGuard enrollment. Root only."""
import http.server
import ipaddress
import json
import os
from pathlib import Path
import queue
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from agent import SameOriginRedirects, connection_settings, atomic_json
import wireguard
from managed_network import guard, GUARD

STATE = Path('/var/lib/openframe-setup')
CONFIG = Path('/etc/openframe/config.json')
CACHE = Path('/var/lib/openframe')
PORTAL_IP = '192.168.50.1'
PROFILE = 'openframe-setup'
WEB = Path(__file__).parent / 'setup-web'


class SetupHTTPServer(http.server.HTTPServer):
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(5)
        return connection, address

    def handle_error(self, request, address):
        pass


def command(*args, input=None, timeout=60):
    return subprocess.run(args, input=input, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()


def validate_input(value):
    if not isinstance(value, dict) or set(value) - {'name', 'ssid', 'password', 'country', 'server', 'clientId', 'clientSecret'}:
        raise ValueError('Invalid setup fields')
    for field in ('name', 'ssid', 'password', 'country', 'server'):
        if not isinstance(value.get(field), str) or any(ord(c) < 32 for c in value[field]):
            raise ValueError('Invalid setup fields')
    if not 1 <= len(value['name'].strip()) <= 100 or not 1 <= len(value['ssid'].encode()) <= 32 or len(value['password']) > 64 or not re.fullmatch('[A-Z]{2}', value['country']):
        raise ValueError('Check screen name, Wi-Fi details, and country code')
    config = {'name': value['name'].strip(), 'server': value['server'].strip()}
    if value.get('clientId') or value.get('clientSecret'):
        config['cloudflare_access'] = {'client_id': value.get('clientId'), 'client_secret': value.get('clientSecret')}
    server, _ = connection_settings(config)
    if not server.startswith('https://'):
        raise ValueError('Use the public HTTPS server address for enrollment')
    return {**value, 'name': config['name'], 'server': server, 'config': config}


def request(config, endpoint, body, token=None):
    server, access = connection_settings(config)
    headers = {'Content-Type': 'application/json', **access}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(server + endpoint, data=json.dumps(body).encode(), headers=headers)
    with urllib.request.build_opener(SameOriginRedirects()).open(req, timeout=15) as response:
        raw = response.read(65537)
    if len(raw) > 65536:
        raise ValueError('Invalid server response')
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError('Invalid server response')
    return result


def client_config(private_key, value):
    # Do not accept arbitrary wg-quick fields or routes from a network response.
    if not isinstance(value, dict) or set(value) != {'address', 'publicKey', 'endpoint', 'allowedIPs', 'server'}:
        raise ValueError('Invalid managed VPN settings')
    if any(not isinstance(v, str) or any(ord(c) < 33 or ord(c) > 126 for c in v) for v in value.values()):
        raise ValueError('Invalid managed VPN settings')
    address = ipaddress.IPv4Interface(value['address'])
    allowed = ipaddress.IPv4Network(value['allowedIPs'])
    if address.network.prefixlen != 32 or allowed.prefixlen != 32 or not address.ip.is_private or not allowed.network_address.is_private:
        raise ValueError('Managed VPN requires private /32 addresses')
    host = allowed.network_address
    network = ipaddress.IPv4Network(str(host) + '/24', strict=False)
    if host.is_loopback or host.is_link_local or int(host) % 256 != 1 or address.ip not in network or not 2 <= int(address.ip) % 256 <= 254:
        raise ValueError('Invalid managed VPN address allocation')
    if value['server'] != f'http://{host}:3100':
        raise ValueError('Private server does not match VPN route')
    if not re.fullmatch(r'(?:[a-zA-Z0-9][a-zA-Z0-9.-]*|\[[a-fA-F0-9:]+\]):[0-9]{1,5}', value['endpoint']) or not 1 <= int(value['endpoint'].rsplit(':', 1)[1]) <= 65535:
        raise ValueError('Invalid WireGuard endpoint')
    text = f"[Interface]\nPrivateKey = {private_key}\nAddress = {address}\n[Peer]\nPublicKey = {value['publicKey']}\nAllowedIPs = {host}/32\nEndpoint = {value['endpoint']}\nPersistentKeepalive = 25\n"
    return wireguard.validate(text), str(host)


def install_private_connection(settings, private_key, identity, name):
    text, host = client_config(private_key, settings)
    guard(host)
    wireguard.install(text)
    command('nmcli', 'general', 'reload', 'conf')
    command('systemctl', 'daemon-reload')
    command('systemctl', 'enable', '--now', wireguard.SERVICE)
    route = json.loads(command('ip', '-j', 'route', 'get', host))
    if not route or route[0].get('dev') != wireguard.INTERFACE:
        raise ValueError('Private server is not routed through WireGuard')
    # Authenticate through the new route before committing the server-origin change.
    result = request({'server': settings['server']}, '/api/player/provision', {}, identity['token'])
    if result.get('approved') is not True or result.get('wireguard') != settings:
        raise ValueError('Private server verification failed')
    atomic_json(GUARD, {'address': host})
    unit = Path('/etc/systemd/system/openframe-managed-network.service')
    wireguard.atomic_write(unit, '''[Unit]
Description=OpenFrame managed VPN route guard
Before=openframe-agent.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/openframe/managed_network.py
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
''', 0o644)
    wireguard.atomic_write(Path('/etc/systemd/system/openframe-agent.service.d/managed-network.conf'), '''[Unit]
Requires=openframe-managed-network.service
After=openframe-managed-network.service
''', 0o644)
    # Pairing survives the change from the public bootstrap origin to the private one.
    import pwd
    user = pwd.getpwnam('openframe')
    atomic_json(CACHE / 'identity.json', {**identity, 'server': settings['server']})
    os.chmod(CACHE / 'identity.json', 0o600)
    os.chown(CACHE / 'identity.json', user.pw_uid, user.pw_gid)
    atomic_json(CONFIG, {'name': name, 'server': settings['server']})
    os.chown(CONFIG, 0, user.pw_gid)
    os.chmod(CONFIG, 0o640)
    command('systemctl', 'daemon-reload')
    command('systemctl', 'enable', '--now', 'openframe-managed-network.service')
    command('systemctl', 'restart', 'openframe-agent.service')
    (CACHE / 'provisioned').touch(mode=0o600)


class Setup:
    def __init__(self):
        self.pending = queue.Queue(maxsize=1)
        self.csrf = secrets.token_urlsafe(24)
        self.password = secrets.token_urlsafe(12)
        self.ssid = 'OpenFrame-Setup-' + secrets.token_hex(2).upper()
        self.status = {'phase': 'Wi-Fi setup', 'ssid': self.ssid, 'password': self.password, 'url': f'http://{PORTAL_IP}', 'code': None, 'error': None}
        self.busy = False
        self.lock = threading.Lock()

    def handler(self, local=False):
        setup = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, code, value, content_type='application/json'):
                raw = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(code)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(raw)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('X-Frame-Options', 'DENY')
                self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(raw)

            def trusted(self):
                hosts = ('127.0.0.1:8081', 'localhost:8081') if local else (PORTAL_IP, PORTAL_IP + ':80')
                return self.headers.get('Host') in hosts

            def do_GET(self):
                if not self.trusted():
                    return self.reply(403, {})
                if self.path == '/setup/state':
                    return self.reply(200, setup.status if local else {'csrf': setup.csrf, 'busy': setup.busy, 'error': setup.status['error']})
                files = {'/': 'screen.html' if local else 'index.html', '/setup.css': 'setup.css', '/setup.js': 'setup.js', '/screen.js': 'screen.js'}
                if self.path == '/hotspot.png' and local:
                    return self.reply(200, (STATE / 'hotspot.png').read_bytes(), 'image/png')
                file = files.get(self.path)
                if not file:
                    return self.reply(404, {})
                kind = 'text/html' if file.endswith('.html') else 'text/css' if file.endswith('.css') else 'text/javascript'
                self.reply(200, (WEB / file).read_bytes(), kind + '; charset=utf-8')

            def do_POST(self):
                if local or not self.trusted() or self.path != '/setup' or self.headers.get('Origin') != f'http://{PORTAL_IP}' or self.headers.get('X-Setup-Token') != setup.csrf:
                    return self.reply(403, {})
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 8192:
                        return self.reply(413, {})
                    self.connection.settimeout(5)
                    value = validate_input(json.loads(self.rfile.read(size)))
                    with setup.lock:
                        if setup.busy:
                            return self.reply(409, {'error': 'Setup already in progress'})
                        setup.pending.put_nowait(value)
                        setup.busy = True
                    self.reply(202, {'ok': True})
                except (ValueError, TypeError, OSError):
                    self.reply(400, {'error': 'Check the setup fields and use a valid HTTPS server address'})
        return Handler

    def hotspot(self):
        country = os.environ.get('OPENFRAME_SETUP_COUNTRY', '')
        if not re.fullmatch('[A-Z]{2}', country):
            raise ValueError('Setup hotspot requires its deployment country')
        command('raspi-config', 'nonint', 'do_wifi_country', country)
        command('nmcli', 'radio', 'wifi', 'on')
        existing = subprocess.run(['nmcli', 'connection', 'show', PROFILE], capture_output=True, timeout=10)
        if existing.returncode == 0:
            command('nmcli', 'connection', 'delete', PROFILE)
        command('nmcli', 'device', 'wifi', 'hotspot', 'ifname', 'wlan0', 'con-name', PROFILE, 'ssid', self.ssid, 'password', self.password)
        command('nmcli', 'connection', 'modify', PROFILE, 'connection.autoconnect', 'no', '802-11-wireless.band', 'bg', '802-11-wireless-security.key-mgmt', 'wpa-psk', '802-11-wireless-security.proto', 'rsn', 'ipv4.addresses', PORTAL_IP + '/24', 'ipv4.method', 'shared', 'ipv6.method', 'disabled')
        command('nmcli', 'connection', 'up', PROFILE)

    def connect_wifi(self, value):
        # On a resumed boot the setup hotspot may already be down.
        subprocess.run(['nmcli', 'connection', 'down', PROFILE], capture_output=True, timeout=10)
        command('raspi-config', 'nonint', 'do_wifi_country', value['country'])
        args = ['nmcli', '--wait', '45', 'device', 'wifi', 'connect', value['ssid'], 'ifname', 'wlan0', 'name', 'openframe-uplink']
        if value['password']:
            args.extend(['password', value['password']])
        command(*args)

    def enroll(self, value):
        key_path = STATE / 'private.key'
        if not key_path.exists():
            wireguard.atomic_write(key_path, command('wg', 'genkey') + '\n')
        private_key = key_path.read_text().strip()
        public_key = command('wg', 'pubkey', input=private_key + '\n')
        identity_path = STATE / 'enrollment.json'
        identity = json.loads(identity_path.read_text()) if identity_path.exists() else {}
        if identity.get('server') != value['server']:
            identity = {'server': value['server'], 'token': secrets.token_hex(32)}
            atomic_json(identity_path, identity)
        result = request(value['config'], '/api/player/enroll', {'name': value['name'], 'wireguardPublicKey': public_key, 'enrollmentToken': identity['token']})
        if result.get('token') != identity['token'] or not re.fullmatch('[A-F0-9]{8}', result.get('code', '')) or not isinstance(result.get('id'), str):
            raise ValueError('Invalid enrollment response')
        identity.update(result)
        atomic_json(identity_path, identity)
        self.status.update(phase='Awaiting approval', code=result['code'], error=None)
        while True:
            result = request(value['config'], '/api/player/provision', {}, identity['token'])
            if result.get('approved') is True:
                self.status.update(phase='Connecting WireGuard', code=None)
                install_private_connection(result.get('wireguard'), private_key, identity, value['name'])
                self.status.update(phase='Ready', error=None)
                return
            time.sleep(5)

    def run(self):
        # Credentials appear only on the local display, not in logs or remote status.
        command('qrencode', '-o', str(STATE / 'hotspot.png'), f'WIFI:T:WPA;S:{self.ssid};P:{self.password};;')
        local = SetupHTTPServer(('127.0.0.1', 8081), self.handler(local=True))
        threading.Thread(target=local.serve_forever, daemon=True).start()
        saved = STATE / 'pending.json'
        resume = json.loads(saved.read_text()) if saved.exists() else None
        try:
            while not (CACHE / 'provisioned').exists():
                if resume:
                    value = resume
                    resume = None
                    try:
                        self.connect_wifi(value)
                    except Exception:
                        self.status['error'] = 'Wi-Fi connection failed. Check the network details.'
                        continue
                else:
                    self.hotspot()
                    self.status['phase'] = 'Wi-Fi setup'
                    self.busy = False
                    portal = SetupHTTPServer((PORTAL_IP, 80), self.handler())
                    threading.Thread(target=portal.serve_forever, daemon=True).start()
                    value = self.pending.get()
                    time.sleep(1)
                    portal.shutdown()
                    portal.server_close()
                    atomic_json(saved, value)
                    try:
                        self.status.update(phase='Joining Wi-Fi', error=None)
                        self.connect_wifi(value)
                    except Exception:
                        self.status['error'] = 'Wi-Fi connection failed. Check the network details.'
                        continue
                try:
                    self.status.update(phase='Contacting server', error=None)
                    self.enroll(value)
                except Exception:
                    self.status['error'] = 'Setup could not complete. Check HTTPS reachability, Access policy, approval, and VPN endpoint.'
                    time.sleep(3)
            for file in ('pending.json', 'enrollment.json', 'private.key'):
                (STATE / file).unlink(missing_ok=True)
            command('systemctl', 'disable', 'openframe-setup.service')
            command('systemctl', 'reboot')
        finally:
            local.shutdown()
            local.server_close()


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Run provisioning as root on a dedicated Pi')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        Setup().run()
    except Exception:
        raise SystemExit('OpenFrame first-boot setup failed; check NetworkManager, Wi-Fi hardware, and installed dependencies') from None
