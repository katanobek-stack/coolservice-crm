import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { taskStatus } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, DualPhotoButton } from "../../shared/ui/PhotoUploader";
import { CreatorLine } from "../../shared/ui/CreatorLine";
import { addServiceTask } from "../../shared/firebase/firestore";
import {
  addServiceSubtask,
  assertFieldsUnchanged,
  mutateServiceSubtask,
  mutateStandaloneServiceTask,
  removeClientRepair,
  removeDocumentIfUnchanged,
  removeServiceSubtask,
} from "../../shared/firebase/concurrency";
import { deletePhotoObjects, repairPhotos, serviceTaskPhotos } from "../../shared/utils/photos";
import type { PhotoData } from "../../shared/utils/photos";
import {
  RepairTaskWork,
  AddRepairTaskModal,
  WorkCommentModal,
  Lightbox,
  clientRepairEditor,
} from "../../shared/repair-work";
import {RequestWorkspace,RequestCard,RequestFilters,RequestStatusBar,RequestListState,useRequestOperation,OperationError} from "../../shared/requests/RequestWorkspace";
import {requestStage,requestAssignees,selectClientRequests,selectServiceRequests,type RequestScope} from "../../shared/requests/workspaceLogic";
import type { ServiceTask } from "../../shared/types/task";
import type { RepairTask, Repair, Client } from "../../shared/types/client";

// ─── Add standalone service task modal ───────────────────────────────────────

function AddServiceTaskModal({ onClose }: { onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();

  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [taskType, setTaskType] = useState<"task" | "project">("task");
  const [assignee, setAssignee] = useState(myProfile?.id ?? "");
  const [saving,   setSaving]   = useState(false);

  const [error,setError]=useState("");
  async function handleSave() {
    if(saving)return;
    const name=title.trim()||desc.trim();
    if(!name){setError("Укажите название или описание задачи.");return;}
    setSaving(true);setError("");
    try{
      await addServiceTask({
        ...(title.trim()?{title:title.trim()}:{}),
        ...(desc.trim()?{description:desc.trim()}:{}),
        taskType,assignees:assignee?[assignee]:[],doneBy:[],status:"in_progress",subtasks:[],
      });
      onClose();
    }catch(e){setError(e instanceof Error?e.message:"Не удалось создать задачу. Данные остались в форме.");}
    finally{setSaving(false);}
  }

  return (
    <Modal title={taskType === "project" ? "Новый проект" : "Новая задача"} onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {(["task", "project"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTaskType(t)}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 13,
              fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
              border: taskType === t ? "1px solid var(--accent)" : "1px solid var(--border2)",
              background: taskType === t ? "var(--accent)" : "var(--bg3)",
              color: taskType === t ? "white" : "var(--text2)",
            }}
          >
            {t === "task" ? "Задача" : "Проект"}
          </button>
        ))}
      </div>
      <FormGroup label="Название">
        <Input
          placeholder={taskType === "project" ? "Название проекта" : "Название задачи"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </FormGroup>
      <FormGroup label="Описание">
        <Textarea placeholder="Подробности..." value={desc} onChange={(e) => setDesc(e.target.value)} />
      </FormGroup>
      <FormGroup label="Исполнитель">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">— не назначен —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
        </Select>
      </FormGroup>
      <OperationError error={error}/>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать"}
      </Button>
    </Modal>
  );
}

// ─── Add subtask modal ────────────────────────────────────────────────────────

function AddSubtaskModal({ task, onClose }: { task: ServiceTask; onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const [desc,     setDesc]     = useState("");
  const [assignee, setAssignee] = useState(myProfile?.id ?? "");
  const [saving,   setSaving]   = useState(false);

  const [error,setError]=useState("");
  const [subtaskId]=useState(genId);
  async function handleSave() {
    if(saving)return;
    if(!desc.trim()){setError("Опишите работу для подзадачи.");return;}
    setSaving(true);setError("");
    const newSub:Subtask={id:subtaskId,description:desc.trim(),assignees:assignee?[assignee]:[],doneBy:[],status:"in_progress",workComment:""};
    try{await addServiceSubtask(task.id,newSub);onClose();}
    catch(e){setError(e instanceof Error?e.message:"Не удалось добавить подзадачу. Текст остался в форме.");}
    finally{setSaving(false);}
  }

  return (
    <Modal title="Добавить подзадачу" onClose={onClose}>
      <FormGroup label="Описание">
        <Textarea placeholder="Что нужно сделать..." value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
      </FormGroup>
      <FormGroup label="Исполнитель">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">— не назначен —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
        </Select>
      </FormGroup>
      <OperationError error={error}/>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Добавить"}
      </Button>
    </Modal>
  );
}

// ─── Subtask type ─────────────────────────────────────────────────────────────

interface Subtask {
  id:          string;
  description: string;
  assignees:   string[];
  doneBy:      string[];
  status:      "in_progress" | "done";
  workComment: string;
  photos?:     PhotoData[];
}

// ─── Subtask row ──────────────────────────────────────────────────────────────

function SubtaskRow({ subtask, task }: { subtask: Subtask; task: ServiceTask }) {
  const { myProfile } = useAuth();
  const { staff }     = useData();
  const uid     = myProfile?.id ?? "";
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const isDone  = subtask.status === "done";
  const myDone  = (subtask.doneBy ?? []).includes(uid);
  const [showComment, setShowComment] = useState(false);
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const assigneeNames = (subtask.assignees ?? [])
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    await mutateServiceSubtask(task.id, subtask, (current) => {
      const doneBy = current.doneBy ?? [];
      const newDoneBy = doneBy.includes(uid) ? doneBy.filter((id) => id !== uid) : [...doneBy, uid];
      const allDone = (current.assignees ?? []).length > 0 && (current.assignees ?? []).every((id) => newDoneBy.includes(id));
      return { ...current, doneBy: newDoneBy, status: allDone ? "done" : "in_progress" };
    });
  }

  async function saveComment(comment: string) {
    await mutateServiceSubtask(task.id, subtask, (current) => {
      assertFieldsUnchanged(current, subtask, ["workComment"], "Подзадача");
      return { ...current, workComment: comment };
    });
  }

  async function addPhotos(photos: PhotoData[]) {
    await mutateServiceSubtask(task.id, subtask, (current) => ({
      ...current,
      photos: [...(current.photos ?? []), ...photos],
    }));
  }

  async function handleDelete() {
    if (!isAdmin || !confirm("Удалить подзадачу?")) return;
    await removeServiceSubtask(task.id, subtask);
    void deletePhotoObjects(subtask.photos);
  }

  return (
    <div style={{
      background: "var(--bg3)", borderRadius: 8,
      padding: "8px 10px", marginBottom: 4,
      border: "1px solid var(--border)",
      opacity: isDone ? 0.6 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <button
          type="button"
          onClick={() => void toggle()}
          style={{
            flexShrink: 0, marginTop: 2,
            width: 18, height: 18, borderRadius: "50%",
            border: `2px solid ${isDone ? "#16a34a" : "rgba(0,0,0,0.15)"}`,
            background: isDone ? "rgba(34,197,94,0.15)" : "transparent",
            color: isDone ? "#16a34a" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 10, fontWeight: 700,
          }}
        >
          {isDone && "✓"}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, color: isDone ? "var(--text3)" : "var(--text)",
            textDecoration: isDone ? "line-through" : "none",
          }}>
            {subtask.description}
          </div>
          {assigneeNames && <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>👤 {assigneeNames}</div>}
          {subtask.workComment && (
            <div style={{ marginTop: 4, fontSize: 10, color: "var(--text2)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 5, padding: "3px 7px" }}>
              <span style={{ color: "#6d28d9", fontWeight: 600 }}>📝 </span>{subtask.workComment}
            </div>
          )}
          <PhotoGrid photos={subtask.photos ?? []} readOnly onView={setLightbox} />
          {!isDone && (
            <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setShowComment(true)} style={{ fontSize: 10, color: "var(--text2)", background: "var(--bg2)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 5, cursor: "pointer" }}>
                📝 {subtask.workComment ? "Изм." : "Отчёт"}
              </button>
              <DualPhotoButton onUploaded={addPhotos} />
              {isAdmin && (
                <button type="button" onClick={() => void handleDelete()} style={{ fontSize: 10, color: "#dc2626", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", padding: "2px 7px", borderRadius: 5, cursor: "pointer" }}>
                  🗑
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {showComment && <WorkCommentModal current={subtask.workComment} onSave={saveComment} onClose={() => setShowComment(false)} />}
      {lightbox    && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── Service task card ────────────────────────────────────────────────────────

function ServiceTaskCard({ task }: { task: ServiceTask }) {
  const { myProfile } = useAuth();
  const { staff }     = useData();
  const uid     = myProfile?.id ?? "";
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "owner" || role === "admin" || role === "manager";

  const isDone    = task.status === "done";
  const myDone    = (task.doneBy ?? []).includes(uid);
  const isProject = task.taskType === "project";
  const subtasks  = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
  const subDone   = subtasks.filter((s) => s.status === "done").length;

  const [showComment,    setShowComment]    = useState(false);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [lightbox,       setLightbox]       = useState<string | null>(null);

  const assigneeNames = (task.assignees ?? [])
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    await mutateStandaloneServiceTask(task.id, (current) => {
      const doneBy = current.doneBy ?? [];
      const newDoneBy = doneBy.includes(uid) ? doneBy.filter((id) => id !== uid) : [...doneBy, uid];
      const assignees = current.assignees ?? [];
      const allDone = assignees.length > 0 && assignees.every((id) => newDoneBy.includes(id));
      return { doneBy: newDoneBy, status: allDone ? "done" : "in_progress" };
    });
  }

  async function handleDelete() {
    if (!confirm("Удалить задачу?")) return;
    await removeDocumentIfUnchanged("servicetasks", task);
    void deletePhotoObjects(serviceTaskPhotos(task));
  }

  async function saveComment(comment: string) {
    await mutateStandaloneServiceTask(task.id, (current) => {
      assertFieldsUnchanged(current, task, ["workComment"], "Задача");
      return { workComment: comment };
    });
  }

  async function addPhotos(photos: PhotoData[]) {
    await mutateStandaloneServiceTask(task.id, (current) => ({
      photos: [...(current.photos ?? []), ...photos],
    }));
  }

  const operation=useRequestOperation();
  return (
    <RequestCard title={task.title||task.description||"Задача без названия"} subtitle={isProject?"Сервисный проект":"Сервисная задача"} description={task.title?task.description:undefined} stage={isDone?"closed":"active"} meta={[assigneeNames||"Исполнитель не назначен"]} progress={isProject?{done:subDone,total:subtasks.length}:undefined}>
      <div className="request-service-body">
      <div className="request-card-actions">
        <button type="button" className="is-primary" disabled={operation.busy} onClick={()=>void operation.run(toggle)}>{myDone?"Отменить мою отметку":"Отметить моё выполнение"}</button>
        {isAdmin&&<button type="button" className="is-danger" disabled={operation.busy} onClick={()=>void operation.run(handleDelete)}>Удалить задачу</button>}
      </div>
      <OperationError error={operation.error}/>
      <p className="request-work-note">Задача считается выполненной после отметок всех назначенных исполнителей.</p>
      {/* Subtask progress */}
      {isProject && subtasks.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>
            <span>Подзадачи</span><span>{subDone}/{subtasks.length}</span>
          </div>
          <div style={{ height: 4, borderRadius: 4, background: "var(--bg3)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 4, background: "rgba(139,92,246,0.7)", width: `${subtasks.length > 0 ? (subDone / subtasks.length) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Work comment */}
      {task.workComment && (
        <div style={{ marginBottom: 6, fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, padding: "4px 8px" }}>
          <span style={{ color: "#6d28d9", fontWeight: 600 }}>📝 </span>{task.workComment}
        </div>
      )}

      <PhotoGrid photos={task.photos ?? []} readOnly onView={setLightbox} />

      {isProject && subtasks.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {subtasks.map((s) => <SubtaskRow key={s.id} subtask={s} task={task} />)}
        </div>
      )}

      {!isDone && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setShowComment(true)} style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 7, cursor: "pointer" }}>
            📝 {task.workComment ? "Изменить" : "Отчёт"}
          </button>
          <DualPhotoButton onUploaded={addPhotos} />
          {isProject && isAdmin && (
            <button type="button" onClick={() => setShowAddSubtask(true)} style={{ fontSize: 11, color: "#6d28d9", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
              + Подзадача
            </button>
          )}
        </div>
      )}

      {showComment    && <WorkCommentModal current={task.workComment} onSave={saveComment} onClose={() => setShowComment(false)} />}
      {showAddSubtask && <AddSubtaskModal task={task} onClose={() => setShowAddSubtask(false)} />}
      {lightbox       && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
      </div>
    </RequestCard>
  );
}

// ─── Repair group card ────────────────────────────────────────────────────────

function RepairGroup({client,repair,tasks,canAdd,onOpenClient}:{client:Client;repair:Repair;tasks:RepairTask[];canAdd:boolean;onOpenClient?:(client:Client,vehicleId?:string)=>void}){
 const {staff}=useData();
 const vehicle=client.vehicles?.find(v=>v.id===repair.vehicleId),chamber=client.chambers?.find(c=>c.id===repair.chamberId);
 const stage=requestStage(repair),archived=stage==="closed"||stage==="cancelled";
 const [showAdd,setShowAdd]=useState(false),[lightbox,setLightbox]=useState<string|null>(null);
 const operation=useRequestOperation();
 const ids=requestAssignees(repair),names=ids.map(id=>staff.find(s=>s.id===id)?.name||id).join(", ");
 async function deleteRepair(){if(!confirm("Удалить наряд?"))return;await removeClientRepair(client.id,repair);void deletePhotoObjects(repairPhotos(repair));}
 const title=repair.chamberId?"Холодильная камера":[vehicle?.brand,vehicle?.model!==vehicle?.brand?vehicle?.model:undefined].filter(Boolean).join(" ")||"Автомобиль";
 return <RequestCard title={title} subtitle={[vehicle?.plate,client.name].filter(Boolean).join(" · ")} description={repair.description||chamber?.notes} stage={stage} photo={vehicle?.photo||chamber?.photo} meta={[repair.date?`Приём: ${fmtDate(repair.date)}`:"Дата не указана",names||"Исполнитель не назначен"]} progress={{done:tasks.filter(t=>taskStatus(t)==="done").length,total:tasks.length}}>
  <CreatorLine name={repair.createdByName} date={repair.createdAt}/>
  {repair.description&&<p>{repair.description}</p>}
  {archived?<div className="request-history">{tasks.map(t=><section key={t.id}><h3>{t.description}</h3><p>{taskStatus(t)==="done"?"Выполнено":"Не выполнено"}</p>{t.workComment&&<p>{t.workComment}</p>}<PhotoGrid photos={t.photos??[]} readOnly onView={setLightbox}/></section>)}</div>:<RepairTaskWork repair={repair} tasks={tasks} editor={clientRepairEditor(client.id,repair)} canManageTasks={canAdd}/>}
  <PhotoGrid photos={repair.photos??[]} readOnly onView={setLightbox}/>
  {stage==="ready"&&<p className="request-work-note">Работы выполнены. Руководитель проверяет результат и подтверждает закрытие в разделе «Отчёты».</p>}
  <OperationError error={operation.error}/>
  <div className="request-card-actions">
   {canAdd&&!archived&&<button type="button" className="is-primary" onClick={()=>setShowAdd(true)}>Добавить работу</button>}
   {onOpenClient&&<button type="button" onClick={()=>onOpenClient(client,vehicle?.id)}>Карточка клиента</button>}
   {canAdd&&<button type="button" className="is-danger" disabled={operation.busy} onClick={()=>void operation.run(deleteRepair)}>Удалить заявку</button>}
  </div>
  {showAdd&&<AddRepairTaskModal editor={clientRepairEditor(client.id,repair)} repairFreonType={repair.freonType} onClose={()=>setShowAdd(false)}/>}
  {lightbox&&<Lightbox url={lightbox} onClose={()=>setLightbox(null)}/>}
 </RequestCard>;
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function MyTasksTab({onOpenClient}:{onOpenClient?:(client:Client,vehicleId?:string)=>void}={}){
 const {clients,tasks,staff,sourceStatus}=useData();const {myProfile}=useAuth();
 const uid=myProfile?.id||"",role=myProfile?.role||"mechanic",manager=["owner","admin","manager"].includes(role);
 const [showAdd,setShowAdd]=useState(false),[view,setView]=useState<"repairs"|"service">("repairs");
 const [filters,setFilters]=useState({search:"",employee:"",mine:false,status:"open" as RequestScope["status"],sort:"newest" as RequestScope["sort"],kind:"all"});
 const ids=new Set([...clients.flatMap(c=>(c.repairs??[]).flatMap(requestAssignees)),...tasks.flatMap(t=>t.assignees??[])]);
 const options=[...staff,...[...ids].filter(id=>!staff.some(s=>s.id===id)).map(id=>({id,name:`Сотрудник ${id}`}))];
 const scope:RequestScope={...filters,uid,manager,staff:options};
 const patch=(value:Partial<RequestScope>)=>setFilters(current=>({...current,...value}));
 const reset=()=>setFilters({search:"",employee:"",mine:false,status:"open",sort:"newest",kind:"all"});
 const rows=selectClientRequests(clients,scope),services=selectServiceRequests(tasks,scope);
 const statuses=view==="repairs"?[sourceStatus.clients]:[sourceStatus.tasks];
 const count=(status:RequestScope["status"])=>statuses.every(s=>s==="ready")?(view==="repairs"?selectClientRequests(clients,{...scope,status}):selectServiceRequests(tasks,{...scope,status})).length:undefined;
 const filtered=!!(scope.search||scope.employee||scope.mine||scope.status!=="open");
 const items=view==="service"?[{id:"open" as const,label:"Активные",count:count("open")},{id:"archive" as const,label:"Выполненные",count:count("archive")}]:[{id:"open" as const,label:"Все открытые",count:count("open")},{id:"active" as const,label:"В работе",count:count("active")},...(manager?[{id:"ready" as const,label:"Ждут менеджера",count:count("ready")},{id:"archive" as const,label:"Архив и отказы",count:count("archive")}]:[])];
 return <RequestWorkspace title="Заявки" description="Работы по клиентам и задачи сервиса. Найдите нужную заявку, раскройте карточку и продолжите работу." actions={manager?<button type="button" className="btn-primary" onClick={()=>setShowAdd(true)}>Создать сервисную задачу</button>:undefined}>
  <nav className="request-view-nav" aria-label="Вид работ"><button type="button" aria-current={view==="repairs"?"page":undefined} onClick={()=>{setView("repairs");patch({status:"open"});}}>Клиентские заявки</button><button type="button" aria-current={view==="service"?"page":undefined} onClick={()=>{setView("service");patch({status:"open"});}}>Сервисные задачи</button></nav>
  <RequestFilters scope={scope} onChange={patch} onReset={reset}/>
  <RequestStatusBar value={scope.status} items={items} onChange={status=>patch({status})}/>
  <div className="request-results-line"><strong>{statuses.every(s=>s==="ready")?`Найдено: ${view==="repairs"?rows.length:services.length}`:"Данные не подтверждены"}</strong><p>{view==="repairs"?(manager?"Завершение работ и подтверждение закрытия — разные этапы. Закрытие заявки выполняется в «Отчётах».":"Здесь показаны ваши незавершённые работы в активных клиентских заявках."):"Сервисные задачи и проекты хранятся отдельно от клиентских ремонтов и ППЗ."}</p></div>
  <RequestListState statuses={statuses} count={view==="repairs"?rows.length:services.length} filtered={filtered} empty={view==="repairs"?"Открытых клиентских заявок нет":"Активных сервисных задач нет"}>
   {view==="repairs"?rows.map(row=><RepairGroup key={`${row.client.id}/${row.repair.id}`} {...row} canAdd={manager} onOpenClient={onOpenClient}/>):services.map(task=><ServiceTaskCard key={task.id} task={task}/>)}
  </RequestListState>
  {showAdd&&manager&&<AddServiceTaskModal onClose={()=>setShowAdd(false)}/>}
 </RequestWorkspace>;
}
