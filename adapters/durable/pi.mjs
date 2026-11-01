import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { binding, guardWorkspace, readBoard, boardChange, receiptReference, wakeMessage } from './board.mjs';
import { domainCommand, waitTrigger } from './protocol.mjs';

const entryType = 'delm.wait.v1';
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], details: data });

/** Stock Pi ExtensionAPI. Deliberately does not import the Durable SDK entry. */
export default function createPiAdapter(pi, options = {
  run: process.env.DELM_RUN, actor: process.env.DELM_ACTOR,
  sessionFile: process.env.DELM_SESSION_FILE,
}) {
  if (options.run === undefined && options.actor === undefined && options.sessionFile === undefined) return;
  const bound = binding(options);
  if (!options.sessionFile) throw Error('Pi binding requires an explicit sessionFile (use delm connect pi)');
  const sessionFile = resolve(options.sessionFile);
  let generation = 0, controller, loop, current, active, failure;

  function stop() {
    generation++;
    controller?.abort();
    controller = undefined;
  }
  function identity(ctx) {
    guardWorkspace(bound, ctx.cwd);
    guardWorkspace(bound, ctx.sessionManager.getCwd());
    if (resolve(ctx.sessionManager.getSessionFile() ?? '') !== sessionFile)
      throw Error('DeLM session binding mismatch; forks/new sessions require their own explicit binding');
    return { ...bound, sessionFile, sessionId: ctx.sessionManager.getSessionId() };
  }
  function save(record) {
    pi.appendEntry(entryType, record);
    current = record;
  }
  function check(ctx, expected) {
    const actual = identity(ctx);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('DeLM session identity changed');
  }
  function restore(ctx) {
    stop(); current = undefined; failure = undefined; active = ctx;
    try {
      const expected = identity(ctx);
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== 'custom' || entry.customType !== entryType) continue;
        const record = entry.data;
        if (record?.version !== 1 || JSON.stringify(record.binding) !== JSON.stringify(expected))
          throw Error('Inherited or incompatible DeLM binding; refusing actor adoption');
        current = structuredClone(record);
      }
      if (current?.state === 'armed') {
        // An abandoned branch cannot erase an already recorded send intent.
        const attempted = ctx.sessionManager.getEntries().filter(entry => entry.type === 'custom' &&
          entry.customType === entryType && entry.data?.id === current.id && entry.data.attempt &&
          JSON.stringify(entry.data.binding) === JSON.stringify(expected))
          .map(entry => entry.data).sort((a, b) => b.attempt.count - a.attempt.count)[0];
        if (attempted) save({ ...current, state: 'attempted', attempt: attempted.attempt,
          receipt: attempted.receipt, trigger: attempted.trigger, recoveredAttempt: true });
        else start(ctx);
      }
    } catch (error) { failure = error.message; }
  }
  function status(ctx) {
    if (failure) throw Error(failure);
    const expected = identity(ctx);
    if (current) check(ctx, current.binding);
    const visibleWake = Boolean(current?.attempt && ctx.sessionManager.getBranch().some(entry =>
      entry.type === 'message' && entry.message.role === 'user' &&
      JSON.stringify(entry.message.content).includes(current.attempt.wakeId)));
    return { binding: expected, wait: current ?? null, visibleWake,
      ...(current?.state === 'attempted' ? { recovery: 'Not durable admission. Inspect transcript and pending receipts; /delm-rearm <id> explicitly permits another attempt.' } : {}) };
  }
  function start(ctx) {
    stop();
    const epoch = generation;
    controller = new AbortController();
    const signal = controller.signal;
    loop = (async () => {
      while (!signal.aborted && epoch === generation && current?.state === 'armed') {
        const change = boardChange(bound.run, signal);
        try {
          check(ctx, current.binding);
          let cause = waitTrigger(current, readBoard(bound.run));
          if (!cause) { await change.promise; continue; }
          const saved = structuredClone(current);
          const count = (saved.attempt?.count ?? 0) + 1;
          const wakeId = `delm-pi:${saved.id}:${count}`;
          const receipt = await domainCommand(bound.run, bound.actor, { op: 'snapshot', request_id: wakeId });
          if (signal.aborted || epoch !== generation) return;
          check(ctx, saved.binding);
          cause = waitTrigger(saved, readBoard(bound.run));
          if (!cause) { await change.promise; continue; }
          // Both official methods return void: persist intent BEFORE the non-atomic send.
          save({ ...saved, state: 'attempted', receipt: receiptReference(receipt), trigger: cause,
            attempt: { count, wakeId, at: Date.now() } });
          pi.sendUserMessage(`[${wakeId}]\n${wakeMessage(current, cause)}`, { deliverAs: 'followUp' });
          return;
        } finally { change.close(); }
      }
    })().catch(error => {
      if (signal.aborted || epoch !== generation) return;
      const message = String(error.message ?? error);
      // Even a synchronous rejection is ambiguous; never automatically resend it.
      if (current?.state === 'attempted') save({ ...current, error: message });
      else failure = message;
    });
  }

  pi.on('session_start', (_event, ctx) => restore(ctx));
  pi.on('session_tree', (_event, ctx) => restore(ctx));
  pi.on('session_before_switch', () => { stop(); active = undefined; });
  pi.on('session_before_fork', () => { stop(); active = undefined; });
  pi.on('session_shutdown', async () => { stop(); active = undefined; await loop; });

  pi.registerTool({ name: 'delm_board', label: 'DeLM board',
    description: 'Invoke the actor-bound board domain CLI with a JSON request object. Read snapshot view before explicit ack. Mutations require stable request_id and current fences. No actor/token input.',
    parameters: Type.Object({ request: Type.Record(Type.String(), Type.Unknown()) }, { additionalProperties: false }),
    async execute(_id, args, _signal, _update, ctx) {
      status(ctx);
      const epoch = generation;
      const answer = await domainCommand(bound.run, bound.actor, args.request);
      if (epoch === generation && current?.state === 'attempted' && args.request.op === 'ack' &&
          args.request.receipt_id === current.receipt?.receipt_id) {
        check(ctx, current.binding);
        save({ ...current, state: 'acked' });
      }
      return result(answer);
    },
  });
  pi.registerTool({ name: 'delm_wait', label: 'DeLM wait',
    description: 'Nonblocking board wait: wait for ALL exact task IDs, or work for a free actor. Returns armed/current status promptly; finish the turn. A follow-up references unread receipt, not read/ACK or durable admission. Never auto-retry an attempted wake. Human recovery: /delm-rearm <id>.',
    parameters: Type.Object({ action: Type.Union(['wait', 'work', 'status', 'cancel'].map(value => Type.Literal(value))),
      items: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 20, uniqueItems: true })),
      reason: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })) }, { additionalProperties: false }),
    async execute(callId, args, _signal, _update, ctx) {
      if (!active) restore(ctx);
      if (current?.state === 'attempted' && current.receipt) {
        const epoch = generation, id = current.id;
        const pending = await domainCommand(bound.run, bound.actor, { op: 'pending' });
        if (epoch !== generation || current?.id !== id) throw Error('Session/branch changed during reconciliation');
        check(ctx, current.binding);
        if (!pending.receipts.some(receipt => receipt.receipt_id === current.receipt.receipt_id))
          save({ ...current, state: 'acked' });
      }
      const state = status(ctx);
      if (args.action === 'status') return result(state);
      if (args.action === 'cancel') {
        stop();
        if (current?.state === 'armed') save({ ...current, state: 'cancelled' });
        return result(status(ctx));
      }
      if (!args.reason?.trim()) throw Error('wait/work needs a concrete reason');
      const callIdentity = createHash('sha256').update(`${state.binding.sessionId}:${callId}`).digest('hex');
      if (current?.id === callIdentity) return result(state);
      if (current && ['armed', 'attempted'].includes(current.state))
        throw Error('A wait is already armed or has an uncertain attempted wake; inspect status');
      const snapshot = readBoard(bound.run);
      if (args.action === 'wait' && (!args.items?.length || args.items.some(id => !snapshot.tasks[id])))
        throw Error('wait requires exact existing task IDs');
      if (args.action === 'work' && (args.items !== undefined || snapshot.queue.some(task =>
        task.owner === bound.actor && ['claimed', 'blocked'].includes(task.state)) || snapshot.sessions.some(session =>
        session.actor === bound.actor && ['blocked', 'ended'].includes(session.state))))
        throw Error('work requires a free active actor and no items');
      const condition = { items: args.items ?? [], sequence: snapshot.sequence,
        ...(args.action === 'work' ? { mode: 'work', actor: bound.actor } : {}) };
      const cause = waitTrigger(condition, snapshot);
      if (cause) return result({ readyNow: cause.kind === 'ready', reevaluateNow: cause.kind !== 'ready', trigger: cause });
      const id = callIdentity;
      save({ version: 1, binding: state.binding, id, ...condition, state: 'armed', reason: args.reason.trim(),
        dependencies: Object.fromEntries(condition.items.map(item => [item,
          { owner: snapshot.tasks[item].owner, generation: snapshot.tasks[item].generation }])) });
      start(ctx);
      return result(status(ctx));
    },
  });
  pi.registerCommand('delm-rearm', {
    description: 'Explicitly authorize another attempt after inspecting an uncertain DeLM wake. Usage: /delm-rearm <wait-id>',
    async handler(id, ctx) {
      status(ctx);
      if (!current || current.id !== id.trim() || current.state !== 'attempted')
        throw Error('Expected the exact attempted wait id');
      stop(); failure = undefined;
      save({ ...current, state: 'armed', error: undefined });
      start(ctx);
    },
  });
}
