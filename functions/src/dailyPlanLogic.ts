import { HttpsError } from "firebase-functions/v2/https";

export interface PlanSource {
  kind: "service" | "repair" | "intake";
  documentId: string;
  taskId?: string;
  repairId?: string;
}
export interface PlanItem {
  id: string;
  source: PlanSource;
  title: string;
  order: number;
  priority: "normal" | "high";
  deadline: string;
  note: string;
  newService?: boolean;
}
export function telegramGroupIds(value: string): string[] {
  const ids = [...new Set(value.split(",").map(id => id.trim()).filter(Boolean))];
  if (!ids.length || ids.some(id => !/^-\d+$/.test(id))) {
    throw new HttpsError("failed-precondition", "Проверьте существующую настройку TELEGRAM_GROUP_CHAT_ID: нужен ID Telegram-группы");
  }
  return ids;
}
export function safeId(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{1,128}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Некорректный идентификатор");
  }
  return value;
}
export function planDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new HttpsError("invalid-argument", "Некорректная дата");
  }
  return value;
}
function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new HttpsError("invalid-argument", "Некорректный текст пункта плана");
  }
  return value.trim();
}
export function parsePlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new HttpsError("invalid-argument", "В плане допускается до 50 задач");
  }
  const ids = new Set<string>();
  const sources = new Set<string>();
  return value.map((raw, order) => {
    if (!raw || typeof raw !== "object" || !raw.source) throw new HttpsError("invalid-argument", "Некорректная задача");
    const id = safeId(raw.id);
    const kind = raw.source.kind;
    if (!["service", "repair", "intake"].includes(kind)) throw new HttpsError("invalid-argument", "Некорректный источник");
    const source: PlanSource = { kind, documentId: safeId(raw.source.documentId) };
    if (kind !== "service") source.taskId = safeId(raw.source.taskId);
    if (kind === "repair") source.repairId = safeId(raw.source.repairId);
    const key = JSON.stringify(source);
    if (ids.has(id) || sources.has(key)) throw new HttpsError("invalid-argument", "Задача повторяется в плане");
    ids.add(id); sources.add(key);
    const title = boundedText(raw.title, 200);
    const deadline = boundedText(raw.deadline, 5);
    if (!title || (deadline && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline))) throw new HttpsError("invalid-argument", "Укажите название и корректное время");
    if (!["normal", "high"].includes(raw.priority)) throw new HttpsError("invalid-argument", "Некорректный приоритет");
    if (raw.newService !== undefined && (raw.newService !== true || kind !== "service")) throw new HttpsError("invalid-argument", "Некорректная новая работа");
    return { id, source, title, order, priority: raw.priority, deadline, note: boundedText(raw.note, 500), ...(raw.newService ? { newService: true } : {}) };
  });
}
export function taskComplete(task: { status?: string; assignees?: string[]; doneBy?: string[] }): boolean {
  return task.status === "done" || !!task.assignees?.length && task.assignees.every(uid => (task.doneBy ?? []).includes(uid));
}
export function planMessage(date: string, name: string, version: number, items: PlanItem[]): string {
  return [`ППЗ на ${date} · версия ${version}`, name,
    ...(items.length ? items.map((item, i) => `${i + 1}. ${item.priority === "high" ? "Важно: " : ""}${item.title}${item.deadline ? ` — до ${item.deadline}` : ""}${item.note ? `\n   ${item.note}` : ""}`) : ["Назначенных задач нет."])].join("\n");
}
export function splitMessage(text: string, max = 3500): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    let end = remaining.lastIndexOf("\n", max);
    if (end < max / 2) end = max;
    // Do not split a UTF-16 surrogate pair.
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\n/, "");
  }
  if (remaining) parts.push(remaining);
  return parts;
}
