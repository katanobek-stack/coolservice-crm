import type { PhotoData } from "../../shared/utils/photos";
import type { Client, Repair } from "../../shared/types/client";
import type { IntakeRepair } from "../../shared/types/intake";
export interface WorkTime { toMillis(): number; toDate(): Date }
export interface WorkEvent {
  id: string; type: string; workKey: string; sourceKind: string; title: string;
  staffId: string | null; actorId: string | null; actorName?: string | null;
  text: string; selfReported: boolean; occurredAt?: WorkTime; evidence: string;
  photos?: PhotoData[];
  createdBy?: string | null; createdByName?: string | null; createdAt?: WorkTime | null;
  assigneeIds?: string[]; assigneeNames?: Record<string, string>;
  planDate?: string; planVersion?: number; planItems?: { title: string; workKey: string; sourceKind: string }[];
}
export interface AccountingTask {
  id: string; title: string; assignees: string[]; createdBy?: string; createdByName?: string;
  assigneeNames?: Record<string, string>; createdAt?: WorkTime;
}
export function canViewWorkAccounting(role?: string) { return role === "admin" || role === "owner"; }
export function accountingMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const start = new Date(`${month}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  const from = `${month}-01`, to = new Date(start.getTime() - 86400000).toISOString().slice(0, 10);
  return { from, to, ...accountingRange(from, to)! };
}
export interface ClosedWorkRepair {
  id: string; title: string; closedAt: string; participants: string[];
  tasks: { id: string; description: string; doneBy: string[]; workComment?: string; photos?: PhotoData[] }[];
}
/** Reuse the loaded CRM archive; never infer participation from mere assignment. */
export function closedWorkRepairs(clients: Client[], intakes: IntakeRepair[], range: { start: Date; end: Date }): ClosedWorkRepair[] {
  const result = new Map<string, ClosedWorkRepair>();
  function add(repair: Repair, equipment: string, client: string) {
    if (!repair.closedByManager || repair.status === "cancelled" || !repair.closedAt) return;
    const ms = Date.parse(repair.closedAt);
    if (!Number.isFinite(ms) || ms < range.start.getTime() || ms >= range.end.getTime()) return;
    const tasks = (repair.tasks ?? []).map(t => ({ id: t.id, description: t.description, doneBy: t.doneBy ?? [], workComment: t.workComment, photos: t.photos }));
    result.set(repair.id, { id: repair.id, title: [client, equipment, repair.description].filter(Boolean).join(" · ") || `Заявка ${repair.id}`, closedAt: repair.closedAt,
      participants: [...new Set(tasks.flatMap(t => t.doneBy))], tasks });
  }
  for (const intake of intakes) add(intake.repair, intake.vehicle?.plate || intake.chamber?.label || "", "Приёмка");
  for (const client of clients) for (const repair of client.repairs ?? []) add(repair,
    client.vehicles?.find(v => v.id === repair.vehicleId)?.plate || client.chambers?.find(c => c.id === repair.chamberId)?.notes || "", client.name);
  return [...result.values()].sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt) || a.id.localeCompare(b.id));
}
export const workEventLabels: Record<string, string> = {
  task_created: "Задача создана", started: "Приступил", completed: "Отметка личного выполнения",
  report_updated: "Отчёт дополнен", completion_revoked: "Отметка выполнения снята",
  task_closed: "Общее закрытие", task_reopened: "Задача открыта повторно",
  comment_changed: "Комментарий изменён", vehicle_received: "Машина принята",
  photo_added: "Фото работы добавлено",
  plan_published: "Дневной ППЗ опубликован",
};
export const workSourceLabels: Record<string, string> = { ppz: "Общие задачи ППЗ", plan: "Дневной план ППЗ", repair: "Ремонт", intake: "Приёмка", service: "Сервис" };
export function accountingRange(from: string, to: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const start = new Date(`${from}T00:00:00+10:00`), last = new Date(`${to}T00:00:00+10:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(last.getTime())
    || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from
    || new Date(`${to}T00:00:00Z`).toISOString().slice(0, 10) !== to) return null;
  return { start, end: new Date(last.getTime() + 86400000) };
}
export function summarizeWork(events: WorkEvent[], staffIds: string[]) {
  // Same commit can also be observed by a trigger. Prefer the authenticated action at that instant.
  const ordered = [...events].sort((a, b) => (a.occurredAt?.toMillis() ?? 0) - (b.occurredAt?.toMillis() ?? 0)
    || Number(a.evidence === "authenticated_action") - Number(b.evidence === "authenticated_action") || a.id.localeCompare(b.id));
  return staffIds.map(uid => {
    const own = ordered.filter(e => e.staffId === uid);
    const latest = new Map<string, WorkEvent>();
    own.forEach(e => { if (["completed", "completion_revoked"].includes(e.type)) latest.set(e.workKey, e); });
    const unique = (list: WorkEvent[]) => new Set(list.map(e => e.workKey)).size;
    const completed = [...latest.values()].filter(e => e.type === "completed" && e.selfReported && e.actorId === uid);
    return { uid,
      started: unique(own.filter(e => e.type === "started" && e.actorId === uid)),
      personal: completed.length,
      ppzCompleted: completed.filter(e => e.sourceKind === "ppz").length,
      repairTasks: completed.filter(e => ["repair", "intake"].includes(e.sourceKind)).length,
      serviceTasks: completed.filter(e => e.sourceKind === "service").length,
      recordedByOthers: [...latest.values()].filter(e => e.type === "completed" && !e.selfReported).length,
      closed: unique(ordered.filter(e => e.type === "task_closed" && e.actorId === uid)),
      received: unique(ordered.filter(e => e.type === "vehicle_received" && e.actorId === uid)),
      revoked: unique(own.filter(e => e.type === "completion_revoked")),
      photos: new Set(own.flatMap(e => (e.photos ?? []).map(p => p.path || `${e.workKey}/${p.id}`))).size,
      withPhotos: unique(own.filter(e => (e.photos ?? []).length > 0)),
    };
  });
}
export function monthlyWorkSummary(events: WorkEvent[], tasks: AccountingTask[], repairs: ClosedWorkRepair[], staffIds: string[], range: { start: Date; end: Date }) {
  const inPeriod = (time?: WorkTime) => !!time && time.toMillis() >= range.start.getTime() && time.toMillis() < range.end.getTime();
  const scopedEvents = events.filter(e => inPeriod(e.occurredAt));
  const scopedTasks = tasks.filter(t => inPeriod(t.createdAt));
  const scopedRepairs = repairs.filter(r => Date.parse(r.closedAt) >= range.start.getTime() && Date.parse(r.closedAt) < range.end.getTime());
  const ids = [...new Set([...staffIds, ...scopedTasks.flatMap(t => [t.createdBy || "", ...t.assignees]),
    ...scopedEvents.flatMap(e => [e.staffId || "", e.actorId || ""]), ...scopedRepairs.flatMap(r => r.participants)])].filter(Boolean);
  return summarizeWork(scopedEvents, ids).map(row => ({ ...row,
    assigned: scopedTasks.filter(t => t.assignees.includes(row.uid)).length,
    created: scopedTasks.filter(t => t.createdBy === row.uid).length,
    requests: scopedRepairs.filter(r => r.participants.includes(row.uid)).length,
    plansPublished: new Set(scopedEvents.filter(e => e.type === "plan_published" && e.staffId === row.uid).map(e => e.workKey)).size,
    plannedTasks: new Set(scopedEvents.filter(e => e.type === "plan_published" && e.staffId === row.uid).flatMap(e => (e.planItems ?? []).map(item => item.workKey))).size,
  }));
}
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
