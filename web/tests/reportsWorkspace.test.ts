import {test} from 'node:test';import assert from 'node:assert/strict';
import * as closure from '../src/shared/utils/repairClosure';import * as reports from '../src/features/done/reportsLogic';import * as closeState from '../src/shared/firebase/repairClose';
import type {Repair,Client} from '../src/shared/types/client';import type {IntakeRepair} from '../src/shared/types/intake';
const c=closure as any,r=reports as any,s=closeState as any;
const task={id:'t',description:'Компрессор',assignees:['a'],doneBy:['a'],status:'done' as const};
const ready=(patch:Partial<Repair>={}):Repair=>({id:'r',serviceType:'refrigerator',date:'2026-09-15',tasks:[task],...patch});
const client=(repairs:Repair[]):Client=>({id:'c',name:'Северный склад',phone:'70000000000',vehicles:[{id:'v',plate:'А123ВС125',brand:'Hyundai'}],chambers:[{id:'ch',notes:'Рыбный терминал'}],repairs});
const staff=[{id:'a',name:'Егор'}];const filters={search:'',employee:'',kind:'all',month:'all',status:'all',sort:'newest'};
test('closure accepts zero and comma money but rejects unsafe/incomplete amounts',()=>{
 assert.equal(typeof c.parseClosureAmount,'function');assert.deepEqual(['0','1 250,50','1250.5',''].map(c.parseClosureAmount),['0','1250.50','1250.5',null]);
 for(const x of ['-1','NaN','Infinity','1e3','12abc','1.234','9007199254740992'])assert.equal(c.parseClosureAmount(x),null,x);
});
test('closure checks real completion, cancellation, legacy closure and refrigerant',()=>{
 assert.equal(typeof c.closureIssue,'function');assert.equal(c.closureIssue(ready()),null);
 for(const p of [{status:'cancelled'},{closedByManager:true},{closedAt:'2026-09-20'},{tasks:[{...task,status:'in_progress',doneBy:[]}]},{tasks:[{...task,freonTask:true,freonKg:'1'}]}])assert.ok(c.closureIssue(ready(p as any)));
 assert.equal(c.closureIssue(ready({tasks:[],status:'done'})),null);assert.equal(c.closureIssue(ready({closedByManager:false,closedAt:'2026-09-20'})),null);
});
test('fresh closing rejects concurrent task/cost/status changes and preserves metadata',()=>{
 assert.equal(typeof s.prepareRepairClose,'function');const expected=ready({cost:'100',freonType:'R134a',photos:[{id:'p',url:'example'}]});const closed=s.prepareRepairClose(expected,expected,'1 200,50','2026-10-27T00:00:00Z','owner');
 assert.equal(closed.cost,'1200.50');assert.equal(closed.closedByManager,true);assert.equal(closed.closedAt,'2026-10-27T00:00:00Z');assert.deepEqual(closed.photos,expected.photos);assert.deepEqual(closed.tasks,expected.tasks);assert.equal(expected.closedByManager,undefined);
 for(const current of [{...expected,cost:'200'},{...expected,tasks:[{...task,description:'Новое задание'}]},{...expected,status:'cancelled'},{...expected,closedByManager:true}])assert.throws(()=>s.prepareRepairClose(current,expected,'100','2026-10-27','owner'));
});
test('report queue/archive use canonical stages, closure month and combined search',()=>{
 assert.equal(typeof r.selectReportItems,'function');const rows=client([ready({id:'q',vehicleId:'v'}),ready({id:'old',closedAt:'2026-10-01'}),ready({id:'cancel',status:'cancelled'}),ready({id:'ch',chamberId:'ch'}),ready({id:'work',tasks:[{...task,status:'in_progress',doneBy:[]}]})]);
 assert.deepEqual(r.selectReportItems([rows],staff,filters,'queue').map((x:any)=>x.repair.id).sort(),['ch','q']);assert.deepEqual(r.selectReportItems([rows],staff,{...filters,month:'2026-10',status:'closed'},'archive').map((x:any)=>x.repair.id),['old']);
 assert.deepEqual(r.selectReportItems([rows],staff,{...filters,search:'северный A123BC125 компрессор егор',employee:'a'},'queue').map((x:any)=>x.repair.id),['q']);assert.deepEqual(r.selectReportItems([rows],staff,{...filters,kind:'chamber'},'queue').map((x:any)=>x.repair.id),['ch']);
});
test('chamber-only intake is included and archived intake never re-enters closing queue',()=>{
 assert.equal(typeof r.selectReportIntake,'function');const chamber={id:'i',kind:'chamber',chamber:{label:'Рыбный склад'},repair:ready(),createdAt:'2026-10-27'} as IntakeRepair;
 assert.deepEqual(r.selectReportIntake([chamber],staff,{...filters,search:'рыбный',kind:'chamber'}).map((x:any)=>x.id),['i']);assert.equal(r.selectReportIntake([{...chamber,repair:ready({closedByManager:true})}],staff,filters).length,0);
});
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import * as ui from '../src/features/done/ReportsWorkspace';
test('queue disclosure is keyboard accessible and preserves report children',()=>{
 const Card=(ui as any).ReportQueueCard;assert.equal(typeof Card,'function');const html=renderToStaticMarkup(createElement(Card,{title:'А123ВС125',subtitle:'Северный склад',kind:'client'},createElement('p',null,'Отчёт механика')));assert.match(html,/<details/);assert.match(html,/<summary/);assert.match(html,/Отчёт механика/);assert.doesNotMatch(html,/<details[^>]* open/);
});
test('source boundary keeps drafts mounted but hides unconfirmed actions',()=>{
 const Boundary=(ui as any).ReportSourceBoundary;assert.equal(typeof Boundary,'function');const html=renderToStaticMarkup(createElement(Boundary,{status:'error'},createElement('input',{defaultValue:'1200'})));assert.match(html,/role="alert"/);assert.match(html,/hidden/);assert.match(html,/1200/);
});
test('review retains the approved snapshot when a later live repair arrives',()=>{
 assert.equal(typeof s.createRepairReview,'function');const original=ready({cost:'100'});const review=s.createRepairReview(original,'100');const latest={...original,cost:'200',tasks:[{...task,workComment:'Новый отчёт'}]};
 assert.throws(()=>s.prepareRepairClose(latest,review.repair,review.amount,'2026-10-27','owner'));assert.equal(review.amount,'100');
});
test('source retention keeps intake draft rows while a failed listener clears arrays',()=>{
 assert.equal(typeof r.confirmedReportData,'function');const last={clients:[client([ready()])],intakeRepairs:[{id:'i'}]};const cleared={clients:[],intakeRepairs:[]};
 assert.equal(r.confirmedReportData(cleared,last,'error'),last);assert.equal(r.confirmedReportData(cleared,last,'ready'),cleared);
});
test('archive periods include completed standalone task months',()=>{
 assert.equal(typeof r.reportArchiveMonths,'function');assert.deepEqual(r.reportArchiveMonths([], [{id:'t',status:'done',createdAt:'2026-08-01T00:00:00Z'}]),['2026-08']);
});
test('portal body hides unconfirmed contents without discarding editor fields',()=>{
 const Body=(ui as any).ReportModalBody;assert.equal(typeof Body,'function');const html=renderToStaticMarkup(createElement(Body,{blocked:true},createElement('input',{defaultValue:'Черновик'})));assert.match(html,/role="alert"/);assert.match(html,/hidden/);assert.match(html,/Черновик/);
});
test('monthly closed totals exclude cancellations while retaining legacy closedAt repairs',()=>{
 assert.equal(typeof r.reportClosedTotal,'function');const items=[{repair:ready({closedAt:'2026-10-01',cost:'8500'})},{repair:ready({status:'cancelled',cost:'999'})},{repair:ready({cost:'12000'})}];assert.equal(r.reportClosedTotal(items),8500);
});
test('close review shows exact kopecks rather than rounding the approved amount',()=>{
 const html=renderToStaticMarkup(createElement((ui as any).ReportCloseReview,{name:'Клиент',amount:'12500,50',busy:false,blocked:false,onConfirm(){},onCancel(){}}));assert.match(html,/12[^0-9]?500,50/);assert.doesNotMatch(html,/12[^0-9]?501/);
});
test('closing review conflicts if repair photographs change after inspection',()=>{
 const original=ready({photos:[{id:'p',url:'old'}]});assert.throws(()=>s.prepareRepairClose({...original,photos:[{id:'p',url:'new'}]},original,'100','2026-10-27','owner'));
});
test('mechanic report preserves full multiline text for closing inspection',()=>{
 const Work=(ui as any).ReportWorkComment;assert.equal(typeof Work,'function');const html=renderToStaticMarkup(createElement(Work,{comment:'Компрессор установлен.\nГерметичность проверена.'}));assert.match(html,/Отчёт механика/);assert.match(html,/Компрессор установлен/);assert.match(html,/Герметичность проверена/);
});
