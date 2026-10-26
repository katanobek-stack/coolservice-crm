import {test} from 'node:test';import assert from 'node:assert/strict';
import * as logic from '../src/features/clients/directoryLogic';
import type {Client} from '../src/shared/types/client';
const api=logic as unknown as {summarizeClients(c:Client[]):any[];selectClientDirectory(c:any[],f:any):any[];groupClientDirectory(c:any[],g:string):{key:string;title:string;rows:any[]}[];clientSortName(c:Client):string};
const client=(id:string,extra:any={}):Client=>({id,name:id,vehicles:[],repairs:[],...extra});
const defaults={type:'all',search:'',activity:'all',equipment:'all',sort:'name'};
test('legal business names sort by meaningful name, without changing display or legacy type',()=>{
 assert.equal(typeof api.summarizeClients,'function');const c=[client('b',{name:'ООО «Бриз»',clientType:'legal',type:'phys'}),client('a',{name:'АО «Айсберг»',type:'legal'}),client('p',{name:'Иванов'})];const before=JSON.stringify(c);
 const rows=api.selectClientDirectory(api.summarizeClients(c),defaults);assert.deepEqual(rows.map(r=>r.client.id),['a','b','p']);assert.equal(rows[1].type,'legal');assert.equal(rows[1].client.name,'ООО «Бриз»');assert.equal(JSON.stringify(c),before);
 assert.deepEqual(api.groupClientDirectory(rows,'alphabet').map(g=>g.title),['А','Б','И']);
});
test('service summaries distinguish active, awaiting manager, confirmed closed, cancelled and reopened',()=>{
 assert.equal(typeof api.summarizeClients,'function');const repairs=[{id:'active',tasks:[],status:'in_progress'},{id:'ready',tasks:[],status:'done'},{id:'closed',closedByManager:true},{id:'cancel',status:'cancelled'},{id:'reopen',status:'in_progress',closedByManager:false,closedAt:'2026-10-01'}];
 const row=api.summarizeClients([client('c',{repairs})])[0];assert.equal(row.active,2);assert.equal(row.ready,1);assert.equal(row.open,3);assert.equal(row.repairs,5);
});
test('search combines normalized plate, phone punctuation, company contact and previous name',()=>{
 assert.equal(typeof api.selectClientDirectory,'function');const rows=api.summarizeClients([client('c',{name:'Бриз',phone:'+7 (924) 123-45-67',contactPerson:'Егор',previousName:'Старое имя',vehicles:[{id:'v',plate:'А 123 ВС 125',brand:'Hyundai'}]}),client('other')]);
 for(const search of ['A123BC125 егор','9241234567','старое имя','Hyundai'])assert.deepEqual(api.selectClientDirectory(rows,{...defaults,search}).map(r=>r.client.id),['c']);
});
test('type, equipment and activity filters intersect without losing records or mutating input order',()=>{
 assert.equal(typeof api.selectClientDirectory,'function');const rows=api.summarizeClients([client('c',{clientType:'legal',chambers:[{id:'ch',notes:'Рыбный склад'}],repairs:[{id:'r',status:'done',tasks:[]}]}),client('p')]);const before=JSON.stringify(rows);
 assert.deepEqual(api.selectClientDirectory(rows,{...defaults,type:'legal',equipment:'chamber',activity:'ready',search:'рыбный'}).map(r=>r.client.id),['c']);
 assert.deepEqual(api.selectClientDirectory(rows,{...defaults,activity:'noPhone',equipment:'none'}).map(r=>r.client.id),['p']);assert.equal(JSON.stringify(rows),before);
});
test('missing legacy optional fields and invalid dates never invent recent service or drop clients',()=>{
 assert.equal(typeof api.summarizeClients,'function');const rows=api.summarizeClients([{id:'unknown',name:'',vehicles:undefined,repairs:undefined} as unknown as Client,client('old',{repairs:[{id:'x',date:'bad'}]})]);
 assert.equal(rows.length,2);assert.equal(rows[0].lastRepair,'');assert.equal(rows[1].lastRepair,'');assert.equal(api.groupClientDirectory(rows,'alphabet').flatMap(g=>g.rows).length,2);
});
test('recent service and creation sorting handle timestamps deterministically, missing dates last',()=>{
 assert.equal(typeof api.summarizeClients,'function');const rows=api.summarizeClients([client('missing'),client('old',{createdAt:{seconds:10},repairs:[{id:'x',date:'2025-01-01'}]}),client('new',{createdAt:'2026-01-01',repairs:[{id:'y',date:'2026-01-02'}]})]);
 for(const sort of ['recent','created'])assert.deepEqual(api.selectClientDirectory(rows,{...defaults,sort}).map(r=>r.client.id),['new','old','missing']);
});
test('grouping by service state or type keeps each customer exactly once, including mixed active and ready',()=>{
 assert.equal(typeof api.groupClientDirectory,'function');const rows=api.summarizeClients([client('mixed',{repairs:[{id:'a',status:'in_progress',tasks:[]},{id:'b',status:'done',tasks:[]}]}),client('company',{type:'legal'}),client('empty')]);
 for(const group of ['activity','type']){const groups=api.groupClientDirectory(rows,group);assert.equal(groups.flatMap(g=>g.rows).length,3);assert.equal(new Set(groups.flatMap(g=>g.rows.map(r=>r.client.id))).size,3);}
});
import {createElement,type ComponentType} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import * as ui from '../src/features/clients/ClientDirectory';
const component=ui as unknown as {ClientDirectory:ComponentType<any>};
test('directory renders client groups, grid and explicit native open controls',()=>{
 assert.equal(typeof component.ClientDirectory,'function');const html=renderToStaticMarkup(createElement(component.ClientDirectory,{clients:[client('ivan',{name:'Иванов',phone:'+79240000000'}),client('boris',{name:'Борисов'})],status:'ready',initialType:'phys',canManage:true,onAdd:()=>{},onOpen:()=>{}}));
 assert.match(html,/client-directory-grid/);assert.match(html,/Группа клиентов Б/);assert.match(html,/Группа клиентов И/);assert.match(html,/Открыть клиента Иванов/);assert.match(html,/tel:\+79240000000/);assert.match(html,/Добавить клиента/);
});
test('unavailable directory hides stale records and mechanic cannot create clients',()=>{
 assert.equal(typeof component.ClientDirectory,'function');const props={clients:[client('private',{name:'Старые данные'})],initialType:'phys',canManage:false,onAdd:()=>{},onOpen:()=>{}};
 const html=renderToStaticMarkup(createElement(component.ClientDirectory,{...props,status:'error'}));assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Старые данные|Добавить клиента/);
 const loading=renderToStaticMarkup(createElement(component.ClientDirectory,{...props,status:'loading'}));assert.match(loading,/role="status"/);assert.doesNotMatch(loading,/Клиентов пока нет/);
});
test('ungrouped view keeps the selected global order instead of rebuilding alphabet groups',()=>{
 const rows=api.selectClientDirectory(api.summarizeClients([client('z',{name:'Яковлев',repairs:[{id:'r',date:'2026-10-26'}]}),client('a',{name:'Андреев'})]),{...defaults,sort:'recent'});
 const groups=api.groupClientDirectory(rows,'none');assert.equal(groups.length,1);assert.deepEqual(groups[0].rows.map(r=>r.client.id),['z','a']);
});
test('client deep link waits for a confirmed source and distinguishes a deleted client',()=>{
 const link=logic as unknown as {resolveClientLink(c:Client[],status:string,id:string):Client|null|undefined};assert.equal(typeof link.resolveClientLink,'function');
 const c=client('c');assert.equal(link.resolveClientLink([],'loading','c'),undefined);assert.equal(link.resolveClientLink([c],'error','c'),undefined);assert.equal(link.resolveClientLink([],'ready','c'),null);assert.equal(link.resolveClientLink([c],'ready','c'),c);
});
test('alphanumeric plate queries never match coincidental phone digits',()=>{
 const rows=api.summarizeClients([client('phone',{name:'Иванов',phone:'+7 924 123-12-55'}),client('vehicle',{name:'Петров',vehicles:[{id:'v',plate:'А123ВС125'}]})]);
 assert.deepEqual(api.selectClientDirectory(rows,{...defaults,search:'A123BC125'}).map(r=>r.client.id),['vehicle']);
});
