#!/usr/bin/env python3
"""Time-boxed single-radio recovery. Never starts while normal Wi-Fi is connected."""
import http.server
import json
import math
import os
from pathlib import Path
import queue
import re
import secrets
import signal
import subprocess
import threading
import time
import uuid

from agent import atomic_json, read_json
from bootstrap import SetupHTTPServer, command
from wireguard import atomic_write

CACHE = Path('/var/lib/openframe')
CONFIG = Path('/etc/openframe/config.json')
STATUS = Path('/run/openframe-recovery/status.json')
PROFILE = 'openframe-recovery'
KEYFILE = Path('/etc/NetworkManager/system-connections/openframe-recovery.nmconnection')
IP = '192.168.50.1'
WEB = Path(__file__).parent / 'setup-web'
WAIT_SECONDS = 60
WINDOW_SECONDS = 90


def credentials():
    value = read_json(CACHE / 'recovery.json', {})
    identity = read_json(CACHE / 'identity.json', {})
    state = read_json(CACHE / 'state.json', {})
    config = read_json(CONFIG, {})
    player_id = value.get('playerId', '')
    if not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', player_id):
        return None
    if not state.get('approved') or value.get('server') != config.get('server') or state.get('server') != config.get('server') or identity.get('id') != player_id or identity.get('server') != config.get('server'):
        return None
    if value.get('ssid') != player_id.replace('-', '') or not re.fullmatch(r'[A-Za-z0-9_-]{24}', value.get('password', '')) or value.get('hidden') is not True:
        return None
    return value


def wifi_state():
    # Unknown/failed inspection must not seize a possibly working radio.
    state = command('nmcli', '-g', 'GENERAL.STATE', 'device', 'show', 'wlan0', timeout=10)
    match = re.match(r'^(\d+)', state)
    if not match:
        raise ValueError('Wi-Fi state unavailable')
    return int(match[1])


def validate_wifi(value):
    if not isinstance(value, dict) or set(value) != {'ssid', 'password', 'country'}:
        raise ValueError('Invalid Wi-Fi fields')
    if any(not isinstance(v, str) or any(ord(c) < 32 for c in v) for v in value.values()):
        raise ValueError('Invalid Wi-Fi fields')
    if not 1 <= len(value['ssid'].encode()) <= 32 or len(value['password']) > 64 or not re.fullmatch('[A-Z]{2}', value['country']):
        raise ValueError('Invalid Wi-Fi fields')
    return value


class Portal:
    def __init__(self):
        self.token = secrets.token_urlsafe(24)
        self.pending = queue.Queue(maxsize=1)
        self.submitted = False
        self.lock = threading.Lock()
        self.deadline = time.monotonic() + WINDOW_SECONDS
        self.paused = False
        self.pause_seconds = None
        self.closed = False

    def start(self):
        with self.lock:
            self.deadline = time.monotonic() + WINDOW_SECONDS

    def _open(self):
        # Serialize expiry with requests so an accepted pause cannot lose a race.
        if not self.submitted and self.deadline is not None and time.monotonic() >= self.deadline:
            self.closed = True
        return not self.closed

    def is_open(self):
        with self.lock:
            return self._open()

    def close(self):
        with self.lock:
            self.closed = True

    def state(self):
        with self.lock:
            opened = self._open()
            remaining = None if self.deadline is None else math.ceil(max(0, self.deadline - time.monotonic()))
            return {'csrf': self.token, 'paused': self.paused, 'pauseSeconds': self.pause_seconds, 'remainingSeconds': remaining, 'closing': not opened or self.submitted}

    def pause(self, value):
        if not isinstance(value, dict) or set(value) != {'duration'}:
            raise ValueError('Invalid pause')
        duration = value['duration']
        if duration is not None and (type(duration) is not int or duration not in (60, 300, 900)):
            raise ValueError('Invalid pause')
        with self.lock:
            if not self._open() or self.submitted:
                return False
            self.deadline = None if duration is None else time.monotonic() + duration
            self.paused = True
            self.pause_seconds = duration
            return True

    def submit(self, value):
        with self.lock:
            if not self._open() or self.submitted:
                return False
            self.pending.put_nowait(value)
            self.submitted = True
            return True

    def handler(self):
        portal = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, value, kind='application/json'):
                raw = value if isinstance(value, bytes) else json.dumps(value).encode()
                self.send_response(status)
                for key, val in {'Content-Type': kind, 'Content-Length': str(len(raw)), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'"}.items():
                    self.send_header(key, val)
                self.end_headers()
                self.wfile.write(raw)

            def trusted(self):
                return self.headers.get('Host') in (IP, IP + ':80')

            def do_GET(self):
                if not self.trusted():
                    return self.reply(403, {})
                if self.path == '/setup/state':
                    return self.reply(200, portal.state())
                files = {'/': ('recovery.html', 'text/html'), '/setup.css': ('setup.css', 'text/css'), '/recovery.js': ('recovery.js', 'text/javascript')}
                if self.path not in files:
                    return self.reply(404, {})
                file, kind = files[self.path]
                self.reply(200, (WEB / file).read_bytes(), kind)

            def do_POST(self):
                if not self.trusted() or self.path not in ('/setup', '/setup/pause', '/setup/resume') or self.headers.get('Origin') != 'http://' + IP or self.headers.get('X-Setup-Token') != portal.token:
                    return self.reply(403, {})
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 0 < size <= 2048:
                        return self.reply(413, {})
                    value = json.loads(self.rfile.read(size))
                    if self.path == '/setup/pause':
                        if not portal.pause(value):
                            return self.reply(409, {})
                        return self.reply(200, portal.state())
                    if self.path == '/setup/resume':
                        if value != {}:
                            raise ValueError('Invalid resume')
                        value = None
                    else:
                        value = validate_wifi(value)
                    if not portal.submit(value):
                        return self.reply(409, {})
                    self.reply(202, {'ok': True})
                except (ValueError, TypeError, OSError, queue.Full):
                    self.reply(400, {'error': 'Check the recovery settings'})
        return Handler


def profile(value):
    return f'''[connection]
id={PROFILE}
uuid={uuid.uuid5(uuid.NAMESPACE_DNS, 'openframe-recovery-' + value['playerId'])}
type=wifi
interface-name=wlan0
autoconnect=false
[wifi]
mode=ap
band=bg
ssid={value['ssid']}
hidden=true
[wifi-security]
key-mgmt=wpa-psk
proto=rsn;
psk={value['password']}
[ipv4]
method=manual
address1={IP}/24
never-default=true
[ipv6]
method=disabled
'''


def firewall(enable):
    rules = [('INPUT', ['-i', 'wlan0', '-j', 'OF-RECOVERY']), ('FORWARD', ['-i', 'wlan0', '-j', 'OF-RECOVERY-FWD']), ('FORWARD', ['-o', 'wlan0', '-j', 'OF-RECOVERY-FWD'])]
    if enable:
        # Clear only our named chain and exact jumps after an interrupted run.
        firewall(False)
        command('iptables', '-w', '-N', 'OF-RECOVERY')
        command('iptables', '-w', '-N', 'OF-RECOVERY-FWD')
        command('iptables', '-w', '-A', 'OF-RECOVERY-FWD', '-j', 'DROP')
        command('iptables', '-w', '-A', 'OF-RECOVERY', '-d', IP, '-p', 'tcp', '--dport', '80', '-j', 'ACCEPT')
        command('iptables', '-w', '-A', 'OF-RECOVERY', '-p', 'udp', '--dport', '67', '-j', 'ACCEPT')
        command('iptables', '-w', '-A', 'OF-RECOVERY', '-j', 'DROP')
        for chain, args in rules:
            command('iptables', '-w', '-I', chain, '1', *args)
    else:
        for chain, args in rules:
            subprocess.run(['iptables', '-w', '-D', chain, *args], capture_output=True, timeout=10)
        for action in ('-F', '-X'):
            for chain in ('OF-RECOVERY', 'OF-RECOVERY-FWD'):
                subprocess.run(['iptables', '-w', action, chain], capture_output=True, timeout=10)


def report(value, phase):
    atomic_json(STATUS, {'playerId': value['playerId'], 'phase': phase})
    os.chmod(STATUS, 0o644)


def window(value):
    portal = Portal()
    server = None
    dns = None
    pending = None
    try:
        report(value, 'starting')
        atomic_write(KEYFILE, profile(value), 0o600)
        command('nmcli', 'connection', 'load', str(KEYFILE))
        firewall(True)
        command('nmcli', '--wait', '20', 'connection', 'up', PROFILE)
        # No DNS forwarding or NAT: this network reaches only the recovery page.
        dns = subprocess.Popen(['dnsmasq', '--keep-in-foreground', '--conf-file=/dev/null', '--port=0', '--interface=wlan0', '--bind-interfaces', '--dhcp-range=192.168.50.10,192.168.50.50,255.255.255.0,2m', '--dhcp-option=3', '--dhcp-option=6', '--dhcp-leasefile=/run/openframe-recovery/leases'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server = SetupHTTPServer((IP, 80), portal.handler())
        portal.start()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        report(value, 'hotspot')
        while portal.is_open() and credentials() == value and dns.poll() is None:
            try:
                pending = portal.pending.get(timeout=2)
                time.sleep(1)
                break
            except queue.Empty:
                pass
    finally:
        portal.close()
        if server:
            server.shutdown()
            server.server_close()
        if dns:
            dns.terminate()
            try: dns.wait(timeout=5)
            except subprocess.TimeoutExpired:
                dns.kill()
                dns.wait(timeout=5)
        subprocess.run(['nmcli', '--wait', '10', 'connection', 'down', PROFILE], capture_output=True, timeout=15)
        subprocess.run(['nmcli', 'connection', 'delete', PROFILE], capture_output=True, timeout=10)
        firewall(False)
    return pending


def reconnect(value=None):
    command('nmcli', 'device', 'set', 'wlan0', 'autoconnect', 'yes')
    if value:
        command('raspi-config', 'nonint', 'do_wifi_country', value['country'])
        args = ['nmcli', '--wait', '30', 'device', 'wifi', 'connect', value['ssid'], 'ifname', 'wlan0', 'name', 'openframe-uplink']
        if value['password']:
            args += ['password', value['password']]
        command(*args, timeout=40)
    else:
        command('nmcli', '--wait', '30', 'device', 'connect', 'wlan0', timeout=40)


def run():
    lost_at = None
    retry_at = 0
    setup_removed = False
    # Remove a leftover recovery profile activation before inspecting connectivity.
    subprocess.run(['nmcli', '--wait', '10', 'connection', 'down', PROFILE], capture_output=True, timeout=15)
    subprocess.run(['nmcli', 'connection', 'delete', PROFILE], capture_output=True, timeout=10)
    firewall(False)
    while True:
        value = credentials()
        try:
            if not value:
                lost_at = None
            else:
                if not setup_removed:
                    subprocess.run(['nmcli', 'connection', 'delete', 'openframe-setup'], capture_output=True, timeout=10)
                    setup_removed = True
                state = wifi_state()
                now = time.monotonic()
                if state == 100:
                    lost_at = None
                    report(value, 'standby')
                elif lost_at is None:
                    lost_at = now
                    report(value, 'reconnecting')
                elif now - lost_at >= WAIT_SECONDS:
                    pending = None
                    try:
                        pending = window(value)
                    finally:
                        report(value, 'reconnecting')
                        try:
                            reconnect(pending)
                        finally:
                            lost_at = time.monotonic()
                elif state in (30, 120) and now >= retry_at:
                    retry_at = now + 15
                    # A failed reconnect must not reset the outage grace period.
                    subprocess.run(['nmcli', '--wait', '0', 'device', 'connect', 'wlan0'], capture_output=True, timeout=10)
        except Exception:
            if value:
                report(value, 'error')
            lost_at = time.monotonic()
        time.sleep(5)


if __name__ == '__main__':
    if os.geteuid() != 0:
        raise SystemExit('Recovery service requires root')
    os.umask(0o077)
    STATUS.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(STATUS.parent, 0o755)
    def stop(*_):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    try:
        run()
    except Exception:
        raise SystemExit('Recovery service failed; check NetworkManager and wlan0') from None
