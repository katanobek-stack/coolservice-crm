import {useMemo,useSyncExternalStore} from 'react';
import type {ResourceSnapshot} from '../../src/shared/types/resources';
const staff=[{id:'owner',name:'Руководитель',role:'owner'},{id:'m1',name:'Алексей',role:'mechanic'},{id:'m2',name:'Сергей',role:'mechanic'}];
export const task={id:'task',description:'Заменить соединение',assignees:['m1'],doneBy:['m1'],status:'done' as const};
export const original={id:'original',description:'Ремонт рефрижератора',serviceType:'refrigerator' as const,closedByManager:true,date:'2026-11-10',workCompletedAt:'2026-11-11T01:00:00Z',cost:'5000',tasks:[task]};
const linked={id:'linked',repairId:'linked',originalClientId:'client',originalRepairId:'original',originalTaskId:'task',cause:'pending' as const,responsibleStaffIds:[],decisionNote:''};
export const child={...original,id:'linked',closedByManager:false,description:'Проверить утечку повторно',rework:linked,tasks:[{...task,assignees:['m2']}]};
let role='owner',version=0;const listeners=new Set<()=>void>();
const crm={staff,clients:[{id:'client',name:'ООО Север',vehicles:[],repairs:[original,child]}],intakeRepairs:[{id:'intake',repair:{...original,id:'intakeRepair'}}],sourceStatus:{clients:'ready',intakeRepairs:'ready',staff:'ready'}};
let data:ResourceSnapshot={items:[{id:'fitting',name:'Соединение 1/4',unit:'pcs',quantityMilli:10000,minimumMilli:2000,revision:1,active:true}],entries:[],confirmations:[],reworks:[linked],valuations:[{id:'fitting',valueCents:10000}],rates:[{id:'m1',hourlyCostCents:60000},{id:'m2',hourlyCostCents:60000}],costs:[],movements:[],ready:true,financialReady:true,error:''};
const logs:object[]=[];
function notify(){version++;listeners.forEach(listener=>listener());}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function useAuth(){useSyncExternalStore(subscribe,()=>version);return {myProfile:{id:role==='owner'?'owner':'m1',role:role==='denied'?'manager':role,permissions:{pl_panel:role!=='denied'}},isOwner:role==='owner'};}
export function useData(){useSyncExternalStore(subscribe,()=>version);return crm;}
export function setRole(next:string){role=next;notify();}
export function useResources(financial:boolean){useSyncExternalStore(subscribe,()=>version);return useMemo(()=>financial?data:{...data,costs:[],valuations:[],rates:[],movements:[],financialReady:false},[financial,data]);}
async function mutate(action:string,input:any){
 logs.push({action,...input});const id=`entry-${logs.length}`;
 if(action==='saveMaterial')data={...data,items:data.items.some(item=>item.id===input.id)?data.items.map(item=>item.id===input.id?{...item,...input,revision:item.revision+1}:item):[...data.items,{id:input.id,name:input.name,unit:input.unit,quantityMilli:0,minimumMilli:input.minimumMilli,revision:1,active:true}]};
 if(action==='receiveMaterial')data={...data,items:data.items.map(item=>item.id===input.materialId?{...item,quantityMilli:item.quantityMilli+input.quantityMilli,revision:item.revision+1}:item),movements:[...data.movements,{...input,id,type:'receipt',createdBy:'owner'}]};
 if(action==='countMaterialStock')data={...data,items:data.items.map(item=>item.id===input.materialId?{...item,quantityMilli:input.quantityMilli,revision:item.revision+1}:item)};
 if(action==='setMaterialValuation')data={...data,valuations:[...data.valuations.filter(item=>item.id!==input.materialId),{id:input.materialId,valueCents:input.valueCents}]};
 if(action==='saveResourceRate')data={...data,rates:[...data.rates.filter(item=>item.id!==input.staffId),{id:input.staffId,hourlyCostCents:input.hourlyCostCents}]};
 if(action==='consumeMaterial')data={...data,items:data.items.map(item=>({...item,quantityMilli:item.quantityMilli-input.quantityMilli})),entries:[...data.entries,{...input,id,type:'material',repairId:input.target.repairId,materialName:'Соединение 1/4',unit:'pcs',createdBy:'m1'}],confirmations:[]};
 if(action==='addRepairTime'||action==='addPieceCharge')data={...data,entries:[...data.entries,{...input,id,type:action==='addRepairTime'?'time':'piece',repairId:input.target.repairId,createdBy:'m1'}],costs:[...data.costs,{id,repairId:input.target.repairId,costCents:input.minutes*1000}],confirmations:[]};
 if(action==='returnMaterial')data={...data,items:data.items.map(item=>item.id===data.entries.find(entry=>entry.id===input.entryId)?.materialId?{...item,quantityMilli:item.quantityMilli+input.quantityMilli}:item),entries:data.entries.map(entry=>entry.id===input.entryId?{...entry,returnedMilli:(entry.returnedMilli??0)+input.quantityMilli}:entry),confirmations:[]};
 if(action==='voidRepairTime')data={...data,entries:data.entries.map(entry=>entry.id===input.entryId?{...entry,voided:true}:entry),confirmations:[]};
 if(action==='confirmTaskResources')data={...data,confirmations:[{id,repairId:input.target.repairId,taskId:input.taskId,assigneeIds:['m1'],confirmedBy:'m1'}]};
 if(action==='decideRepairRework')data={...data,reworks:data.reworks.map(item=>item.id===input.repairId?{...item,cause:input.cause,responsibleStaffIds:input.responsibleStaffIds,decisionNote:input.note}:item)};
 notify();return {id,repairId:'created-rework'};
}
export const consumeMaterial=(input:any)=>mutate('consumeMaterial',input),returnMaterial=(input:any)=>mutate('returnMaterial',input),addRepairTime=(input:any)=>mutate('addRepairTime',input),voidRepairTime=(input:any)=>mutate('voidRepairTime',input),addPieceCharge=(input:any)=>mutate('addPieceCharge',input),confirmTaskResources=(input:any)=>mutate('confirmTaskResources',input),createRepairRework=(input:any)=>mutate('createRepairRework',input),decideRepairRework=(input:any)=>mutate('decideRepairRework',input),saveRepairPaymentDestination=(input:any)=>mutate('saveRepairPaymentDestination',input),saveMaterial=(input:any)=>mutate('saveMaterial',input),receiveMaterial=(input:any)=>mutate('receiveMaterial',input),countMaterialStock=(input:any)=>mutate('countMaterialStock',input),saveResourceRate=(input:any)=>mutate('saveResourceRate',input),setMaterialValuation=(input:any)=>mutate('setMaterialValuation',input);
Object.assign(window,{resourcePreview:{logs,setRole,getState:()=>({data,crm,role})}});
