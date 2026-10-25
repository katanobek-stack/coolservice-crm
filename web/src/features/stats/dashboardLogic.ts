import type {Client, Repair, Vehicle} from "../../shared/types/client";
import type {IntakeRepair} from "../../shared/types/intake";
import type {FinanceFixedCostShape} from "../../shared/utils/finance";
import {resolveFixedCosts} from "../../shared/utils/finance";
import {repairFinancialMonth, repairStatus} from "../../shared/utils/repair";
import {vladivostokDate} from "../daily-plan/logic";

export interface DashboardRepair extends Repair {
  key: string; source: "client" | "intake"; clientId: string; clientName: string;
  vehicle?: Vehicle; equipment?: string; mechanicIds: string[];
  phase: "active" | "ready" | "closed" | "cancelled";
}
export type AttentionFilter = "all" | "ready" | "unassigned" | "aging";
export const dashboardDay = vladivostokDate;
export function dashboardNumber(value: unknown): number {
  const n = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
export function dashboardFinancialAccess(role: string, allowed: boolean): boolean {
  return role === "owner" || ((role === "admin" || role === "manager") && allowed);
}
export function dashboardMechanics(repair: Repair): string[] {
  const legacy = repair as Repair & {mechanic?: string};
  const ids = new Set<string>();
  for (const task of repair.tasks ?? []) {
    for (const id of task.assignees ?? []) if (id) ids.add(id);
    const assignee = (task as typeof task & {assignee?: string}).assignee;
    if (assignee) ids.add(assignee);
  }
  if (!ids.size) for (const id of repair.mechanics ?? []) if (id) ids.add(id);
  if (!ids.size && legacy.mechanic) ids.add(legacy.mechanic);
  return [...ids];
}
export function dashboardPhase(repair: Repair): DashboardRepair["phase"] {
  if (repair.status === "cancelled") return "cancelled";
  if (repair.closedByManager || repair.closedAt) return "closed";
  return repairStatus(repair) === "done" ? "ready" : "active";
}
export function collectDashboardRepairs(clients: readonly Client[], intake: readonly IntakeRepair[]): DashboardRepair[] {
  const registered = new Set<string>();
  const rows: DashboardRepair[] = [];
  for (const client of clients) for (const repair of client.repairs ?? []) {
    registered.add(repair.id);
    rows.push({...repair,key:`client/${client.id}/${repair.id}`,source:"client",clientId:client.id,clientName:client.name,
      vehicle:(client.vehicles ?? []).find(v=>v.id===repair.vehicleId),
      equipment:repair.chamberId ? "Холодильная камера" : undefined,mechanicIds:dashboardMechanics(repair),phase:dashboardPhase(repair)});
  }
  for (const item of intake) {
    if (registered.has(item.repair.id)) continue;
    rows.push({...item.repair,key:`intake/${item.id}`,source:"intake",clientId:"",clientName:item.kind === "chamber" || item.chamber ? item.chamber?.label || "Камера из приёмки" : "Автомобиль из приёмки",
      vehicle:item.vehicle ? {...item.vehicle,id:item.id} : undefined,equipment:item.chamber?.label,
      mechanicIds:dashboardMechanics(item.repair),phase:dashboardPhase(item.repair)});
  }
  return rows;
}
export function dashboardAge(value: string | undefined, day: string): number | null {
  if (!value) return null;
  let date = value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) return null;
    date = dashboardDay(parsed);
  }
  const start = Date.parse(`${date}T00:00:00Z`), end = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || new Date(start).toISOString().slice(0,10) !== date) return null;
  return Math.max(0,Math.floor((end-start)/86400000));
}
export function selectDashboardRepairs(rows: readonly DashboardRepair[], filter: {search: string; attention: AttentionFilter; mine: boolean; uid: string; day: string}, name: (id:string)=>string) {
  const norm=(s:string)=>s.toLocaleLowerCase("ru-RU").replace(/ё/g,"е");
  const words=norm(filter.search).trim().split(/\s+/).filter(Boolean);
  const scope=rows.filter(r=> (r.phase === "active" || r.phase === "ready") && (!filter.mine || r.mechanicIds.includes(filter.uid)) &&
    words.every(word=>norm([r.clientName,r.description,r.vehicle?.plate,r.vehicle?.brand,r.equipment,...r.mechanicIds.map(name)].filter(Boolean).join(" ")).includes(word)));
  const matches=(r:DashboardRepair,attention:AttentionFilter)=>attention === "all" || (attention === "ready" ? r.phase === "ready" : attention === "unassigned" ? !r.mechanicIds.length : (dashboardAge(r.date,filter.day) ?? -1)>=7);
  const counts={all:scope.length,ready:scope.filter(r=>matches(r,"ready")).length,unassigned:scope.filter(r=>matches(r,"unassigned")).length,aging:scope.filter(r=>matches(r,"aging")).length};
  return {counts,rows:scope.filter(r=>matches(r,filter.attention)).sort((a,b)=>
    (dashboardAge(b.date,filter.day) ?? -1)-(dashboardAge(a.date,filter.day) ?? -1) || a.key.localeCompare(b.key))};
}
export function dashboardMonthRevenue(repairs: readonly Repair[], month: string, finance: FinanceFixedCostShape, liveRental: number): number {
  return repairs.filter(r=>repairStatus(r)==="done" && repairFinancialMonth(r)===month).reduce((s,r)=>s+dashboardNumber(r.cost),0)+resolveFixedCosts(finance,liveRental,month).rentalIncome;
}

export function dashboardStatusLabel(repair:Repair):string {
 const state=dashboardPhase(repair);
 return state === "closed" ? "Закрыто" : state === "ready" ? "Работы выполнены · ожидает закрытия" : state === "cancelled" ? "Отказ" : "В работе";
}
