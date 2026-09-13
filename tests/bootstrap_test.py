import base64
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'player'))
import bootstrap
import managed_network

PRIVATE = base64.b64encode(bytes(range(32))).decode()
PUBLIC = base64.b64encode(bytes(range(32, 64))).decode()
SETTINGS = dict(address='10.77.0.2/32', publicKey=PUBLIC, endpoint='vpn.example.com:51820', allowedIPs='10.77.0.1/32', server='http://10.77.0.1:3100')
FORM = dict(name='Lobby', ssid='Office Wi-Fi', password='fake-wifi-password', country='US', server='https://signage.example.com')


class BootstrapTests(unittest.TestCase):
    def test_hotspot_requires_country_and_sets_wpa2_on_24ghz(self):
        setup = bootstrap.Setup()
        with patch.dict(bootstrap.os.environ, {'OPENFRAME_SETUP_COUNTRY': ''}), patch.object(bootstrap, 'command') as command:
            with self.assertRaises(ValueError):
                setup.hotspot()
            command.assert_not_called()
        with patch.dict(bootstrap.os.environ, {'OPENFRAME_SETUP_COUNTRY': 'US'}), patch.object(bootstrap, 'command') as command, patch.object(bootstrap.subprocess, 'run') as run:
            run.return_value.returncode = 1
            setup.hotspot()
            self.assertEqual(command.call_args_list[0].args, ('raspi-config', 'nonint', 'do_wifi_country', 'US'))
            args = command.call_args_list[-2].args
            self.assertIn('bg', args)
            self.assertIn('rsn', args)
            self.assertIn('wpa-psk', args)
            self.assertEqual(command.call_args_list[-1].args, ('nmcli', 'connection', 'up', bootstrap.PROFILE))

    def test_input_requires_https_and_validates_wifi_and_access(self):
        self.assertEqual(bootstrap.validate_input(FORM)['config']['server'], FORM['server'])
        for patch_value in ({'server': 'http://example.com'}, {'server': 'https://user:pass@example.com'}, {'server': 'https://example.com/path'}, {'ssid': ''}, {'ssid': '\u00e9' * 17}, {'name': ''}, {'password': 'x\x00y'}, {'country': 'USA'}, {'clientId': 'fake-id'}, {'clientId': 'id', 'clientSecret': 'bad\r\nheader'}):
            with self.subTest(value=patch_value), self.assertRaises(ValueError):
                bootstrap.validate_input({**FORM, **patch_value})

    def test_client_config_is_compatible_and_rejects_arbitrary_routes_or_hooks(self):
        text, host = bootstrap.client_config(PRIVATE, SETTINGS)
        self.assertEqual(host, '10.77.0.1')
        self.assertEqual(bootstrap.wireguard.validate(text), text)
        self.assertIn('PersistentKeepalive = 25', text)
        for change in ({'address': '10.77.0.2/24'}, {'address': '10.77.0.1/32'}, {'address': '10.88.0.2/32'}, {'allowedIPs': '0.0.0.0/0'}, {'allowedIPs': '127.0.0.1/32'}, {'server': 'http://192.168.1.1:3100'}, {'publicKey': 'invalid'}, {'endpoint': 'vpn.example.com:99999'}, {'endpoint': 'vpn.example.com:51820\nPostUp=bad'}, {'PostUp': 'echo bad'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                bootstrap.client_config(PRIVATE, {**SETTINGS, **change})

    def test_route_guard_checks_before_adding_a_narrow_output_rule(self):
        with patch.object(managed_network.subprocess, 'run') as run:
            run.return_value.returncode = 1
            managed_network.guard('10.77.0.1')
            self.assertEqual(run.call_args_list[1].args[0], ['iptables', '-w', '-I', 'OUTPUT', '-d', '10.77.0.1', '!', '-o', 'wg-openframe', '-j', 'REJECT'])
        for address in ('127.0.0.1', '8.8.8.8', '169.254.1.1', '10.77.0.1; bad'):
            with self.assertRaises(ValueError):
                managed_network.guard(address)

    def test_private_origin_is_not_committed_when_route_is_wrong(self):
        with patch.object(bootstrap, 'guard'), patch.object(bootstrap.wireguard, 'install'), patch.object(bootstrap, 'command', return_value='[{"dev":"wlan0"}]'), patch.object(bootstrap, 'request') as request, patch.object(bootstrap, 'atomic_json') as write:
            with self.assertRaisesRegex(ValueError, 'routed through WireGuard'):
                bootstrap.install_private_connection(SETTINGS, PRIVATE, {'token': 'fake-token'}, 'Lobby')
            request.assert_not_called()
            write.assert_not_called()

    def test_enrollment_persists_secret_before_request_and_reuses_it_on_retry(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'STATE', Path(directory)), patch.object(bootstrap, 'command', side_effect=[PRIVATE, PUBLIC, PUBLIC]), patch.object(bootstrap, 'request') as request, patch.object(bootstrap, 'install_private_connection') as install:
            def respond(_config, endpoint, body, token=None):
                if endpoint.endswith('/enroll'):
                    saved = json.loads((Path(directory) / 'enrollment.json').read_text())
                    self.assertEqual(body['enrollmentToken'], saved['token'])
                    self.assertNotIn(PRIVATE, json.dumps(body))
                    return dict(id='test-device', token=body['enrollmentToken'], code='AABBCCDD')
                return dict(approved=True, wireguard=SETTINGS)
            request.side_effect = respond
            setup = bootstrap.Setup()
            value = bootstrap.validate_input(FORM)
            setup.enroll(value)
            first = request.call_args_list[0].args[2]['enrollmentToken']
            setup.enroll(value)
            second = request.call_args_list[2].args[2]['enrollmentToken']
            self.assertEqual(first, second)
            self.assertEqual(install.call_count, 2)

    def test_verified_private_connection_preserves_pairing_and_writes_no_public_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / 'cache'
            cache.mkdir()
            config = root / 'config.json'
            identity = dict(id='test-device', token='fake-token', server=FORM['server'], code='AABBCCDD')
            commands = []
            def command(*args):
                commands.append(args)
                return '[{"dev":"wg-openframe"}]' if args[0] == 'ip' else ''
            fake_pwd = types.SimpleNamespace(getpwnam=lambda _: types.SimpleNamespace(pw_uid=1000, pw_gid=1000))
            with patch.dict(sys.modules, {'pwd': fake_pwd}), patch.object(bootstrap, 'CONFIG', config), patch.object(bootstrap, 'CACHE', cache), patch.object(bootstrap, 'GUARD', root / 'guard.json'), patch.object(bootstrap, 'guard'), patch.object(bootstrap, 'command', side_effect=command), patch.object(bootstrap.wireguard, 'install'), patch.object(bootstrap.wireguard, 'atomic_write'), patch.object(bootstrap.os, 'chown', create=True), patch.object(bootstrap, 'request', return_value=dict(approved=True, wireguard=SETTINGS)):
                bootstrap.install_private_connection(SETTINGS, PRIVATE, identity, 'Lobby')
            self.assertEqual(json.loads(config.read_text()), dict(name='Lobby', server=SETTINGS['server']))
            stored = json.loads((cache / 'identity.json').read_text())
            self.assertEqual(stored['token'], identity['token'])
            self.assertEqual(stored['server'], SETTINGS['server'])
            self.assertTrue((cache / 'provisioned').exists())
            self.assertIn(('systemctl', 'restart', 'openframe-agent.service'), commands)

    def test_portal_auth_bounds_and_metadata_do_not_expose_secrets(self):
        setup = bootstrap.Setup()
        server = bootstrap.SetupHTTPServer(('127.0.0.1', 0), setup.handler())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(method, route, value=None, extra=None):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            headers = {'Host': bootstrap.PORTAL_IP, 'Content-Type': 'application/json', **(extra or {})}
            conn.request(method, route, json.dumps(value) if value is not None else None, headers)
            response = conn.getresponse()
            data = response.read()
            status = response.status
            conn.close()
            return status, json.loads(data)
        status, metadata = request('GET', '/setup/state')
        self.assertEqual(status, 200)
        self.assertNotIn(setup.password, json.dumps(metadata))
        self.assertNotIn('code', metadata)
        self.assertEqual(request('POST', '/setup', FORM)[0], 403)
        headers = {'Origin': 'http://' + bootstrap.PORTAL_IP, 'X-Setup-Token': setup.csrf}
        self.assertEqual(request('POST', '/setup', FORM, {**headers, 'Host': 'foreign.example'})[0], 403)
        self.assertEqual(request('POST', '/setup', FORM, {**headers, 'Origin': 'http://foreign.example'})[0], 403)
        self.assertEqual(request('POST', '/setup', {**FORM, 'password': 'x' * 9000}, headers)[0], 413)
        self.assertEqual(request('POST', '/setup', FORM, headers)[0], 202)
        self.assertEqual(setup.pending.get_nowait()['ssid'], FORM['ssid'])
        self.assertEqual(request('POST', '/setup', FORM, headers)[0], 409)


if __name__ == '__main__':
    unittest.main()
