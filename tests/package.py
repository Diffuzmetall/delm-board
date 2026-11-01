"""Inspect npm archive, install in a clean temporary directory, run documented entrypoints."""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
from rpc import RPC

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='delm-package-test-') as temporary:
        base = Path(temporary)
        home = base / 'home'; home.mkdir()
        env = dict(PATH=os.environ['PATH'], HOME=str(home), LANG='C.UTF-8', NO_COLOR='1',
                   PI_OFFLINE='1', PI_TELEMETRY='0')
        packed = subprocess.check_output(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', str(base)],
                                         cwd=ROOT, env=env, text=True)
        filename = json.loads(packed)[0]['filename']
        archive = base / filename
        with tarfile.open(archive) as package:
            names = package.getnames()
            required = ['package/bin/delm', 'package/board/scripts/delm_local.py',
                        'package/adapters/durable/index.mjs', 'package/adapters/durable/pi.mjs',
                        'package/board/vendor/DeLM/LICENSE', 'package/LICENSES/pi-native.txt',
                        'package/docs/verification.md']
            assert set(required).issubset(names)
            for member in package.getmembers():
                assert member.name.startswith('package/') and '..' not in Path(member.name).parts
                assert not member.issym() and not member.islnk()
                assert not any(part in member.name.split('/') for part in ['node_modules', '__pycache__', 'records', '.git']), member.name
                assert not member.name.endswith(('.pyc', '.sqlite', '.sqlite-wal', '.sqlite-shm', '.jsonl'))
                assert Path(member.name).name not in ('config.json', 'endpoint.json', 'auth.json')
                if member.isfile():
                    content = package.extractfile(member).read()
                    assert b'/home/ubuntu' not in content, member.name
                    assert b'host-lane/host' not in content, member.name
                    assert b'native14.js' not in content, member.name
            package.extractall(base, filter='data')
        installed = base / 'package'
        manifest = json.loads((installed / 'package.json').read_text())
        assert manifest['pi']['extensions'] == ['./adapters/durable/pi.mjs']
        result = subprocess.run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
                                cwd=installed, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        probe = RPC([str(installed / 'node_modules/.bin/pi'), '--mode', 'rpc', '--no-extensions',
                     '--no-skills', '--no-prompt-templates', '--no-themes', '--extension', str(installed)],
                    installed, env | {'PI_CODING_AGENT_DIR': str(home / '.pi/agent')})
        try:
            probe.command('get_state')
            probe.stderr.seek(0)
            assert b'Failed to load extension' not in probe.stderr.read()
        finally:
            probe.close()
        sdk_probe = installed / 'sdk-smoke.mjs'
        sdk_probe.write_text('''import assert from 'node:assert/strict';
import { createRegistry } from '@earendil-works/pi-durable';
import createAdapter from './adapters/durable/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const workspace=join(process.argv[2],'sdk-project'),run=join(process.argv[2],'sdk-run');
mkdirSync(workspace);
execFileSync('./bin/delm',['init',run,'--shared-workspace',workspace,'--n','2','--task','package SDK']);
const registry=createRegistry(), adapter=createAdapter({run,actor:'bob'});
registry.install(adapter);
assert.equal(registry.snapshot().extension('delm').tools.length,2);
registry.uninstall(adapter);
console.log('installed SDK live-registry factory PASS');
''')
        sdk = subprocess.check_output(['node', str(sdk_probe), str(base)], cwd=installed, env=env, text=True)
        rpc = subprocess.run(['python3', str(ROOT / 'tests/rpc.py')], cwd=installed,
                             env=dict(env, DELM_TEST_ROOT=str(installed)), capture_output=True, text=True)
        assert rpc.returncode == 0, rpc.stdout + rpc.stderr
        print(json.dumps({'result': 'PASS', 'archiveFiles': len(names), 'archiveHygiene': 'PASS',
            'freshOwnInstall': 'PASS', 'unconfiguredStockLoad': 'PASS', 'sdk': sdk.strip(), 'installedStockRPC': json.loads(rpc.stdout)}, indent=2))


if __name__ == '__main__':
    main()
