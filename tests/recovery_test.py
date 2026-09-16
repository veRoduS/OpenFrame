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
    def test_unpaused_window_expires_and_restart_clears_pause(self):
        with patch.object(recovery.time, 'monotonic', return_value=0) as clock:
            portal = recovery.Portal()
            clock.return_value = 90
            self.assertTrue(portal.state()['closing'])
            self.assertFalse(portal.submit(WIFI))
            fresh = recovery.Portal()
            fresh.pause({'duration': None})
            restarted = recovery.Portal()
            self.assertFalse(restarted.paused)
            self.assertEqual(restarted.state()['remainingSeconds'], 90)

    def test_pause_deadlines_are_owned_by_player_and_replace_existing_window(self):
        with patch.object(recovery.time, 'monotonic', return_value=100) as clock:
            for duration in (60, 300, 900):
                clock.return_value = 100
                portal = recovery.Portal()
                self.assertEqual(portal.state()['remainingSeconds'], 90)
                clock.return_value = 120
                self.assertTrue(portal.pause({'duration': duration}))
                self.assertEqual(portal.state()['remainingSeconds'], duration)
                clock.return_value = 120 + duration - 0.1
                self.assertTrue(portal.is_open())
                self.assertEqual(portal.state()['remainingSeconds'], 1)
                clock.return_value = 120 + duration
                self.assertFalse(portal.is_open())
                self.assertFalse(portal.pause({'duration': None}))
                self.assertFalse(portal.submit(None))

    def test_indefinite_pause_survives_reads_and_ends_on_submission_or_close(self):
        with patch.object(recovery.time, 'monotonic', return_value=0) as clock:
            portal = recovery.Portal()
            self.assertTrue(portal.pause({'duration': None}))
            clock.return_value = 1000000
            for _ in range(3):
                self.assertEqual(portal.state(), dict(csrf=portal.token, paused=True, pauseSeconds=None, remainingSeconds=None, closing=False))
            self.assertTrue(portal.submit(None))
            self.assertTrue(portal.state()['closing'])
            self.assertIsNone(portal.pending.get_nowait())
            self.assertFalse(portal.pause({'duration': 60}))
            self.assertFalse(portal.submit(WIFI))
            portal.close()
            self.assertFalse(portal.is_open())

    def test_invalid_pause_does_not_change_deadline(self):
        portal = recovery.Portal()
        deadline = portal.deadline
        for value in ({}, [], {'duration': True}, {'duration': '60'}, {'duration': 60.0}, {'duration': 0}, {'duration': -1}, {'duration': 91}, {'duration': None, 'extra': 1}):
            with self.assertRaises(ValueError):
                portal.pause(value)
            self.assertEqual(portal.deadline, deadline)
            self.assertFalse(portal.paused)

    def test_submitted_wifi_wins_over_expiry_and_can_override_pause(self):
        with patch.object(recovery.time, 'monotonic', return_value=0) as clock:
            portal = recovery.Portal()
            portal.pause({'duration': 60})
            self.assertTrue(portal.submit(WIFI))
            clock.return_value = 200
            self.assertTrue(portal.is_open())
            self.assertEqual(portal.pending.get_nowait(), WIFI)
            portal.close()
            self.assertFalse(portal.is_open())

    def test_window_keeps_hotspot_past_original_deadline_until_resume(self):
        with patch.object(recovery.time, 'monotonic', return_value=0) as clock:
            portal = recovery.Portal()
            calls = []
            def pending_get(timeout):
                calls.append(clock.return_value)
                if len(calls) == 1:
                    portal.pause({'duration': None})
                    clock.return_value = 1000
                    raise recovery.queue.Empty()
                self.assertTrue(portal.submit(None))
                return None
            with patch.object(recovery, 'Portal', return_value=portal), patch.object(portal.pending, 'get', side_effect=pending_get), patch.object(recovery, 'credentials', return_value=VALUE), patch.object(recovery, 'report'), patch.object(recovery, 'atomic_write'), patch.object(recovery, 'command'), patch.object(recovery, 'firewall') as firewall, patch.object(recovery.subprocess, 'run'), patch.object(recovery.subprocess, 'Popen') as dns, patch.object(recovery, 'SetupHTTPServer') as server, patch.object(recovery.threading, 'Thread'), patch.object(recovery.time, 'sleep'):
                dns.return_value.poll.return_value = None
                self.assertIsNone(recovery.window(VALUE))
                self.assertEqual(calls, [0, 1000])
                server.return_value.shutdown.assert_called_once()
                dns.return_value.terminate.assert_called_once()
                self.assertEqual(firewall.call_args.args, (False,))
                self.assertFalse(portal.is_open())

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
        self.assertEqual(request('GET', '/setup/state')[1]['csrf'], portal.token)
        self.assertEqual(request('GET', '/recovery.json')[0], 404)
        self.assertEqual(request('POST', '/setup', WIFI)[0], 403)
        headers = {'Origin': 'http://' + recovery.IP, 'X-Setup-Token': portal.token}
        for endpoint, body in (('/setup/pause', {'duration': None}), ('/setup/resume', {})):
            self.assertEqual(request('POST', endpoint, body)[0], 403)
            self.assertEqual(request('POST', endpoint, body, {**headers, 'Host': 'evil.example'})[0], 403)
            self.assertEqual(request('POST', endpoint, body, {**headers, 'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(request('POST', '/setup/pause', {'duration': 7}, headers)[0], 400)
        self.assertEqual(request('POST', '/setup/resume', {'extra': 1}, headers)[0], 400)
        status, state = request('POST', '/setup/pause', {'duration': None}, headers)
        self.assertEqual(status, 200)
        self.assertTrue(state['paused'])
        self.assertIsNone(state['remainingSeconds'])
        self.assertEqual(request('POST', '/setup', {**WIFI, 'server': 'https://other.example'}, headers)[0], 400)
        self.assertEqual(request('POST', '/setup', WIFI, {**headers, 'Host': 'evil.example'})[0], 403)
        self.assertEqual(request('POST', '/setup', WIFI, headers)[0], 202)
        self.assertEqual(portal.pending.get_nowait(), WIFI)
        self.assertEqual(request('POST', '/setup', WIFI, headers)[0], 409)
        self.assertEqual(request('POST', '/setup/pause', {'duration': 60}, headers)[0], 409)
        self.assertEqual(request('POST', '/setup/resume', {}, headers)[0], 409)

    def test_resume_endpoint_queues_saved_wifi_reconnection(self):
        portal = recovery.Portal()
        portal.pause({'duration': None})
        server = recovery.SetupHTTPServer(('127.0.0.1', 0), portal.handler())
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        self.addCleanup(conn.close)
        conn.request('POST', '/setup/resume', '{}', {'Host': recovery.IP, 'Origin': 'http://' + recovery.IP, 'X-Setup-Token': portal.token})
        response = conn.getresponse()
        response.read()
        self.assertEqual(response.status, 202)
        self.assertIsNone(portal.pending.get_nowait())
        self.assertTrue(portal.state()['closing'])


if __name__ == '__main__':
    unittest.main()
