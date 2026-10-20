import type { Client, RepairTask } from "../../shared/types/client";
import type { ServiceTask } from "../../shared/types/task";
import type { IntakeRepair } from "../../shared/types/intake";
import type { PlanSource } from "../../shared/types/dailyPlan";

export function vladivostokDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function sourceKey(source: PlanSource): string {
  return [source.kind, source.documentId, source.repairId ?? "", source.taskId ?? ""].join("/");
}
export type WorkTask = Pick<RepairTask, "assignees" | "doneBy" | "status" | "workComment" | "photos">;
export function resolveTask(source: PlanSource, tasks: ServiceTask[], clients: Client[], intake: IntakeRepair[]): WorkTask | undefined {
  if (source.kind === "service") return tasks.find(t => t.id === source.documentId) as WorkTask | undefined;
  if (source.kind === "repair") return clients.find(c => c.id === source.documentId)?.repairs?.find(r => r.id === source.repairId)?.tasks?.find(t => t.id === source.taskId);
  return intake.find(i => i.id === source.documentId)?.repair.tasks?.find(t => t.id === source.taskId);
}
export function workDone(task: WorkTask): boolean {
  return task.status === "done" || !!task.assignees?.length && task.assignees.every(id => (task.doneBy ?? []).includes(id));
}
