import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit_agent', Path(__file__).parents[1] / 'player' / 'agent.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


class AtomicJsonTests(unittest.TestCase):
    def test_symlink_destinations_and_old_temporary_names_do_not_redirect_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'dummy-target.json'
            target.write_text('untouched fixture')
            path = root / 'identity.json'
            path.symlink_to(target)
            path.with_suffix('.tmp').symlink_to(target)
            agent.atomic_json(path, {'fixture': True})
            self.assertEqual(target.read_text(), 'untouched fixture')
            self.assertFalse(path.is_symlink())
            self.assertEqual(json.loads(path.read_text()), {'fixture': True})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob('.openframe-*')), [])

    def test_failed_write_preserves_original_and_cleans_up_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'state.json'
            path.write_text('original fixture')
            with self.assertRaises(TypeError):
                agent.atomic_json(path, {'invalid': object()})
            self.assertEqual(path.read_text(), 'original fixture')
            self.assertEqual(list(root.glob('.openframe-*')), [])
