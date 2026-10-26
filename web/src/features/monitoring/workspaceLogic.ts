import type {Client} from '../../shared/types/client';
import type {MonitoringDevice,MonitoringDeviceState,MonitoringControllerStatus,MonitoringSensor,MonitoringSensorState} from '../../shared/types/monitoring';
import {controllerConnectionStatus,objectLabel,type ConnectionStatus,type ReadingStatus} from '../../shared/monitoring/logic';
import {normalizePlate} from '../../shared/utils/plate';
export type MonitorFilter='all'|'online'|'attention'|'alarms';
export type MonitorSource='devices'|'states'|'controllers'|'settings';
export type MonitorSources=Record<MonitorSource,'loading'|'ready'|'error'>;
export interface MonitorFilters{search:string;status:MonitorFilter;scope:'enabled'|'disabled'|'all';target:'all'|'vehicle'|'chamber'|'unassigned';sort:'attention'|'name'|'recent'}
export const DEFAULT_MONITOR_FILTERS:MonitorFilters={search:'',status:'all',scope:'enabled',target:'all',sort:'attention'};
export interface MonitorRow{device:MonitoringDevice;state:MonitoringDeviceState|undefined;controllerStatus:MonitoringControllerStatus|undefined;reading:ReadingStatus;connection:ConnectionStatus;activeAlertCount:number;attention:boolean;priority:number;object:string;plate:string;client:string}
export function monitorSourcesReady(sources:MonitorSources):boolean{return ['devices','states','controllers','settings'].every(key=>sources[key as MonitorSource]==='ready');}
export function safeMonitorTemperature(value:unknown):number|undefined{return typeof value==='number'&&Number.isFinite(value)&&value>=-55&&value<=125?value:undefined;}
export function monitorReading(state:MonitoringDeviceState|undefined,now:number,threshold:number):ReadingStatus{
 const time=state?.measuredAt?.getTime();if(time===undefined||!Number.isFinite(time)||safeMonitorTemperature(state?.temperatureC)===undefined)return 'missing';
 return now-time>threshold*60000?'stale':'fresh';
}
export function monitorRows(devices:readonly MonitoringDevice[],states:Map<string,MonitoringDeviceState>,controllers:Map<string,MonitoringControllerStatus>,clients:readonly Client[],now:number,threshold:number):MonitorRow[]{return devices.map(device=>{
 const state=states.get(device.id),controllerStatus=controllers.get(device.id),reported=controllerStatus?.reportedAt?.getTime();
 const connection=reported===undefined||!Number.isFinite(reported)?'unknown':controllerConnectionStatus(controllerStatus,now,threshold);
 const reading=monitorReading(state,now,threshold),activeAlertCount=Object.keys(state?.activeAlertIds??{}).length;
 const client=clients.find(c=>c.id===device.clientId),plate=client?.vehicles?.find(v=>device.targetType==='vehicle'&&v.id===device.targetId)?.plate||'';
 const attention=activeAlertCount>0||connection!=='online'||reading!=='fresh';
 return {device,state,controllerStatus,connection,reading,activeAlertCount,attention,priority:!device.enabled?-1:activeAlertCount?4:connection==='offline'?3:connection==='unknown'?2:reading!=='fresh'?1:0,object:objectLabel(device,[...clients]),plate,client:client?.name||''};
});}
export function monitorStats(rows:readonly MonitorRow[]){const active=rows.filter(r=>r.device.enabled);return {total:active.length,online:active.filter(r=>r.connection==='online'&&r.reading==='fresh').length,attention:active.filter(r=>r.attention).length,alarms:active.filter(r=>r.activeAlertCount>0).length,alarmEvents:active.reduce((n,r)=>n+r.activeAlertCount,0),disabled:rows.length-active.length};}
const norm=(v:string)=>v.toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
export function filterMonitorRows(rows:readonly MonitorRow[],filter:MonitorFilters):MonitorRow[]{const words=norm(filter.search).trim().split(/\s+/).filter(Boolean);return rows.filter(row=>{
 if(filter.scope==='enabled'&&!row.device.enabled||filter.scope==='disabled'&&row.device.enabled)return false;
 if(filter.status==='online'&&(row.connection!=='online'||row.reading!=='fresh')||filter.status==='attention'&&!row.attention||filter.status==='alarms'&&!row.activeAlertCount)return false;
 if(filter.target==='unassigned'&&(row.device.clientId&&row.device.targetId&&row.device.targetType))return false;
 if(filter.target!=='all'&&filter.target!=='unassigned'&&row.device.targetType!==filter.target)return false;
 const searchable=norm([row.device.id,row.device.name,row.object,row.client,row.plate,row.device.isTest?'Тестовое устройство':''].join(' '));
 return words.every(word=>searchable.includes(word)||(!!row.plate&&!!normalizePlate(word)&&normalizePlate(row.plate).includes(normalizePlate(word))));
 }).sort((a,b)=>{const name=a.device.name.localeCompare(b.device.name,'ru',{numeric:true})||a.device.id.localeCompare(b.device.id);if(filter.sort==='attention')return b.priority-a.priority||name;if(filter.sort==='recent')return (b.state?.measuredAt?.getTime()||0)-(a.state?.measuredAt?.getTime()||0)||name;return name;});}
export interface SensorView{sensorId:string;sensor:MonitoringSensor;state:MonitoringDeviceState|undefined;index:number}
export function selectedSensorViews(input:{selectedId:string|null;owner:string|null;registryReady:boolean;statesReady:boolean;error:string;sensors:MonitoringSensor[];states:Map<string,MonitoringSensorState>;parent:MonitoringDeviceState|undefined}):SensorView[]{
 if(!input.selectedId||input.owner!==input.selectedId||!input.registryReady||!input.statesReady||input.error)return [];
 const ids=new Set([...input.sensors.map(s=>s.sensorId),...input.states.keys()]);
 if(!ids.size&&input.parent?.measuredAt)ids.add('default');
 return [...ids].sort((a,b)=>a.localeCompare(b,'en')).map((sensorId,index)=>({sensorId,index,sensor:input.sensors.find(s=>s.sensorId===sensorId)??{sensorId,lastSeenAt:null},state:input.states.get(sensorId)??(sensorId==='default'?input.parent:undefined)}));
}
export function monitorSensorColor(sensorId:string):string{const colors=['#2563eb','#087e8b','#7c3aed','#158065','#b45309','#be3b68'];let hash=0;for(const c of sensorId)hash=(hash*31+c.charCodeAt(0))>>>0;return colors[hash%colors.length];}
