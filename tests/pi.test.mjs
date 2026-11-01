import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import createPiAdapter from '../adapters/durable/pi.mjs';
import { boardFixture, until } from './fixture.mjs';

async function fixture() {
  const f = await boardFixture();
  const agentDir = join(f.directory, 'profile'); await mkdir(agentDir);
  const file = join(f.run, 'bob', 'session.jsonl');
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 0 }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null,
    modelsStorePath: join(agentDir, 'models.json'), refreshOnCreate: false });
  const faux = fauxProvider(); modelRuntime.registerNativeProvider(faux.provider);
  let session, manager;
  const errors = [];
  const loader = new DefaultResourceLoader({ cwd: f.workspace, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [pi => createPiAdapter(pi, { run: f.run, actor: 'bob', sessionFile: file })] });
  async function open(path = file, cwd = f.workspace) {
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    manager = SessionManager.open(path, undefined, cwd);
    ({ session } = await createAgentSession({ cwd, agentDir, settingsManager, modelRuntime,
      model: faux.getModel(), resourceLoader: loader, sessionManager: manager, noTools: 'builtin' }));
    await session.bindExtensions({ mode: 'rpc', onError: error => errors.push(error) });
    assert.ok(session.getActiveToolNames().includes('delm_wait'), JSON.stringify({ errors, loaded: loader.getExtensions() }, (_, value) => typeof value === 'function' ? '[function]' : value));
  }
  try { await open(); } catch (error) { await f.close(); throw error; }
  const record = () => manager.getBranch().filter(e => e.type === 'custom' && e.customType === 'delm.wait.v1').at(-1)?.data;
  async function call(name, args, id) {
    faux.setResponses([fauxAssistantMessage(fauxToolCall(name, args, id ? { id } : undefined), { stopReason: 'toolUse' }), fauxAssistantMessage('finished')]);
    await session.prompt('fixture tool call');
    const message = [...session.messages].reverse().find(m => m.role === 'toolResult' && m.toolName === name);
    assert.ok(message, JSON.stringify(session.messages));
    return message;
  }
  return { ...f, file, faux, errors, record, call, open,
    get session() { return session; }, get manager() { return manager; },
    async arm() {
      const start = Date.now();
      const answer = await call('delm_wait', { action: 'wait', items: [f.task.id], reason: 'exact input' });
      assert.ok(!answer.isError, JSON.stringify(answer));
      assert.equal(record().state, 'armed');
      assert.ok(Date.now() - start < 2000, 'wait must return promptly, not wait on the board');
      return record();
    },
    async close() { session.dispose(); await f.close(); },
  };
}

test('real AgentSession: arm/event/follow-up/readACK permits a new wait', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm();
    f.faux.setResponses([fauxAssistantMessage('actual same-session follow-up')]); f.complete();
    await until(() => f.record()?.state === 'attempted');
    await f.session.waitForIdle();
    assert.ok(f.session.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes(`delm-pi:${entry.id}:1`)));
    const saved = f.record();
    const read = await f.call('delm_board', { request: { op: 'snapshot', request_id: saved.receipt.request_id } });
    assert.equal(read.details.receipt_id, saved.receipt.receipt_id);
    const ack = await f.call('delm_board', { request: { op: 'ack', request_id: 'read-ack', receipt_id: saved.receipt.receipt_id } });
    assert.ok(!ack.isError, JSON.stringify(ack)); assert.equal(f.record().state, 'acked');
    const next = f.command('alice', { op: 'create', request_id: 'next-input', subject: 'next', detail: 'next input' }).task;
    const armed = await f.call('delm_wait', { action: 'wait', items: [next.id], reason: 'next cycle' });
    assert.ok(!armed.isError, JSON.stringify(armed)); assert.equal(f.record().state, 'armed');
    assert.notEqual(f.record().id, entry.id);
    assert.equal(f.errors.length, 0, JSON.stringify(f.errors));
  } finally { await f.close(); }
});

test('real AgentSession tree navigation drops abandoned wait and restores pending branch', async () => {
  const f = await fixture();
  try {
    f.manager.appendCustomEntry('before-wait', {}); const before = f.manager.getLeafId();
    const entry = await f.arm(); const pendingLeaf = f.manager.getLeafId();
    await f.session.navigateTree(before, { summarize: false });
    assert.equal(f.record(), undefined);
    f.command('alice', { op: 'publish', request_id: 'unrelated', type: 'FACT', text: 'unrelated' });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(!f.session.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('delm-pi:')));
    await f.session.navigateTree(pendingLeaf, { summarize: false });
    assert.equal(f.record().id, entry.id);
    f.faux.setResponses([fauxAssistantMessage('restored branch wake')]); f.complete();
    await until(() => f.record()?.state === 'attempted');
    await f.session.waitForIdle();
    assert.equal(f.record().attempt.count, 1);
    await f.session.navigateTree(pendingLeaf, { summarize: false });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.record().state, 'attempted');
    assert.equal(f.record().attempt.count, 1, 'rewinding an abandoned branch must not erase send intent');
  } finally { await f.close(); }
});

test('real AgentSession reload restores armed wait; attempted send never automatically resends', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm();
    await f.session.reload();
    assert.equal(f.record().id, entry.id);
    f.faux.setResponses([fauxAssistantMessage('one wake')]); f.complete();
    await until(() => f.record()?.state === 'attempted'); await f.session.waitForIdle();
    const count = () => f.session.messages.filter(m => m.role === 'user' && JSON.stringify(m.content).includes('delm-pi:')).length;
    assert.equal(count(), 1);
    await f.session.reload();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(count(), 1); assert.equal(f.record().state, 'attempted');
    const status = await f.call('delm_wait', { action: 'status' });
    assert.equal(status.details.visibleWake, true);
    assert.equal(f.command('bob', { op: 'pending' }).receipts.length, 1);
    f.faux.setResponses([fauxAssistantMessage('explicit second attempt')]);
    await f.session.prompt(`/delm-rearm ${entry.id}`);
    await until(() => f.record().attempt.count === 2); await f.session.waitForIdle();
    assert.equal(count(), 2);
    const disk = await readFile(f.file, 'utf8');
    assert.ok(disk.indexOf('"state":"attempted"') < disk.indexOf('[delm-pi:'), 'attempt marker is persisted before user message');
  } finally { await f.close(); }
});

test('real AgentSession fork file and replacement workspace cannot inherit actor', async () => {
  const f = await fixture();
  try {
    await f.arm();
    const fork = f.manager.createBranchedSession(f.manager.getLeafId());
    f.session.dispose();
    await f.open(fork);
    const refused = await f.call('delm_wait', { action: 'status' });
    assert.ok(refused.isError); assert.match(JSON.stringify(refused.content), /session binding mismatch/);
    f.session.dispose();
    const foreign = join(f.directory, 'foreign'); await mkdir(foreign);
    await f.open(f.file, foreign);
    const guarded = await f.call('delm_board', { request: { op: 'projection' } });
    assert.ok(guarded.isError); assert.match(JSON.stringify(guarded.content), /effective conversation workspace/);
  } finally { await f.close(); }
});

test('persisted interruption between attempt marker and send requires explicit recovery', async () => {
  const f = await fixture();
  try {
    const entry = await f.arm();
    f.session.dispose();
    // Restore a persisted marker simulating a crash between appendEntry and sendUserMessage.
    f.manager.appendCustomEntry('delm.wait.v1', { ...entry, state: 'attempted',
      attempt: { count: 1, wakeId: `delm-pi:${entry.id}:1`, at: Date.now() } });
    await f.open(); f.complete();
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(f.record().state, 'attempted');
    assert.ok(!f.session.messages.some(m => m.role === 'user' && JSON.stringify(m.content).includes('delm-pi:')));
    f.faux.setResponses([fauxAssistantMessage('manual recovery')]);
    await f.session.prompt(`/delm-rearm ${entry.id}`);
    await until(() => f.record().attempt.count === 2);
  } finally { await f.close(); }
});

test('real AgentSession asynchronous send rejection during compaction retains uncertain intent', async () => {
  const f = await fixture();
  let release, compaction;
  try {
    const entry = await f.arm();
    const barrier = new Promise(resolve => { release = resolve; });
    f.faux.setResponses([async () => { await barrier; return fauxAssistantMessage('compact fixture summary'); }]);
    compaction = f.session.compact();
    await until(() => f.session.isCompacting);
    f.complete();
    await until(() => f.record()?.state === 'attempted');
    await until(() => f.errors.some(e => /compaction is in progress/.test(e.error)));
    assert.equal(f.record().attempt.count, 1);
    release(); await compaction; compaction = undefined;
    await f.session.reload();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(f.record().attempt.count, 1);
    assert.equal(f.command('bob', { op: 'pending' }).receipts.length, 1);
    f.faux.setResponses([fauxAssistantMessage('explicit recovery after rejection')]);
    await f.session.prompt(`/delm-rearm ${entry.id}`);
    await until(() => f.record().attempt.count === 2);
  } finally { release?.(); await compaction?.catch(() => {}); await f.close(); }
});
