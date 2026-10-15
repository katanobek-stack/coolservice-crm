import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import { getFirebaseDb, getFirebaseFunctions } from "../../shared/firebase/app";
import { Button } from "../../shared/ui/Button";
import { Input, Select } from "../../shared/ui/Input";

interface PpzTask {
  id: string; title: string; assignees: string[]; status: "open" | "in_progress" | "done";
  description?: string;
  completedByName?: string; completedAt?: Timestamp; startedBy?: string;
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
    <p className="ppz-muted">Общая задача видна всем назначенным. Закрытие одним исполнителем завершает её для всех.</p>
    <div className="ppz-row">
      <Button variant={!completed ? "primary" : "ghost"} onClick={() => setCompleted(false)}>Активные</Button>
      <Button variant={completed ? "primary" : "ghost"} onClick={() => setCompleted(true)}>Завершённые</Button>
      {administrator && <Select aria-label="Фильтр сотрудников" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все сотрудники</option>{staff.map(s => <option key={s.id} value={s.id}>{name(s.id)}</option>)}</Select>}
    </div>
    {administrator && <fieldset disabled={busy} className="ppz-editor">
      <Input aria-label="Название задачи без срока" placeholder="Название задачи" value={title} maxLength={200} onChange={e => setTitle(e.target.value)}/>
      <div className="ppz-row">{staff.map(s => <label key={s.id}><input type="checkbox" checked={assignees.includes(s.id)} onChange={e => setAssignees(previous => e.target.checked ? [...previous, s.id] : previous.filter(id => id !== s.id))}/>{name(s.id)}</label>)}</div>
      <Button disabled={!title.trim() || !assignees.length} onClick={() => void act("create", crypto.randomUUID())}>Назначить задачу</Button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    {loading ? <p>Загружаем задачи…</p> : !visible.length && <p>Задач нет.</p>}
    {visible.map(task => <article className="ppz-card" key={task.id}>
      <strong>{task.title}</strong>
      {task.description && <p className="ppz-comment">{task.description}</p>}
      <p>{task.assignees.map(name).join(", ")} · {task.status === "done" ? "Выполнено" : task.status === "in_progress" ? "В работе" : "К выполнению"}</p>
      {task.status === "in_progress" && task.startedBy && <p>Приступил: {name(task.startedBy)}</p>}
      {task.status === "done" && <p>Закрыл: {task.completedByName} · {task.completedAt?.toDate().toLocaleString("ru-RU", { timeZone: "Asia/Vladivostok" })} (Владивосток)</p>}
      {task.status !== "done" && task.assignees.includes(uid) && <div className="ppz-row">
        {task.status === "open" && <Button disabled={busy} onClick={() => void act("start", task.id)}>Приступить</Button>}
        <Button disabled={busy} onClick={() => void act("complete", task.id)}>Завершить для всех</Button>
      </div>}
    </article>)}
  </section>;
}
