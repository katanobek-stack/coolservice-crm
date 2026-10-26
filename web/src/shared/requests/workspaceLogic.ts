import type {Client,Repair,RepairTask} from '../types/client';
import type {IntakeRepair} from '../types/intake';
import {intakeKind} from '../types/intake';
import type {ServiceTask} from '../types/task';
import type {StaffMember} from '../types/staff';
import {getAssignees,repairStatus,taskStatus} from '../utils/repair';
import {normalizePlate} from '../utils/plate';
export type RequestStage='active'|'ready'|'closed'|'cancelled';
export type RequestStatus='open'|'active'|'ready'|'archive';
export interface RequestScope {uid:string;manager:boolean;search:string;employee:string;mine:boolean;status:RequestStatus;sort:'newest'|'oldest';kind:string;staff:StaffMember[]}
export interface ClientRequest {client:Client;repair:Repair;tasks:RepairTask[]}
export function requestStage(repair:Repair):RequestStage {
 if(repair.status==='cancelled')return 'cancelled';
 // Returning a repair explicitly clears this flag but intentionally preserves its audit timestamp.
 if(repair.closedByManager===true||(repair.closedAt&&repair.closedByManager!==false))return 'closed';
 return repairStatus(repair)==='done'?'ready':'active';
}
export function requestStageLabel(stage:RequestStage):string {
 return {active:'В работе',ready:'Ждёт менеджера',closed:'Закрыта',cancelled:'Отказ'}[stage];
}
export function requestAssignees(repair:Repair):string[]{
 const ids=new Set((repair.tasks??[]).flatMap(getAssignees));
 if(!ids.size)(repair.mechanics??[]).forEach(id=>ids.add(id));
 const legacy=(repair as Repair&{mechanic?:string}).mechanic;if(!ids.size&&legacy)ids.add(legacy);
 return [...ids];
}
const norm=(value:string)=>value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
function matchesSearch(values:Array<string|undefined>,plate:string|undefined,search:string):boolean{
 const text=norm(values.filter(Boolean).join(' ')),normalizedPlate=normalizePlate(plate);
 return norm(search).trim().split(/\s+/).filter(Boolean).every(word=>text.includes(word)||(!!normalizedPlate&&!!normalizePlate(word)&&normalizedPlate.includes(normalizePlate(word))));
}
function staffNames(ids:string[],scope:RequestScope):string{return ids.map(id=>scope.staff.find(s=>s.id===id)?.name||scope.staff.find(s=>s.id===id)?.email||id).join(' ');}
function assigned(ids:string[],scope:RequestScope):boolean{return (!scope.mine||ids.includes(scope.uid))&&(!scope.employee||(scope.employee==='unassigned'?!ids.length:ids.includes(scope.employee)));}
function stageMatches(stage:RequestStage,scope:RequestScope):boolean{return scope.status==='open'?(stage==='active'||stage==='ready'):scope.status==='archive'?(stage==='closed'||stage==='cancelled'):stage===scope.status;}
function sorted<T>(rows:T[],scope:RequestScope,date:(r:T)=>string,id:(r:T)=>string):T[]{return rows.sort((a,b)=>{const ad=date(a),bd=date(b);if(!ad&&!bd)return id(a).localeCompare(id(b));if(!ad)return 1;if(!bd)return -1;return (scope.sort==='oldest'?ad.localeCompare(bd):bd.localeCompare(ad))||id(a).localeCompare(id(b));});}
export function selectClientRequests(clients:readonly Client[],scope:RequestScope):ClientRequest[]{
 const result:ClientRequest[]=[];
 for(const client of clients)for(const repair of client.repairs??[]){
  const stage=requestStage(repair),all=repair.tasks??[];
  const visible=scope.manager?all:all.filter(t=>taskStatus(t)!=='done'&&getAssignees(t).includes(scope.uid));
  if(!scope.manager&&(stage!=='active'||!visible.length))continue;
  const ids=requestAssignees(repair),vehicle=client.vehicles?.find(v=>v.id===repair.vehicleId),chamber=client.chambers?.find(c=>c.id===repair.chamberId);
  if(!stageMatches(stage,scope)||!assigned(ids,scope)||!matchesSearch([client.name,client.phone,repair.description,vehicle?.brand,vehicle?.model,vehicle?.plate,chamber?.notes,staffNames(ids,scope),...visible.map(t=>t.description)],vehicle?.plate,scope.search))continue;
  result.push({client,repair,tasks:visible});
 }
 return sorted(result,scope,r=>r.repair.createdAt||r.repair.date||'',r=>`${r.client.id}/${r.repair.id}`);
}
export function selectIntakeRequests(intake:readonly IntakeRepair[],scope:RequestScope):IntakeRepair[]{
 const rows=intake.filter(item=>{if(!item?.repair||(!item.vehicle&&!item.chamber))return false;
 const ids=requestAssignees(item.repair),kind=intakeKind(item);
 return (scope.kind==='all'||scope.kind===kind||(scope.kind==='ac'&&kind==='vehicle'&&item.vehicle?.serviceType==='ac'))&&stageMatches(requestStage(item.repair),scope)&&assigned(ids,scope)&&matchesSearch([item.vehicle?.plate,item.vehicle?.brand,item.vehicle?.model,item.chamber?.label,item.chamber?.notes,item.repair.description,item.createdByName,staffNames(ids,scope),...(item.repair.tasks??[]).map(t=>t.description)],item.vehicle?.plate,scope.search);
 });return sorted(rows,scope,r=>r.createdAt||r.repair.date||'',r=>r.id);
}
export function selectServiceRequests(tasks:readonly ServiceTask[],scope:RequestScope):ServiceTask[]{
 const rows=tasks.filter(task=>{const ids=task.assignees??[];
 if(!scope.manager&&!ids.includes(scope.uid))return false;
 const done=task.status==='done';if(scope.status==='archive'?!done:done)return false;
 return assigned(ids,scope)&&matchesSearch([task.title,task.description,task.workComment,staffNames(ids,scope),...(task.subtasks??[]).map(t=>t.description)],undefined,scope.search);
 });return sorted(rows,scope,r=>typeof r.createdAt==='string'?r.createdAt:typeof (r.createdAt as {toDate?:unknown})?.toDate==='function'?(r.createdAt as {toDate():Date}).toDate().toISOString():'',r=>r.id);
}
