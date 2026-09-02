import type { Repair, RepairTask } from "../types/client";

export function getAssignees(t: RepairTask): string[] {
  if (t.assignees?.length) return t.assignees;
  return [];
}

export function taskStatus(t: RepairTask): "done" | "in_progress" {
  if (t.status === "done") return "done";
  const a = getAssignees(t);
  const d = t.doneBy ?? [];
  if (a.length > 0 && d.length > 0 && a.every((uid) => d.includes(uid))) return "done";
  return "in_progress";
}

export function repairStatus(r: Repair): "done" | "in_progress" | "cancelled" {
  if (r.status === "cancelled") return "cancelled";
  if (r.closedByManager) return "done";
  const tasks = r.tasks ?? [];
  if (!tasks.length) return r.status ?? "in_progress";
  return tasks.every((t) => taskStatus(t) === "done") ? "done" : "in_progress";
}

type RepairDates = Pick<Repair, "closedAt" | "date">;

/**
 * Month (`YYYY-MM`) a repair counts toward in financial reports, dashboards and
 * the Excel export: the month it was closed. Falls back to the start date for
 * repairs closed before `closedAt` existed, so historical revenue is not lost.
 * Returns `""` when neither date is set.
 */
export function repairFinancialMonth(r: RepairDates): string {
  return (r.closedAt ?? r.date ?? "").slice(0, 7);
}

/** Day (`YYYY-MM-DD`) a repair counts as closed — same fallback as {@link repairFinancialMonth}. */
export function repairFinancialDay(r: RepairDates): string {
  return (r.closedAt ?? r.date ?? "").slice(0, 10);
}

/** True when a repair's financial month equals `targetMonth` (`YYYY-MM`). */
export function isRepairClosedInMonth(r: RepairDates, targetMonth: string): boolean {
  return repairFinancialMonth(r) === targetMonth;
}

export type ServiceType = "refrigerator" | "ac" | "freezer" | "other";
export const SERVICE_TYPES = [
  { id: "refrigerator" as ServiceType, label: "Рефрижератор", emoji: "❄️" },
  { id: "ac" as ServiceType, label: "Кондиционер", emoji: "❄️" },
  { id: "freezer" as ServiceType, label: "Морозильная", emoji: "❄️" },
  { id: "other" as ServiceType, label: "Другое", emoji: "⚙️" },
];
export const FREON_TYPES = [
  "", "R134a", "R404a", "R407c", "R410a", "R422d", "R449a", "R452a", "R507a", "Другой",
];

export function getServiceType(id?: string) {
  return SERVICE_TYPES.find((s) => s.id === id) ?? SERVICE_TYPES[3];
}
