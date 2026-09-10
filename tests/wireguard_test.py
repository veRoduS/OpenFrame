import base64
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / 'player' / 'wireguard.py'
spec = importlib.util.spec_from_file_location('wireguard', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PRIVATE_KEY = base64.b64encode(bytes(range(32))).decode()
PUBLIC_KEY = base64.b64encode(bytes(range(32, 64))).decode()
CLIENT = f'''[Interface]
PrivateKey = {PRIVATE_KEY}
Address = 10.8.0.2/32

[Peer]
PublicKey = {PUBLIC_KEY}
AllowedIPs = 10.8.0.1/32, 192.168.50.10/32
Endpoint = vpn.example.com:51820
PersistentKeepalive = 25
'''


class WireGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.config = self.directory / 'openframe.json'
        self.config.write_text('{"server":"http://10.8.0.1:3100"}')
        self.source = self.directory / module.DROP_IN
        for name in ('CONFIG', 'OVERRIDE', 'NETWORK_MANAGER'):
            mock = patch.object(module, name, self.directory / 'installed' / name)
            mock.start()
            self.addCleanup(mock.stop)

    def cli(self, *arguments):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, arguments)], capture_output=True, text=True, timeout=15)

    def test_without_drop_in_existing_lan_and_cloudflare_setup_is_unchanged(self):
        self.assertIsNone(module.source_config(self.config))
        result = self.cli('check', self.config)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), 'direct')
        self.assertFalse(module.CONFIG.exists())

    def test_windows_export_and_comments_are_normalized_without_logging_keys(self):
        self.source.write_bytes(('\ufeff# private export\r\n' + CLIENT.replace('\n', '\r\n')).encode('utf-8'))
        path, content = module.source_config(self.config)
        self.assertEqual(path, self.source)
        self.assertIn('PrivateKey = ' + PRIVATE_KEY, content)
        self.assertNotIn('\r', content)
        result = self.cli('check', self.config)
        self.assertEqual(result.stdout.strip(), 'wireguard')
        self.assertNotIn(PRIVATE_KEY, result.stdout + result.stderr)
        self.assertFalse(module.CONFIG.exists())

    def test_multiple_peers_repeated_addresses_and_full_tunnel_are_preserved(self):
        text = CLIENT.replace('Address = 10.8.0.2/32', 'Address = 10.8.0.2/32\nAddress = fd00::2/128')
        text += f'\n[Peer]\nPublicKey = {PUBLIC_KEY}\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = [2001:db8::1]:51820\n'
        normalized = module.validate(text)
        self.assertEqual(normalized.count('[Peer]'), 2)
        self.assertIn('AllowedIPs = 0.0.0.0/0, ::/0', normalized)
        self.assertIn('Address = fd00::2/128', normalized)

    def test_dns_dependency_only_requested_for_dns_directive(self):
        self.source.write_text(CLIENT.replace('[Interface]', '[Interface]\nDNS = 10.8.0.1, home.example'))
        result = self.cli('check', self.config)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), 'wireguard-dns')

    def test_shell_hooks_and_saveconfig_cannot_be_executed(self):
        for field in ('PreUp', 'PostUp', 'PreDown', 'PostDown', 'postup', 'SaveConfig'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.validate(CLIENT.replace('[Interface]', '[Interface]\n' + field + ' = true'))
        self.assertIn('SaveConfig = false', module.validate(CLIENT.replace('[Interface]', '[Interface]\nSaveConfig = false')))

    def test_missing_fields_bad_keys_unknown_fields_and_sections_fail(self):
        cases = [
            '', CLIENT.replace('[Interface]', '[Peer]'), CLIENT + '\n[Interface]\n',
            CLIENT.replace('PrivateKey', 'UnknownKey'), CLIENT.replace(PRIVATE_KEY, 'SECRET-BUT-INVALID'),
            CLIENT.replace('Address = 10.8.0.2/32', ''), CLIENT.replace('Endpoint = vpn.example.com:51820', ''),
            CLIENT.replace('[Peer]', '[Untrusted]'), CLIENT + '\nPrivateKey = extra\n',
            CLIENT.replace('AllowedIPs = 10.8.0.1/32, 192.168.50.10/32', ''),
            CLIENT.replace('[Interface]', '[Interface]\nMTU = 1420\x00'),
        ]
        for content in cases:
            with self.subTest(content=cases.index(content)), self.assertRaises(ValueError):
                module.validate(content)

    def test_invalid_config_cli_does_not_echo_secret_values(self):
        self.source.write_text(CLIENT.replace(PRIVATE_KEY, 'SECRET-BUT-INVALID'))
        result = self.cli('check', self.config)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('SECRET-BUT-INVALID', result.stdout + result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_oversize_non_text_and_directory_drop_ins_fail(self):
        for data in (b'x' * (module.MAX_SIZE + 1), b'\xff\xff'):
            self.source.write_bytes(data)
            with self.assertRaises(ValueError):
                module.source_config(self.config)
        self.source.unlink()
        self.source.mkdir()
        with self.assertRaises(ValueError):
            module.source_config(self.config)

    def test_symbolic_link_drop_in_is_rejected_even_if_dangling(self):
        with patch.object(Path, 'is_symlink', return_value=True), self.assertRaises(ValueError):
            module.source_config(self.config)

    def test_staging_copies_drop_in_beside_boot_json_without_touching_source(self):
        original = '# original comment\n' + CLIENT
        self.source.write_text(original)
        destination = self.directory / 'boot'
        result = self.cli('stage', self.config, '--destination', destination)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((destination / module.DROP_IN).read_text(), module.validate(CLIENT))
        self.assertEqual(self.source.read_text(), original)
        self.assertEqual(self.config.read_text(), '{"server":"http://10.8.0.1:3100"}')

    def test_install_creates_private_config_and_scoped_service_settings(self):
        with patch.object(module.subprocess, 'run') as run, patch.object(module.os, 'chmod', wraps=os.chmod) as chmod:
            module.install(module.validate(CLIENT))
        run.assert_not_called()
        self.assertEqual(module.CONFIG.read_text(), module.MANAGED + module.validate(CLIENT))
        self.assertEqual([call.args[1] for call in chmod.call_args_list], [0o600, 0o644, 0o644])
        self.assertIn('Restart=on-failure', module.OVERRIDE.read_text())
        self.assertIn('WG_ENDPOINT_RESOLUTION_RETRIES=2', module.OVERRIDE.read_text())
        self.assertIn('StartLimitIntervalSec=0', module.OVERRIDE.read_text())
        self.assertIn('interface-name:wg-openframe\nmanaged=0', module.NETWORK_MANAGER.read_text())
        self.assertEqual(list(module.CONFIG.parent.glob('.openframe-*')), [])

    def test_reinstall_stops_only_own_tunnel_with_old_config_before_replacing(self):
        module.install(module.validate(CLIENT))
        replacement = module.validate(CLIENT.replace('10.8.0.2/32', '10.8.0.3/32'))

        def stop(command, **kwargs):
            self.assertEqual(command, ['systemctl', 'stop', module.SERVICE])
            self.assertIn('Address = 10.8.0.2/32', module.CONFIG.read_text())

        with patch.object(module.subprocess, 'run', side_effect=stop) as run:
            module.install(replacement)
            run.assert_called_once()
        self.assertIn('Address = 10.8.0.3/32', module.CONFIG.read_text())

    def test_unmanaged_destinations_are_never_overwritten_or_stopped(self):
        module.CONFIG.parent.mkdir()
        module.NETWORK_MANAGER.write_text('existing administrator configuration')
        with patch.object(module.subprocess, 'run') as run, self.assertRaises(ValueError):
            module.install(module.validate(CLIENT))
        run.assert_not_called()
        self.assertFalse(module.CONFIG.exists())
        self.assertEqual(module.NETWORK_MANAGER.read_text(), 'existing administrator configuration')

    def test_failed_stop_or_atomic_write_preserves_existing_config(self):
        module.install(module.validate(CLIENT))
        original = module.CONFIG.read_text()
        with patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'systemctl')), self.assertRaises(subprocess.SubprocessError):
            module.install(module.validate(CLIENT.replace('10.8.0.2', '10.8.0.3')))
        self.assertEqual(module.CONFIG.read_text(), original)
        with patch.object(module.os, 'replace', side_effect=OSError('disk full')), self.assertRaises(OSError):
            module.atomic_write(module.CONFIG, 'replacement')
        self.assertEqual(module.CONFIG.read_text(), original)
        self.assertEqual(list(module.CONFIG.parent.glob('.openframe-*')), [])

    def test_boot_cleanup_requires_matching_installed_copy_and_leaves_other_files(self):
        self.source.write_text(CLIENT)
        source = module.source_config(self.config)
        with self.assertRaises(ValueError):
            module.clean_boot(source)
        self.assertTrue(self.source.exists())
        module.install(source[1])
        module.clean_boot(source)
        self.assertFalse(self.source.exists())
        self.assertTrue(module.CONFIG.exists())
        self.assertTrue(self.config.exists())
        self.assertIsNone(module.source_config(self.config))

    def test_all_provisioning_paths_include_drop_in_and_playback_does_not_wait_for_vpn(self):
        install = (ROOT / 'player' / 'install.sh').read_text()
        build = (ROOT / 'player' / 'build-image.sh').read_text()
        firstboot = (ROOT / 'player' / 'firstboot.sh').read_text()
        self.assertLess(install.index('wireguard.py" check'), install.index('apt-get update'))
        self.assertIn('wireguard-tools', install)
        self.assertIn('openresolv', install)
        self.assertIn('systemctl --no-block restart wg-quick@wg-openframe.service', install)
        agent_unit = install.split("openframe-agent.service <<'SERVICE'", 1)[1].split('\nSERVICE', 1)[0]
        self.assertNotIn('wg-quick', agent_unit)
        self.assertNotIn('network-online.target', agent_unit)
        self.assertIn('"$source_dir/wireguard.py"', build)
        self.assertIn('wireguard.py" stage', build)
        self.assertLess(firstboot.index('bash /opt/openframe/install.sh'), firstboot.index('wireguard.py clean-boot'))
        for name in ('.gitignore', '.dockerignore'):
            self.assertIn('*.conf', (ROOT / name).read_text().splitlines())


if __name__ == '__main__':
    unittest.main()
