import type {Client,ClientType} from '../../shared/types/client';
import {requestStage} from '../../shared/requests/workspaceLogic';
import {normalizePlate} from '../../shared/utils/plate';
export type DirectoryGroup='alphabet'|'activity'|'type'|'none';
export interface DirectoryFilters{type:ClientType|'all';search:string;activity:'all'|'open'|'ready'|'noHistory'|'noPhone';equipment:'all'|'vehicle'|'chamber'|'none';sort:'name'|'recent'|'open'|'created'}
export interface ClientSummary{client:Client;name:string;type:ClientType;active:number;ready:number;open:number;repairs:number;vehicles:number;chambers:number;lastRepair:string;created:number;sortName:string}
export interface ClientGroup{key:string;title:string;rows:ClientSummary[]}
const collator=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
const norm=(value:string)=>value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
export function clientSortName(client:Client):string{
 return norm((client.name?.trim()||client.companyName?.trim()||'Без названия').replace(/^[«"“\s]+/u,'').replace(/^(?:ооо|пао|оао|зао|ао|ип)\s+/iu,'').replace(/^[«"“\s]+/u,''));
}
function validDay(value:unknown):string{if(typeof value!=='string')return '';const day=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';const time=Date.parse(day+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day?day:'';}
function creationTime(value:unknown):number{
 if(typeof value==='string'){const time=Date.parse(value);return Number.isFinite(time)?time:0;}
 if(value&&typeof value==='object'){const v=value as {seconds?:number;toMillis?:()=>number};if(typeof v.toMillis==='function'){const time=v.toMillis();return Number.isFinite(time)?time:0;}if(typeof v.seconds==='number'&&Number.isFinite(v.seconds))return v.seconds*1000;}
 return 0;
}
export function summarizeClients(clients:readonly Client[]):ClientSummary[]{return clients.map(client=>{
 const repairs=client.repairs??[],active=repairs.filter(r=>requestStage(r)==='active').length,ready=repairs.filter(r=>requestStage(r)==='ready').length;
 return {client,name:client.name?.trim()||client.companyName?.trim()||'Без названия',type:client.clientType??client.type??'phys',active,ready,open:active+ready,repairs:repairs.length,vehicles:(client.vehicles??[]).length,chambers:(client.chambers??[]).length,lastRepair:repairs.map(r=>validDay(r.date)).filter(Boolean).sort().at(-1)||'',created:creationTime(client.createdAt),sortName:clientSortName(client)};
});}
export function selectClientDirectory(rows:readonly ClientSummary[],filter:DirectoryFilters):ClientSummary[]{
 const words=norm(filter.search).trim().split(/\s+/).filter(Boolean);
 return rows.filter(row=>{
  const c=row.client;if(filter.type!=='all'&&row.type!==filter.type)return false;
  if(filter.activity==='open'&&!row.open||filter.activity==='ready'&&!row.ready||filter.activity==='noHistory'&&row.repairs||filter.activity==='noPhone'&&c.phone?.trim())return false;
  if(filter.equipment==='vehicle'&&!row.vehicles||filter.equipment==='chamber'&&!row.chambers||filter.equipment==='none'&&(row.vehicles||row.chambers))return false;
  const text=norm([row.name,c.companyName,c.previousName,c.contactPerson,c.inn,c.phone,c.note,c.legalAddress,...(c.vehicles??[]).flatMap(v=>[v.plate,v.brand,v.model]),...(c.chambers??[]).map(ch=>ch.notes)].filter(Boolean).join(' '));
  const phone=(c.phone??'').replace(/\D/g,'');
  return words.every(word=>text.includes(word)||(/^[+\d().-]+$/.test(word)&&/\d/.test(word)&&phone.includes(word.replace(/\D/g,'')))||(c.vehicles??[]).some(v=>!!normalizePlate(word)&&normalizePlate(v.plate).includes(normalizePlate(word))));
 }).sort((a,b)=>{
  const byName=collator.compare(a.sortName,b.sortName)||collator.compare(a.name,b.name)||a.client.id.localeCompare(b.client.id);
  if(filter.sort==='recent')return b.lastRepair.localeCompare(a.lastRepair)||byName;
  if(filter.sort==='open')return b.open-a.open||byName;
  if(filter.sort==='created')return b.created-a.created||byName;
  return byName;
 });
}
export function groupClientDirectory(rows:readonly ClientSummary[],group:DirectoryGroup):ClientGroup[]{
 if(group==='none')return rows.length?[{key:'all',title:'Клиенты',rows:[...rows]}]:[];
 const groups=new Map<string,ClientGroup>();
 for(const row of rows){let key:string,title:string;
  if(group==='type'){key=row.type==='legal'?'1':'2';title=row.type==='legal'?'Компании':'Частные клиенты';}
  else if(group==='activity'){key=row.ready?'1':row.active?'2':row.repairs?'3':'4';title=row.ready?'Ждут менеджера':row.active?'Есть работы в сервисе':row.repairs?'Без открытых заявок':'Ещё не обращались';}
  else {const letter=row.sortName[0]?.toLocaleUpperCase('ru-RU')||'#';key=/[А-ЯЁA-Z]/u.test(letter)?letter:'#';title=key;}
  if(!groups.has(key))groups.set(key,{key,title,rows:[]});groups.get(key)!.rows.push(row);
 }
 return [...groups.values()].sort((a,b)=>a.key==='#'?1:b.key==='#'?-1:collator.compare(a.key,b.key));
}

export function resolveClientLink(clients:readonly Client[],status:string,id:string):Client|null|undefined{return status!=="ready"?undefined:clients.find(c=>c.id===id)??null;}
