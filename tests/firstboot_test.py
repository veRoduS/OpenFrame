import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = (Path(__file__).parents[1] / 'player' / 'firstboot.sh').read_text()
WIFI_SETUP = SOURCE.split("<<'PY'\n", 1)[1].split('\nPY', 1)[0]


class FirstBootTests(unittest.TestCase):
    def execute(self, config, runner):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.json'
            path.write_text(json.dumps(config))
            output = io.StringIO()
            with patch.object(sys, 'argv', ['fixture', str(path)]), patch.object(subprocess, 'run', side_effect=runner) as run, contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    exec(compile(WIFI_SETUP, 'firstboot-wifi', 'exec'), {})
                except SystemExit as result:
                    return result.code, output.getvalue(), run
            return 0, output.getvalue(), run

    def test_wifi_failures_never_print_command_arguments_or_diagnostics(self):
        password = 'synthetic-wifi-password'
        def failure(args, **kwargs):
            self.assertTrue(kwargs['capture_output'])
            if 'connect' in args:
                raise subprocess.CalledProcessError(10, args, output=password, stderr=password)
            return subprocess.CompletedProcess(args, 0)
        status, output, _ = self.execute({'wifi_ssid': 'Fixture', 'wifi_password': password}, failure)
        self.assertEqual(status, 1)
        self.assertIn('Wi-Fi connection failed', output)
        self.assertNotIn(password, output)
        self.assertNotIn('Traceback', output)

    def test_missing_wifi_tools_are_sanitized_and_successful_setup_continues(self):
        def failure(*args, **kwargs):
            raise OSError('synthetic sensitive diagnostic')
        status, output, _ = self.execute({'wifi_ssid': 'Fixture'}, failure)
        self.assertEqual(status, 1)
        self.assertNotIn('synthetic sensitive diagnostic', output)
        status, output, run = self.execute({'wifi_ssid': 'Fixture', 'wifi_country': 'US'}, lambda *args, **kwargs: subprocess.CompletedProcess(args, 0))
        self.assertEqual(status, 0)
        self.assertEqual(output, '')
        self.assertEqual(run.call_count, 3)
