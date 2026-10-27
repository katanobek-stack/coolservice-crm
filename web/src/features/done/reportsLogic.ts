import type {Client,Repair,Vehicle} from '../../shared/types/client';
import type {IntakeRepair} from '../../shared/types/intake';
import type {StaffMember} from '../../shared/types/staff';
import {selectClientRequests,selectIntakeRequests,requestAssignees,type RequestScope} from '../../shared/requests/workspaceLogic';
import {repairFinancialMonth} from '../../shared/utils/repair';
export interface ReportFilters{origin?:'all'|'client'|'intake';search:string;employee:string;kind:string;month:string;status:string;sort:'newest'|'oldest'}
export const DEFAULT_REPORT_FILTERS:ReportFilters={search:'',employee:'',kind:'all',month:'all',status:'all',sort:'oldest'};
export interface DoneItem{repair:Repair;client:Client;vehicle?:Vehicle;assigneeNames:string;createdByName:string;mk:string;objectLabel:string}
export function reportScope(staff:StaffMember[],filters:ReportFilters,status:RequestScope['status']):RequestScope{return {uid:'',manager:true,mine:false,staff,search:filters.search,employee:filters.employee,kind:filters.kind,sort:filters.sort,status};}
export function selectReportItems(clients:Client[],staff:StaffMember[],filters:ReportFilters,view:'queue'|'archive'):DoneItem[]{
 if(view==='queue'&&filters.origin==='intake')return [];
 return selectClientRequests(clients,reportScope(staff,filters,view==='queue'?'ready':'archive')).filter(({repair})=>{
 const kind=repair.chamberId?'chamber':repair.vehicleId?'vehicle':'other';
 return (filters.kind==='all'||filters.kind===kind)&&(view==='queue'||((filters.month==='all'||(repairFinancialMonth(repair)||'0000-00')===filters.month)&&(filters.status==='all'||(filters.status==='cancelled'?repair.status==='cancelled':repair.status!=='cancelled'))));
 }).map(({client,repair})=>{
 const vehicle=client.vehicles?.find(v=>v.id===repair.vehicleId),chamber=client.chambers?.find(c=>c.id===repair.chamberId);
 return {client,repair,vehicle,mk:repairFinancialMonth(repair)||'0000-00',createdByName:repair.createdByName||'—',assigneeNames:requestAssignees(repair).map(id=>staff.find(s=>s.id===id)?.name||id).join(', '),objectLabel:vehicle?[vehicle.brand||vehicle.model,vehicle.plate].filter(Boolean).join(' · '):repair.chamberId?(chamber?.notes||`Камера ${repair.chamberId.slice(0,6)}`):'Без привязки к технике'};
 });
}
export function selectReportIntake(intakes:IntakeRepair[],staff:StaffMember[],filters:ReportFilters):IntakeRepair[]{if(filters.origin==='client')return [];return selectIntakeRequests(intakes,reportScope(staff,filters,'ready'));}
export function confirmedReportData<T>(current:T,last:T,status:'ready'|'loading'|'error'):T{return status==='ready'?current:last;}
export function reportTaskMonth(task:import('../../shared/types/task').ServiceTask):string{
 const date=task.createdAt;
 return typeof date==='string'?date.slice(0,7):date&&typeof date==='object'&&'seconds' in date?new Date((date as {seconds:number}).seconds*1000).toISOString().slice(0,7):'0000-00';
}
export function reportArchiveMonths(items:DoneItem[],tasks:import('../../shared/types/task').ServiceTask[]):string[]{return [...new Set([...items.map(i=>i.mk),...tasks.filter(t=>t.status==='done').map(reportTaskMonth)])].sort().reverse();}
