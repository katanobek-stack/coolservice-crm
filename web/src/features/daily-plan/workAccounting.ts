import type { PhotoData } from "../../shared/utils/photos";
export interface WorkTime { toMillis(): number; toDate(): Date }
export interface WorkEvent {
  id: string; type: string; workKey: string; sourceKind: string; title: string;
  staffId: string | null; actorId: string | null; actorName?: string | null;
  text: string; selfReported: boolean; occurredAt?: WorkTime; evidence: string;
  photos?: PhotoData[];
}
export const workEventLabels: Record<string, string> = {
  task_created: "Задача создана", started: "Приступил", completed: "Отметка личного выполнения",
  report_updated: "Отчёт дополнен", completion_revoked: "Отметка выполнения снята",
  task_closed: "Общее закрытие", task_reopened: "Задача открыта повторно",
  comment_changed: "Комментарий изменён", vehicle_received: "Машина принята",
  photo_added: "Фото работы добавлено",
};
export const workSourceLabels: Record<string, string> = { ppz: "ППЗ", repair: "Ремонт", intake: "Приёмка", service: "Сервис" };
export function accountingRange(from: string, to: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
  const start = new Date(`${from}T00:00:00+10:00`), last = new Date(`${to}T00:00:00+10:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(last.getTime())
    || new Date(`${from}T00:00:00Z`).toISOString().slice(0, 10) !== from
    || new Date(`${to}T00:00:00Z`).toISOString().slice(0, 10) !== to) return null;
  return { start, end: new Date(last.getTime() + 86400000) };
}
export function summarizeWork(events: WorkEvent[], staffIds: string[]) {
  const ordered = [...events].sort((a, b) => (a.occurredAt?.toMillis() ?? 0) - (b.occurredAt?.toMillis() ?? 0) || a.id.localeCompare(b.id));
  return staffIds.map(uid => {
    const own = ordered.filter(e => e.staffId === uid);
    const latest = new Map<string, WorkEvent>();
    own.forEach(e => { if (["completed", "completion_revoked"].includes(e.type)) latest.set(e.workKey, e); });
    const unique = (list: WorkEvent[]) => new Set(list.map(e => e.workKey)).size;
    return { uid,
      started: unique(own.filter(e => e.type === "started" && e.actorId === uid)),
      personal: [...latest.values()].filter(e => e.type === "completed" && e.selfReported && e.actorId === uid).length,
      recordedByOthers: [...latest.values()].filter(e => e.type === "completed" && !e.selfReported).length,
      closed: unique(ordered.filter(e => e.type === "task_closed" && e.actorId === uid)),
      received: unique(ordered.filter(e => e.type === "vehicle_received" && e.actorId === uid)),
      revoked: unique(own.filter(e => e.type === "completion_revoked")),
      photos: new Set(own.flatMap(e => (e.photos ?? []).map(p => p.path || `${e.workKey}/${p.id}`))).size,
      withPhotos: unique(own.filter(e => (e.photos ?? []).length > 0)),
    };
  });
}
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
