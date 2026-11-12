import { getFirestore, FieldValue, type Transaction, type DocumentData } from 'firebase-admin/firestore';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { consumeStock, receiveStock, returnCost, laborCost, integer } from './resourceLogic';

const db = () => getFirestore();
const stamp = () => FieldValue.serverTimestamp();
const ref = (collection: string, id: string) => db().collection(collection).doc(id);
const confirmationRef = (repairId: string, taskId: string) => ref('repairResourceConfirmations',createHash('sha256').update(`${repairId}:${taskId}`).digest('hex'));
function id(value: unknown): string { if(typeof value !== 'string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value))throw new HttpsError('invalid-argument','Некорректный идентификатор'); return value; }
function text(value: unknown, max=1000): string { if(typeof value!=='string'||value.trim().length>max)throw new HttpsError('invalid-argument','Некорректный текст');return value.trim(); }
function amount(value: unknown, min=0, max=1e12): number { try{return integer(value,min,max);}catch{throw new HttpsError('invalid-argument','Некорректное количество или сумма');} }
const requireManager = (actor: Actor) => {if(!actor.manager)throw new HttpsError('permission-denied','Действие доступно менеджеру');};
const requireFinance = (actor: Actor) => {if(!actor.financial)throw new HttpsError('permission-denied','Нет доступа к финансовой панели');};
interface Actor { uid:string; name:string; manager:boolean; financial:boolean }
async function actorFor(request: CallableRequest): Promise<Actor> {
  if(!request.auth)throw new HttpsError('unauthenticated','Войдите в CRM');
  const profile=(await ref('staff',request.auth.uid).get()).data();
  const owner=request.auth.token.role==='owner'||profile?.role==='owner';
  if(!owner&&!['admin','manager','mechanic'].includes(profile?.role))throw new HttpsError('permission-denied','Нет рабочего профиля');
  const manager=owner||['admin','manager'].includes(profile?.role);
  return {uid:request.auth.uid,name:profile?.name||'Сотрудник',manager,financial:owner||manager&&profile?.permissions?.pl_panel!==false};
}
async function repairTarget(tx: Transaction, data: DocumentData, actor: Actor) {
  const target=data.target;
  if(!target||!['client','intake'].includes(target.kind))throw new HttpsError('invalid-argument','Выберите заявку');
  const documentId=id(target.documentId), repairId=id(target.repairId);
  const documentRef=ref(target.kind==='client'?'clients':'intakeRepairs',documentId);
  const document=(await tx.get(documentRef)).data();
  const repair=target.kind==='client'?(document?.repairs??[]).find((r:DocumentData)=>r.id===repairId):document?.repair;
  if(!repair||repair.id!==repairId)throw new HttpsError('not-found','Заявка удалена или перенесена. Откройте её заново.');
  if(repair.status==='cancelled'||repair.closedByManager&&!actor.manager)throw new HttpsError('failed-precondition','Заявка закрыта для изменений');
  const task=(repair.tasks??[]).find((t:DocumentData)=>t.id===id(data.taskId));
  if(!task)throw new HttpsError('not-found','Задача не найдена');
  if(!actor.manager&&!(task.assignees??[]).includes(actor.uid))throw new HttpsError('permission-denied','Можно учитывать расход и время только по своей задаче');
  return {repair,task,document,documentRef,repairId,target};
}
function precision(unit: string, quantity: number) { if(unit==='pcs'&&quantity%1000!==0)throw new HttpsError('invalid-argument','Штучные материалы учитываются целыми штуками'); }
async function runAction(action:string,data:DocumentData,actor:Actor,tx:Transaction,operationId:string):Promise<DocumentData> {
  const audit={createdBy:actor.uid,createdAt:stamp()};
  if(action==='saveMaterial') {
    requireManager(actor); const materialId=id(data.id), name=text(data.name,160), unit=data.unit, minimumMilli=amount(data.minimumMilli);
    if(!name||!['pcs','kg','ml','m'].includes(unit))throw new HttpsError('invalid-argument','Укажите название и единицу материала'); precision(unit,minimumMilli);
    const itemRef=ref('materialItems',materialId), old=(await tx.get(itemRef)).data();
    if(old&&(old.revision!==data.expectedRevision||old.unit!==unit))throw new HttpsError('aborted','Материал уже изменён. Обновите данные.');
    tx.set(itemRef,{name,unit,minimumMilli,active:data.active!==false,quantityMilli:old?.quantityMilli??0,revision:(old?.revision??0)+1,updatedBy:actor.uid,updatedAt:stamp()});
    if(!old)tx.create(ref('materialValuations',materialId),{valueCents:0});
    return {id:materialId};
  }
  if(['receiveMaterial','setMaterialValuation','countMaterialStock'].includes(action)) {
    requireManager(actor); const materialId=id(data.materialId), itemRef=ref('materialItems',materialId), valueRef=ref('materialValuations',materialId);
    const item=(await tx.get(itemRef)).data(), valuation=(await tx.get(valueRef)).data();
    if(!item)throw new HttpsError('not-found','Материал не найден');
    if(action==='countMaterialStock') {
      if(item.revision!==data.expectedRevision)throw new HttpsError('aborted','Остаток изменился. Обновите данные перед сверкой.');
      const quantityMilli=amount(data.quantityMilli),note=text(data.note);precision(item.unit,quantityMilli);
      if(!note)throw new HttpsError('invalid-argument','Укажите причину сверки остатка');
      const before={quantityMilli:item.quantityMilli,valueCents:valuation?.valueCents??null};
      const after=quantityMilli===before.quantityMilli?before:quantityMilli<before.quantityMilli?consumeStock(before,before.quantityMilli-quantityMilli):receiveStock(before,quantityMilli-before.quantityMilli,null);
      tx.update(itemRef,{quantityMilli,revision:item.revision+1,updatedAt:stamp(),updatedBy:actor.uid});tx.set(valueRef,{valueCents:after.valueCents});
      tx.create(ref('materialMovements',operationId),{materialId,type:'count',quantityMilli:quantityMilli-before.quantityMilli,costCents:before.valueCents===null||after.valueCents===null?null:after.valueCents-before.valueCents,note,...audit});
      return {id:operationId};
    }
    if(action==='setMaterialValuation') {
      requireFinance(actor); if(item.revision!==data.expectedRevision)throw new HttpsError('aborted','Остаток изменился. Обновите данные.');
      const valueCents=amount(data.valueCents); if(!item.quantityMilli&&valueCents)throw new HttpsError('invalid-argument','Нулевой остаток не может иметь стоимость');
      tx.set(valueRef,{valueCents});tx.update(itemRef,{revision:item.revision+1,updatedAt:stamp(),updatedBy:actor.uid});
      return {id:materialId,previousValueCents:valuation?.valueCents??null,valueCents};
    }
    const quantityMilli=amount(data.quantityMilli,1),costCents=data.costCents===null?null:amount(data.costCents);precision(item.unit,quantityMilli);
    if(costCents!==null)requireFinance(actor);
    const stock=receiveStock({quantityMilli:item.quantityMilli,valueCents:valuation?.valueCents??null},quantityMilli,costCents);
    tx.update(itemRef,{quantityMilli:stock.quantityMilli,revision:item.revision+1,updatedAt:stamp(),updatedBy:actor.uid}); tx.set(valueRef,{valueCents:stock.valueCents});
    tx.create(ref('materialMovements',operationId),{materialId,type:'receipt',quantityMilli,costCents,note:text(data.note),...audit});
    return {id:operationId};
  }
  if(action==='saveResourceRate') {
    requireFinance(actor); const staffId=id(data.staffId);if(!(await tx.get(ref('staff',staffId))).exists)throw new HttpsError('not-found','Сотрудник не найден');
    tx.set(ref('resourceRates',staffId),{hourlyCostCents:amount(data.hourlyCostCents),updatedBy:actor.uid,updatedAt:stamp()});return {id:staffId};
  }
  if(action==='confirmTaskResources') {
    const target=await repairTarget(tx,data,actor);
    const rows=(await tx.get(db().collection('repairResources').where('repairId','==',target.repairId))).docs.map(doc=>doc.data()).filter(entry=>entry.taskId===target.task.id&&!entry.voided&&['time','piece'].includes(entry.type));
    const assigneeIds=[...new Set<string>(target.task.assignees??[])];
    if(!rows.length||assigneeIds.some(uid=>!rows.some(entry=>entry.staffId===uid)))throw new HttpsError('failed-precondition','Внесите время каждого исполнителя задачи или сдельное начисление');
    tx.set(confirmationRef(target.repairId,target.task.id),{repairId:target.repairId,taskId:target.task.id,assigneeIds,confirmedBy:actor.uid,createdAt:stamp()});return {id:target.task.id};
  }
  if(['consumeMaterial','addRepairTime','addPieceCharge'].includes(action)) {
    const target=await repairTarget(tx,data,actor), note=text(data.note);
    const base={repairId:target.repairId,taskId:id(data.taskId),sourceKind:target.target.kind,documentId:target.target.documentId,note,...audit};
    if(action==='consumeMaterial') {
      const materialId=id(data.materialId),quantityMilli=amount(data.quantityMilli,1),itemRef=ref('materialItems',materialId),valueRef=ref('materialValuations',materialId);
      const item=(await tx.get(itemRef)).data(),valuation=(await tx.get(valueRef)).data();
      if(!item||!item.active)throw new HttpsError('failed-precondition','Материал не доступен для списания');precision(item.unit,quantityMilli);
      const stock=consumeStock({quantityMilli:item.quantityMilli,valueCents:valuation?.valueCents??null},quantityMilli);
      tx.update(itemRef,{quantityMilli:stock.quantityMilli,revision:item.revision+1,updatedAt:stamp(),updatedBy:actor.uid});tx.set(valueRef,{valueCents:stock.valueCents});
      tx.create(ref('repairResources',operationId),{...base,type:'material',materialId,materialName:item.name,unit:item.unit,quantityMilli,returnedMilli:0});
      tx.create(ref('resourceCosts',operationId),{repairId:target.repairId,costCents:stock.costCents});
      tx.create(ref('materialMovements',operationId),{materialId,type:'material',quantityMilli:-quantityMilli,costCents:stock.costCents,repairId:target.repairId,note,...audit});
    } else {
      const staffId=id(data.staffId);if(!actor.manager&&staffId!==actor.uid)throw new HttpsError('permission-denied','Можно учитывать только своё время');
      if(!(await tx.get(ref('staff',staffId))).exists)throw new HttpsError('not-found','Сотрудник не найден');
      if(action==='addPieceCharge') {
        requireFinance(actor);const costCents=amount(data.costCents);
        if(!note)throw new HttpsError('invalid-argument','Укажите основание сдельного начисления');
        tx.create(ref('repairResources',operationId),{...base,type:'piece',staffId,voided:false});
        tx.create(ref('resourceCosts',operationId),{repairId:target.repairId,costCents});
      } else {
        const minutes=amount(data.minutes,0,1440), rate=(await tx.get(ref('resourceRates',staffId))).data(),hourlyCostCents=rate?.hourlyCostCents??null;
        if(minutes===0&&!note)throw new HttpsError('invalid-argument','Для нулевого времени укажите причину: работа не выполнялась');
        tx.create(ref('repairResources',operationId),{...base,type:'time',staffId,minutes,voided:false});
        tx.create(ref('resourceCosts',operationId),{repairId:target.repairId,costCents:laborCost(minutes,hourlyCostCents),...(hourlyCostCents===null?{}:{hourlyCostCents})});
      }
    }
    tx.delete(confirmationRef(target.repairId,id(data.taskId)));
    return {id:operationId};
  }
  if(action==='returnMaterial'||action==='voidRepairTime') {
    const entryRef=ref('repairResources',id(data.entryId)),entry=(await tx.get(entryRef)).data();
    if(!entry)throw new HttpsError('not-found','Запись не найдена');
    if(!actor.manager&&entry.createdBy!==actor.uid)throw new HttpsError('permission-denied','Изменять чужую запись может менеджер');
    const note=text(data.note);if(!note)throw new HttpsError('invalid-argument','Укажите причину исправления');
    if(action==='voidRepairTime') {
      if(!['time','piece'].includes(entry.type)||entry.voided)throw new HttpsError('failed-precondition','Запись уже аннулирована или не является трудозатратами');
      if(entry.type==='piece')requireFinance(actor);
      tx.update(entryRef,{voided:true,voidReason:note,voidedBy:actor.uid,voidedAt:stamp()});tx.delete(confirmationRef(entry.repairId,entry.taskId));return {id:entryRef.id};
    }
    if(entry.type!=='material')throw new HttpsError('failed-precondition','Возврат возможен только по расходу материала');
    const itemRef=ref('materialItems',entry.materialId), valueRef=ref('materialValuations',entry.materialId);
    const item=(await tx.get(itemRef)).data(),valuation=(await tx.get(valueRef)).data(),cost=(await tx.get(ref('resourceCosts',entryRef.id))).data();
    if(!item)throw new HttpsError('failed-precondition','Материал не найден');
    const quantityMilli=amount(data.quantityMilli,1);precision(item.unit,quantityMilli);
    const costCents=returnCost(cost?.costCents??null,entry.quantityMilli,entry.returnedMilli??0,quantityMilli);
    const stock=receiveStock({quantityMilli:item.quantityMilli,valueCents:valuation?.valueCents??null},quantityMilli,costCents);
    tx.update(itemRef,{quantityMilli:stock.quantityMilli,revision:item.revision+1,updatedAt:stamp(),updatedBy:actor.uid});tx.set(valueRef,{valueCents:stock.valueCents});
    tx.update(entryRef,{returnedMilli:(entry.returnedMilli??0)+quantityMilli});
    tx.create(ref('repairResources',operationId),{repairId:entry.repairId,taskId:entry.taskId,type:'return',materialId:entry.materialId,materialName:entry.materialName,unit:entry.unit,quantityMilli,originalId:entryRef.id,note,...audit});
    tx.create(ref('resourceCosts',operationId),{repairId:entry.repairId,costCents:costCents===null?null:-costCents});
    tx.create(ref('materialMovements',operationId),{materialId:entry.materialId,type:'return',quantityMilli,costCents,repairId:entry.repairId,note,...audit});
    tx.delete(confirmationRef(entry.repairId,entry.taskId));
    return {id:operationId};
  }
  if(action==='createRepairRework'||action==='decideRepairRework'||action==='saveRepairPaymentDestination') {
    requireManager(actor);
    if(action==='saveRepairPaymentDestination') {
      const target=data.target;if(!target||!['client','intake'].includes(target.kind))throw new HttpsError('invalid-argument','Выберите заявку');
      const documentRef=ref(target.kind==='client'?'clients':'intakeRepairs',id(target.documentId)),document=(await tx.get(documentRef)).data();
      const repair=target.kind==='client'?(document?.repairs??[]).find((r:DocumentData)=>r.id===id(target.repairId)):document?.repair;
      if(!repair||repair.id!==target.repairId)throw new HttpsError('not-found','Заявка не найдена');
      if(!['cash','bank','unspecified'].includes(data.destination))throw new HttpsError('invalid-argument','Выберите кассу или расчётный счёт');
      const next={...repair,paymentDestination:data.destination};
      tx.update(documentRef,target.kind==='client'?{repairs:document!.repairs.map((r:DocumentData)=>r.id===repair.id?next:r)}:{repair:next});return {id:repair.id};
    }
    const clientId=id(data.clientId),clientRef=ref('clients',clientId),client=(await tx.get(clientRef)).data();
    if(!client)throw new HttpsError('not-found','Клиент не найден');
    const repairs=client.repairs??[];
    if(action==='createRepairRework') {
      const original=repairs.find((r:DocumentData)=>r.id===id(data.originalRepairId));
      const originalLink=(await tx.get(ref('repairReworks',id(data.originalRepairId)))).data();
      if(!original||!original.closedByManager||originalLink)throw new HttpsError('failed-precondition','Выберите исходный ремонт, оформленный менеджером');
      const originalTaskId=id(data.originalTaskId),task=(original.tasks??[]).find((t:DocumentData)=>t.id===originalTaskId);
      if(!task)throw new HttpsError('not-found','Исходная работа не найдена');
      if(!Array.isArray(data.assignees)||data.assignees.length>30)throw new HttpsError('invalid-argument','Выберите исполнителей');
      const assignees=[...new Set<string>(data.assignees.map(id))];
      for(const uid of assignees)if(!(await tx.get(ref('staff',uid))).exists)throw new HttpsError('not-found','Исполнитель не найден');
      const description=text(data.description);if(!description)throw new HttpsError('invalid-argument','Опишите переделку');
      const now=new Date().toISOString(),repairId=`rw_${operationId}`,taskBase={assignees,doneBy:[],status:'in_progress',createdBy:actor.uid,createdByName:actor.name,createdAt:now};
      const repair={id:repairId,serviceType:original.serviceType??'other',...(original.vehicleId?{vehicleId:original.vehicleId}:{}),...(original.chamberId?{chamberId:original.chamberId}:{}),description:`Переделка: ${description}`,date:new Date(Date.now()+36000000).toISOString().slice(0,10),cost:'0',status:'in_progress',closedByManager:false,createdBy:actor.uid,createdByName:actor.name,createdAt:now,rework:{originalClientId:clientId,originalRepairId:original.id,originalTaskId,cause:'pending',responsibleStaffIds:[],decisionNote:''},tasks:[{...taskBase,id:`task_${operationId}`,description},{...taskBase,id:`freon_${operationId}`,description:'Заправка фреона',freonTask:true}]};
      tx.update(clientRef,{repairs:[...repairs,repair]});
      tx.create(ref('repairReworks',repairId),{...repair.rework,repairId,...audit});return {repairId};
    }
    const repairId=id(data.repairId),repair=repairs.find((r:DocumentData)=>r.id===repairId);
    const link=(await tx.get(ref('repairReworks',repairId))).data();
    if(!repair||!link||link.originalClientId!==clientId)throw new HttpsError('failed-precondition','Это не подтверждённая связанная переделка');
    if(!['pending','workmanship','part','other'].includes(data.cause)||!Array.isArray(data.responsibleStaffIds))throw new HttpsError('invalid-argument','Укажите причину переделки');
    const original=repairs.find((r:DocumentData)=>r.id===link.originalRepairId),task=(original?.tasks??[]).find((t:DocumentData)=>t.id===link.originalTaskId);
    if(!task)throw new HttpsError('failed-precondition','Исходная работа не найдена');
    const responsibleStaffIds=[...new Set<string>(data.responsibleStaffIds.map(id))];
    if(responsibleStaffIds.some(uid=>!(task.assignees??[]).includes(uid))||data.cause!=='workmanship'&&responsibleStaffIds.length)throw new HttpsError('invalid-argument','Ответственные выбираются из исполнителей исходной работы только при подтверждённом браке');
    const decisionNote=text(data.note);if(data.cause!=='pending'&&!decisionNote)throw new HttpsError('invalid-argument','Укажите основание решения');
    if((data.expectedConfirmedAt??null)!==(link.confirmedAt??null))throw new HttpsError('aborted','Решение по переделке уже изменено другим менеджером. Обновите данные.');
    const rework={originalClientId:link.originalClientId,originalRepairId:link.originalRepairId,originalTaskId:link.originalTaskId,cause:data.cause,responsibleStaffIds,decisionNote,confirmedBy:actor.uid,confirmedAt:new Date().toISOString()};
    tx.update(clientRef,{repairs:repairs.map((r:DocumentData)=>r.id===repairId?{...r,rework}:r)});
    tx.update(ref('repairReworks',repairId),rework);return {repairId};
  }
  throw new HttpsError('invalid-argument','Неизвестное действие');
}

/** No client-supplied cost/stock totals or direct ledger writes are trusted. */
export const manageRepairResources = onCall({region:'europe-west1'}, async request => {
  const actor=await actorFor(request),data=request.data;
  if(!data||typeof data!=='object')throw new HttpsError('invalid-argument','Нет данных операции');
  const requestId=id(data.requestId),action=text(data.action,64),operationId=createHash('sha256').update(`${actor.uid}:${requestId}`).digest('hex').slice(0,40);
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v as object).sort().map(k=>[k,canonical((v as DocumentData)[k])])):v;
  const hash=createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
  try { return await db().runTransaction(async tx=>{
    const requestRef=ref('resourceRequests',operationId),old=(await tx.get(requestRef)).data();
    if(old){if(old.hash!==hash)throw new HttpsError('already-exists','Этот запрос уже сохранён с другими значениями. Обновите данные.');return old.result;}
    const result=await runAction(action,data,actor,tx,operationId);
    tx.create(requestRef,{action,hash,result,input:data,createdBy:actor.uid,createdAt:stamp()});return result;
  }); } catch(error) { if(error instanceof HttpsError)throw error;throw new HttpsError('failed-precondition',error instanceof Error?error.message:'Не удалось сохранить операцию'); }
});
