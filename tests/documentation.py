"""Check repository and shipped onboarding links without loading a model."""
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    'README.md', 'AGENTS.md', 'prompts/setup.md', 'prompts/worker.md',
    'docs/architecture.md', 'docs/durable-sdk.md', 'docs/verification.md',
    'docs/publication.md', 'docs/evidence/acceptance.json',
)


def links(filename, body, exists):
    for target in re.findall(r'\[[^\]\n]*\]\(([^\s)]+)\)', body):
        parsed = urlsplit(target)
        if parsed.scheme or not parsed.path:
            continue
        path = posixpath.normpath((Path(filename).parent / unquote(parsed.path)).as_posix())
        assert exists(path), f'{filename}: missing link {target}'


def main():
    for name in REQUIRED:
        assert (ROOT / name).is_file(), name
    markdown = [p for p in ROOT.rglob('*.md')
                if 'node_modules' not in p.parts and '.git' not in p.parts]
    diagrams = 0
    for path in markdown:
        body = path.read_text()
        assert not any(ord(c) < 32 and c not in '\n\r\t' for c in body), path
        assert len(re.findall(r'^```', body, re.M)) % 2 == 0, f'{path}: unmatched fence'
        links(path.relative_to(ROOT), body, lambda target: (ROOT / target).resolve().is_file())
        diagrams += len(re.findall(r'^```mermaid\s*$', body, re.M))
    assert diagrams >= 2, 'architecture diagrams are missing'
    manifest = json.loads((ROOT / 'package.json').read_text())
    assert manifest['pi']['extensions'] == ['./adapters/durable/pi.mjs']
    assert manifest['exports']['./durable'] == './adapters/durable/index.mjs'
    for path in [ROOT / 'prompts/setup.md', ROOT / 'prompts/worker.md']:
        body = path.read_text()
        assert 'config.json' in body and 'ACK' in body and 'разреш' in body, path
        assert '/home/ubuntu' not in body, path
    with tempfile.TemporaryDirectory(prefix='delm-docs-home-') as home:
        env = dict(os.environ, HOME=home)
        data = json.loads(subprocess.check_output(
            ['npm', 'pack', '--dry-run', '--ignore-scripts', '--json'],
            cwd=ROOT, env=env, text=True))
    shipped = {record['path'] for record in data[0]['files']}
    assert set(REQUIRED).issubset(shipped), sorted(set(REQUIRED) - shipped)
    for name in shipped:
        if name.endswith('.md'):
            links(name, (ROOT / name).read_text(), lambda target: str(Path(target)) in shipped)
    print(json.dumps({'result': 'PASS', 'markdownFiles': len(markdown),
                      'mermaidDiagrams': diagrams, 'archiveFiles': len(shipped),
                      'repositoryAndArchiveLinks': 'PASS', 'agentPrompts': 'PASS'}))


if __name__ == '__main__':
    main()
