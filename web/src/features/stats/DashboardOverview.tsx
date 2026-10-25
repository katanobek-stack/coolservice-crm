import {useMemo,useState} from "react";
import type {Tab} from "../../app/AppShell";
import type {Appointment} from "../../shared/types/appointment";
import type {ServiceTask} from "../../shared/types/task";
import type {StaffMember} from "../../shared/types/staff";
import {sourcesReady,type DataStatus} from "../../shared/context/dataReadiness";
import {Input} from "../../shared/ui/Input";
import {fmtMoney} from "../../shared/utils/format";
import {dashboardAge,dashboardNumber,selectDashboardRepairs,type AttentionFilter,type DashboardRepair} from "./dashboardLogic";

export interface DashboardMonitoring {
  ready:boolean; error:boolean; total:number; online:number; attention:number; alarms:number;
  problems:Array<{id:string;name:string;label:string}>;
}
interface Props {
  repairs:DashboardRepair[];appointments:Appointment[];tasks:ServiceTask[];staff:StaffMember[];
  uid:string;role:string;day:string;sourceStatus:DataStatus;canFinance:boolean;
  finance?:{current:number;previous:number;label:string};monitoring?:DashboardMonitoring;
  onNavigate(tab:Tab):void;onOpenRepair(repair:DashboardRepair):void;
}
const kinds:Record<string,string>={diagnostics:"Диагностика",repair:"Ремонт",consultation:"Консультация"};
const filters:Array<{id:AttentionFilter;label:string;hint:string}>=[
  {id:"all",label:"Открытых заявок",hint:"Клиенты и приёмка"},
  {id:"ready",label:"Готово к закрытию",hint:"Проверить результат работ"},
  {id:"unassigned",label:"Без исполнителя",hint:"Нужно назначить сотрудника"},
  {id:"aging",label:"Открыты 7+ дней",hint:"Возраст, а не просрочка"},
];
export function DashboardOverview({repairs,appointments,tasks,staff,uid,role,day,sourceStatus,canFinance,finance,monitoring,onNavigate,onOpenRepair}:Props){
  const [search,setSearch]=useState(""),[attention,setAttention]=useState<AttentionFilter>("all"),[mine,setMine]=useState(role==="mechanic"),[showAll,setShowAll]=useState(false),[showVisits,setShowVisits]=useState(false);
  const name=(id:string)=>staff.find(s=>s.id===id)?.name||staff.find(s=>s.id===id)?.email||id;
  const selection=useMemo(()=>selectDashboardRepairs(repairs,{search,attention,mine,uid,day},name),[repairs,search,attention,mine,uid,day,staff]);
  const ready=sourcesReady(sourceStatus,["clients","intakeRepairs"]),requestError=sourceStatus.clients==="error"||sourceStatus.intakeRepairs==="error";
  const visits=appointments.filter(a=>a.date===day&&a.status!=="closed"&&(role!=="mechanic"||a.assignees?.includes(uid))).sort((a,b)=>a.time.localeCompare(b.time));
  const visible=showAll?selection.rows:selection.rows.slice(0,6);
  const services=tasks.filter(t=>t.status!=="done"&&(!mine||t.assignees?.includes(uid))).length;
  const reset=()=>{setSearch("");setAttention("all");setShowAll(false);};
  return <div className="dash-overview">
    <div className="dash-attention-grid" role="group" aria-label="Фильтр внимания">{filters.map(filter=><button type="button" key={filter.id} className={`dash-attention dash-attention--${filter.id}`} aria-pressed={attention===filter.id} onClick={()=>{setAttention(filter.id);setShowAll(false);}}><span>{filter.label}</span><strong>{ready?selection.counts[filter.id]:"—"}</strong><small>{filter.hint}</small></button>)}</div>
    <div className="dash-columns"><section className="dash-panel dash-queue" aria-label="Открытые заявки"><div className="dash-panel-heading"><div><h2>Очередь работ</h2><p>Найдите заявку и откройте подробности.</p></div><button type="button" className="dash-link" onClick={()=>onNavigate("mytasks")}>Все заявки</button></div>
      <div className="dash-queue-tools"><label className="dash-search-label">Поиск<Input aria-label="Поиск заявок" type="search" value={search} onChange={e=>{setSearch(e.target.value);setShowAll(false);}} placeholder="Клиент, номер, оборудование, сотрудник"/></label><label className="dash-mine"><input type="checkbox" checked={mine} onChange={e=>{setMine(e.target.checked);setShowAll(false);}}/>Только мои заявки</label></div>
      <div className="dash-queue-caption"><span>{filters.find(f=>f.id===attention)?.label}{ready?` · ${selection.rows.length}`:""}</span>{(search||attention!=="all")&&<button type="button" className="dash-link" onClick={reset}>Сбросить фильтры</button>}</div>
      {requestError?<p className="dash-message dash-message--error" role="alert">Не удалось загрузить все заявки. Данные клиентов или приёмки недоступны. Обновите страницу, чтобы повторить подключение.</p>:!ready?<p className="dash-message" role="status">Загружаем клиентов и приёмку…</p>:!visible.length?<div className="dash-empty"><strong>{search||attention!=="all"?"По этим условиям заявок нет":mine?"У вас нет открытых заявок":"Нет активных заявок"}</strong><p>{mine?"Снимите «Только мои заявки», чтобы посмотреть общую очередь.":"Измените фильтр или откройте приёмку для новой работы."}</p></div>:<div className="dash-request-list">{visible.map(repair=>{
        const age=dashboardAge(repair.date,day);
        return <button type="button" className="dash-request" key={repair.key} onClick={()=>onOpenRepair(repair)}><span className="dash-request-top"><strong>{repair.clientName}</strong><span className={`dash-badge ${repair.phase==="ready"?"is-ready":"is-active"}`}>{repair.phase==="ready"?"Работы выполнены":"В работе"}</span></span><span className="dash-request-description">{repair.description||repair.equipment||"Описание не указано"}</span><span className="dash-request-meta"><span>{repair.source==="intake"?"Приёмка":"Клиент"}{repair.vehicle?.plate?` · ${repair.vehicle.plate}`:""}</span><span>{repair.mechanicIds.length?repair.mechanicIds.map(name).join(", "):"Исполнитель не назначен"}</span><span className={age!==null&&age>=7?"dash-age":""}>{age===null?"Дата не указана":`${age} дн. в очереди`}</span>{canFinance&&dashboardNumber(repair.cost)>0&&<span className="dash-request-price">{fmtMoney(dashboardNumber(repair.cost))}</span>}</span></button>;
      })}</div>}
      {ready&&selection.rows.length>6&&<button type="button" className="dash-show-more" onClick={()=>setShowAll(value=>!value)}>{showAll?"Свернуть список":`Показать все ${selection.rows.length}`}</button>}
      <p className="dash-footnote">«Работы выполнены» — результат готов, закрытие руководителем ещё не подтверждено. Возраст заявки не означает нарушение срока.</p>
    </section>
    <aside className="dash-side"><section className="dash-panel dash-today"><div className="dash-panel-heading"><div><h2>{role==="mechanic"?"Ваши записи сегодня":"Сегодня в сервисе"}</h2><p>По времени Владивостока</p></div><button type="button" className="dash-link" onClick={()=>onNavigate("calendar")}>Календарь</button></div>
      {sourceStatus.appointments==="error"?<p className="dash-message dash-message--error" role="alert">Записи недоступны. Это не означает, что записей нет.</p>:sourceStatus.appointments!=="ready"?<p className="dash-message" role="status">Загружаем записи…</p>:!visits.length?<p className="dash-message">На сегодня записей нет.</p>:<div className="dash-visits">{(showVisits?visits:visits.slice(0,4)).map(visit=><button type="button" className="dash-visit" key={visit.id} onClick={()=>onNavigate("calendar")}><span className="dash-visit-time">{visit.time||"—"}</span><span><strong>{visit.clientName}</strong><small>{[visit.carPlate,kinds[visit.type],visit.assigneeNames?.join(", ")].filter(Boolean).join(" · ")}</small></span></button>)}</div>}
      {sourceStatus.appointments==="ready"&&visits.length>4&&<button type="button" className="dash-show-more" onClick={()=>setShowVisits(value=>!value)}>{showVisits?"Свернуть":`Все записи · ${visits.length}`}</button>}
    </section>
    {monitoring&&<section className="dash-panel dash-monitoring"><div className="dash-panel-heading"><div><h2>Оборудование</h2><p>Связь и актуальность измерений</p></div><button type="button" className="dash-link" onClick={()=>onNavigate("monitoring")}>Открыть</button></div>
      {monitoring.error?<p className="dash-message dash-message--error" role="alert">Мониторинг недоступен. Состояние оборудования не подтверждено.</p>:!monitoring.ready?<p className="dash-message" role="status">Загружаем состояние оборудования…</p>:!monitoring.total?<p className="dash-message">Активные устройства не подключены.</p>:<><div className="dash-monitor-stats"><div><strong>{monitoring.online}/{monitoring.total}</strong><span>Связь и свежие данные</span></div><div className={monitoring.attention?"needs-attention":""}><strong>{monitoring.attention}</strong><span>Требуют проверки</span></div><div className={monitoring.alarms?"needs-alarm":""}><strong>{monitoring.alarms}</strong><span>Активных тревог</span></div></div>{monitoring.problems.map(problem=><button type="button" className="dash-problem" key={problem.id} onClick={()=>onNavigate("monitoring")}><span>{problem.name}</span><strong>{problem.label}</strong></button>)}<p className="dash-footnote">Наличие связи само по себе не подтверждает допустимую температуру.</p></>}
    </section>}
    {canFinance&&<section className="dash-panel dash-finance-peek"><div className="dash-panel-heading"><div><h2>Выручка по учёту</h2><p>{finance?.label||"Текущий месяц"}</p></div></div>{finance?<><strong className="dash-money">{fmtMoney(finance.current)}</strong><p className="dash-footnote">Предыдущий месяц: {fmtMoney(finance.previous)}. Завершённые заявки и аренда камер по настройкам учёта; не подтверждение оплаты.</p></>:<p className="dash-message">Финансовые данные ещё не загружены или недоступны.</p>}</section>}
    </aside></div>
    <section className="dash-shortcuts" aria-label="Быстрые действия">{([{tab:"intake",title:"Принять технику",text:"Автомобиль или камера"},{tab:"dailyPlan",title:"Открыть ППЗ",text:"План и задачи команды"},{tab:"mytasks",title:"Сервисные работы",text:sourceStatus.tasks==="ready"?`${services} активных${mine?" у вас":""}`:"Данные ещё не подтверждены"},{tab:"calendar",title:"Записи на приём",text:"Расписание и новые записи"}] as const).map(item=><button type="button" key={item.tab} onClick={()=>onNavigate(item.tab)}><strong>{item.title}<span aria-hidden="true">↗</span></strong><span>{item.text}</span></button>)}</section>
  </div>;
}
