import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { Harness, createRegistry, defineTask, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createDurableAdapter as createDelmWait, DelmWaitDoc, wakeRequestId, cancelAndDrain } from '../adapters/durable/index.mjs';
import { readBoard } from '../adapters/durable/board.mjs';
import { boardFixture } from './fixture.mjs';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

const project = new URL('../', import.meta.url).pathname;
async function until(check) {
  const deadline = Date.now() + 8000;
  while (!await check()) {
    if (Date.now() > deadline) throw Error('condition timed out');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
async function fixture({ nativeAdmission = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'delm-native-'));
  const source = join(directory, 'source'), run = join(directory, 'board');
  await mkdir(source); await writeFile(join(source, 'sample.txt'), 'baseline');
  execFileSync('python3', [join(project, 'board/scripts/delm_local.py'), 'init', run, '--source', source, '--task', 'fixture']);
  const board = expression => JSON.parse(execFileSync('python3', ['-c',
    `import sys,json;sys.path.insert(0,${JSON.stringify(join(project, 'board/scripts'))});from delm_local import board;from pathlib import Path;b=board(Path(${JSON.stringify(run)}));print(json.dumps(${expression}))`], { encoding: 'utf8' }));
  const item = board("b.reserve('alice','required dependency','fixture')").item;
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const registry = createRegistry(), admissions = [];
  let deny = false;
  registry.install(createDelmWait({ run, actor: 'bob', ...(!nativeAdmission ? { admitInput: async (_conversation, id) => {
    admissions.push(id); if (deny) throw Error('revoked');
  } } : {}) }));
  const path = join(directory, 'native.sqlite');
  let host, root; const workspace = join(run, 'bob/workspace');
  async function open() {
    host = await Harness.open(await openNodeSqliteStorage(path), { registry, models }, context);
    root = await host.root(context, { agent: { model: { provider: 'faux', modelId: 'faux-1' }, cwd: workspace } });
    host.resume();
  }
  await open();
  const doc = () => host.snapshot(DelmWaitDoc, root.id, context);
  const tool = registry.snapshot().extension('delm').tools[0];
  async function direct(args, key='direct-test', conversationId=root.id) {
    return tool.execute(args, { taskId: key, callId: key, conversationId,
      commit: fn => host.commit(fn, context), agent: () => root.agent(context) }, context);
  }
  return { directory, run, item, board, faux, admissions, registry, doc, direct,
    get host() { return host; }, get root() { return root; }, deny: () => { deny = true; },
    async arm() {
      faux.setResponses([fauxAssistantMessage(fauxToolCall('delm_wait', { action: 'wait', items: [item], reason: 'need exact task' }), { stopReason: 'toolUse' }), fauxAssistantMessage('waiting')]);
      const submission = await root.submit({ type: 'input', content: 'arm wait' }, context);
      await submission.wait(context);
      const entry = Object.values((await doc()).waits)[0]; assert.equal(entry.state, 'waiting'); return entry;
    },
    done() { return board(`b.done('alice',${JSON.stringify(item)},'verified fixture complete')`); },
    async reopen() { await host.close(context); await open(); },
    async close() { await host.close(context); await rm(directory, { recursive: true, force: true }); },
  };
}

test('native registry refuses missing binding; no importer starts services', () => {
  assert.throws(() => createDelmWait({}), /binding requires run and actor/);
});

test('native SDK admission delivers same-conversation wake without an author-private policy', async () => {
  const f = await fixture({ nativeAdmission: true });
  try {
    const entry = await f.arm();
    f.faux.setResponses([fauxAssistantMessage('native admitted wake')]);
    f.done();
    await until(async () => (await f.doc()).waits[entry.id].state === 'sent');
    const accepted = await f.host.commit(tx => tx.submissionByRequest(f.root.id, wakeRequestId(entry.taskId)), context);
    assert.equal(accepted.conversationId, f.root.id);
    assert.equal(accepted.type, 'input');
    assert.equal(f.admissions.length, 0);
  } finally { await f.close(); }
});

test('real SDK SQLite + faux model: exact dependency wake in same conversation; unrelated events ignored', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm();
    const before = readBoard(f.run).sequence;
    f.board("b.note('alice','FACT','unrelated progress','other','test')");
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(f.admissions.length, 0);
    assert.equal((await f.doc()).waits[entry.id].state, 'waiting');
    f.faux.setResponses([fauxAssistantMessage('resumed exact dependency')]);
    f.done();
    await until(async () => (await f.doc()).waits[entry.id].state === 'sent');
    const receipt = await f.host.commit(tx => tx.submissionByRequest(f.root.id, wakeRequestId(entry.taskId)), context);
    assert.ok(receipt); assert.equal(receipt.conversationId, f.root.id);
    assert.equal(f.admissions.length, 1);
    f.board("b.note('alice','FACT','later progress','other','test')");
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(f.admissions.length, 1);
    assert.ok(readBoard(f.run).sequence > before);
  } finally { await f.close(); }
});

test('ready at arm, invalid dependency, cross-conversation and cancellation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.direct({ action: 'wait', items: ['missing'], reason: 'no' }), /Unknown/);
    const sibling = await f.host.createConversation({ ownership: { kind: 'ownerless' } }, context);
    await assert.rejects(f.direct({ action: 'status' }, 'foreign', sibling.id), /root conversation/);
    const result = await f.direct({ action: 'wait', items: [f.item], reason: 'dependency' });
    const entry = result.structuredOutput.result;
    const replay = await f.direct({ action: 'wait', items: [f.item], reason: 'dependency' });
    assert.equal(replay.structuredOutput.result.id, entry.id);
    await assert.rejects(f.direct({ action: 'wait', items: [f.item], reason: 'duplicate' }, 'second'), /already active/);
    await f.direct({ action: 'cancel', id: entry.id }, 'cancel');
    f.done();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.admissions.length, 0);
    assert.equal((await f.doc()).waits[entry.id].state, 'cancelled');
    const ready = await f.direct({ action: 'wait', items: [f.item], reason: 'already done' }, 'ready');
    assert.equal(ready.structuredOutput.result.readyNow, true);
    assert.equal(Object.keys((await f.doc()).waits).length, 1);
  } finally { await f.close(); }
});

test('reopen persisted native watch, same request identity, no duplicate wake after second reopen', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm();
    await f.reopen();
    assert.equal((await f.doc()).waits[entry.id].state, 'waiting');
    f.faux.setResponses([fauxAssistantMessage('resumed after reopen')]); f.done();
    await until(async () => (await f.doc()).waits[entry.id].state === 'sent');
    assert.equal(f.admissions.length, 1);
    await f.reopen();
    const receipt = await f.host.commit(tx => tx.submissionByRequest(f.root.id, wakeRequestId(entry.taskId)), context);
    assert.ok(receipt); assert.equal(f.admissions.length, 1);
  } finally { await f.close(); }
});

test('temporary SQLite writer lock keeps the native wait armed and wakes after unlock', async () => {
  const f = await fixture(); let writer;
  try {
    const entry = await f.arm();
    writer = spawn('python3', ['-c', "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.execute('BEGIN EXCLUSIVE'); print('locked',flush=True); sys.stdin.read(); d.rollback(); d.close()", join(f.run, 'context.sqlite')], { stdio: ['pipe', 'pipe', 'pipe'] });
    await once(writer.stdout, 'data');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal((await f.doc()).waits[entry.id].state, 'waiting');
    assert.equal(f.admissions.length, 0);
    const stopped = once(writer, 'close'); writer.stdin.end(); await stopped;
    f.faux.setResponses([fauxAssistantMessage('resumed after board contention')]); f.done();
    await until(async () => (await f.doc()).waits[entry.id].state === 'sent');
    assert.equal(f.admissions.length, 1);
  } finally { if (writer?.exitCode === null) writer.kill(); await f.close(); }
});

test('trusted admission denial does not submit a wake', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm(); f.deny(); f.done();
    await until(async () => (await f.doc()).waits[entry.id].state === 'failed');
    const receipt = await f.host.commit(tx => tx.submissionByRequest(f.root.id, wakeRequestId(entry.taskId)), context);
    assert.equal(receipt, undefined);
  } finally { await f.close(); }
});


test('live registry model-driven board operations, snapshot ACK, active detach preserves unrelated tasks', async () => {
  const f = await boardFixture();
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const registry = createRegistry();
  const adapter = createDelmWait({ run: f.run, actor: 'bob' });
  const storage = await openNodeSqliteStorage(join(f.directory, 'sdk.sqlite'));
  const host = await Harness.open(storage, { registry, models }, context);
  registry.install(adapter);
  const unrelated = defineTask({ name: 'fixture.unrelated', version: 1, initial: () => ({ phase: 'wait' }), phases: {
    wait: async (_record, runtime, ctx) => {
      await new Promise(resolve => ctx.abortSignal.addEventListener('abort', resolve, { once: true }));
      ctx.abortSignal.throwIfAborted();
    },
  }, abort: (_record, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  registry.install(defineExtension({ name: 'fixture', tasks: [unrelated] }));
  const root = await host.root(context, { agent: { cwd: f.workspace, model: { provider: 'faux', modelId: 'faux-1' } } }); host.resume();
  const invoke = async (name, args) => {
    faux.setResponses([fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse' }), fauxAssistantMessage('finished')]);
    await (await root.submit({ type: 'input', content: 'test operation' }, context)).wait(context);
  };
  try {
    await invoke('delm_board', { request: { op: 'publish', request_id: 'sdk-model-publish', type: 'FACT', text: 'model-driven board tool verified' } });
    assert.ok(readBoard(f.run).notes.some(note => note.text === 'model-driven board tool verified'));
    await invoke('delm_wait', { action: 'wait', items: [f.task.id], reason: 'real board input' });
    const entry = Object.values((await host.snapshot(DelmWaitDoc, 1, context)).waits)[0];
    faux.setResponses([fauxAssistantMessage('SDK wake')]); f.complete();
    await until(async () => (await host.snapshot(DelmWaitDoc, 1, context)).waits[entry.id].state === 'sent');
    const receipt = f.command('bob', { op: 'pending' }).receipts[0];
    assert.ok(receipt);
    await invoke('delm_board', { request: { op: 'snapshot', request_id: receipt.request_id } });
    await invoke('delm_board', { request: { op: 'ack', request_id: 'sdk-model-ack', receipt_id: receipt.receipt_id } });
    assert.equal(f.command('bob', { op: 'pending' }).receipts.length, 0);
    const next = f.command('alice', { op: 'create', request_id: 'detach-task', subject: 'detach pending', detail: 'pending input' }).task;
    await invoke('delm_wait', { action: 'wait', items: [next.id], reason: 'detach active wait' });
    const active = Object.values((await host.snapshot(DelmWaitDoc, 1, context)).waits).find(e => e.state === 'waiting');
    const other = await host.commit(tx => tx.createTask(unrelated, {}, { conversationId: 1, ownership: { kind: 'conversation' }, background: true }), context);
    const unread = f.command('bob', { op: 'snapshot', request_id: 'preserve-unread' });
    const transcriptIds = (await root.context(context)).entries.map(entry => entry.id);
    const drained = await cancelAndDrain(host, { run: f.run, actor: 'bob' }, context);
    assert.ok(drained.some(e => e.id === active.id && !e.alreadyAdmitted));
    assert.ok(drained.some(e => e.id === entry.id && e.alreadyAdmitted));
    registry.uninstall(adapter);
    const retainedIds = new Set((await root.context(context)).entries.map(entry => entry.id));
    assert.ok(transcriptIds.every(id => retainedIds.has(id)), 'detach preserves existing caller transcript entries');
    assert.equal((await host.commit(tx => tx.task(other), context)).state.status, 'running');
    assert.equal(f.command('bob', { op: 'pending' }).receipts[0].receipt_id, unread.receipt_id);
    assert.equal((await host.snapshot(DelmWaitDoc, 1, context)).waits[active.id].state, 'cancelled');
    await host.abortTask(other, context); await host.waitForTask(other, context);
  } finally { await host.close(context); await f.close(); }
});

test('effective conversation environment guard rejects tool and wake despite correct process cwd', async () => {
  const f = await boardFixture();
  const faux = fauxProvider(), models = createModels(); models.setProvider(faux.provider);
  const registry = createRegistry(); registry.install(createDelmWait({ run: f.run, actor: 'bob' }));
  let effective = f.workspace;
  const host = await Harness.open(await openNodeSqliteStorage(join(f.directory, 'guard.sqlite')),
    { registry, models, env: () => new NodeExecutionEnv({ cwd: effective }) }, context);
  const root = await host.root(context, { agent: { cwd: f.workspace, model: { provider: 'faux', modelId: 'faux-1' } } }); host.resume();
  const tool = registry.snapshot().extension('delm').tools[0];
  const api = { taskId: 'guard', callId: 'guard', conversationId: 1,
    commit: fn => host.commit(fn, context), agent: () => root.agent(context), get env() { return new NodeExecutionEnv({ cwd: effective }); } };
  try {
    await tool.execute({ action: 'wait', items: [f.task.id], reason: 'check effective env' }, api, context);
    effective = f.directory;
    await assert.rejects(tool.execute({ action: 'status' }, api, context), /effective conversation workspace/);
    f.complete();
    await new Promise(resolve => setTimeout(resolve, 200));
    const entry = Object.values((await host.snapshot(DelmWaitDoc, 1, context)).waits)[0];
    assert.equal(await host.commit(tx => tx.submissionByRequest(1, wakeRequestId(entry.taskId)), context), undefined);
    await cancelAndDrain(host, { run: f.run, actor: 'bob' }, context);
  } finally { await host.close(context); await f.close(); }
});
