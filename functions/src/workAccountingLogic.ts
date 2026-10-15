import { createHash } from "node:crypto";
type Data = Record<string, any>;
export function auditId(...parts: string[]): string { return createHash("sha256").update(JSON.stringify(parts)).digest("hex"); }
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];
const done = (task: Data) => task.status === "done" || (strings(task.assignees).length > 0 && strings(task.assignees).every(id => strings(task.doneBy).includes(id)));
export interface WorkChange {
  type: string; workKey: string; sourceKind: string; title: string; staffId: string | null;
  visibleTo: string[]; text: string;
}
interface FlatTask { task: Data; key: string; kind: string; label: string }
function flatten(kind: string, documentId: string, data?: Data): FlatTask[] {
  if (!data) return [];
  if (kind === "service") {
    const base = { task: data, key: `service/${documentId}`, kind, label: String(data.title || data.description || "Сервисная задача") };
    return [base, ...(Array.isArray(data.subtasks) ? data.subtasks : []).filter((task: Data) => task && typeof task.id === "string").map((task: Data) => ({ task, key: `${base.key}/subtask/${task.id}`, kind, label: String(task.description || base.label) }))];
  }
  const repairs = kind === "intake" ? [data.repair] : (Array.isArray(data.repairs) ? data.repairs : []);
  return repairs.filter((r: Data) => r && typeof r.id === "string").flatMap((repair: Data) => (Array.isArray(repair.tasks) ? repair.tasks : []).filter((task: Data) => task && typeof task.id === "string").map((task: Data) => ({
    task, key: `repair/${repair.id}/task/${task.id}`, kind, label: String(task.description || "Работа ремонта"),
  })));
}
// Moving intake into clients or importing an already completed task is not new work.
export function workChanges(kind: string, documentId: string, before?: Data, after?: Data): WorkChange[] {
  const previous = new Map(flatten(kind, documentId, before).map(t => [t.key, t]));
  const changes: WorkChange[] = [];
  for (const row of flatten(kind, documentId, after)) {
    const prior = previous.get(row.key);
    if (!prior) continue;
    const visibleTo = [...new Set([...strings(prior.task.assignees), ...strings(row.task.assignees), ...strings(prior.task.doneBy), ...strings(row.task.doneBy)])];
    const emit = (type: string, staffId: string | null, text = "") => changes.push({ type, staffId, workKey: row.key, sourceKind: row.kind, title: row.label, visibleTo, text: text.slice(0, 2000) });
    for (const uid of strings(row.task.doneBy)) if (!strings(prior.task.doneBy).includes(uid)) emit("completed", uid, String(row.task.workComment || ""));
    for (const uid of strings(prior.task.doneBy)) if (!strings(row.task.doneBy).includes(uid)) emit("completion_revoked", uid);
    if (!done(prior.task) && done(row.task)) emit("task_closed", null, String(row.task.workComment || ""));
    if (done(prior.task) && !done(row.task)) emit("task_reopened", null);
    if ((row.task.workComment || "") !== (prior.task.workComment || "")) emit("comment_changed", null, String(row.task.workComment || ""));
  }
  if (kind === "intake" && !before && after && (after.kind ?? (after.chamber ? "chamber" : "vehicle")) === "vehicle") {
    changes.push({ type: "vehicle_received", workKey: `intake/${documentId}`, sourceKind: "intake", title: `Приёмка: ${String(after.vehicle?.plate || "автомобиль")}`, staffId: null, visibleTo: strings(after.repair?.mechanics), text: "" });
  }
  return changes;
}
