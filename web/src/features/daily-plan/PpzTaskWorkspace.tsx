import { useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { Input, Select } from "../../shared/ui/Input";
import { TaskCard, type PpzTask } from "./PpzTasks";
import { canAttachPpzPhotos, newestPpzTasks, ppzCreateRequest, selectPpzTasks, type PpzCreateRequest, type PpzStatusFilter } from "./presentation";

interface PpzEmployee { id: string; name?: string; email?: string }
interface WorkspaceProps {
  tasks: PpzTask[]; staff: PpzEmployee[]; uid: string; role?: string; loading?: boolean; loadError?: string;
  onCreate(request: PpzCreateRequest): Promise<void>;
  onToggleAccounting?(): void; accounting?: boolean;
}

/** The container supplies authenticated snapshots and owns server calls. */
export function PpzTaskWorkspace({ tasks, staff, uid, role, loading = false, loadError = "", onCreate, onToggleAccounting, accounting }: WorkspaceProps) {
  const administrator = role === "owner" || role === "admin";
  const [title, setTitle] = useState(""), [assignees, setAssignees] = useState<string[]>([]);
  const [employee, setEmployee] = useState(""), [status, setStatus] = useState<PpzStatusFilter>("active"), [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pendingCreate = useRef<PpzCreateRequest | null>(null), submitting = useRef(false);
  const name = (id: string) => staff.find(s => s.id === id)?.name || staff.find(s => s.id === id)?.email || id;
  const filtered = selectPpzTasks(tasks, { search, employee: administrator ? employee : "", status }, name);
  const visibleIds = new Set(filtered.tasks.map(task => task.id));
  const ordered = useMemo(() => newestPpzTasks(tasks), [tasks]);
  const filters: { id: PpzStatusFilter; label: string }[] = [
    { id: "active", label: "Активные" }, { id: "open", label: "К выполнению" },
    { id: "in_progress", label: "В работе" }, { id: "done", label: "Завершённые" }, { id: "all", label: "Все" },
  ];
  async function create() {
    if (submitting.current || !title.trim() || !assignees.length) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    const request = ppzCreateRequest(pendingCreate.current, { title, assignees }, () => crypto.randomUUID());
    pendingCreate.current = request;
    try {
      await onCreate(request);
      pendingCreate.current = null; setTitle(""); setAssignees([]); setCreating(false);
      setEmployee(""); setSearch(""); setStatus("active"); setNotice(`Задача «${request.title}» назначена.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось назначить задачу. Данные формы сохранены — попробуйте ещё раз."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="ppz-board" aria-label="Задачи ППЗ">
    <div className="ppz-board-heading"><div><h2>{administrator ? "Задачи команды" : "Мои задачи"}</h2><p className="ppz-muted">Без обязательного срока. Общее закрытие — одно, личный результат — у каждого свой.</p></div>
      {administrator && <Button onClick={() => { setCreating(true); setNotice(""); }}>+ Назначить задачу</Button>}
    </div>
    <div className="ppz-overview" aria-label="Задачи в выбранном списке"><div><span>Активных</span><strong>{loading ? "—" : filtered.counts.active}</strong></div><div><span>В работе</span><strong>{loading ? "—" : filtered.counts.in_progress}</strong></div><div><span>Завершено</span><strong>{loading ? "—" : filtered.counts.done}</strong></div><p>Закрытие одним исполнителем завершает задачу для всех. Личные отчёты не начисляются остальным автоматически.</p></div>
    {administrator && <div hidden={!creating} className="ppz-create"><form onSubmit={event => { event.preventDefault(); void create(); }}>
      <fieldset disabled={busy} className="ppz-editor"><div className="ppz-row"><div><h3>Новая задача</h3><p className="ppz-muted">Выберите одного или нескольких исполнителей.</p></div><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Свернуть</Button></div>
        <label className="ppz-field">Что нужно сделать?<Input autoComplete="off" aria-label="Название задачи без срока" placeholder="Например: подготовить оборудование к выезду" value={title} maxLength={200} required onChange={e => setTitle(e.target.value)}/></label>
        <fieldset className="ppz-assignees"><legend>Исполнители · {assignees.length}</legend><div className="ppz-assignee-grid">{staff.map(s => <label key={s.id} className={`ppz-assignee-choice ${assignees.includes(s.id) ? "is-selected" : ""}`}><input type="checkbox" checked={assignees.includes(s.id)} onChange={e => setAssignees(previous => e.target.checked ? [...previous, s.id] : previous.filter(id => id !== s.id))}/><span>{name(s.id)}{s.id === uid && <small>Вы</small>}</span></label>)}</div></fieldset>
        {!staff.length && <p className="ppz-warning">Список сотрудников пока пуст. Дождитесь загрузки или проверьте раздел сотрудников.</p>}
        <div className="ppz-row"><span className="ppz-muted">Срок не требуется. Задача появится у всех выбранных сотрудников.</span><Button type="submit" disabled={busy || !title.trim() || !assignees.length}>{busy ? "Назначаем…" : "Назначить задачу"}</Button></div>
      </fieldset>{error && <p className="ppz-error" role="alert">{error}</p>}
    </form></div>}
    {notice && <p className="ppz-notice" role="status">{notice}</p>}
    <div className="ppz-search-row"><label className="ppz-field ppz-search">Поиск задачи<Input type="search" value={search} aria-label="Поиск задач ППЗ" placeholder="Название, описание, сотрудник или автор" onChange={e => setSearch(e.target.value)}/></label>
      {administrator && <label className="ppz-field">Исполнитель<Select aria-label="Фильтр сотрудников" value={employee} onChange={e => setEmployee(e.target.value)}><option value="">Все сотрудники</option>{staff.map(s => <option key={s.id} value={s.id}>{name(s.id)}</option>)}</Select></label>}
    </div>
    <div className="ppz-list-toolbar"><div className="ppz-status-filters" role="group" aria-label="Статус задач">{filters.map(filter => <button type="button" key={filter.id} aria-pressed={status === filter.id} onClick={() => setStatus(filter.id)}>{filter.label}<span>{loading ? "—" : filtered.counts[filter.id]}</span></button>)}</div>
      {administrator && onToggleAccounting && <Button variant="ghost" onClick={onToggleAccounting}>{accounting ? "Скрыть учёт работ" : "Учёт работ и история"}</Button>}
    </div>
    {loadError && <p className="ppz-error" role="alert">Не удалось загрузить задачи: {loadError}</p>}
    {loading ? <div className="ppz-empty" role="status"><strong>Загружаем задачи…</strong><p>Проверяем ваши назначения и статусы.</p></div> : !filtered.tasks.length && !loadError && <div className="ppz-empty"><strong>{search.trim() || employee ? "По этим условиям задач нет" : status === "done" ? "Завершённых задач пока нет" : status === "in_progress" ? "Пока никто не приступил" : status === "open" ? "Нет задач к выполнению" : "В этом списке задач пока нет"}</strong><p>{search.trim() || employee ? "Измените поиск или сбросьте фильтры." : administrator ? "Назначьте новую задачу или выберите другой статус." : "Здесь появятся ваши назначения. Проверьте другие статусы или обратитесь к руководителю."}</p>{(search.trim() || employee || status !== "active") && <Button variant="ghost" onClick={() => { setSearch(""); setEmployee(""); setStatus("active"); }}>Сбросить фильтры</Button>}</div>}
    <div className="ppz-task-list">{ordered.map(task => <div key={task.id} hidden={!visibleIds.has(task.id)}><TaskCard task={task} uid={uid} name={name} canAttachPhotos={canAttachPpzPhotos(role)}/></div>)}</div>
  </section>;
}
