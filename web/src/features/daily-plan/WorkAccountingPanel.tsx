import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { getFirebaseDb } from "../../shared/firebase/app";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Button } from "../../shared/ui/Button";
import { Input, Select } from "../../shared/ui/Input";
import { vladivostokDate } from "./logic";
import { accountingMonth, accountingRange, canViewWorkAccounting, closedWorkRepairs, csvCell, monthlyWorkSummary, workEventLabels, workSourceLabels, type AccountingTask, type WorkEvent, type WorkTime } from "./workAccounting";
import { PhotoEvidence } from "./ReportPhotos";
import { employeeTone } from "./presentation";
import "./dailyPlan.css";

type WorkRow = ReturnType<typeof monthlyWorkSummary>[number];
export function WorkRankingTable({ rows, name, onSelect }: { rows: WorkRow[]; name(id: string): string; onSelect(id: string): void }) {
  return <><div className="ppz-ranking-cards">{rows.map((row, index) => <article key={row.uid} className={`ppz-ranking-card ppz-person--${employeeTone(row.uid)}`}>
    <strong>№{index + 1} · {name(row.uid)}</strong><dl>
      <div><dt>ППЗ назначено¹</dt><dd>{row.assigned}</dd></div><div><dt>ППЗ выполнено²</dt><dd>{row.ppzCompleted}</dd></div>
      <div><dt>Работ в заявках²</dt><dd>{row.repairTasks}</dd></div><div><dt>Заявок с участием³</dt><dd>{row.requests}</dd></div>
    </dl><Button variant="ghost" onClick={() => onSelect(row.uid)} aria-label={`История сотрудника: ${name(row.uid)}`}>Подробнее</Button>
  </article>)}</div><div className="ppz-table-scroll ppz-ranking-desktop"><table className="ppz-accounting"><thead><tr>
    <th>Место</th><th>Сотрудник</th><th>ППЗ назначено¹</th><th>Создал ППЗ¹</th><th>Выполнил ППЗ²</th><th>Задач в дневных планах¹</th><th>Работ в заявках²</th><th>Сервисных работ²</th><th>Личных выполнений²</th><th>Закрытых заявок с участием³</th><th>Отметки других / системы</th><th>Фото</th><th>История</th>
  </tr></thead><tbody>{rows.map((row, index) => <tr key={row.uid}>
    <td>{index + 1}</td><td><span className={`ppz-person ppz-person--${employeeTone(row.uid)}`}><span className="ppz-person-dot" aria-hidden="true" />{name(row.uid)}</span></td>
    <td>{row.assigned}</td><td>{row.created}</td><td>{row.ppzCompleted}</td><td>{row.plannedTasks}</td><td>{row.repairTasks}</td><td>{row.serviceTasks}</td><td>{row.personal}</td><td>{row.requests}</td><td>{row.recordedByOthers}</td><td>{row.photos}</td>
    <td><Button variant="ghost" onClick={() => onSelect(row.uid)} aria-label={`История сотрудника: ${name(row.uid)}`}>Подробнее</Button></td>
  </tr>)}</tbody></table></div></>;
}

export function WorkAccountingPanel(props: { ppzTasks?: AccountingTask[]; dashboard?: boolean }) {
  const { myProfile } = useAuth();
  // Do not mount company-wide listeners for a read-only mechanic or manager.
  if (!canViewWorkAccounting(myProfile?.role)) return null;
  return <MonthlyWorkAccounting {...props} />;
}

function MonthlyWorkAccounting({ ppzTasks, dashboard = false }: { ppzTasks?: AccountingTask[]; dashboard?: boolean }) {
  const { staff, clients, intakeRepairs, loaded } = useData();
  const currentMonth = vladivostokDate().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const initial = accountingMonth(currentMonth)!;
  const [from, setFrom] = useState(initial.from), [to, setTo] = useState(initial.to);
  const [employee, setEmployee] = useState(""), [source, setSource] = useState("");
  const [rankBy, setRankBy] = useState<"ppzCompleted" | "personal" | "requests">("ppzCompleted");
  const [details, setDetails] = useState(!dashboard);
  const [events, setEvents] = useState<WorkEvent[]>([]), [queriedTasks, setQueriedTasks] = useState<AccountingTask[]>([]);
  const [loading, setLoading] = useState(true), [taskLoading, setTaskLoading] = useState(false);
  const [error, setError] = useState(""), [taskError, setTaskError] = useState("");
  const [showCount, setShowCount] = useState(100);
  const range = useMemo(() => accountingRange(from, to), [from, to]);
  useEffect(() => {
    setEvents([]); setError(""); setLoading(true); setShowCount(100);
    if (!range) { setLoading(false); return; }
    return onSnapshot(query(collection(getFirebaseDb(), "workEvents"), where("occurredAt", ">=", Timestamp.fromDate(range.start)), where("occurredAt", "<", Timestamp.fromDate(range.end)), orderBy("occurredAt", "desc")), snap => {
      setEvents(snap.docs.map(d => ({ ...d.data(), id: d.id }) as WorkEvent)); setLoading(false);
    }, err => { setError(err.message); setLoading(false); });
  }, [range]);
  useEffect(() => {
    setQueriedTasks([]); setTaskError(""); setTaskLoading(false);
    if (ppzTasks || !range) return;
    setTaskLoading(true);
    // Only creation records in the selected month, not the complete task archive.
    return onSnapshot(query(collection(getFirebaseDb(), "ppzTasks"), where("createdAt", ">=", Timestamp.fromDate(range.start)), where("createdAt", "<", Timestamp.fromDate(range.end))), snap => {
      setQueriedTasks(snap.docs.map(d => ({ ...d.data(), id: d.id }) as AccountingTask)); setTaskLoading(false);
    }, err => { setTaskError(err.message); setTaskLoading(false); });
  }, [ppzTasks, range]);
  const tasks = ppzTasks ?? queriedTasks;
  const repairs = useMemo(() => range ? closedWorkRepairs(clients, intakeRepairs, range) : [], [clients, intakeRepairs, range]);
  const allRows = range ? monthlyWorkSummary(events, tasks, repairs, staff.map(s => s.id), range) : [];
  const name = (id: string | null | undefined): string => !id ? "Автор не зафиксирован" : staff.find(s => s.id === id)?.name
    || events.find(e => e.actorId === id && e.actorName)?.actorName || tasks.find(t => t.createdBy === id)?.createdByName
    || tasks.find(t => t.assigneeNames?.[id])?.assigneeNames?.[id] || id;
  const rows = allRows.filter(row => !employee || row.uid === employee).sort((a, b) => b[rankBy] - a[rankBy] || name(a.uid).localeCompare(name(b.uid), "ru") || a.uid.localeCompare(b.uid));
  const filtered = events.filter(e => (!source || e.sourceKind === source) && (!employee || e.staffId === employee || e.actorId === employee || e.type === "task_created" && e.assigneeIds?.includes(employee)));
  const createdTasks = tasks.filter(t => t.createdAt && range && t.createdAt.toMillis() >= range.start.getTime() && t.createdAt.toMillis() < range.end.getTime()
    && (!employee || t.createdBy === employee || t.assignees.includes(employee))).sort((a, b) => b.createdAt!.toMillis() - a.createdAt!.toMillis() || a.id.localeCompare(b.id));
  const visibleRepairs = repairs.filter(r => !employee || r.participants.includes(employee));
  const format = (t?: WorkTime | null) => t?.toDate().toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" }) || "Дата не зафиксирована";
  function download(history: boolean) {
    const data = history
      ? [["Время (Владивосток)", "Источник", "Работа", "Действие", "Исполнитель отметки", "Автор действия", "Создал ППЗ", "Создано", "Назначено", "Отчёт", "Фото"],
        ...filtered.map(e => [format(e.occurredAt), workSourceLabels[e.sourceKind] || e.sourceKind, e.title, workEventLabels[e.type] || e.type, name(e.staffId), e.actorName || name(e.actorId), e.createdByName || name(e.createdBy), e.createdAt ? format(e.createdAt) : "", (e.assigneeIds ?? []).map(id => e.assigneeNames?.[id] || name(id)).join(", "), e.text, String(e.photos?.length ?? 0)])]
      : [["Период", "Сотрудник", "Назначено общих ППЗ", "Создал ППЗ", "Выполнил общих ППЗ", "Задач в дневных планах", "Опубликованных дневных планов", "Работ в заявках", "Сервисных работ", "Личных выполнений", "Заявок с участием", "Отметки других/системы", "Фото"],
        ...rows.map(row => [from + " — " + to, name(row.uid), ...[row.assigned, row.created, row.ppzCompleted, row.plannedTasks, row.plansPublished, row.repairTasks, row.serviceTasks, row.personal, row.requests, row.recordedByOthers, row.photos].map(String)])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + data.map(row => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${history ? "work-history" : "staff-month"}-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="ppz-card">
    <h3>Сотрудники · ППЗ и выполненные заявки по месяцам</h3>
    <div className="ppz-row">
      <label>Месяц <Input aria-label="Месяц статистики сотрудников" type="month" value={month} onChange={e => { setMonth(e.target.value); const next = accountingMonth(e.target.value); setFrom(next?.from ?? ""); setTo(next?.to ?? ""); }}/></label>
      <label>С <Input aria-label="Начало периода учёта" type="date" value={from} onChange={e => { setMonth(""); setFrom(e.target.value); }}/></label>
      <label>По <Input aria-label="Конец периода учёта" type="date" value={to} onChange={e => { setMonth(""); setTo(e.target.value); }}/></label>
      <Select aria-label="Сотрудник в учёте работ" value={employee} onChange={e => { setEmployee(e.target.value); setShowCount(100); }}><option value="">Все сотрудники</option>{allRows.map(row => <option key={row.uid} value={row.uid}>{name(row.uid)}</option>)}</Select>
      <Select aria-label="Сортировка рейтинга сотрудников" value={rankBy} onChange={e => setRankBy(e.target.value as typeof rankBy)}><option value="ppzCompleted">По выполненным ППЗ</option><option value="personal">По личным выполнениям всех работ</option><option value="requests">По закрытым заявкам с участием</option></Select>
    </div>
    {!range && <p role="alert">Укажите корректный период.</p>}
    {(error || taskError) && <p role="alert">Не удалось получить полную статистику: {error || taskError}</p>}
    {loading || taskLoading || !loaded ? <p>Загружаем историю…</p> : !error && !taskError && range && <>
      <WorkRankingTable rows={rows} name={name} onSelect={id => { setEmployee(id); setDetails(true); setShowCount(100); }} />
      <p className="ppz-muted">¹ Общие задачи ППЗ — созданные за период; задачи дневных планов — уникальные работы по публикациям за период, без повторного счёта версий и переноса на другой день. ² Личные выполнения — по журналу, не по числу назначений. ³ Закрытые заявки с отметками doneBy сотрудника, не просто с назначением механика.</p>
      <p className="ppz-muted">Это рейтинг количества работ, не качества, часов или сложности. Совместная заявка может присутствовать у нескольких участников — строки нельзя складывать как число уникальных заявок компании.</p>
      <div className="ppz-row"><Button variant="ghost" onClick={() => setDetails(value => !value)}>{details ? "Скрыть подробную историю" : "Открыть историю и выполненные заявки"}</Button><Button variant="ghost" onClick={() => download(false)}>Скачать статистику CSV</Button></div>
      <p className="ppz-muted">История действий ведётся с подключения учёта, прежние работы автоматически не приписываются. Создатель и назначения новых ППЗ сохраняются снимком; для старых используются только имеющиеся данные. Заявки ниже — текущий архив CRM по closedAt; отменённые, открытые и без даты закрытия не засчитываются.</p>
      {details && <>
        <h4>Дополнительные показатели периода</h4>{rows.map(row => <p className="ppz-muted" key={row.uid}>{name(row.uid)}: создал ППЗ — {row.created}; дневных планов опубликовано — {row.plansPublished}; задач в планах — {row.plannedTasks}; приступил — {row.started}; общих закрытий — {row.closed}; принял машин — {row.received}; снятых отметок — {row.revoked}; работ с фото — {row.withPhotos}.</p>)}
        <h4>ППЗ, созданные в выбранном периоде · {createdTasks.length}</h4>
        {createdTasks.map(task => <article className="ppz-card" key={task.id}><strong>{task.title}</strong><p className="ppz-muted">Создал: {task.createdByName || name(task.createdBy)} · {format(task.createdAt)} · Назначено: {task.assignees.map(id => task.assigneeNames?.[id] || name(id)).join(", ")}{task.createdBy && task.assignees.includes(task.createdBy) ? " · автор назначил себе" : ""}</p></article>)}
        <h4>Закрытые заявки {employee ? `с участием ${name(employee)}` : "из архива CRM"} · {visibleRepairs.length}</h4>
        {visibleRepairs.map(repair => <details className="ppz-card" key={repair.id}><summary><strong>{repair.title}</strong> · {new Date(repair.closedAt).toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" })}</summary><p className="ppz-muted">ID заявки: {repair.id} · Участники по отметкам: {repair.participants.map(name).join(", ") || "Не зафиксированы"}</p>
          {repair.tasks.filter(task => !employee || task.doneBy.includes(employee)).map(task => <div key={task.id}><strong>{task.description}</strong><p>Отметки: {task.doneBy.map(name).join(", ") || "Нет"}</p>{task.workComment && <p className="ppz-comment">{task.workComment}</p>}<PhotoEvidence photos={task.photos} /></div>)}
        </details>)}
        <div className="ppz-row"><h4>История действий · {filtered.length}</h4><Select aria-label="Источник работ в истории" value={source} onChange={e => { setSource(e.target.value); setShowCount(100); }}><option value="">Все виды работ</option>{Object.entries(workSourceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select><Button variant="ghost" disabled={!filtered.length} onClick={() => download(true)}>Скачать историю CSV</Button></div>
        {filtered.slice(0, showCount).map(e => <article key={e.id} className="ppz-card">
          <strong>{e.title}</strong><p>{format(e.occurredAt)} · {workSourceLabels[e.sourceKind]} · {workEventLabels[e.type] || e.type}</p>
          <p>Автор действия: {e.actorName || name(e.actorId)}{e.staffId && e.staffId !== e.actorId ? ` · Отметка за: ${name(e.staffId)}` : ""}</p>
          {["ppz", "plan"].includes(e.sourceKind) && <p className="ppz-muted">Создал: {e.createdByName || name(e.createdBy)} · {format(e.createdAt)} · Назначено: {(e.assigneeIds ?? []).map(id => e.assigneeNames?.[id] || name(id)).join(", ") || "Не зафиксировано в старом событии"}</p>}
          {e.planItems && <ul>{e.planItems.map(item => <li key={item.workKey}>{item.title} · {workSourceLabels[item.sourceKind]}</li>)}</ul>}
          {e.text && <p className="ppz-comment">{e.text}</p>}<PhotoEvidence photos={e.photos} />
          {e.type === "completed" && !e.selfReported && <p className="ppz-muted">Личное действие исполнителя не подтверждено автором записи; отдельно от личных выполнений.</p>}
        </article>)}
        {filtered.length > showCount && <Button variant="ghost" onClick={() => setShowCount(n => n + 100)}>Показать ещё</Button>}
        {!filtered.length && <p>За этот период записей пока нет.</p>}
      </>}
    </>}
  </section>;
}
