/** Pure shared logic: imported by both callable writes and the web transaction layer. */
interface CompletionTask { status?: string; assignees?: string[]; doneBy?: string[] }
interface CompletionRepair { tasks?: CompletionTask[]; workCompletedAt?: string }
function allTasksDone(repair: CompletionRepair): boolean {
  const tasks = repair.tasks ?? [];
  return tasks.length > 0 && tasks.every(task => task.status === 'done' ||
    !!task.assignees?.length && task.assignees.every(uid => (task.doneBy ?? []).includes(uid)));
}
export function stampRepairCompletion<T extends CompletionRepair>(before: CompletionRepair, after: T, now: string): T {
  const next = { ...after };
  if (!allTasksDone(after)) delete next.workCompletedAt;
  else if (!allTasksDone(before)) next.workCompletedAt = now;
  else if (before.workCompletedAt) next.workCompletedAt = before.workCompletedAt;
  else delete next.workCompletedAt; // Never invent completion dates for legacy finished work.
  return next;
}
