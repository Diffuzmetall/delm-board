"""Actual installed npm bundle/RPC + deterministic loopback model + real Python board."""
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time

from deterministic_provider import DeterministicProvider

ROOT = Path(os.environ.get('DELM_TEST_ROOT', Path(__file__).resolve().parents[1])).resolve()
CLI = ROOT / 'node_modules/.bin/pi'


def until(check, timeout=15):
    deadline = time.monotonic() + timeout
    while not check():
        if time.monotonic() > deadline:
            raise TimeoutError('condition timed out')
        time.sleep(.02)


class RPC:
    def __init__(self, command, cwd, env):
        self.stderr = tempfile.TemporaryFile()
        self.process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr)
        self.events = []
        self.records = queue.Queue()
        self.counter = 0
        def reader():
            for line in self.process.stdout:
                self.records.put(json.loads(line))
        self.reader = threading.Thread(target=reader, daemon=True)
        self.reader.start()

    def wait(self, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                item = self.records.get(timeout=.1)
            except queue.Empty:
                if self.process.poll() is not None:
                    self.stderr.seek(0)
                    raise AssertionError(self.stderr.read().decode())
                continue
            self.events.append(item)
            if predicate(item):
                return item
        self.stderr.seek(0)
        raise TimeoutError('RPC record timeout; stderr=' + self.stderr.read().decode())

    def command(self, kind, **args):
        self.counter += 1
        request = dict(type=kind, id=str(self.counter), **args)
        self.process.stdin.write(json.dumps(request).encode() + b'\n')
        self.process.stdin.flush()
        answer = self.wait(lambda event: event.get('type') == 'response' and event.get('id') == request['id'])
        assert answer['success'], answer
        return answer.get('data', {})

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=5)
        self.reader.join(timeout=2)
        self.stderr.close()


def main():
    assert str(CLI.resolve()).endswith('/pi-coding-agent/dist/bundle/cli.js')
    with tempfile.TemporaryDirectory(prefix='delm-stock-rpc-') as temporary:
        base = Path(temporary)
        home = base / 'home'; home.mkdir()
        workspace = base / 'workspace'; workspace.mkdir()
        run = base / 'run'
        env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'LANG': 'C.UTF-8', 'TERM': 'dumb',
               'PI_CODING_AGENT_DIR': str(home / '.pi/agent'), 'NO_COLOR': '1'}
        def cli(*args):
            return subprocess.check_output([str(ROOT / 'bin/delm'), *map(str, args)], env=env, text=True)
        cli('init', run, '--shared-workspace', workspace, '--n', '2', '--task', 'deterministic RPC fixture')
        before = cli('connect', 'pi', run)
        assert before == cli('connect', 'pi', run)
        assert not (run / 'bob/pi-session.jsonl').exists(), 'connect must not launch Pi'
        board = subprocess.Popen([str(ROOT / 'bin/delm'), 'serve', str(run)], env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rpc = None
        try:
            until(lambda: (run / 'endpoint.json').exists())
            def domain(actor, payload):
                return json.loads(cli('context', run, actor, 'domain', json.dumps(payload)))
            task = domain('alice', dict(op='create', request_id='input', subject='input', detail='required input'))['task']
            task = domain('alice', dict(op='claim', request_id='claim', item=task['id'], expected_revision=task['revision']))['task']
            with DeterministicProvider() as provider:
                agent = home / '.pi/agent'; agent.mkdir(parents=True)
                (agent / 'models.json').write_text(json.dumps(provider.models_config()))
                (agent / 'settings.json').write_text(json.dumps({'compaction': {'enabled': False},
                    'retry': {'enabled': False}}))
                command = [str(CLI), '--mode', 'rpc', '--provider', 'fixture', '--model', 'deterministic',
                    '--thinking', 'off', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes',
                    '--no-context-files', '--no-builtin-tools', '--extension', str(run / 'bob/delm-pi.mjs'),
                    '--session', str(run / 'bob/pi-session.jsonl')]
                rpc = RPC(command, workspace, env)
                state = rpc.command('get_state')
                assert state['sessionFile'] == str(run / 'bob/pi-session.jsonl')
                def call(tool, arguments, expect_error=False):
                    with provider.lock:
                        provider.replies.extend([dict(tool=tool, arguments=arguments), dict(text='TOOL_CYCLE_COMPLETE')])
                    start = len(rpc.events)
                    rpc.command('prompt', message='fixture board operation')
                    rpc.wait(lambda e: e.get('type') == 'agent_settled')
                    results = [e for e in rpc.events[start:] if e.get('type') == 'tool_execution_end' and e.get('toolName') == tool]
                    assert results, rpc.events[start:]
                    value = results[-1]['result']
                    assert bool(results[-1].get('isError', value.get('isError', False))) == expect_error, value
                    return value
                projection = call('delm_board', {'request': {'op': 'projection'}})
                assert task['id'] in json.dumps(projection)
                start = time.monotonic()
                armed = call('delm_wait', dict(action='wait', items=[task['id']], reason='RPC exact input'))
                elapsed = time.monotonic() - start
                assert elapsed < 3, elapsed
                entry = armed['details']['wait']; assert entry['state'] == 'armed'
                domain('alice', dict(op='complete', request_id='complete', item=task['id'],
                    expected_revision=task['revision'], generation=task['generation'], summary='verified input'))
                rpc.wait(lambda e: e.get('type') == 'message_end' and e.get('message', {}).get('role') == 'user'
                         and f"delm-pi:{entry['id']}:1" in json.dumps(e))
                rpc.wait(lambda e: e.get('type') == 'agent_settled')
                pending = domain('bob', {'op': 'pending'})['receipts']; assert len(pending) == 1
                receipt = pending[0]
                read = call('delm_board', {'request': {'op': 'snapshot', 'request_id': receipt['request_id']}})
                assert read['details']['receipt_id'] == receipt['receipt_id']
                call('delm_board', {'request': {'op': 'ack', 'request_id': 'read-ack', 'receipt_id': receipt['receipt_id']}})
                assert not domain('bob', {'op': 'pending'})['receipts']
                task2 = domain('alice', dict(op='create', request_id='next-input', subject='next input', detail='next'))['task']
                call('delm_wait', dict(action='wait', items=[task2['id']], reason='second cycle'))
                fork_messages = rpc.command('get_fork_messages')['messages']
                rpc.command('fork', entryId=fork_messages[-1]['entryId'])
                call('delm_wait', {'action': 'status'}, expect_error=True)
                rpc.command('switch_session', sessionPath=str(run / 'bob/pi-session.jsonl'))
                restored = call('delm_wait', {'action': 'status'})
                assert restored['details']['wait']['state'] == 'armed'
                call('delm_wait', {'action': 'cancel'})
                assert set(['delm_board', 'delm_wait']).issubset(provider.tool_names)
                summary = {'result': 'PASS', 'publicVersion': '1.4.0', 'binary': 'pi-coding-agent/dist/bundle/cli.js',
                    'checks': ['repeat-connect-no-model', 'real-extension-loader', 'model-board-projection',
                        'nonblocking-arm', 'event-follow-up', 'snapshot-read-ACK', 'new-wait-cycle',
                        'RPC-fork-refusal', 'RPC-switch-restore', 'cancel', 'orderly-shutdown'],
                    'waitCycleSeconds': round(elapsed, 3), 'loopbackModelRequests': provider.requests,
                    'lifecycleScope': 'tree/reload/uncertain-send seams separately use genuine AgentSession API'}
                rpc.close(); rpc = None
                print(json.dumps(summary, indent=2))
        finally:
            if rpc: rpc.close()
            board.terminate(); board.wait(timeout=5)


if __name__ == '__main__':
    main()
