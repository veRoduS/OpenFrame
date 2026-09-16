import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'player'))
import recovery

PLAYER_ID = '12345678-1234-1234-1234-123456789abc'
VALUE = dict(playerId=PLAYER_ID, ssid=PLAYER_ID.replace('-', ''), password='a' * 24, hidden=True, server='https://signage.example.com')
WIFI = dict(ssid='Office', password='fake-password', country='US')


class RecoveryTests(unittest.TestCase):
    def test_profile_is_hidden_non_autoconnecting_and_has_no_nat(self):
        profile = recovery.profile(VALUE)
        self.assertIn('hidden=true', profile)
        self.assertIn('autoconnect=false', profile)
        self.assertIn('method=manual', profile)
        self.assertIn('proto=rsn;', profile)
        self.assertNotIn('shared', profile)
        self.assertEqual(len(VALUE['ssid']), 32)

    def test_credentials_require_matching_approved_identity_and_origin(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(recovery, 'CACHE', Path(directory)), patch.object(recovery, 'CONFIG', Path(directory) / 'config.json'):
            root = Path(directory)
            documents = {'recovery.json': VALUE, 'identity.json': dict(id=PLAYER_ID, server=VALUE['server']), 'state.json': dict(approved=True, server=VALUE['server']), 'config.json': dict(server=VALUE['server'])}
            for name, data in documents.items():
                recovery.atomic_json(root / name, data)
            self.assertEqual(recovery.credentials(), VALUE)
            for changes in ({'password': 'a\nPostUp=bad'}, {'ssid': 'different'}, {'server': 'https://other.example'}, {'hidden': False}):
                recovery.atomic_json(root / 'recovery.json', {**VALUE, **changes})
                self.assertIsNone(recovery.credentials())
            recovery.atomic_json(root / 'recovery.json', VALUE)
            recovery.atomic_json(root / 'state.json', dict(approved=False, server=VALUE['server']))
            self.assertIsNone(recovery.credentials())

    def test_outage_grace_and_retries_do_not_take_down_healthy_wifi(self):
        for connected in (True, False):
            now = [0]
            windows = []
            def sleep(seconds):
                now[0] += seconds
                if now[0] > 125:
                    raise StopIteration()
            with patch.object(recovery, 'credentials', return_value=VALUE), patch.object(recovery, 'wifi_state', return_value=100 if connected else 30), patch.object(recovery, 'window', side_effect=lambda _: windows.append(now[0])), patch.object(recovery, 'reconnect'), patch.object(recovery, 'report'), patch.object(recovery, 'firewall'), patch.object(recovery.subprocess, 'run') as run, patch.object(recovery.time, 'monotonic', side_effect=lambda: now[0]), patch.object(recovery.time, 'sleep', side_effect=sleep):
                run.return_value.returncode = 1
                with self.assertRaises(StopIteration):
                    recovery.run()
            self.assertEqual(windows, [] if connected else [60, 120])

    def test_unknown_wifi_status_does_not_start_hotspot(self):
        with patch.object(recovery, 'credentials', return_value=VALUE), patch.object(recovery, 'wifi_state', side_effect=ValueError()), patch.object(recovery, 'window') as window, patch.object(recovery, 'report'), patch.object(recovery, 'firewall'), patch.object(recovery.subprocess, 'run'), patch.object(recovery.time, 'sleep', side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                recovery.run()
            window.assert_not_called()

    def test_window_failure_cleans_its_network_rules_and_profile(self):
        with patch.object(recovery, 'report'), patch.object(recovery, 'atomic_write'), patch.object(recovery, 'command', side_effect=OSError()), patch.object(recovery, 'firewall') as firewall, patch.object(recovery.subprocess, 'run') as run:
            with self.assertRaises(OSError):
                recovery.window(VALUE)
            firewall.assert_called_once_with(False)
            self.assertTrue(any('down' in call.args[0] for call in run.call_args_list))
            self.assertIn('delete', run.call_args.args[0])

    def test_firewall_cleanup_only_targets_reserved_chains(self):
        with patch.object(recovery.subprocess, 'run') as run:
            recovery.firewall(False)
        for call in run.call_args_list:
            args = call.args[0]
            self.assertTrue(any(s.startswith('OF-RECOVERY') for s in args))
            self.assertNotIn('DROP', args)

    def test_portal_requires_local_origin_token_and_only_accepts_wifi_fields(self):
        portal = recovery.Portal()
        server = recovery.SetupHTTPServer(('127.0.0.1', 0), portal.handler())
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        def request(method, path, body=None, extra=None):
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            conn.request(method, path, json.dumps(body) if body is not None else None, {'Host': recovery.IP, **(extra or {})})
            response = conn.getresponse()
            data = json.loads(response.read())
            status = response.status
            conn.close()
            return status, data
        self.assertEqual(request('GET', '/setup/state')[1], {'csrf': portal.token})
        self.assertEqual(request('GET', '/recovery.json')[0], 404)
        self.assertEqual(request('POST', '/setup', WIFI)[0], 403)
        headers = {'Origin': 'http://' + recovery.IP, 'X-Setup-Token': portal.token}
        self.assertEqual(request('POST', '/setup', {**WIFI, 'server': 'https://other.example'}, headers)[0], 400)
        self.assertEqual(request('POST', '/setup', WIFI, {**headers, 'Host': 'evil.example'})[0], 403)
        self.assertEqual(request('POST', '/setup', WIFI, headers)[0], 202)
        self.assertEqual(portal.pending.get_nowait(), WIFI)
        self.assertEqual(request('POST', '/setup', WIFI, headers)[0], 409)


if __name__ == '__main__':
    unittest.main()
