#!/usr/bin/env python3
"""OpenFrame player agent. Python standard library only; no browser dependency."""
import argparse
import hashlib
import http.server
import json
import logging
import os
from pathlib import Path
import re
import socket
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

VERSION = '0.4.0'


def normalize_server(value):
    if not isinstance(value, str):
        raise ValueError('server must be an http(s) origin')
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or parsed.path not in ('', '/') or any(c.isspace() for c in value):
        raise ValueError('server must be an http(s) origin, e.g. https://signage.example.com')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError('Invalid server port')
    return value.rstrip('/')


class SameOriginRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        def origin(url):
            parsed = urllib.parse.urlsplit(url)
            if parsed.username is not None or parsed.password is not None:
                raise ValueError('Redirect URLs cannot contain credentials')
            return parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == 'https' else 80)
        if origin(req.full_url) != origin(newurl):
            raise ValueError('Server redirected to another origin; check the final HTTPS address and any Cloudflare Access Service Auth policy')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def connection_settings(config):
    server = normalize_server(config.get('server', ''))
    access = config.get('cloudflare_access')
    headers = {}
    if access is not None:
        if not isinstance(access, dict) or set(access) != {'client_id', 'client_secret'}:
            raise ValueError('cloudflare_access requires client_id and client_secret')
        if urllib.parse.urlsplit(server).scheme != 'https':
            raise ValueError('Cloudflare Access credentials require an HTTPS server')
        for key, header in (('client_id', 'CF-Access-Client-Id'), ('client_secret', 'CF-Access-Client-Secret')):
            value = access[key]
            if not isinstance(value, str) or not 1 <= len(value) <= 2048 or any(ord(c) < 33 or ord(c) > 126 for c in value):
                raise ValueError('Invalid Cloudflare Access credential: ' + key)
            headers[header] = value
    return server, headers


def check_connection(config):
    server, headers = connection_settings(config)
    opener = urllib.request.build_opener(SameOriginRedirects())
    request = urllib.request.Request(server + '/api/health', headers={'Accept': 'application/json', **headers})
    with opener.open(request, timeout=10) as response:
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError('Unexpectedly large health response')
    result = json.loads(body)
    if not isinstance(result, dict) or result.get('ok') is not True or not isinstance(result.get('version'), str):
        raise ValueError('The address did not return an OpenFrame health response')
    return {'server': server, 'reachable': True, 'version': result['version']}


def device_revoked(error):
    if error.code != 401:
        return False
    try:
        value = json.loads(error.read(4096))
        return isinstance(value, dict) and (value.get('code') == 'DEVICE_CREDENTIALS_INVALID' or value.get('error') == 'Device credentials invalid')
    except (OSError, ValueError):
        return False


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


class Agent:
    def __init__(self, config, cache, allow_reboot=False):
        self.config = config
        self.server, self.access_headers = connection_settings(config)
        self.opener = urllib.request.build_opener(SameOriginRedirects())
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        (self.cache / 'media').mkdir(exist_ok=True)
        self.allow_reboot = allow_reboot
        self.credentials = read_json(self.cache / 'identity.json', {})
        if self.credentials.get('server') != self.server:
            self.credentials = {}
        self.state = read_json(self.cache / 'state.json', {'approved': False})
        if self.state.get('server') != self.server:
            self.state = {'approved': False}
        self.started = time.monotonic()
        self.error = None
        self.connected = False
        self.last_contact = None
        self.recovery_next = 0
        self.verified_revision = None
        self.playback = None
        self.playback_at = 0
        self.lock = threading.Lock()

    def request(self, endpoint, body=None):
        headers = {'Content-Type': 'application/json', **self.access_headers}
        if self.credentials.get('token'):
            headers['Authorization'] = 'Bearer ' + self.credentials['token']
        request = urllib.request.Request(self.server + endpoint, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        with self.opener.open(request, timeout=10) as response:
            return json.load(response)

    def download(self, asset):
        filename = asset['filename']
        if not re.fullmatch(r'[a-f0-9-]{36}\.webp', filename) or asset['url'] != '/media/' + filename:
            raise ValueError('Invalid asset path')
        target = self.cache / 'media' / filename
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == asset['sha256']:
            return
        req = urllib.request.Request(self.server + asset['url'], headers={'Authorization': 'Bearer ' + self.credentials['token'], **self.access_headers})
        with self.opener.open(req, timeout=45) as response:
            data = response.read(25 * 1024 * 1024 + 1)
        if len(data) > 25 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != asset['sha256']:
            raise ValueError('Image checksum mismatch or download too large')
        temporary = target.with_suffix('.part')
        with temporary.open('wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)

    def sync(self):
        if not self.credentials:
            self.credentials = self.request('/api/player/enroll', {'name': self.config.get('name', socket.gethostname())})
            self.credentials['server'] = self.server
            atomic_json(self.cache / 'identity.json', self.credentials)
            os.chmod(self.cache / 'identity.json', 0o600)
        revision = self.state.get('manifest', {}).get('revision')
        with self.lock:
            playback = self.playback.copy() if self.playback else None
        if time.monotonic() - (self.playback_at or self.started) > 30:
            playback = {'phase': 'stalled', 'error': 'No recent status from the browser player'}
        response = self.request('/api/player/sync', {
            'revision': revision, 'version': VERSION, 'uptime': time.monotonic() - self.started,
            'error': self.error, 'commandAck': self.state.get('commandAck'),
            'playback': playback,
            'recovery': self.recovery_status(),
        })
        response['server'] = self.server
        with self.lock:
            self.connected = True
            self.last_contact = time.time()
        response['generation'] = self.state.get('generation', 0)
        response['commandAck'] = self.state.get('commandAck')
        if response.get('approved'):
            # Keep last-known weather if a cold server cache has no replacement yet.
            for key, value in response.get('weather', {}).items():
                previous = self.state.get('weather', {}).get(key)
                if not value.get('periods') and previous and previous.get('periods'):
                    response['weather'][key] = {**previous, **value, 'periods': previous['periods'], 'fetchedAt': previous.get('fetchedAt'), 'status': 'stale'}
                if previous and previous.get('observation') and not value.get('observation'):
                    response['weather'][key]['observation'] = previous['observation']
                    response['weather'][key]['observationStatus'] = 'unavailable'
            manifest = response['manifest']
            if manifest.get('schemaVersion') != 1:
                raise ValueError('Unsupported playlist schema')
            command = response.get('command')
            force_refresh = command and command['type'] == 'refresh' and command['id'] != self.state.get('commandAck')
            verify = self.verified_revision != manifest['revision'] or force_refresh
            for asset in manifest['assets']:
                if verify:
                    self.download(asset)
                asset['url'] = '/media/' + asset['filename']
            self.verified_revision = manifest['revision']
        command = response.pop('command', None)
        execute = command and command['id'] != response['commandAck']
        command_error = None
        if execute:
            response['generation'] += 1
            if command['type'] == 'reboot' and not self.allow_reboot:
                command_error = 'Reboot disabled for this player; start agent with --allow-reboot'
            response['commandAck'] = command['id']
        # Commit only after every asset is complete. The previous state survives errors.
        atomic_json(self.cache / 'state.json', response)
        with self.lock:
            self.state = response
        self.error = command_error
        if execute and command['type'] == 'reboot' and self.allow_reboot:
            subprocess.run(['sudo', '-n', '/usr/sbin/reboot'], check=True, timeout=10)

    def recovery_status(self):
        value = read_json(Path('/run/openframe-recovery/status.json'), {})
        if value.get('playerId') == self.credentials.get('id') and value.get('phase') in ('standby', 'starting', 'hotspot', 'reconnecting', 'error'):
            return value['phase']
        return None

    def ensure_recovery(self):
        if not self.state.get('approved') or time.monotonic() < self.recovery_next:
            return
        self.recovery_next = time.monotonic() + 60
        path = self.cache / 'recovery.json'
        saved = read_json(path, {})
        if saved.get('playerId') == self.credentials.get('id') and saved.get('server') == self.server and saved.get('ssid') == self.credentials.get('id', '').replace('-', '') and saved.get('hidden') is True and re.fullmatch(r'[A-Za-z0-9_-]{24}', saved.get('password', '')):
            return
        try:
            value = self.request('/api/player/recovery', {})
            player_id = self.credentials.get('id', '')
            if not re.fullmatch(r'[a-f0-9-]{36}', player_id) or value.get('playerId') != player_id or value.get('ssid') != player_id.replace('-', '') or not re.fullmatch(r'[A-Za-z0-9_-]{24}', value.get('password', '')) or value.get('hidden') is not True:
                raise ValueError('Invalid recovery settings')
            atomic_json(path, {**value, 'server': self.server})
            os.chmod(path, 0o600)
        except Exception:
            logging.warning('Recovery Wi-Fi settings unavailable; playback is unchanged')

    def loop(self):
        while True:
            attempt_started = time.monotonic()
            try:
                self.sync()
                self.ensure_recovery()
            except urllib.error.HTTPError as error:
                self.connected = False
                self.error = 'Server returned HTTP ' + str(error.code)
                if device_revoked(error):
                    # Revocation stops local playback too. A new enrollment needs approval.
                    self.credentials = {}
                    (self.cache / 'recovery.json').unlink(missing_ok=True)
                    atomic_json(self.cache / 'identity.json', {})
                    with self.lock:
                        self.state = {'approved': False, 'error': 'Device revoked. Pair this screen again.'}
                        atomic_json(self.cache / 'state.json', self.state)
                logging.warning('%s', self.error)
            except Exception as error:
                self.connected = False
                self.error = str(error)[:500]
                logging.warning('Sync failed: %s', self.error)
            # Keep failed connection attempts near 15 seconds apart, without overlap.
            time.sleep(max(1, 15 - (time.monotonic() - attempt_started)))

    def handler(self):
        agent = self
        web = Path(__file__).parent / 'web'

        class Handler(http.server.BaseHTTPRequestHandler):
            def local_host(self):
                return self.headers.get('Host') in ('127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port))

            def do_POST(self):
                origin = self.headers.get('Origin')
                allowed = ('http://127.0.0.1:' + str(self.server.server_port), 'http://localhost:' + str(self.server.server_port))
                if not self.local_host() or (origin and origin not in allowed):
                    self.send_error(403)
                    return
                if self.path != '/local/playback':
                    self.send_error(404)
                    return
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 4096:
                        self.send_error(413)
                        return
                    self.connection.settimeout(3)
                    value = json.loads(self.rfile.read(length))
                    if value.get('phase') not in ('playing', 'preparing', 'waiting', 'blank', 'empty', 'unpaired'):
                        raise ValueError('Invalid phase')
                    status = {'phase': value['phase'], 'error': str(value['error'])[:500] if value.get('error') else None}
                    if value.get('slideId') is not None:
                        status['slideId'] = str(value['slideId'])[:100]
                    for field in ('preparationMs', 'missedDeadlines'):
                        number = value.get(field, 0)
                        if type(number) not in (int, float) or not 0 <= number <= 1e12:
                            raise ValueError('Invalid metric')
                        status[field] = number
                    with agent.lock:
                        agent.playback = status
                        agent.playback_at = time.monotonic()
                except (ValueError, AttributeError, OSError):
                    self.send_error(400)
                    return
                self.send_response(204)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_GET(self):
                if not self.local_host():
                    self.send_error(403)
                    return
                route = urllib.parse.urlsplit(self.path).path
                target = None
                if route == '/local/state':
                    with agent.lock:
                        state = dict(agent.state)
                        state['connection'] = {'connected': agent.connected, 'lastContactAt': agent.last_contact}
                    # Credentials never leave the agent, including through localhost.
                    state.pop('server', None)
                    state['error'] = agent.error or state.get('error')
                    data = json.dumps(state).encode()
                    content_type = 'application/json'
                elif re.fullmatch(r'/media/[a-f0-9-]{36}\.webp', route):
                    target = agent.cache / 'media' / route.split('/')[-1]
                    if not target.is_file():
                        self.send_error(404)
                        return
                    data = None
                    content_type = 'image/webp'
                elif route in ('/', '/index.html', '/player.js', '/player.css', '/widgets.js', '/text-layout.js', '/counter.js', '/clock.js', '/weather.js', '/weather-icons.js', '/image-layout.js', '/playback.js', '/frame.js', '/wifi-off.svg'):
                    filename = 'index.html' if route == '/' else route[1:]
                    data = (web / filename).read_bytes()
                    content_type = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'svg': 'image/svg+xml'}[filename.split('.')[-1]]
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(target.stat().st_size if target else len(data)))
                self.send_header('Cache-Control', 'private, max-age=31536000, immutable' if target else 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                if target:
                    with target.open('rb') as stream:
                        shutil.copyfileobj(stream, self.wfile, length=65536)
                else:
                    self.wfile.write(data)

            def log_message(self, *args):
                pass

        return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/etc/openframe/config.json')
    parser.add_argument('--cache', default='/var/lib/openframe')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--allow-reboot', action='store_true')
    parser.add_argument('--check-connection', action='store_true', help='Check the configured server without enrolling or changing the cache')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    config = read_json(Path(args.config), {})
    if args.check_connection:
        try:
            print(json.dumps(check_connection(config)))
        except (OSError, ValueError, AttributeError) as error:
            parser.exit(1, 'Connection check failed: ' + str(error) + '\n')
        return
    agent = Agent(config, args.cache, args.allow_reboot)
    threading.Thread(target=agent.loop, daemon=True).start()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), agent.handler())
    logging.info('OpenFrame player at http://127.0.0.1:%s', args.port)
    server.serve_forever()


if __name__ == '__main__':
    main()
