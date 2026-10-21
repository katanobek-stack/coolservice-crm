import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import { getFirebaseDb } from "../../shared/firebase/app";
import { saveDailyPlan, publishDailyPlan, updateDailyPlanWork, retryDailyPlanNotification } from "../../shared/firebase/dailyPlans";
import type { DailyPlan, PlanItem, PlanSource } from "../../shared/types/dailyPlan";
import { Button } from "../../shared/ui/Button";
import { Input, Select, Textarea } from "../../shared/ui/Input";
import { resolveTask, sourceKey, vladivostokDate, workDone } from "./logic";
import "./dailyPlan.css";
import { PpzTasks } from "./PpzTasks";
import { PhotoEvidence, ReportPhotoPicker, useReportPhotos } from "./ReportPhotos";
import { employeeTone } from "./presentation";
import { ReportText } from "../../shared/ui/ReportText";

interface Candidate { source: PlanSource; title: string }
const deliveryLabels = { pending: "Telegram: ожидает отправки", sent: "Telegram: доставлено", failed: "Telegram: ошибка отправки", unknown: "Telegram: результат отправки неизвестен" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие";

function WorkRow({ item, planId, staffId, own, published }: { item: PlanItem; planId: string; staffId: string; own: boolean; published: boolean }) {
  const { tasks, clients, intakeRepairs } = useData();
  const task = resolveTask(item.source, tasks, clients, intakeRepairs);
  const [comment, setComment] = useState("");
  const [dictating, setDictating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assigned = task?.assignees?.includes(staffId);
  const myDone = task?.doneBy?.includes(staffId) ?? false;
  const attachments = useReportPhotos(`work-reports/${staffId}/plan/${planId}/${item.id}`);
  async function submit(done?: boolean) {
    if (busy || dictating) return;
    setBusy(true); setError("");
    try { const photos = await attachments.upload(); await updateDailyPlanWork(planId, item.id, done, comment, photos); setComment(""); attachments.reset(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }
  return <article className={`ppz-card ppz-task ppz-task--${task && workDone(task) ? "done" : myDone ? "in_progress" : "open"}`}>
    <div className="ppz-row"><strong>{item.order + 1}. {item.title}</strong><span>{task && workDone(task) ? "✓ Выполнено" : myDone ? "Вы завершили свою часть" : "К выполнению"}</span></div>
    <p className="ppz-muted">{item.priority === "high" ? "Высокий приоритет · " : ""}{item.deadline ? `До ${item.deadline} · ` : ""}{item.source.kind === "service" ? "Сервисная задача" : item.source.kind === "repair" ? "Задача ремонта" : "Приёмка"}</p>
    {item.note && <p>{item.note}</p>}
    {task?.workComment && <p className="ppz-comment">{task.workComment}</p>}
    <PhotoEvidence photos={task?.photos} />
    {!task && <p role="alert">Исходная задача удалена или перемещена. Обратитесь к руководителю.</p>}
    {task && !assigned && <p role="alert">Исполнитель изменён. Руководителю нужно обновить план.</p>}
    {own && published && assigned && <div className="ppz-work">
      <ReportText label={`Комментарий: ${item.title}`} placeholder="Комментарий о работе" value={comment} onChange={setComment} onListeningChange={setDictating} maxLength={1000} disabled={busy}/>
      <ReportPhotoPicker files={attachments.files} onChange={attachments.setFiles} disabled={busy} />
      <div className="ppz-row"><Button disabled={busy || dictating} onClick={() => void submit(!myDone)}>{myDone ? "Вернуть в работу" : "Моя часть выполнена"}</Button>
        <Button variant="ghost" disabled={busy || dictating || (!comment.trim() && !attachments.files.length)} onClick={() => void submit()}>Сохранить комментарий / фото</Button></div>
    </div>}
    {error && <p className="ppz-error" role="alert">{error}</p>}
  </article>;
}

export function DailyPlanTab() {
  const { myProfile } = useAuth();
  const { staff, tasks, clients, intakeRepairs, appointments } = useData();
  const uid = myProfile?.id ?? "";
  const manager = ["owner", "admin", "manager"].includes(myProfile?.role ?? "mechanic");
  const [mode, setMode] = useState<"mine" | "meeting">("mine");
  const [date, setDate] = useState(vladivostokDate);
  const [selected, setSelected] = useState(uid);
  const staffId = manager && mode === "meeting" ? selected || uid : uid;
  const planId = `${staffId}_${date}`;
  const [plan, setPlan] = useState<DailyPlan>();
  const [published, setPublished] = useState<PlanItem[]>([]);
  const [draft, setDraft] = useState<PlanItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidate, setCandidate] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [absence, setAbsence] = useState("");
  const editing = manager && mode === "meeting";

  useEffect(() => {
    setLoading(true); setPlan(undefined); setPublished([]); setDraft([]); setDirty(false); setError(""); setNotice(""); setRevision(0);
    if (!staffId || !date) return;
    const ref = doc(getFirebaseDb(), "dailyPlans", planId);
    return onSnapshot(ref, snap => { setPlan(snap.exists() ? snap.data() as DailyPlan : undefined); setLoading(false); }, err => { setError(errorText(err)); setLoading(false); });
  }, [planId, staffId, date]);

  useEffect(() => {
    setPublished([]);
    if (plan?.status !== "published") return;
    return onSnapshot(collection(getFirebaseDb(), "dailyPlans", planId, "items"), snap => {
      setPublished(snap.docs.map(d => d.data() as PlanItem).sort((a, b) => a.order - b.order));
    }, err => setError(errorText(err)));
  }, [planId, plan?.status]);

  useEffect(() => {
    if (!editing || loading || dirty) return;
    let active = true;
    const path = plan?.hasDraft ? "draftItems" : "items";
    if (!plan) { setDraft([]); setRevision(0); return; }
    void getDocs(collection(getFirebaseDb(), "dailyPlans", planId, path)).then(snap => {
      if (active) { setDraft(snap.docs.map(d => d.data() as PlanItem).sort((a, b) => a.order - b.order)); setRevision(plan.revision); }
    }).catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [editing, planId, plan, loading, dirty]);

  useEffect(() => {
    setAbsence("");
    if (!staffId || !date) return;
    return onSnapshot(query(collection(getFirebaseDb(), "schedules"), where("staffId", "==", staffId)), snap => {
      const entry = snap.docs.map(d => d.data()).find(d => d.date === date);
      setAbsence(entry ? ({ dayoff: "выходной", vacation: "отпуск", sick: "больничный" }[entry.type as "dayoff"] || "нерабочий день") : "");
    }, err => setError(errorText(err)));
  }, [staffId, date]);

  const candidates = useMemo(() => {
    const list: Candidate[] = [];
    for (const t of tasks) if ((t.assignees ?? []).includes(staffId) && t.status !== "done") list.push({ source: { kind: "service", documentId: t.id }, title: t.title || t.description || "Сервисная задача" });
    for (const c of clients) for (const r of c.repairs ?? []) if (!r.closedByManager && r.status !== "cancelled") {
      for (const t of r.tasks ?? []) if ((t.assignees ?? []).includes(staffId) && !workDone(t)) list.push({ source: { kind: "repair", documentId: c.id, repairId: r.id, taskId: t.id }, title: `${c.name}: ${t.description}` });
    }
    for (const i of intakeRepairs) if (!i.repair.closedByManager) for (const t of i.repair.tasks ?? []) {
      if ((t.assignees ?? []).includes(staffId) && !workDone(t)) list.push({ source: { kind: "intake", documentId: i.id, taskId: t.id }, title: `${i.vehicle?.plate || i.chamber?.label || "Приёмка"}: ${t.description}` });
    }
    return list;
  }, [tasks, clients, intakeRepairs, staffId]);
  const available = candidates.filter(c => !draft.some(item => sourceKey(item.source) === sourceKey(c.source)));
  const otherWork = candidates.filter(c => !published.some(item => sourceKey(item.source) === sourceKey(c.source)));
  const visits = appointments.filter(a => a.date === date && a.status === "pending" && (a.assignees ?? []).includes(staffId)).sort((a, b) => a.time.localeCompare(b.time));
  function change(items: PlanItem[]) { setDraft(items.map((item, order) => ({ ...item, order }))); setDirty(true); setNotice(""); }
  function add(source: PlanSource, title: string, newService = false) {
    if (draft.length >= 50) { setError("В плане допускается до 50 задач"); return; }
    change([...draft, { id: crypto.randomUUID(), source, title: title.slice(0, 200), order: draft.length, priority: "normal", deadline: "", note: "", ...(newService ? { newService: true } : {}) }]);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function save() {
    const result = await saveDailyPlan(staffId, date, revision, draft);
    setRevision(result.revision); setDirty(false); setNotice("Черновик сохранён. Сотрудник увидит изменения после публикации.");
  }
  async function publish() {
    let expected = revision;
    if (dirty || !plan) { const saved = await saveDailyPlan(staffId, date, expected, draft); expected = saved.revision; setRevision(expected); setDirty(false); }
    const result = await publishDailyPlan(staffId, date, expected);
    setRevision(result.revision); setNotice("План опубликован. Сообщение поставлено в очередь Telegram.");
  }
  async function reload() {
    const snap = await getDoc(doc(getFirebaseDb(), "dailyPlans", planId));
    const current = snap.data() as DailyPlan | undefined;
    const items = current ? await getDocs(collection(getFirebaseDb(), "dailyPlans", planId, current.hasDraft ? "draftItems" : "items")) : undefined;
    setDraft(items?.docs.map(d => d.data() as PlanItem).sort((a, b) => a.order - b.order) ?? []);
    setRevision(current?.revision ?? 0); setDirty(false);
  }
  const conflict = dirty && (plan?.revision ?? 0) !== revision;
  return <div className="ppz">
    <PpzTasks />
    <div className="ppz-row ppz-controls"><div className="ppz-row"><Button variant={mode === "mine" ? "primary" : "ghost"} disabled={busy || dirty} onClick={() => setMode("mine")}>Мой день</Button>
      {manager && <Button variant={mode === "meeting" ? "primary" : "ghost"} disabled={busy || dirty} onClick={() => setMode("meeting")}>Планёрка</Button>}</div>
      <Input aria-label="Дата плана" type="date" value={date} disabled={busy || dirty} onChange={e => { if (e.target.value) setDate(e.target.value); }}/>
      {editing && <Select aria-label="Сотрудник" value={staffId} disabled={busy || dirty} onChange={e => { setSelected(e.target.value); setCandidate(""); setNewTitle(""); }}>
        {staff.map(s => <option key={s.id} value={s.id}>{s.name || s.email || "Сотрудник"}</option>)}</Select>}
    </div>
    <div className={`ppz-day-banner ppz-person--${employeeTone(staffId)}`}><div><span className="ppz-person-dot" aria-hidden="true" /><strong>{staff.find(s => s.id === staffId)?.name || "Мой план"}</strong></div><span>Персональный план на {date} · Владивосток</span></div>
    {absence && <p className="ppz-warning">По графику у сотрудника {absence}. Проверьте назначение работ.</p>}
    {error && <p className="ppz-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p>Загружаем план…</p> : <>
      {visits.length > 0 && <section className="ppz-card"><h3>Записи на приём</h3>{visits.map(a => <p key={a.id}>{a.time} · {a.clientName} · {[a.carBrand, a.carPlate].filter(Boolean).join(" ")}</p>)}</section>}
      {editing ? <>
        <div className="ppz-row"><strong>{plan?.status === "published" ? `Опубликована версия ${plan.version}${plan.hasDraft ? "; есть черновик" : ""}` : "Черновик планёрки"}</strong>
          {plan?.deliveryStatus && <span>{deliveryLabels[plan.deliveryStatus]}</span>}</div>
        {plan?.deliveryStatus && ["failed", "unknown"].includes(plan.deliveryStatus) && <div className="ppz-warning">
          {plan.deliveryStatus === "unknown" && <p>Сообщение могло дойти. Проверьте группу перед повторной отправкой: возможен дубль.</p>}
          <Button disabled={busy} onClick={() => { if (window.confirm("Повторить отправку проблемных сообщений? Проверьте группу: при неизвестном результате возможен дубль.")) void run(async () => { await retryDailyPlanNotification(planId); setNotice("Повторная отправка поставлена в очередь."); }); }}>Повторить отправку</Button>
        </div>}
        <fieldset disabled={busy || conflict} className="ppz-editor">
          <div className="ppz-row"><Select aria-label="Существующая задача" value={candidate} onChange={e => setCandidate(e.target.value)}><option value="">Выберите назначенную задачу</option>{available.map(c => <option key={sourceKey(c.source)} value={sourceKey(c.source)}>{c.title}</option>)}</Select>
            <Button disabled={!candidate} onClick={() => { const chosen = available.find(c => sourceKey(c.source) === candidate); if (chosen) { add(chosen.source, chosen.title); setCandidate(""); } }}>Добавить</Button></div>
          <div className="ppz-row"><Input aria-label="Новая сервисная работа" maxLength={200} placeholder="Новая работа: убрать бокс, нарубить дрова…" value={newTitle} onChange={e => setNewTitle(e.target.value)}/>
            <Button disabled={!newTitle.trim()} onClick={() => { add({ kind: "service", documentId: crypto.randomUUID() }, newTitle.trim(), true); setNewTitle(""); }}>Создать работу</Button></div>
          {draft.map((item, i) => <article className="ppz-card" key={item.id}>
            <div className="ppz-row"><strong>{i + 1}. {item.title}</strong><div className="ppz-row"><Button variant="ghost" aria-label={`Выше: ${item.title}`} disabled={i === 0} onClick={() => { const next = [...draft]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; change(next); }}>↑</Button><Button variant="ghost" aria-label={`Ниже: ${item.title}`} disabled={i === draft.length - 1} onClick={() => { const next = [...draft]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; change(next); }}>↓</Button><Button variant="danger" onClick={() => change(draft.filter(t => t.id !== item.id))}>Убрать из плана</Button></div></div>
            <p className="ppz-muted">{(() => { const task = resolveTask(item.source, tasks, clients, intakeRepairs); return item.newService ? "Новая сервисная работа" : !task ? "Исходная задача удалена или перемещена" : workDone(task) ? "✓ Выполнено" : "К выполнению"; })()}</p>
            <div className="ppz-row"><Select aria-label={`Приоритет: ${item.title}`} value={item.priority} onChange={e => change(draft.map(t => t.id === item.id ? { ...t, priority: e.target.value as PlanItem["priority"] } : t))}><option value="normal">Обычный приоритет</option><option value="high">Высокий приоритет</option></Select>
              <Input type="time" aria-label={`Срок: ${item.title}`} value={item.deadline} onChange={e => change(draft.map(t => t.id === item.id ? { ...t, deadline: e.target.value } : t))}/></div>
            <Textarea aria-label={`Примечание: ${item.title}`} placeholder="Примечание к задаче" maxLength={500} value={item.note} onChange={e => change(draft.map(t => t.id === item.id ? { ...t, note: e.target.value } : t))}/>
          </article>)}
        </fieldset>
        {conflict && <p className="ppz-warning">План изменён другим руководителем. Загрузите актуальную версию перед редактированием.</p>}
        <div className="ppz-row"><Button variant="ghost" disabled={busy || !dirty || conflict} onClick={() => void run(save)}>Сохранить черновик</Button>
          <Button disabled={busy || conflict || (!dirty && !plan?.hasDraft && !!plan)} onClick={() => void run(publish)}>Опубликовать и отправить в Telegram</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("Загрузить актуальный план и отменить несохранённые изменения?")) void run(reload); }}>Загрузить актуальный план</Button></div>
        <p className="ppz-muted">Убрать пункт из плана не удаляет исходную задачу. Новая сервисная работа создаётся при сохранении черновика. Чтобы перенести работу, выберите другой день и добавьте её из существующих задач.</p>
      </> : <>
        {plan?.status !== "published" ? <p>План пока не опубликован. Обратитесь к руководителю.</p> : published.length === 0 ? <p>Назначенных задач в плане нет.</p> : published.map(item => <WorkRow key={`${planId}:${item.id}`} item={item} planId={planId} staffId={staffId} own={staffId === uid} published/>) }
        {otherWork.length > 0 && <section className="ppz-card"><h3>Другие назначенные работы</h3><p className="ppz-muted">Эти работы доступны в разделе «Заявки». Порядок выполнения можно уточнить у руководителя.</p>{otherWork.map(c => <p key={sourceKey(c.source)}>{c.title}</p>)}</section>}
      </>}
    </>}
  </div>;
}
