import {test} from "node:test";
import assert from "node:assert/strict";
import * as logic from "../src/features/stats/dashboardLogic";
import * as readiness from "../src/shared/context/dataReadiness";
import type {Client,Repair} from "../src/shared/types/client";
import type {IntakeRepair} from "../src/shared/types/intake";
const api=logic as unknown as {
  dashboardNumber(value:unknown):number;
  dashboardFinancialAccess(role:string, allowed:boolean):boolean;
  collectDashboardRepairs(clients:Client[],intake:IntakeRepair[]):Array<Repair&{key:string;source:"client"|"intake";clientName:string;phase:"active"|"ready"|"closed"|"cancelled"}>;
  selectDashboardRepairs(rows:ReturnType<typeof api.collectDashboardRepairs>,filter:{search:string;attention:string;mine:boolean;uid:string;day:string},name:(id:string)=>string):{rows:Array<{id:string}>;counts:Record<string,number>};
  dashboardDay(now:Date):string;
  dashboardAge(date:string|undefined,day:string):number|null;
  dashboardMonthRevenue(repairs:Repair[],month:string,finance:unknown,rental:number):number;
};
const ready=readiness as unknown as {initialDataStatus():Record<string,string>;markDataStatus(state:Record<string,string>,source:string,status:string):Record<string,string>;sourcesReady(state:Record<string,string>,sources:readonly string[]):boolean};
const repair=(id:string,extra:Partial<Repair>={}):Repair=>({id,serviceType:"refrigerator",date:"2026-10-01",tasks:[],...extra});
const client=(id:string,repairs:Repair[]):Client=>({id,name:`Клиент ${id}`,vehicles:[],repairs});
const intake=(id:string,r:Repair):IntakeRepair=>({id,kind:"vehicle",vehicle:{plate:"А123АА",plateNormalized:"A123AA",serviceType:"refrigerator"},repair:r,createdAt:"2026-10-01",createdBy:"a",createdByName:"Егор"});
test("readiness needs each stream, not eight repeated snapshots of one source",()=>{
 assert.equal(typeof ready.initialDataStatus,"function");let state=ready.initialDataStatus();for(let i=0;i<8;i++)state=ready.markDataStatus(state,"clients","ready");
 assert.equal(ready.sourcesReady(state,["clients","intakeRepairs"]),false);
 state=ready.markDataStatus(state,"intakeRepairs","error");assert.equal(ready.sourcesReady(state,["clients","intakeRepairs"]),false);
 state=ready.markDataStatus(state,"intakeRepairs","ready");assert.equal(ready.sourcesReady(state,["clients","intakeRepairs"]),true);
});
test("financial access never depends on mere non-mechanic status",()=>{
 assert.equal(typeof api.dashboardFinancialAccess,"function");
 for(const role of ["mechanic","unknown",""])assert.equal(api.dashboardFinancialAccess(role,true),false);
 assert.equal(api.dashboardFinancialAccess("admin",false),false);assert.equal(api.dashboardFinancialAccess("admin",true),true);assert.equal(api.dashboardFinancialAccess("owner",false),true);assert.equal(api.dashboardFinancialAccess("manager",true),true);
});
test("operational requests include intake and deduplicate a moved intake without merging distinct clients",()=>{
 assert.equal(typeof api.collectDashboardRepairs,"function");const rows=api.collectDashboardRepairs([client("one",[repair("moved")]),client("two",[repair("moved")])],[intake("old",repair("moved")),intake("new",repair("walk-in"))]);
 assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.source==="intake").length,1);assert.equal(new Set(rows.map(r=>r.key)).size,3);
});
test("completed tasks awaiting manager close remain actionable, cancellations and confirmed closures do not",()=>{
 assert.equal(typeof api.collectDashboardRepairs,"function");const rows=api.collectDashboardRepairs([client("one",[
 repair("ready",{tasks:[{id:"t",description:"Готово",assignees:["a"],doneBy:["a"],status:"done"}]}),repair("closed",{closedByManager:true}),repair("cancel",{status:"cancelled"}),repair("active")])],[]);
 assert.deepEqual(rows.map(r=>[r.id,r.phase]),[["ready","ready"],["closed","closed"],["cancel","cancelled"],["active","active"]]);
 const result=api.selectDashboardRepairs(rows,{search:"",attention:"all",mine:false,uid:"a",day:"2026-10-26"},id=>id);
 assert.deepEqual(result.rows.map(r=>r.id).sort(),["active","ready"]);
 assert.equal(result.counts.ready,1);assert.equal(result.counts.unassigned,1);assert.equal(result.counts.aging,2);
});
test("search and personal scope combine and leave source data untouched",()=>{
 assert.equal(typeof api.selectDashboardRepairs,"function");const rows=api.collectDashboardRepairs([client("one",[repair("a",{description:"Проверить компрессор",mechanics:["a"]}),repair("b")])],[]);
 const result=api.selectDashboardRepairs(rows,{search:"егор компрессор",attention:"all",mine:true,uid:"a",day:"2026-10-26"},id=>id==="a"?"Егор":id);
 assert.deepEqual(result.rows.map(r=>r.id),["a"]);assert.equal(rows.length,2);
});
test("service day follows Vladivostok around midnight, age is calendar days without invented deadlines",()=>{
 assert.equal(typeof api.dashboardDay,"function");assert.equal(api.dashboardDay(new Date("2026-10-25T14:00:00Z")),"2026-10-26");
 assert.equal(api.dashboardAge("2026-10-19","2026-10-26"),7);assert.equal(api.dashboardAge(undefined,"2026-10-26"),null);assert.equal(api.dashboardAge("bad","2026-10-26"),null);assert.equal(api.dashboardAge("2026-10-27","2026-10-26"),0);
});
test("localized amounts remain finite and historical rentals are not replaced with today's configuration",()=>{
 assert.equal(typeof api.dashboardNumber,"function");assert.equal(api.dashboardNumber("12 500,50"),12500.5);assert.equal(api.dashboardNumber("Infinity"),0);assert.equal(api.dashboardNumber(undefined),0);
 const r=repair("past",{cost:"1 500,50",closedByManager:true,closedAt:"2026-09-15T10:00:00Z"});
 assert.equal(api.dashboardMonthRevenue([r],"2026-09",{fixedCostHistory:{"2026-09":{rentalIncome:3000}}},9000),4500.5);
});

import {createElement, type ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import * as overview from "../src/features/stats/DashboardOverview";
const view=overview as unknown as {DashboardOverview:ComponentType<Record<string,unknown>>};
test("overview omits all monetary surfaces when finance permission is false",()=>{
 assert.equal(typeof view.DashboardOverview,"function");
 const states=Object.fromEntries(["clients","intakeRepairs","tasks","staff","finance","freezers","expenses","appointments"].map(k=>[k,"ready"]));
 const html=renderToStaticMarkup(createElement(view.DashboardOverview,{repairs:api.collectDashboardRepairs([client("a",[repair("p",{cost:"123456"})])],[]),appointments:[],tasks:[],staff:[],uid:"a",role:"admin",day:"2026-10-26",sourceStatus:states,canFinance:false,finance:{current:999999,previous:888888,label:"Октябрь"},onNavigate:()=>{},onOpenRepair:()=>{}}));
 assert.doesNotMatch(html,/999.?999|888.?888|123.?456|₽/);
 assert.match(html,/Поиск заявок/);
});
test("overview reports unavailable request sources rather than a falsely empty queue",()=>{
 assert.equal(typeof view.DashboardOverview,"function");
 const states=Object.fromEntries(["clients","intakeRepairs","tasks","staff","finance","freezers","expenses","appointments"].map(k=>[k,"ready"]));states.intakeRepairs="error";
 const html=renderToStaticMarkup(createElement(view.DashboardOverview,{repairs:[],appointments:[],tasks:[],staff:[],uid:"a",role:"owner",day:"2026-10-26",sourceStatus:states,canFinance:false,onNavigate:()=>{},onOpenRepair:()=>{}}));
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Нет активных заявок/);
});
test("mechanic overview tolerates legacy appointments without assignees",()=>{
 const states=Object.fromEntries(["clients","intakeRepairs","tasks","staff","finance","freezers","expenses","appointments"].map(k=>[k,"ready"]));
 const html=renderToStaticMarkup(createElement(view.DashboardOverview,{repairs:[],appointments:[{id:"legacy",date:"2026-10-26",time:"09:00",status:"pending",clientName:"Legacy"}],tasks:[],staff:[],uid:"a",role:"mechanic",day:"2026-10-26",sourceStatus:states,canFinance:false,onNavigate:()=>{},onOpenRepair:()=>{}}));
 assert.match(html,/На сегодня записей нет/);
});

test("detail status distinguishes work completion from confirmed closure",()=>{
 assert.equal((logic as unknown as {dashboardStatusLabel(r:Repair):string}).dashboardStatusLabel(repair("ready",{tasks:[{id:"t",description:"Done",assignees:["a"],doneBy:["a"],status:"done"}]})),"Работы выполнены · ожидает закрытия");
 assert.equal((logic as unknown as {dashboardStatusLabel(r:Repair):string}).dashboardStatusLabel(repair("closed",{closedByManager:true})),"Закрыто");
});
