import {useState} from 'react';
import {useAuth} from '../../features/auth';
import {useData} from '../context/DataContext';
import {cashflowAccess} from '../../features/cashflow/cashflowLogic';
import type {RepairTask} from '../types/client';
import {useResources,consumeMaterial,returnMaterial,addRepairTime,voidRepairTime,addPieceCharge,confirmTaskResources} from '../firebase/resources';
import type {ResourceTarget,RepairResource} from '../types/resources';
import {Input,Select,Textarea} from '../ui/Input';
import {Button} from '../ui/Button';
import {parseResourceQuantity,manualTimeMinutes,resourceAccountingState,returnableQuantity} from './resourceFormLogic';
import {useResourceSubmission} from './useResourceSubmission';

const units={pcs:'шт.',kg:'кг',ml:'мл',m:'м'};
const quantity=(value:number)=>(value/1000).toLocaleString('ru-RU',{maximumFractionDigits:3});
export function ResourcePanel(props:{target:ResourceTarget;taskId:string;task?:RepairTask}){
 const [open,setOpen]=useState(false);
 return <section style={{marginTop:10,paddingTop:8,borderTop:'1px solid var(--border)'}} aria-label="Материалы и время задачи">
  <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} style={{background:'transparent',border:0,color:'var(--accent2)',cursor:'pointer',fontSize:12,padding:4}}>Материалы и время {open?'▴':'▾'}</button>
  {open&&<ResourcePanelBody {...props}/>}
 </section>;
}
function ResourcePanelBody({target,taskId,task}:{target:ResourceTarget;taskId:string;task?:RepairTask}){
 const {myProfile,isOwner}=useAuth();const {staff,clients,intakeRepairs}=useData();
 const manager=['owner','admin','manager'].includes(myProfile?.role??'');
 const financial=cashflowAccess(isOwner?'owner':myProfile?.role,myProfile?.permissions?.pl_panel);
 const data=useResources(financial,target.repairId);
 const {busy,error,setError,submit}=useResourceSubmission();
 const [materialId,setMaterialId]=useState(''),[amount,setAmount]=useState(''),[note,setNote]=useState('');
 const [zeroDeclared,setZeroDeclared]=useState(false);
 const [minutes,setMinutes]=useState(''),[timeNote,setTimeNote]=useState(''),[staffId,setStaffId]=useState(myProfile?.id??'');
 const [correction,setCorrection]=useState<RepairResource|null>(null),[returnAmount,setReturnAmount]=useState(''),[reason,setReason]=useState('');
 const [pieceAmount,setPieceAmount]=useState(''),[pieceNote,setPieceNote]=useState('');
 const resolvedTask=task??(target.kind==='client'?clients.find(client=>client.id===target.documentId)?.repairs?.find(repair=>repair.id===target.repairId)?.tasks?.find(item=>item.id===taskId):intakeRepairs.find(intake=>intake.id===target.documentId)?.repair.tasks?.find(item=>item.id===taskId));
 const accounting=resourceAccountingState(resolvedTask??{id:taskId},data.entries,data.confirmations);
 const selected=data.items.find(item=>item.id===materialId);
 const entries=data.entries.filter(entry=>entry.taskId===taskId);
 if(!data.ready)return <p role="status">Загружаем материалы и время…{data.error&&<span role="alert">{data.error}</span>}</p>;
 if(data.error)return <p role="alert">{data.error}</p>;
 function saveMaterial(){
  const quantityMilli=parseResourceQuantity(amount);
  if(!selected||quantityMilli===null||quantityMilli>selected.quantityMilli){setError('Выберите материал и положительное количество в пределах остатка (до 3 знаков после запятой).');return;}
  void submit('consume',{target,taskId,materialId,quantityMilli,note:note.trim()},consumeMaterial,()=>{setAmount('');setNote('');});
 }
 function saveTime(){
  const count=manualTimeMinutes(minutes,zeroDeclared,timeNote);
  if(count===null||!staffId){setError('Укажите исполнителя и целое положительное число минут; для отсутствия работы обязательно основание.');return;}
  void submit('time',{target,taskId,minutes:count,staffId:manager?staffId:myProfile!.id,note:timeNote.trim()},addRepairTime,()=>{setMinutes('');setTimeNote('');setZeroDeclared(false);});
 }
 function saveCorrection(){
  if(!correction||!reason.trim()){setError('Укажите причину исправления.');return;}
  if(correction.type==='material'){
   const quantityMilli=parseResourceQuantity(returnAmount);
   if(quantityMilli===null||quantityMilli>returnableQuantity(correction)){setError('Количество возврата не должно превышать ещё не возвращённый расход.');return;}
   void submit('return',{entryId:correction.id,quantityMilli,note:reason.trim()},returnMaterial,()=>setCorrection(null));
  }else void submit('void-time',{entryId:correction.id,note:reason.trim()},voidRepairTime,()=>setCorrection(null));
 }
 return <div style={{fontSize:12,color:'var(--text)',opacity:1}}>
  <fieldset disabled={busy} style={{border:0,padding:0,margin:0,display:'grid',gap:8}}>
   <label>Материал<Select aria-label="Материал" value={materialId} onChange={event=>setMaterialId(event.target.value)}><option value="">Выберите материал</option>{data.items.filter(item=>item.active&&item.stockConfirmed!==false).map(item=><option key={item.id} value={item.id}>{item.name} · {quantity(item.quantityMilli)} {units[item.unit]}</option>)}</Select></label>
   {selected&&<span>Остаток: {quantity(selected.quantityMilli)} {units[selected.unit]}</span>}
   <label>Количество<Input aria-label="Количество материала" inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="Например, 0,250"/></label>
   <Input aria-label="Примечание к расходу" value={note} onChange={event=>setNote(event.target.value)} placeholder="Примечание к расходу"/>
   <Button size="sm" onClick={saveMaterial}>Записать расход</Button>
   <strong>Рабочее время</strong>
   {manager&&<label>Исполнитель<Select aria-label="Исполнитель времени" value={staffId} onChange={event=>setStaffId(event.target.value)}><option value="">Выберите сотрудника</option>{staff.map(person=><option key={person.id} value={person.id}>{person.name??person.email}</option>)}</Select></label>}
   <label><input type="checkbox" checked={zeroDeclared} onChange={event=>setZeroDeclared(event.target.checked)}/> Работа не потребовала времени (укажите причину)</label>
   <label>Минуты<Input disabled={zeroDeclared} aria-label="Минуты работы" inputMode="numeric" value={minutes} onChange={event=>setMinutes(event.target.value)} placeholder="45"/></label>
   <Input aria-label="Примечание ко времени" value={timeNote} onChange={event=>setTimeNote(event.target.value)} placeholder="Что сделано"/>
   <Button size="sm" onClick={saveTime}>Записать время</Button>
   {financial&&<details><summary>Сдельная стоимость</summary><Input aria-label="Сдельная стоимость в рублях" inputMode="decimal" value={pieceAmount} onChange={event=>setPieceAmount(event.target.value)} placeholder="Стоимость, ₽"/><Input aria-label="Основание сдельной стоимости" value={pieceNote} onChange={event=>setPieceNote(event.target.value)} placeholder="Основание"/><Button size="sm" onClick={()=>{
    const milli=parseResourceQuantity(pieceAmount),costCents=milli===null?null:milli/10;
    if(costCents===null||!Number.isSafeInteger(costCents)||!staffId||!pieceNote.trim()){setError('Укажите исполнителя, стоимость с точностью до копейки и основание.');return;}
    void submit('piece',{target,taskId,staffId,costCents,note:pieceNote.trim()},addPieceCharge,()=>{setPieceAmount('');setPieceNote('');});
   }}>Записать стоимость</Button></details>}
   <p role="status">{accounting.confirmed?'Учёт расхода и времени подтверждён':'Учёт не завершён'}</p>
   {!accounting.canConfirm&&<p>Для подтверждения запишите время или явное отсутствие работы для каждого исполнителя задачи.</p>}
   <Button size="sm" variant="secondary" disabled={!accounting.canConfirm||accounting.confirmed} onClick={()=>void submit('confirm-resources',{target,taskId},confirmTaskResources)}>Подтвердить расход и время</Button>
   {entries.length===0&&<p>Расход и время пока не записаны.</p>}
   {entries.map(entry=><div key={entry.id} style={{padding:'8px 0',borderTop:'1px solid var(--border)'}}>
    <span>{entry.type==='material'?`${entry.materialName??'Материал'}: ${quantity(entry.quantityMilli??0)} ${entry.unit?units[entry.unit]:''}${entry.returnedMilli?` · возвращено ${quantity(entry.returnedMilli)}`:''}`:entry.type==='return'?`Возврат: ${quantity(entry.quantityMilli??0)}`:entry.type==='time'?`${entry.minutes} мин · ${staff.find(person=>person.id===entry.staffId)?.name??entry.staffId}`:'Сдельная работа'}{entry.voided?' · отменено':''}</span>
    {entry.note&&<div>{entry.note}</div>}
    <div style={{color:'var(--text3)',fontSize:11}}>Записал: {staff.find(person=>person.id===entry.createdBy)?.name??entry.createdBy}{typeof entry.createdAt==='string'?' · '+entry.createdAt:''}</div>
    {financial&&<div>{!data.financialReady?'Стоимость загружается…':(()=>{const cost=data.costs.find(item=>item.id===entry.id);return cost?.costCents==null?'Стоимость не определена':`${(cost.costCents/100).toLocaleString('ru-RU')} ₽`;})()}</div>}
    {!entry.voided&&((entry.type==='material'&&returnableQuantity(entry)>0)||(entry.type==='time'&&(manager||entry.staffId===myProfile?.id))||(entry.type==='piece'&&financial))&&<Button size="sm" variant="ghost" onClick={()=>{setCorrection(entry);setReason('');setReturnAmount('');setError('');}}>{entry.type==='material'?'Вернуть остаток':entry.type==='piece'?'Отменить стоимость':'Отменить время'}</Button>}
   </div>)}
   {correction&&<div style={{padding:10,background:'var(--bg3)',borderRadius:8}}>
    {correction.type==='material'&&<label>Возврат, максимум {quantity(returnableQuantity(correction))}<Input aria-label="Количество возврата" inputMode="decimal" value={returnAmount} onChange={event=>setReturnAmount(event.target.value)}/></label>}
    <Textarea aria-label="Причина исправления" placeholder="Причина исправления" value={reason} onChange={event=>setReason(event.target.value)}/>
    <Button size="sm" onClick={saveCorrection}>Подтвердить исправление</Button><Button size="sm" variant="ghost" onClick={()=>setCorrection(null)}>Отмена</Button>
   </div>}
  </fieldset>
  {busy&&<p role="status">Сохраняем…</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
 </div>;
}
