import { binding } from './board.mjs';
import { createDelmWait, DelmWaitDoc } from './wait.mjs';
export { DelmWaitDoc, wakeRequestId } from './wait.mjs';

/** Install the returned definition in the caller's LIVE registry. No Harness is created. */
export function createDurableAdapter(options) {
  return createDelmWait(options);
}
export default createDurableAdapter;

/** Stop only this binding's wait tasks, and drain abort handling BEFORE uninstalling delm.
 * Already-admitted inputs are not cancelled, erased, or reported as unsubmitted.
 */
export async function cancelAndDrain(harness, options, context, conversationId = 1) {
  const bound = binding(options);
  const doc = await harness.snapshot(DelmWaitDoc, conversationId, context);
  const results = [];
  for (const entry of Object.values(doc?.waits ?? {})) {
    if (JSON.stringify(entry.binding) !== JSON.stringify(bound)) continue;
    const id = entry.watcherTaskId ?? entry.taskId;
    await harness.abortTask(id, context);
    await harness.waitForTask(id, context);
    const submission = await harness.commit(tx => tx.submissionByRequest(conversationId, `delm-wake:${entry.taskId}`), context);
    results.push({ id: entry.id, alreadyAdmitted: Boolean(submission) });
  }
  return results;
}
