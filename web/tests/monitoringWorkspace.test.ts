import {test} from 'node:test';import assert from 'node:assert/strict';
import * as logic from '../src/features/monitoring/workspaceLogic';
import type {MonitoringDevice,MonitoringDeviceState,MonitoringControllerStatus} from '../src/shared/types/monitoring';
const api=logic as unknown as {monitorRows(...a:any[]):any[];monitorStats(r:any[]):any;filterMonitorRows(r:any[],f:any):any[];monitorSourcesReady(s:any):boolean;selectedSensorViews(p:any):any[]};
const now=Date.parse('2026-10-26T00:00:00Z');
const state=(extra:any={}):MonitoringDeviceState=>({deviceId:'x',temperatureC:-18,measuredAt:new Date(now-60000),receivedAt:new Date(now-60000),lastReceivedAt:new Date(now-60000),alertActive:false,activeAlertIds:{},...extra});
const controller=(extra:any={}):MonitoringControllerStatus=>({controllerId:'x',statusId:'s',reportedAt:new Date(now-60000),receivedAt:new Date(now-60000),networkRegistered:true,registrationState:'home',rssi:22,gprsConnected:true,mqttConnected:true,queueDepth:0,lastFailureCode:'none',uptimeSeconds:100,...extra});
const device=(id:string,extra:any={}):MonitoringDevice=>({id,name:id,enabled:true,...extra});
const filter={search:'',status:'all',scope:'enabled',target:'all',sort:'attention'};
test('heartbeat connectivity wins over recently delivered buffered measurements in every row',()=>{
 assert.equal(typeof api.monitorRows,'function');const rows=api.monitorRows([device('x')],new Map([['x',state()]]),new Map([['x',controller({reportedAt:new Date(now-600000)})]]),[],now,5);
 assert.equal(rows[0].connection,'offline');assert.equal(rows[0].reading,'fresh');assert.equal(rows[0].attention,true);assert.equal(api.monitorStats(rows).online,0);
});
test('fresh heartbeat with old or invalid readings never becomes a fully current device',()=>{
 assert.equal(typeof api.monitorRows,'function');for(const reading of [state({measuredAt:new Date(now-600000)}),state({temperatureC:NaN}),state({temperatureC:undefined}),state({measuredAt:new Date('bad')})]){const rows=api.monitorRows([device('x')],new Map([['x',reading]]),new Map([['x',controller()]]),[],now,5);assert.notEqual(rows[0].reading,'fresh');assert.equal(api.monitorStats(rows).online,0);}
});
test('disabled devices stay discoverable but do not inflate active alarm or attention totals',()=>{
 assert.equal(typeof api.monitorStats,'function');const rows=api.monitorRows([device('active'),device('disabled',{enabled:false})],new Map([['active',state({activeAlertIds:{r1:'e1',r2:'e2'}})],['disabled',state({activeAlertIds:{r3:'e3'}})]]),new Map([['active',controller()]]),[],now,5);
 const stats=api.monitorStats(rows);assert.equal(stats.total,1);assert.equal(stats.alarms,1);assert.equal(stats.alarmEvents,2);assert.equal(stats.attention,1);assert.deepEqual(api.filterMonitorRows(rows,{...filter,scope:'disabled'}).map(r=>r.device.id),['disabled']);
});
test('search technical ID, client, plate and multiword filters combine without source mutation',()=>{
 assert.equal(typeof api.filterMonitorRows,'function');const devices=[device('esp-a',{name:'Склад',clientId:'c',targetType:'vehicle',targetId:'v'}),device('esp-b',{name:'Камера',targetType:'chamber'})];const before=JSON.stringify(devices);
 const rows=api.monitorRows(devices,new Map([['esp-a',state()]]),new Map([['esp-a',controller()]]),[{id:'c',name:'Бриз',vehicles:[{id:'v',plate:'А123ВС125'}],repairs:[]}],now,5);
 assert.deepEqual(api.filterMonitorRows(rows,{...filter,search:'бриз A123BC125 esp-a',target:'vehicle'}).map(r=>r.device.id),['esp-a']);assert.equal(JSON.stringify(devices),before);
});
test('alarm devices rank before disconnected and fresh devices; same-name ties are deterministic',()=>{
 assert.equal(typeof api.monitorRows,'function');const rows=api.monitorRows([device('fresh'),device('lost'),device('alarm')],new Map([['fresh',state()],['alarm',state({activeAlertIds:{r:'e'}})]]),new Map([['fresh',controller()],['alarm',controller()]]),[],now,5);
 assert.deepEqual(api.filterMonitorRows(rows,filter).map(r=>r.device.id),['alarm','lost','fresh']);
});
test('all four source snapshots are required, error never counts as ready',()=>{
 assert.equal(typeof api.monitorSourcesReady,'function');assert.equal(api.monitorSourcesReady({devices:'ready',states:'ready',controllers:'ready',settings:'loading'}),false);assert.equal(api.monitorSourcesReady({devices:'ready',states:'error',controllers:'ready',settings:'ready'}),false);assert.equal(api.monitorSourcesReady({devices:'ready',states:'ready',controllers:'ready',settings:'ready'}),true);
});
test('selected sensor views reject another owner or incomplete streams, preserving confirmed legacy fallback',()=>{
 assert.equal(typeof api.selectedSensorViews,'function');const props={selectedId:'new',owner:'old',registryReady:true,statesReady:true,error:'',sensors:[{sensorId:'old-sensor',lastSeenAt:null}],states:new Map([['old-sensor',state()]]),parent:state()};
 assert.equal(api.selectedSensorViews(props).length,0);assert.equal(api.selectedSensorViews({...props,owner:'new',statesReady:false}).length,0);assert.equal(api.selectedSensorViews({...props,owner:'new',error:'denied'}).length,0);
 assert.deepEqual(api.selectedSensorViews({...props,owner:'new',sensors:[],states:new Map()}).map(r=>r.sensorId),['default']);
 assert.deepEqual(api.selectedSensorViews({...props,owner:'new',sensors:[{sensorId:'temperature-1'}],states:new Map()}).map(r=>r.sensorId),['temperature-1']);
});
import {createElement,type ComponentType} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import * as ui from '../src/features/monitoring/MonitoringOverview';
const view=ui as unknown as {MonitoringOverview:ComponentType<any>};
const ready={devices:'ready',states:'ready',controllers:'ready',settings:'ready'};
test('overview shows labeled alarm colors and independent measured/heartbeat times without safety claims',()=>{
 assert.equal(typeof view.MonitoringOverview,'function');const rows=api.monitorRows([device('x',{name:'Камера №3'})],new Map([['x',state({activeAlertIds:{a:'e'}})]]),new Map([['x',controller()]]),[],now,5);
 const html=renderToStaticMarkup(createElement(view.MonitoringOverview,{rows,sourceStatus:ready,sourceErrors:{},nowMs:now,threshold:5,thresholdSaving:false,canManage:true,onThreshold:()=>{},onOpen:()=>{},onRename:()=>{}}));
 assert.match(html,/monitor-device-tone--alarm/);assert.match(html,/Измерено/);assert.match(html,/Статус связи/);assert.match(html,/Основной датчик/);assert.doesNotMatch(html,/Температура в норме/);
});
test('overview fails closed for incomplete or failed sources and preserves read-only mechanic controls',()=>{
 assert.equal(typeof view.MonitoringOverview,'function');const props={rows:[],sourceStatus:{...ready,states:'error'},sourceErrors:{states:'Недоступны измерения'},nowMs:now,threshold:5,thresholdSaving:false,canManage:false,onThreshold:()=>{},onOpen:()=>{},onRename:()=>{}};
 const html=renderToStaticMarkup(createElement(view.MonitoringOverview,props));assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Устройства ещё не добавлены|Переименовать контроллер/);
 const loading=renderToStaticMarkup(createElement(view.MonitoringOverview,{...props,sourceStatus:{...ready,settings:'loading'}}));assert.match(loading,/role="status"/);
});
test('incomplete target bindings stay in the unassigned filter',()=>{
 const rows=api.monitorRows([device('partial',{clientId:'c',targetId:'v'})],new Map(),new Map(),[],now,5);
 assert.deepEqual(api.filterMonitorRows(rows,{...filter,target:'unassigned'}).map(r=>r.device.id),['partial']);
});
test('controlled overview preserves search and disabled scope supplied by its parent',()=>{
 const rows=api.monitorRows([device('keep',{name:'Архивный контроллер',enabled:false}),device('other',{name:'Другой'})],new Map(),new Map(),[],now,5);
 const html=renderToStaticMarkup(createElement(view.MonitoringOverview,{rows,sourceStatus:ready,sourceErrors:{},nowMs:now,threshold:5,thresholdSaving:false,canManage:false,filters:{...filter,scope:'disabled',search:'Архивный'},onFiltersChange:()=>{},onThreshold:()=>{},onOpen:()=>{},onRename:()=>{}}));
 assert.match(html,/Открыть устройство Архивный контроллер/);assert.doesNotMatch(html,/Открыть устройство Другой/);
});
import {chartAxisLabel} from '../src/features/monitoring/MonitoringTab';
test('short and multi-day graph axes use the same Vladivostok time as measurement details',()=>{
 assert.match(chartAxisLabel(now,3600000),/10:00/);assert.match(chartAxisLabel(now,7*86400000),/10:00/);
});
test('a failed source keeps the draft subtree mounted but unavailable for editing',()=>{
 const boundary=ui as unknown as {MonitoringSourceBoundary:ComponentType<any>};assert.equal(typeof boundary.MonitoringSourceBoundary,'function');
 const html=renderToStaticMarkup(createElement(boundary.MonitoringSourceBoundary,{status:{...ready,states:'error'}},createElement('input',{value:'Несохранённое правило',readOnly:true})));
 assert.match(html,/Несохранённое правило/);assert.match(html,/hidden/);assert.match(html,/role="alert"/);
});
