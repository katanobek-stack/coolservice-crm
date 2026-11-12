import {useEffect,useState} from 'react';
import {useAuth} from '../auth';
import {useData} from '../../shared/context/DataContext';
import {createRepairRework,decideRepairRework,useResources} from '../../shared/firebase/resources';
import {useResourceSubmission} from '../../shared/repair-work/useResourceSubmission';
import {Button} from '../../shared/ui/Button';
import {Input,Select,Textarea} from '../../shared/ui/Input';
import type {Repair} from '../../shared/types/client';
import type {ReworkDecisionInput} from '../../shared/types/resources';
import {PaymentDestinationPanel} from './PaymentDestinationPanel';
import {fmtDate} from '../../shared/utils/format';

const causes={pending:'Причина выясняется',workmanship:'Качество работы',part:'Неисправность детали',other:'Другая причина'};
export function ReworkPanel({clientId,repair,canManage=true}:{clientId:string;repair:Repair;canManage?:boolean}){
 const {myProfile}=useAuth();const {staff,clients}=useData();
 const resourceData=useResources(false,repair.id);
 const rework=resourceData.ready&&!resourceData.error?resourceData.reworks.find(item=>item.id===repair.id):undefined;
 const manager=canManage&&['owner','admin','manager'].includes(myProfile?.role??'');
 const [creating,setCreating]=useState(false),[originalTaskId,setOriginalTaskId]=useState(''),[description,setDescription]=useState(''),[assignees,setAssignees]=useState<string[]>([]);
 const [cause,setCause]=useState<ReworkDecisionInput['cause']>(rework?.cause??'pending'),[responsible,setResponsible]=useState<string[]>(rework?.responsibleStaffIds??[]),[decisionNote,setDecisionNote]=useState(rework?.decisionNote??'');
 const [createdId,setCreatedId]=useState('');
 useEffect(()=>{if(rework){setCause(rework.cause);setResponsible(rework.responsibleStaffIds);setDecisionNote(rework.decisionNote);}},[rework]);
 const {busy,error,setError,submit}=useResourceSubmission();
 const originalClient=clients.find(client=>client.id===rework?.originalClientId);
 const originalRepair=originalClient?.repairs?.find(item=>item.id===rework?.originalRepairId);
 const originalTask=originalRepair?.tasks?.find(task=>task.id===rework?.originalTaskId);
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(item=>item!==id):[...list,id];
 if(!manager&&!repair.rework&&!rework)return null;
 return <section aria-label="Переделка и оплата" style={{margin:'12px 0',padding:12,border:'1px solid var(--border)',borderRadius:10,fontSize:12,background:'var(--bg2)'}}>
  {!resourceData.ready&&<p role="status">Проверяем связь переделки…</p>}
  {resourceData.error&&<p role="alert">{resourceData.error}</p>}
  {repair.rework&&resourceData.ready&&!rework&&<p role="status">Связь не подтверждена</p>}
  {rework&&<div>
   <strong>Связанная переделка</strong>
   <p>Исходный ремонт: {originalClient?.name??rework.originalClientId} · {originalRepair?.description??rework.originalRepairId}<br/>Исходная задача: {originalTask?.description??rework.originalTaskId}</p>
   {originalRepair&&<details><summary>Посмотреть исходную работу</summary><p>{originalRepair.date?fmtDate(originalRepair.date):'Дата не указана'} · {originalRepair.description}</p><p>{originalTask?.description}</p><p>Исходные исполнители: {(originalTask?.assignees??[]).map(id=>staff.find(person=>person.id===id)?.name??id).join(', ')||'не указаны'}</p>{originalTask?.workComment&&<p>{originalTask.workComment}</p>}</details>}
   <p>Причина: {causes[rework.cause]}. Ответственные за исходную работу: {rework.responsibleStaffIds.map(id=>staff.find(person=>person.id===id)?.name??id).join(', ')||'не определены'}.</p>
   <p>Переделку выполняют: {(repair.tasks??[]).flatMap(task=>task.assignees??[]).filter((id,index,list)=>list.indexOf(id)===index).map(id=>staff.find(person=>person.id===id)?.name??id).join(', ')||'не назначены'}.</p>
   {rework.decisionNote&&<p>{rework.decisionNote}</p>}
   {manager&&<fieldset disabled={busy} style={{border:0,padding:0,display:'grid',gap:8}}>
    <label>Подтверждённая причина<Select aria-label="Причина переделки" value={cause} onChange={event=>setCause(event.target.value as ReworkDecisionInput['cause'])}>{Object.entries(causes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label>
    {cause==='workmanship'&&<><span>Ответственные за исходную работу</span>
    {staff.filter(person=>originalTask?.assignees?.includes(person.id)).map(person=><label key={person.id}><input type="checkbox" checked={responsible.includes(person.id)} onChange={()=>setResponsible(toggle(responsible,person.id))}/> {person.name??person.email}</label>)}</>}
    <Textarea aria-label="Решение по переделке" placeholder="Основание решения" value={decisionNote} onChange={event=>setDecisionNote(event.target.value)}/>
    <Button size="sm" onClick={()=>{
     if(cause!=='pending'&&!decisionNote.trim()){setError('Укажите основание решения.');return;}
     void submit('decide-rework',{clientId,repairId:repair.id,cause,responsibleStaffIds:cause==='workmanship'?responsible.filter(id=>originalTask?.assignees?.includes(id)):[],note:decisionNote.trim(),expectedConfirmedAt:rework.confirmedAt??null},decideRepairRework);
    }}>Сохранить решение</Button>
    <span>Решение не создаёт удержаний из зарплаты.</span>
   </fieldset>}
  </div>}
  {manager&&<fieldset disabled={busy} style={{border:0,padding:0,display:'grid',gap:8}}>
   <PaymentDestinationPanel target={{kind:'client',documentId:clientId,repairId:repair.id}} repair={repair}/>
   {repair.closedByManager&&!repair.rework&&!rework&&<>
   <Button size="sm" variant="secondary" onClick={()=>setCreating(!creating)}>{creating?'Скрыть форму':'Создать связанную переделку'}</Button>
   {creating&&<div style={{display:'grid',gap:8,padding:10,background:'var(--bg3)',borderRadius:8}}>
    <label>Исходная задача<Select aria-label="Исходная задача" value={originalTaskId} onChange={event=>setOriginalTaskId(event.target.value)}><option value="">Выберите задачу</option>{(repair.tasks??[]).map(task=><option key={task.id} value={task.id}>{task.description}</option>)}</Select></label>
    <Input aria-label="Описание переделки" placeholder="Что нужно переделать" value={description} onChange={event=>setDescription(event.target.value)}/>
    <span>Механики, выполняющие переделку</span>
    {staff.map(person=><label key={person.id}><input type="checkbox" checked={assignees.includes(person.id)} onChange={()=>setAssignees(toggle(assignees,person.id))}/> {person.name??person.email}</label>)}
    <Button size="sm" onClick={()=>{
     if(!originalTaskId||!description.trim()||!assignees.length){setError('Укажите исходную задачу, описание и исполнителей переделки.');return;}
     void submit('create-rework',{clientId,originalRepairId:repair.id,originalTaskId,description:description.trim(),assignees},async input=>{const result=await createRepairRework(input);setCreatedId(result.repairId);},()=>{setCreating(false);setDescription('');setAssignees([]);});
    }}>Создать переделку</Button>
   </div>}
   </>}
  </fieldset>}
  {createdId&&<p role="status">Переделка создана. Откройте её в заявках: {createdId}.</p>}
  {busy&&<p role="status">Сохраняем…</p>}{error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
 </section>;
}
