import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../src/shared/requests/workspaceLogic';
import type {Client,Repair} from '../src/shared/types/client';
import type {IntakeRepair} from '../src/shared/types/intake';
import type {ServiceTask} from '../src/shared/types/task';
const api=logic as unknown as {requestStage(r:Repair):string;selectClientRequests(c:Client[],s:any):{client:Client;repair:Repair;tasks:any[]}[];selectIntakeRequests(i:IntakeRepair[],s:any):IntakeRepair[];selectServiceRequests(t:ServiceTask[],s:any):ServiceTask[]};
const scope={uid:'a',manager:true,search:'',employee:'',mine:false,status:'open',sort:'newest',kind:'all',staff:[{id:'a',name:'Егор'},{id:'b',name:'Иван'}]};
const task=(id:string,extra:any={})=>({id,description:id,assignees:['a'],doneBy:[],status:'in_progress' as const,...extra});
const repair=(id:string,extra:any={}):Repair=>({id,serviceType:'refrigerator',date:'2026-10-26',tasks:[task(id)],...extra});
const client=(repairs:Repair[]):Client=>({id:'c',name:'Северная логистика',vehicles:[{id:'v',plate:'А 123 ВС 125',brand:'Hyundai'}],repairs});
const intake=(id:string,extra:any={}):IntakeRepair=>({id,kind:'vehicle',vehicle:{plate:'А 123 ВС 125',plateNormalized:'A123BC125',serviceType:'refrigerator'},repair:repair(id),createdBy:'a',createdByName:'Егор',createdAt:'2026-10-26',...extra});
test('request stages distinguish completed work, manager close, cancellation and closedAt',()=>{
 assert.equal(typeof api.requestStage,'function');
 assert.deepEqual([repair('a'),repair('b',{tasks:[task('t',{status:'done'})]}),repair('c',{closedByManager:true}),repair('d',{status:'cancelled'}),repair('e',{closedAt:'2026-10-26'})].map(api.requestStage),['active','ready','closed','cancelled','closed']);
});
test('manager open queue excludes archive and ready filter keeps work awaiting close',()=>{
 assert.equal(typeof api.selectClientRequests,'function');const c=client([repair('a'),repair('b',{status:'done',tasks:[]}),repair('c',{closedByManager:true}),repair('d',{status:'cancelled'})]);
 assert.deepEqual(api.selectClientRequests([c],scope).map(r=>r.repair.id),['a','b']);
 assert.deepEqual(api.selectClientRequests([c],{...scope,status:'ready'}).map(r=>r.repair.id),['b']);
 assert.deepEqual(api.selectClientRequests([c],{...scope,status:'archive'}).map(r=>r.repair.id),['c','d']);
});
test('mechanics retain only their active task scope; completed work and unrelated tasks do not leak in',()=>{
 assert.equal(typeof api.selectClientRequests,'function');const c=client([repair('a',{tasks:[task('own'),task('other',{assignees:['b']}),task('done',{status:'done'})]}),repair('other',{tasks:[task('x',{assignees:['b']})]}),repair('closed',{closedByManager:true})]);
 const rows=api.selectClientRequests([c],{...scope,manager:false});assert.deepEqual(rows.map(r=>r.repair.id),['a']);assert.deepEqual(rows[0].tasks.map(t=>t.id),['own']);
 assert.equal(api.selectClientRequests([c],{...scope,manager:false,status:'archive'}).length,0);
});
test('plate lookalikes, staff and task descriptions combine; filters never mutate originals',()=>{
 assert.equal(typeof api.selectClientRequests,'function');const c=client([repair('old',{vehicleId:'v',createdAt:'2026-10-01',tasks:[task('t',{description:'Проверить компрессор'})]}),repair('new',{createdAt:'2026-10-26'})]);const before=JSON.stringify(c);
 assert.deepEqual(api.selectClientRequests([c],{...scope,search:'A123BC125 компрессор егор',mine:true,employee:'a'}).map(r=>r.repair.id),['old']);
 assert.deepEqual(api.selectClientRequests([c],{...scope,sort:'oldest'}).map(r=>r.repair.id),['old','new']);assert.equal(JSON.stringify(c),before);
});
test('intake combines type, status, personal assignment, unassigned and legacy fields',()=>{
 assert.equal(typeof api.selectIntakeRequests,'function');const car=intake('car',{kind:undefined});const chamber=intake('chamber',{kind:undefined,vehicle:undefined,chamber:{label:'Магазин у моря',notes:'Не держит температуру'},repair:repair('ch',{tasks:[]})});const cancelled=intake('cancel',{repair:repair('x',{status:'cancelled'})});
 assert.deepEqual(api.selectIntakeRequests([car,chamber,cancelled],{...scope,kind:'chamber',employee:'unassigned',search:'температуру'}).map(r=>r.id),['chamber']);
 assert.deepEqual(api.selectIntakeRequests([car,chamber,cancelled],{...scope,mine:true}).map(r=>r.id),['car']);
 assert.deepEqual(api.selectIntakeRequests([cancelled],{...scope,status:'archive'}).map(r=>r.id),['cancel']);
});
test('service task role scope and completed archive tolerate optional legacy arrays',()=>{
 assert.equal(typeof api.selectServiceRequests,'function');const tasks=[{id:'a',title:'Сезонная подготовка',assignees:['a'],doneBy:[],status:'in_progress'}, {id:'b',title:'Проект',assignees:['b'],doneBy:[],status:'done'},{id:'legacy',title:'Legacy'}] as ServiceTask[];
 assert.deepEqual(api.selectServiceRequests(tasks,{...scope,manager:false}).map(t=>t.id),['a']);
 assert.deepEqual(api.selectServiceRequests(tasks,{...scope,status:'archive',employee:'b'}).map(t=>t.id),['b']);
 assert.deepEqual(api.selectServiceRequests(tasks,{...scope,employee:'unassigned'}).map(t=>t.id),['legacy']);
});

import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as ui from '../src/shared/requests/RequestWorkspace';
const components=ui as unknown as {RequestCard:ComponentType<any>;RequestListState:ComponentType<any>};
test('request card uses native keyboard disclosure and keeps report/photo children intact',()=>{
 assert.equal(typeof components.RequestCard,'function');
 const html=renderToStaticMarkup(createElement(components.RequestCard,{title:'А123ВС',subtitle:'Клиент',stage:'ready',description:'Ремонт',meta:['Егор'],progress:{done:1,total:2}},createElement('p',null,'Существующий отчёт')));
 assert.match(html,/<details/);assert.match(html,/<summary/);assert.match(html,/Существующий отчёт/);assert.match(html,/Ждёт менеджера/);assert.match(html,/1 из 2/);assert.doesNotMatch(html,/<details[^>]* open/);
});
test('source failures do not render empty-success messages or stale editable children',()=>{
 assert.equal(typeof components.RequestListState,'function');
 const html=renderToStaticMarkup(createElement(components.RequestListState,{statuses:['ready','error'],count:0,filtered:false,empty:'Нет заявок'},createElement('button',null,'Старое действие')));
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Нет заявок|Старое действие/);
 const loading=renderToStaticMarkup(createElement(components.RequestListState,{statuses:['loading'],count:0,filtered:false,empty:'Нет заявок'}));assert.match(loading,/role="status"/);assert.doesNotMatch(loading,/Нет заявок/);
});
test('intake search finds the primary chamber label independently of notes',()=>{
 const chamber=intake('ch',{kind:'chamber',vehicle:undefined,chamber:{label:'Склад Рыбный порт',notes:'Заменить вентилятор'}});
 assert.deepEqual(api.selectIntakeRequests([chamber],{...scope,search:'рыбный порт'}).map(r=>r.id),['ch']);
});
test('explicitly reopened repair remains active despite its historical close timestamp',()=>{
 const r=repair('returned',{closedByManager:false,closedAt:'2026-10-01T01:00:00Z',status:'in_progress'});
 assert.equal(api.requestStage(r),'active');
 assert.deepEqual(api.selectClientRequests([client([r])],scope).map(row=>row.repair.id),['returned']);
 assert.deepEqual(api.selectClientRequests([client([r])],{...scope,manager:false}).map(row=>row.repair.id),['returned']);
});
