import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import { getFirebaseDb, getFirebaseFunctions } from "../../shared/firebase/app";
import { Button } from "../../shared/ui/Button";
import { Input, Select, Textarea } from "../../shared/ui/Input";
import { WorkAccountingPanel } from "./WorkAccountingPanel";
import { PhotoEvidence, ReportPhotoPicker, useReportPhotos } from "./ReportPhotos";
import type { PhotoData } from "../../shared/utils/photos";
import { employeeTone } from "./presentation";

interface PpzTask {
  id: string; title: string; assignees: string[]; status: "open" | "in_progress" | "done";
  description?: string;
  completedByName?: string; completedAt?: Timestamp; startedBy?: string;
  participants?: Record<string, { name: string; startedAt?: Timestamp; result?: string; photos?: PhotoData[]; reportedAt?: Timestamp; updatedAt?: Timestamp; revision: number }>;
}
export function TaskCard({ task, uid, name }: { task: PpzTask; uid: string; name: (uid: string) => string }) {
  const [report, setReport] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const own = task.participants?.[uid];
  const attachments = useReportPhotos(`work-reports/${uid}/ppz/${task.id}`);
  const time = (t?: Timestamp) => t?.toDate().toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" }) ?? "";
  async function act(action: "start" | "report" | "complete") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const photos = action === "start" ? [] : await attachments.upload();
      const payload = { action, id: task.id, ...(action === "start" ? {} : { report: report.trim(), reportRevision: own?.revision ?? 0, ...(photos.length ? { photos } : {}) }) };
      const signature = JSON.stringify(payload);
      if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      await httpsCallable(getFirebaseFunctions(), "savePpzTask")({ ...payload, requestId: pending.current.id });
      pending.current = null; if (action !== "start") { setReport(""); attachments.reset(); }
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить выполнение"); }
    finally { setBusy(false); }
  }
  return <article className={`ppz-card ppz-task ppz-task--${task.status}`}>
    <div className="ppz-row"><strong>{task.title}</strong><span className={`ppz-status ppz-status--${task.status}`}>{task.status === "done" ? "✓ Выполнено" : task.status === "in_progress" ? "◉ В работе" : "К выполнению"}</span></div>
    {task.description && <p className="ppz-comment">{task.description}</p>}
    <div className="ppz-people">{task.assignees.map(id => <span key={id} className={`ppz-person ppz-person--${employeeTone(id)}`}><span className="ppz-person-dot" aria-hidden="true" />{name(id)}</span>)}</div>
    {task.status === "done" && <p>Закрыл: {task.completedByName} · {time(task.completedAt)} (Владивосток)</p>}
    {task.assignees.map(id => {
      const participant = task.participants?.[id];
      return <div key={id} className={`ppz-participant ppz-person--${employeeTone(id)} ${participant?.result ? "is-reported" : participant?.startedAt ? "is-working" : "is-waiting"}`}><div className="ppz-row"><strong><span className="ppz-person-dot" aria-hidden="true" />{name(id)}</strong><span className="ppz-muted">{participant?.result ? "Личное выполнение отмечено" : participant?.startedAt ? "Выполняет" : "Ещё не приступил"}</span></div>
        {participant?.startedAt && <p>Приступил: {time(participant.startedAt)}</p>}
        {participant?.result ? <><p className="ppz-comment">{participant.result}</p><p className="ppz-muted">Личная отметка: {time(participant.reportedAt)}{(participant.revision ?? 0) > 1 ? ` · уточнено ${time(participant.updatedAt)}` : ""}</p></> : <p className="ppz-muted">Личный результат пока не зафиксирован.</p>}
        <PhotoEvidence photos={participant?.photos} />
      </div>;
    })}
    {task.assignees.includes(uid) && <div className="ppz-work">
      {task.status !== "done" && !own?.startedAt && <Button disabled={busy} onClick={() => void act("start")}>Приступить к работе</Button>}
      <Textarea aria-label={`Мой результат: ${task.title}`} maxLength={2000} disabled={busy} value={report} onChange={e => setReport(e.target.value)} placeholder={own?.result ? "Уточните свой результат — предыдущая запись останется в истории" : "Что именно вы выполнили в этой задаче?"}/>
      <ReportPhotoPicker files={attachments.files} onChange={attachments.setFiles} disabled={busy} />
      <div className="ppz-row"><Button disabled={busy || (!report.trim() && !(own?.result && attachments.files.length))} onClick={() => void act("report")}>{busy ? "Сохраняем отчёт…" : own?.result ? "Уточнить мой результат" : "Зафиксировать моё выполнение"}</Button>
        {task.status !== "done" && <Button disabled={busy || (!report.trim() && !own?.result)} onClick={() => void act("complete")}>Завершить для всех</Button>}
      </div>
      {task.status === "done" && <p className="ppz-muted">Общая задача уже закрыта. Вы можете отдельно зафиксировать свою выполненную работу.</p>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </article>;
}
export function PpzTasks() {
  const { myProfile } = useAuth();
  const { staff } = useData();
  const uid = myProfile?.id ?? "";
  const administrator = ["owner", "admin"].includes(myProfile?.role ?? "");
  const [tasks, setTasks] = useState<PpzTask[]>([]);
  const [title, setTitle] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [employee, setEmployee] = useState("");
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounting, setAccounting] = useState(false);
  useEffect(() => {
    setTasks([]); setLoading(true); setError("");
    if (!uid) return;
    const all = collection(getFirebaseDb(), "ppzTasks");
    return onSnapshot(administrator ? all : query(all, where("assignees", "array-contains", uid)), snap => {
      setTasks(snap.docs.map(d => ({ ...d.data(), id: d.id }) as PpzTask)); setLoading(false);
    }, err => { setError(err.message); setLoading(false); });
  }, [uid, administrator]);
  async function act(action: "create" | "start" | "complete", id: string) {
    setBusy(true); setError("");
    try {
      await httpsCallable(getFirebaseFunctions(), "savePpzTask")({ action, id, ...(action === "create" ? { title, assignees } : {}) });
      if (action === "create") { setTitle(""); setAssignees([]); }
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить задачу"); }
    finally { setBusy(false); }
  }
  const name = (id: string) => staff.find(s => s.id === id)?.name || staff.find(s => s.id === id)?.email || id;
  const visible = tasks.filter(t => (completed ? t.status === "done" : t.status !== "done") && (!administrator || !employee || t.assignees.includes(employee)));
  return <section className="ppz-card">
    <h3>Задачи без сроков</h3>
    <p className="ppz-muted">Закрытие одним исполнителем завершает задачу для всех. Личное выполнение каждого сотрудника фиксируется его отдельным отчётом.</p>
    <div className="ppz-row">
      <Button variant={!completed ? "primary" : "ghost"} onClick={() => setCompleted(false)}>Активные</Button>
      <Button variant={completed ? "primary" : "ghost"} onClick={() => setCompleted(true)}>Завершённые</Button>
      {administrator && <Select aria-label="Фильтр сотрудников" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все сотрудники</option>{staff.map(s => <option key={s.id} value={s.id}>{name(s.id)}</option>)}</Select>}
      {administrator && <Button variant="ghost" onClick={() => setAccounting(value => !value)}>{accounting ? "Скрыть учёт работ" : "Учёт работ и история"}</Button>}
    </div>
    {administrator && accounting && <WorkAccountingPanel />}
    {administrator && <fieldset disabled={busy} className="ppz-editor">
      <Input aria-label="Название задачи без срока" placeholder="Название задачи" value={title} maxLength={200} onChange={e => setTitle(e.target.value)}/>
      <div className="ppz-row">{staff.map(s => <label key={s.id}><input type="checkbox" checked={assignees.includes(s.id)} onChange={e => setAssignees(previous => e.target.checked ? [...previous, s.id] : previous.filter(id => id !== s.id))}/>{name(s.id)}</label>)}</div>
      <Button disabled={!title.trim() || !assignees.length} onClick={() => void act("create", crypto.randomUUID())}>Назначить задачу</Button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Загружаем задачи…</p> : !visible.length && <p>Задач нет.</p>}
    {visible.map(task => <TaskCard key={task.id} task={task} uid={uid} name={name}/>)}
  </section>;
}
