import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

export const project = new URL('../', import.meta.url).pathname;
export async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() > deadline) throw Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
export async function boardFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'delm-board-test-'));
  const workspace = join(directory, 'workspace'), run = join(directory, 'run');
  await mkdir(workspace);
  const cli = (...args) => execFileSync(join(project, 'bin/delm'), args, { encoding: 'utf8' });
  cli('init', run, '--shared-workspace', workspace, '--n', '2', '--task', 'private deterministic test');
  const server = spawn(join(project, 'bin/delm'), ['serve', run], { stdio: 'ignore' });
  await until(() => existsSync(join(run, 'endpoint.json')));
  const command = (actor, payload) => JSON.parse(cli('context', run, actor, 'domain', JSON.stringify(payload)));
  const task = command('alice', { op: 'create', request_id: 'create-input', subject: 'input', detail: 'required input' }).task;
  const claimed = command('alice', { op: 'claim', request_id: 'claim-input', item: task.id, expected_revision: task.revision }).task;
  return { directory, workspace, run, task: claimed, command,
    complete() { return command('alice', { op: 'complete', request_id: 'complete-input', item: claimed.id,
      expected_revision: claimed.revision, generation: claimed.generation, summary: 'verified input' }); },
    async close() {
      server.kill();
      await new Promise(resolve => server.once('close', resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
