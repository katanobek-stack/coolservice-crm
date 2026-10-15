import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, Timestamp, where } from "firebase/firestore";
import { getFirebaseDb } from "../../shared/firebase/app";
import { useData } from "../../shared/context/DataContext";
import { Button } from "../../shared/ui/Button";
import { Input, Select } from "../../shared/ui/Input";
import { vladivostokDate } from "./logic";
import { accountingRange, csvCell, summarizeWork, workEventLabels, workSourceLabels, type WorkEvent } from "./workAccounting";

export function WorkAccountingPanel() {
  const { staff } = useData();
  const today = vladivostokDate();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`), [to, setTo] = useState(today);
  const [employee, setEmployee] = useState(""), [source, setSource] = useState("");
  const [events, setEvents] = useState<WorkEvent[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [showCount, setShowCount] = useState(100);
  const range = useMemo(() => accountingRange(from, to), [from, to]);
  useEffect(() => {
    setEvents([]); setError(""); setLoading(true); setShowCount(100);
    if (!range) { setLoading(false); return; }
    return onSnapshot(query(collection(getFirebaseDb(), "workEvents"), where("occurredAt", ">=", Timestamp.fromDate(range.start)), where("occurredAt", "<", Timestamp.fromDate(range.end)), orderBy("occurredAt", "desc")), snap => {
      setEvents(snap.docs.map(d => ({ ...d.data(), id: d.id }) as WorkEvent)); setLoading(false);
    }, err => { setError(err.message); setLoading(false); });
  }, [range]);
  const bySource = events.filter(e => !source || e.sourceKind === source);
  const filtered = bySource.filter(e => !employee || e.staffId === employee || e.actorId === employee);
  const summary = summarizeWork(bySource, staff.filter(s => !employee || s.id === employee).map(s => s.id));
  const name = (id: string | null) => id ? staff.find(s => s.id === id)?.name || id : "Автор не установлен";
  const time = (e: WorkEvent) => e.occurredAt?.toDate().toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" }) ?? "";
  function download() {
    const rows = [["Время (Владивосток)", "Источник", "Работа", "Действие", "Исполнитель отметки", "Автор действия", "Личная отметка", "Отчёт"], ...filtered.map(e => [time(e), workSourceLabels[e.sourceKind] || e.sourceKind, e.title, workEventLabels[e.type] || e.type, name(e.staffId), name(e.actorId), e.selfReported ? "Да" : "Нет", e.text])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `work-history-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="ppz-card">
    <h3>Учёт выполненных работ</h3>
    <p className="ppz-muted">Личные отметки, общие закрытия и приёмка машин считаются отдельно. Это факты для будущего KPI; оценка качества пока не ведётся.</p>
    <div className="ppz-row">
      <label>С <Input aria-label="Начало периода учёта" type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
      <label>По <Input aria-label="Конец периода учёта" type="date" value={to} onChange={e => setTo(e.target.value)}/></label>
      <Select aria-label="Сотрудник в учёте работ" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все сотрудники</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}</Select>
      <Select aria-label="Источник работ" value={source} onChange={e => setSource(e.target.value)}><option value="">Все виды работ</option>{Object.entries(workSourceLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
    </div>
    {!range && <p role="alert">Укажите корректный период.</p>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Загружаем историю…</p> : !error && range && <>
      <div className="ppz-table-scroll"><table className="ppz-accounting"><thead><tr><th>Сотрудник</th><th>Начал ППЗ</th><th>Лично отметил выполнение</th><th>Отмечено другим / системой</th><th>Общих закрытий</th><th>Принял машин</th><th>Снятых отметок</th></tr></thead><tbody>
        {summary.map(row => <tr key={row.uid}><td>{name(row.uid)}</td><td>{row.started}</td><td>{row.personal}</td><td>{row.recordedByOthers}</td><td>{row.closed}</td><td>{row.received}</td><td>{row.revoked}</td></tr>)}
      </tbody></table></div>
      <p className="ppz-muted">Одна работа учитывается один раз на сотрудника в выбранном периоде. Снятая отметка исключается, если она последняя за период. Начало и конец периода — по Владивостоку. Время между началом и отчётом не считается отработанными часами.</p>
      <p className="ppz-muted">История собирается с подключения этого учёта. Старые работы и перенос из приёмки к клиенту не начисляют новые выполнения. Отметка выполнения — сообщение о работе, а не оценка качества.</p>
      <div className="ppz-row"><strong>История действий: {filtered.length}</strong><Button variant="ghost" disabled={!filtered.length} onClick={download}>Скачать историю CSV</Button></div>
      {filtered.slice(0, showCount).map(e => <article key={e.id} className="ppz-card">
        <strong>{e.title}</strong><p>{time(e)} · {workSourceLabels[e.sourceKind]} · {workEventLabels[e.type] || e.type}</p>
        <p>Автор действия: {e.actorName || name(e.actorId)}{e.staffId && e.staffId !== e.actorId ? ` · Отметка за: ${name(e.staffId)}` : ""}</p>
        {e.text && <p className="ppz-comment">{e.text}</p>}
        {e.type === "completed" && !e.selfReported && <p className="ppz-muted">Личное действие этого исполнителя не подтверждено автором записи.</p>}
      </article>)}
      {filtered.length > showCount && <Button variant="ghost" onClick={() => setShowCount(n => n + 100)}>Показать ещё</Button>}
      {!filtered.length && <p>За этот период записей пока нет.</p>}
    </>}
  </section>;
}
