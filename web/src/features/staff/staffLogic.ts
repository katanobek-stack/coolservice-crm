import type { Client } from '../../shared/types/client';
import type { IntakeRepair } from '../../shared/types/intake';
import type { StaffMember, StaffPermissions, StaffRole } from '../../shared/types/staff';
import { collectDashboardRepairs, dashboardNumber } from '../stats/dashboardLogic';
import { vladivostokDate } from '../daily-plan/logic';

export const ROLE_LABELS: Record<StaffRole, string> = { owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер', mechanic: 'Механик' };
export const PERMISSION_LABELS: Record<keyof StaffPermissions, string> = { dashboard_financials: 'Финансы дашборда', reports_amounts: 'Суммы в отчётах', pl_panel: 'P&L — доходы и расходы' };
export const staffMonth = (now = new Date()) => vladivostokDate(now).slice(0, 7);
function closedBusinessDay(value: string | undefined): string {
  if (!value) return '';
  // Date-only legacy records already represent a business day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? vladivostokDate(date) : '';
}
export const staffName = (s: StaffMember) => s.name?.trim() || s.email || 'Без имени';
export function staffRole(s: StaffMember): StaffRole { return s.role && s.role in ROLE_LABELS ? s.role : 'mechanic'; }
export function effectivePermissions(s: StaffMember): StaffPermissions {
  return { dashboard_financials: s.permissions?.dashboard_financials !== false, reports_amounts: s.permissions?.reports_amounts !== false, pl_panel: s.permissions?.pl_panel !== false };
}
export interface StaffRepairResult { key: string; clientName: string; title: string; date: string; cost: number; share: number; participants: number }
export interface StaffResult { member: StaffMember; total: number; closed: number; active: number; rank?: number; tied: boolean; repairs: StaffRepairResult[] }
export function buildStaffResults(staff: StaffMember[], clients: Client[], intake: IntakeRepair[], month: string): StaffResult[] {
  const rows: StaffResult[] = staff.map(member => ({ member, total: 0, closed: 0, active: 0, tied: false, repairs: [] }));
  const byId = new Map(rows.map(row => [row.member.id, row]));
  for (const repair of collectDashboardRepairs(clients, intake)) {
    if (repair.phase === 'cancelled') continue;
    for (const uid of repair.mechanicIds) {
      const row = byId.get(uid);
      if (!row) continue;
      if (repair.phase !== 'closed') { row.active++; continue; }
      // Intake has not yet been assigned/priced by the manager.
      const closedDay = closedBusinessDay(repair.closedAt ?? repair.date);
      if (repair.source !== 'client' || closedDay.slice(0, 7) !== month) continue;
      const cost = Math.max(0, dashboardNumber(repair.cost));
      const share = cost / repair.mechanicIds.length;
      row.closed++;
      row.total += share;
      row.repairs.push({ key: repair.key, clientName: repair.clientName, title: repair.description || repair.vehicle?.plate || repair.equipment || 'Ремонт', date: closedDay, cost, share, participants: repair.mechanicIds.length });
    }
  }
  const rated = rows.filter(r => staffRole(r.member) === 'mechanic' && r.total > 0).sort((a, b) => b.total - a.total);
  let rank = 1;
  for (let i = 0; i < rated.length; i++) {
    if (i && Math.round(rated[i].total * 100) < Math.round(rated[i - 1].total * 100)) rank = i + 1;
    rated[i].rank = rank;
  }
  const frequencies = new Map<number, number>();
  for (const row of rated) frequencies.set(row.rank!, (frequencies.get(row.rank!) ?? 0) + 1);
  for (const row of rated) row.tied = frequencies.get(row.rank!)! > 1;
  for (const row of rows) row.repairs.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return rows;
}
export interface StaffFilters { search: string; role: StaffRole | 'all'; activity: 'all' | 'active' | 'idle'; sort: 'name' | 'role' | 'active' | 'result' }
export function selectStaff(rows: StaffResult[], filters: StaffFilters): StaffResult[] {
  const words = filters.search.trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
  const order: Record<StaffRole, number> = { owner: 0, admin: 1, manager: 2, mechanic: 3 };
  return rows.filter(row => {
    const haystack = `${staffName(row.member)} ${row.member.email || ''} ${ROLE_LABELS[staffRole(row.member)]}`.toLocaleLowerCase('ru').replace(/ё/g, 'е');
    return words.every(word => haystack.includes(word)) && (filters.role === 'all' || staffRole(row.member) === filters.role)
      && (filters.activity === 'all' || (filters.activity === 'active' ? row.active > 0 : row.active === 0));
  }).sort((a, b) => {
    const name = staffName(a.member).localeCompare(staffName(b.member), 'ru') || a.member.id.localeCompare(b.member.id);
    if (filters.sort === 'active') return b.active - a.active || name;
    if (filters.sort === 'result') return b.total - a.total || name;
    if (filters.sort === 'role') return order[staffRole(a.member)] - order[staffRole(b.member)] || name;
    return name;
  });
}
export function staffEditPolicy(uid: string, actorRole: StaffRole, member: StaffMember) {
  const self = uid === member.id;
  const manager = actorRole === 'owner' || actorRole === 'admin';
  return { name: self || manager && staffRole(member) !== 'owner', role: !self && manager && staffRole(member) !== 'owner', permissions: !self && actorRole === 'owner' && staffRole(member) === 'admin' };
}
export interface StaffFormValues { name: string; role: StaffRole; permissions: StaffPermissions }
export function staffProfileChanges(member: StaffMember, values: StaffFormValues, uid: string, actorRole: StaffRole): Partial<StaffMember> {
  const policy = staffEditPolicy(uid, actorRole, member);
  const name = values.name.trim();
  if (!name || name.length > 120) throw new Error('Укажите имя сотрудника — от 1 до 120 символов.');
  const patch: Partial<StaffMember> = {};
  if (name !== (member.name ?? '')) {
    if (!policy.name) throw new Error('Нет доступа к редактированию сотрудника.');
    patch.name = name;
  }
  if (values.role !== staffRole(member)) {
    if (!policy.role || !['admin', 'manager', 'mechanic'].includes(values.role)) throw new Error('Эту роль нельзя изменить.');
    patch.role = values.role;
  }
  const current = effectivePermissions(member);
  const changed = (Object.keys(current) as (keyof StaffPermissions)[]).some(key => current[key] !== values.permissions[key]);
  if (changed && values.role === 'admin') {
    if (!policy.permissions) throw new Error('Только владелец может менять финансовый доступ администратора.');
    patch.permissions = values.permissions;
  }
  return patch;
}
