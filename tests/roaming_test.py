from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'player'))
import wifi

A = '00000000-0000-4000-8000-000000000001'
B = '00000000-0000-4000-8000-000000000002'
C = '00000000-0000-4000-8000-000000000003'


def record(identifier, name, priority, hidden=False):
    return dict(public=dict(id=identifier, ssid=name, priority=priority, security='wpa-psk', hidden=hidden),
                value=wifi.parser('[connection]\nautoconnect=true\n'), text=name)


class RoamingTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.active = C
        self.records = {A: record(A, 'Preferred', 999), B: record(B, 'Second', 998), C: record(C, 'Backup', 997)}
        self.scan = [('Preferred', 70, ['WPA2']), ('Second', 60, ['WPA2'])]
        self.calls = []
        self.fail = set()
        self.allowed = True
        def command(*args, **kwargs):
            self.calls.append((args, kwargs))
            if 'up' in args:
                target = args[6]
                if target in self.fail:
                    self.active = None
                    raise subprocess.TimeoutExpired('nmcli', 25)
                self.active = target
            return ''
        for name, options in [
            ('inventory', dict(side_effect=lambda: self.records)),
            ('connected_uuid', dict(side_effect=lambda: self.active)),
            ('scan_networks', dict(side_effect=lambda _: self.scan)),
            ('command', dict(side_effect=command)),
        ]:
            patcher = patch.object(wifi, name, **options)
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)
        self.roamer = wifi.Roamer(clock=lambda: self.now)

    def tick(self, at):
        self.now = at
        self.roamer.tick(lambda: self.allowed)

    def test_promotes_to_highest_stable_available_priority_and_stops_scanning_at_first(self):
        self.tick(0)
        self.tick(59)
        self.scan_networks.assert_not_called()
        self.tick(60)
        self.assertEqual(self.active, C)
        self.tick(120)
        self.assertEqual(self.active, A)
        self.assertEqual(self.calls[0][0], ('nmcli', '--wait', '25', 'connection', 'up', 'uuid', A, 'ifname', 'wlan0'))
        self.tick(180)
        self.assertEqual(self.scan_networks.call_count, 2)

    def test_moves_up_in_stages_when_first_network_is_absent(self):
        self.scan = [('Second', 60, ['WPA2'])]
        for at in (0, 60, 120): self.tick(at)
        self.assertEqual(self.active, B)
        self.scan = [('Preferred', 60, ['WPA2'])]
        self.tick(180)
        self.tick(240)
        self.assertEqual(self.active, A)

    def test_transient_or_weak_or_wrong_security_network_does_not_disrupt_backup(self):
        self.tick(0)
        self.tick(60)
        self.scan = [('Preferred', 34, ['WPA2']), ('Second', 70, ['--'])]
        self.tick(120)
        self.scan = [('Preferred', 70, ['WPA2'])]
        self.tick(180)
        self.assertEqual(self.active, C)
        self.assertFalse(self.calls)
        self.tick(240)
        self.assertEqual(self.active, A)

    def test_failed_promotion_restores_previous_and_backs_off_but_can_try_second(self):
        self.fail.add(A)
        for at in (0, 60, 120): self.tick(at)
        self.assertEqual(self.active, C)
        self.assertEqual([args[6] for args, _ in self.calls], [A, C])
        self.assertEqual(self.roamer.failures[A], (1, 420))
        self.tick(180)
        self.tick(240)
        self.assertEqual(self.active, B)
        self.assertEqual([args[6] for args, _ in self.calls], [A, C, B])
        self.tick(420)
        self.tick(480)
        self.assertEqual(self.roamer.failures[A], (2, 1080))
        self.assertEqual(self.active, B)

    def test_failure_backoff_is_capped_and_restore_failure_does_not_raise(self):
        self.fail.update([A, C])
        self.roamer.failures[A] = (3, 0)
        self.scan = [('Preferred', 60, ['WPA2'])]
        for at in (0, 60, 120): self.tick(at)
        self.assertIsNone(self.active)
        self.assertEqual(self.roamer.failures[A], (4, 1920))
        self.assertEqual([args[6] for args, _ in self.calls], [A, C])

    def test_disabled_equal_priority_unknown_active_and_recovery_never_scan(self):
        self.records[A]['value']['connection']['autoconnect'] = 'false'
        self.records[B]['public']['priority'] = 997
        for at in (0, 60, 120): self.tick(at)
        self.active = 'recovery-hotspot-uuid'
        self.tick(180)
        self.tick(240)
        self.scan_networks.assert_not_called()
        self.assertFalse(self.calls)

    def test_scan_failure_retains_current_and_requires_fresh_consecutive_scans(self):
        self.tick(0)
        self.tick(60)
        self.scan_networks.side_effect = OSError('scan failed')
        self.tick(120)
        self.assertEqual(self.active, C)
        self.scan_networks.side_effect = lambda _: self.scan
        self.tick(180)
        self.assertFalse(self.calls)
        self.tick(240)
        self.assertEqual(self.active, A)

    def test_revocation_or_active_connection_change_during_scan_cancels_promotion(self):
        self.tick(0)
        self.tick(60)
        def scan(_):
            self.allowed = False
            return self.scan
        self.scan_networks.side_effect = scan
        self.tick(120)
        self.assertFalse(self.calls)
        self.allowed = True
        self.roamer.seen = {A}
        def changed(_):
            self.active = B
            return self.scan
        self.scan_networks.side_effect = changed
        self.tick(180)
        self.assertFalse(self.calls)

    def test_reset_for_outage_or_hotspot_clears_scan_history(self):
        self.tick(0)
        self.tick(60)
        self.roamer.reset()
        self.tick(120)
        self.tick(180)
        self.assertFalse(self.calls)
        self.tick(240)
        self.assertEqual(self.active, A)

    def test_priority_edit_during_scan_prevents_stale_promotion(self):
        self.tick(0)
        self.tick(60)
        def scan(_):
            self.records[A] = record(A, 'Preferred', 996)
            self.records[B] = record(B, 'Second', 996)
            return self.scan
        self.scan_networks.side_effect = scan
        self.tick(120)
        self.assertFalse(self.calls)
        self.assertEqual(self.active, C)

    def test_failed_attempt_does_not_replace_an_already_working_fallback(self):
        self.tick(0)
        self.tick(60)
        def activate(*args, **kwargs):
            self.calls.append((args, kwargs))
            self.active = B
            raise OSError('NM already restored another working fallback')
        self.command.side_effect = activate
        self.tick(120)
        self.assertEqual(self.active, B)
        self.assertEqual([args[6] for args, _ in self.calls], [A])


class ScanTests(unittest.TestCase):
    def test_hex_scan_rows_preserve_exact_names_and_enforce_bounds(self):
        expected = [(' Office: west ', 70, ['WPA2']), ('Back\\up', 40, ['WPA3']), ('Caf\u00e9', 50, ['--'])]
        text = '\n'.join(f'{ssid.encode("utf-8").hex()}:{signal}:{" ".join(security)}' for ssid, signal, security in expected)
        rows = wifi.scan_rows(text + '\n426164:101:WPA2\ninvalid\nff:60:WPA2\n0a:50:--\n:50:--\n0:50:--')
        self.assertEqual(rows, expected)
        with self.assertRaises(ValueError): wifi.scan_rows('x' * 65537)
        with self.assertRaises(ValueError): wifi.scan_rows('a:50:WPA2\n' * 513)

    def test_security_matching_and_hidden_directed_scan(self):
        hidden = record(A, 'Hidden: office', 999, hidden=True)
        with patch.object(wifi, 'command', return_value=f'{"Hidden: office".encode().hex()}:60:WPA2') as command:
            result = wifi.scan_networks([hidden])
            command.assert_any_call('nmcli', 'device', 'wifi', 'rescan', 'ifname', 'wlan0', 'ssid', 'Hidden: office')
            command.assert_any_call('nmcli', '-t', '--escape', 'yes', '-f', 'SSID-HEX,SIGNAL,SECURITY',
                                    'device', 'wifi', 'list', 'ifname', 'wlan0', '--rescan', 'yes')
            self.assertTrue(wifi.scan_matches(hidden, result))
        self.assertFalse(wifi.scan_matches(hidden, [('Hidden: office', 60, ['WPA2', '802.1X'])]))
        hidden['public']['security'] = 'sae'
        self.assertTrue(wifi.scan_matches(hidden, [('Hidden: office', 60, ['WPA3'])]))
        hidden['public']['security'] = 'open'
        self.assertTrue(wifi.scan_matches(hidden, [('Hidden: office', 60, ['--'])]))
        self.assertFalse(wifi.scan_matches(hidden, [('Hidden: office', 60, ['WPA2'])]))

    def test_active_uuid_requires_connected_state_and_canonical_uuid(self):
        with patch.object(wifi, 'command', side_effect=['100 (connected)', A]):
            self.assertEqual(wifi.connected_uuid(), A)
        with patch.object(wifi, 'command', return_value='40 (connecting)') as command:
            self.assertIsNone(wifi.connected_uuid())
            self.assertEqual(command.call_count, 1)
        with patch.object(wifi, 'command', side_effect=['100 (connected)', '--']):
            self.assertIsNone(wifi.connected_uuid())


if __name__ == '__main__':
    unittest.main()
