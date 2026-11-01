import { readFileSync, realpathSync, watch } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectEvents, domainCommand } from './protocol.mjs';

export function binding(options) {
  if (typeof options?.run !== 'string' || typeof options?.actor !== 'string')
    throw Error('DeLM binding requires run and actor');
  const run = realpathSync(options.run), actor = options.actor;
  const config = JSON.parse(readFileSync(join(run, 'config.json'), 'utf8'));
  if (!Object.hasOwn(config.actors, actor)) throw Error('Unknown bound DeLM actor');
  const workspace = realpathSync(config.workspace ?? join(run, actor, 'workspace'));
  if (options.workspace && realpathSync(options.workspace) !== workspace) throw Error('Workspace binding mismatch');
  return { run, actor, workspace };
}

export function guardWorkspace(bound, cwd) {
  if (!cwd || realpathSync(cwd) !== bound.workspace) throw Error('DeLM belongs to another effective conversation workspace');
}

export const receiptReference = receipt => Object.fromEntries(['receipt_id', 'request_id', 'actor', 'from_sequence', 'to_sequence', 'full']
  .map(key => [key, receipt[key]]));
export const waitStatus = entry => JSON.parse(JSON.stringify({ ...entry, ...(entry.receipt ? { receipt: receiptReference(entry.receipt) } : {}) }));
const brief = (value, limit) => {
  const chars = Array.from(String(value ?? ''));
  return chars.slice(0, limit).join('') + (chars.length > limit ? '…' : '');
};

/** A notification references unread evidence; it is not the evidence or its acknowledgement. */
export function wakeMessage(entry, cause) {
  const ids = [...new Set([...entry.items, ...(cause.tasks ?? []), ...(cause.publications ?? [])])];
  const lines = [cause.kind === 'work' ? '[delm] WORK AVAILABLE: inspect current board; claim atomically, not assigned by this wake' :
    cause.kind === 'ready' ? '[delm] READY: dependencies are done' :
    '[delm] REEVALUATE-NOT-READY: reevaluation required, NOT successful readiness',
    `Reason: ${brief(cause.reason, 80)}`,
    `Affected (${Math.min(ids.length, 3)}/${ids.length}): ${ids.slice(0, 3).map(id => brief(id, 40)).join(', ')}`];
  if (entry.receipt) {
    const r = receiptReference(entry.receipt);
    lines.push(`receipt_id: ${r.receipt_id}`, `request_id: ${r.request_id}`, `range: ${r.from_sequence}->${r.to_sequence}`,
      'Read full receipt via bound CLI, then explicitly ack; this reference is NOT a read:',
      `context domain '${JSON.stringify({ op: 'snapshot', request_id: r.request_id })}'`,
      `context domain '${JSON.stringify({ op: 'ack', request_id: `${r.request_id}:ack`, receipt_id: r.receipt_id })}'`);
  } else lines.push('Run context read for the normal board delta; context read --all only for genuine recovery.');
  lines.push('Apply the frozen WORKER.md recovery and claim/handoff checkpoints before acting; refresh task facts, not the whole repository.');
  const message = lines.join('\n');
  if (Buffer.byteLength(message, 'utf8') > 2048) throw Error('DeLM wake reference exceeds 2048 UTF8 bytes');
  return message;
}

/** Read the BOARD, never another native session. Does not consume an agent's read cursor. */
export function readBoard(run) {
  const db = new DatabaseSync(join(run, 'context.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=50');
    db.exec('BEGIN');
    const rows = db.prepare('SELECT sequence,actor,kind,payload FROM events ORDER BY sequence').all();
    const actors = [...new Set(rows.filter(row => row.kind === 'session' || row.kind === 'lifecycle')
      .map(row => JSON.parse(row.payload).actor))];
    const projection = projectEvents(rows, actors);
    return { ...projection, tasks: Object.fromEntries(projection.queue.map(task => [task.id, task])),
      domainEnabled: rows.some(row => ['task', 'publication', 'lifecycle'].includes(row.kind)) };
  } finally { db.close(); }
}

/** Register before checking the board: changes between arming and yielding cannot be lost.
 * The bounded fallback only rechecks native state; it never invokes a model. */
export function boardChange(run, signal, timeoutMs = 2000) {
  let watcher, timer, resolve;
  let closed = false;
  const promise = new Promise(r => { resolve = r; });
  const close = () => {
    if (closed) return;
    closed = true;
    watcher?.close(); clearTimeout(timer); signal?.removeEventListener('abort', close); resolve();
  };
  watcher = watch(run, { persistent: false }, close);
  watcher.on('error', close);
  timer = setTimeout(close, timeoutMs);
  signal?.addEventListener('abort', close, { once: true });
  if (signal?.aborted) close();
  return { promise, close };
}
