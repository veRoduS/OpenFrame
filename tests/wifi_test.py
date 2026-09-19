import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / 'player'))
import wifi

FIRST = '12345678-1234-1234-1234-123456789abc'
SECOND = '12345678-1234-1234-1234-123456789abd'


class WifiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.directory = self.root / 'connections'
        self.directory.mkdir()
        for name, value in [('DIRECTORY', self.directory), ('SETTINGS', self.root / 'wifi.json')]:
            patcher = patch.object(wifi, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(wifi, 'command', return_value='')
        self.command = patcher.start()
        self.addCleanup(patcher.stop)

    def seed(self, identifier=FIRST, ssid='Office', priority=0, security='wpa-psk', mode='infrastructure', interface='wlan0'):
        text = f'[connection]\nid=existing\nuuid={identifier}\ntype=wifi\ninterface-name={interface}\nautoconnect-priority={priority}\n[wifi]\nmode={mode}\nssid={ssid}\n[ipv4]\nmethod=manual\naddress1=192.0.2.10/24,192.0.2.1\n'
        if security != 'open':
            text += f'[wifi-security]\nkey-mgmt={security}\npsk=fake-original-password\n'
        path = self.directory / f'{identifier}.nmconnection'
        path.write_text(text, encoding='utf-8')
        return path

    def body(self, networks=None):
        snapshot = wifi.snapshot()
        rows = [{key: row[key] for key in ('id', 'ssid', 'security', 'hidden')} for row in snapshot['networks']]
        return dict(revision=snapshot['revision'], country='US', networks=rows if networks is None else networks)

    def new(self, ssid='Backup', **extra):
        return dict(id=None, ssid=ssid, security='wpa-psk', hidden=False, password='fake-new-password', **extra)

    def test_inventory_adopts_existing_profiles_without_returning_secrets(self):
        self.seed(priority=1)
        self.seed(SECOND, 'Backup', priority=5, security='open')
        state = wifi.snapshot()
        self.assertEqual([row['ssid'] for row in state['networks']], ['Backup', 'Office'])
        self.assertEqual(state['networks'][1]['hasPassword'], True)
        self.assertNotIn('fake-original-password', json.dumps(state))
        self.assertNotIn('psk', state['networks'][1])
        self.assertEqual(len(state['revision']), 64)

    def test_save_reorders_preserves_password_and_static_ip_and_persists_reboot_state(self):
        first = self.seed()
        body = self.body()
        body['networks'].insert(0, self.new())
        result = wifi.save(body)
        self.assertEqual([row['priority'] for row in result['networks']], [999, 998])
        self.assertEqual([row['ssid'] for row in wifi.snapshot()['networks']], ['Backup', 'Office'])
        saved = wifi.parser(first.read_text())
        self.assertEqual(saved['wifi-security']['psk'], 'fake-original-password')
        self.assertEqual(saved['ipv4']['method'], 'manual')
        self.assertEqual(saved['ipv4']['address1'], '192.0.2.10/24,192.0.2.1')
        self.assertEqual(saved['connection']['autoconnect-retries'], '1')
        self.assertEqual(saved['connection']['autoconnect'], 'true')
        self.assertNotEqual(result['revision'], body['revision'])
        self.assertEqual(result['country'], 'US')
        self.assertNotIn('fake-new-password', repr(self.command.call_args_list))
        self.assertNotIn('do_wifi_country', repr(self.command.call_args_list))

    def test_hidden_open_and_special_character_ssids_round_trip(self):
        for ssid in ['Office: West; = #', '  Leading space  ', 'Cafe\\guest', '\u00c9tage']:
            row = dict(id=None, ssid=ssid, security='open', hidden=True)
            state = wifi.save(self.body([row]))
            self.assertEqual(state['networks'][0]['ssid'], ssid)
            self.assertTrue(state['networks'][0]['hidden'])
            self.assertFalse(state['networks'][0]['hasPassword'])
            self.assertEqual(wifi.inventory()[state['networks'][0]['id']]['value']['ipv4']['method'], 'auto')

    def test_replacing_password_uses_private_file_not_command_arguments(self):
        self.seed()
        body = self.body()
        body['networks'][0]['password'] = ' a\\complex;=password '
        with patch.object(wifi, 'atomic_write', wraps=wifi.atomic_write) as write:
            wifi.save(body)
        value = wifi.inventory()[FIRST]['value']['wifi-security']['psk']
        self.assertEqual(wifi.unescape(value), body['networks'][0]['password'])
        self.assertNotIn(body['networks'][0]['password'], repr(self.command.call_args_list))
        self.assertTrue(all(call.args[2] == 0o600 for call in write.call_args_list))

    def test_switch_to_open_clears_secret_and_delete_is_explicit_from_full_list(self):
        first = self.seed()
        second = self.seed(SECOND, 'Backup')
        body = self.body()
        body['networks'] = [next(row for row in body['networks'] if row['id'] == FIRST)]
        body['networks'][0]['security'] = 'open'
        wifi.save(body)
        self.assertNotIn('wifi-security', wifi.parser(first.read_text()))
        self.assertFalse(second.exists())
        self.command.assert_any_call('nmcli', 'connection', 'delete', 'uuid', SECOND)

    def test_unmanaged_ap_other_adapter_and_enterprise_profiles_are_untouched(self):
        self.seed()
        ap = self.seed(SECOND, 'Recovery', mode='ap')
        external = self.directory / 'ethernet.nmconnection'
        external.write_text('[connection]\ntype=ethernet\n')
        before = ap.read_bytes(), external.read_bytes()
        wifi.save(self.body())
        self.assertEqual(before, (ap.read_bytes(), external.read_bytes()))
        self.seed(SECOND, 'Enterprise', security='wpa-eap')
        self.assertEqual(list(wifi.inventory()), [FIRST])
        self.seed(SECOND, 'USB adapter', interface='wlan1')
        self.assertEqual(list(wifi.inventory()), [FIRST])

    def test_stale_revision_rejected_before_any_mutation(self):
        path = self.seed()
        body = self.body()
        path.write_text(path.read_text() + '\n# external change\n')
        with self.assertRaises(wifi.Conflict):
            wifi.save(body)
        self.command.assert_not_called()

    def test_invalid_batch_changes_nothing(self):
        path = self.seed()
        original = path.read_bytes()
        invalid = [[], [self.new('x' * 33)],
                   [dict(id=None, ssid='Backup', security='wpa-psk', hidden=False)],
                   [dict(self.new(), password='short')], [dict(self.new(), password='bad\npassword')],
                   [dict(self.new(), id='../../elsewhere')], [self.new('Office'), self.new('Office')],
                   [dict(self.new(), hidden='true')], [dict(self.new(), extra='bad')],
                   [self.new(str(i)) for i in range(21)]]
        for rows in invalid:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                wifi.save(self.body(rows))
            self.assertEqual(path.read_bytes(), original)
        self.command.assert_not_called()

    def test_load_failure_rolls_back_files_and_does_not_forget_old_profiles(self):
        path = self.seed()
        original = path.read_text()
        body = self.body()
        body['networks'].append(self.new())
        self.command.side_effect = lambda *args: (_ for _ in ()).throw(OSError()) if 'load' in args else ''
        with self.assertRaises(RuntimeError):
            wifi.save(body)
        self.assertEqual(path.read_text(), original)
        self.assertEqual(list(wifi.inventory()), [FIRST])
        self.assertFalse(wifi.SETTINGS.exists())

    def test_country_only_applies_at_reconnect(self):
        wifi.save(self.body([self.new()]))
        self.assertNotIn('raspi-config', repr(self.command.call_args_list))
        wifi.apply_country()
        self.command.assert_called_with('raspi-config', 'nonint', 'do_wifi_country', 'US')

    def test_duplicate_identity_fails_closed(self):
        path = self.seed()
        (self.directory / 'duplicate.nmconnection').write_bytes(path.read_bytes())
        with self.assertRaises(ValueError):
            wifi.snapshot()


if __name__ == '__main__':
    unittest.main()
