"""The board distribution needs only the Python standard library, not Node or host state."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'board/scripts'))
from delm_board import BoardView, clean


class BoundaryTest(unittest.TestCase):
    def test_empty_path_without_node_serves_fenced_tasks_and_read_ack(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            workspace = base / 'workspace'; workspace.mkdir()
            home = base / 'home'; home.mkdir()
            run = base / 'run'
            env = dict(PATH='', HOME=str(home), LANG='C.UTF-8')
            self.assertIsNone(shutil.which('node', path=env['PATH']))
            script = str(ROOT / 'board/scripts/delm_local.py')
            def invoke(*args):
                return subprocess.check_output([sys.executable, script, *map(str, args)], env=env, text=True)
            invoke('init', run, '--shared-workspace', workspace, '--n', '2', '--task', 'boundary')
            server = subprocess.Popen([sys.executable, script, 'serve', str(run)], env=env,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not (run / 'endpoint.json').exists():
                    self.assertIsNone(server.poll())
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(.02)
                def domain(payload):
                    return json.loads(invoke('context', run, 'alice', 'domain', json.dumps(payload)))
                task = domain(dict(op='create', request_id='create', subject='Python-only board', detail='no Node'))['task']
                self.assertEqual(task['state'], 'open')
                receipt = domain(dict(op='snapshot', request_id='read'))
                self.assertEqual(receipt, domain(dict(op='snapshot', request_id='read')))
                domain(dict(op='ack', request_id='ack', receipt_id=receipt['receipt_id']))
                self.assertEqual(domain(dict(op='pending'))['receipts'], [])
                before = (run / 'context.sqlite').read_bytes()
                view = subprocess.check_output([sys.executable, str(ROOT / 'board/scripts/delm_board.py'),
                                                str(run), '--once'], env=env, text=True)
                self.assertIn('Python-only board', view)
                self.assertEqual(before, (run / 'context.sqlite').read_bytes())
                self.assertFalse(list(run.rglob('delm-adapter*')))
            finally:
                server.terminate(); server.wait(timeout=5)

    def test_inherited_terminal_view_sanitizes_and_exposes_full_details(self):
        self.assertNotIn('\x1b', clean('unsafe\x1b[2J'))
        view = BoardView()
        row = dict(id='task', subject='Useful output', state='open', owner='-', detail='full detail tail',
                   criteria=['exact output'], waited_by=[])
        data = dict(tasks=[row], notes=[], events=[], leases=[])
        self.assertEqual(view.rows(data), [row])
        document = view.document(row, data)
        self.assertIn('full detail tail', document)
        self.assertIn('exact output', document)
        view.query = 'no match'
        self.assertEqual(view.rows(data), [])


if __name__ == '__main__':
    unittest.main()
