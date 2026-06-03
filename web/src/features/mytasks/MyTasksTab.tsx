import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, InlinePhotoButton } from "../../shared/ui/PhotoUploader";
import { updateClientArray, addServiceTask, updateServiceTask, deleteServiceTask } from "../../shared/firebase/firestore";
import type { PhotoData } from "../../shared/utils/photos";
import type { ServiceTask } from "../../shared/types/task";
import type { RepairTask, Repair, Client } from "../../shared/types/client";

function SectionTitle({ text, count }: { text: string; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 10px", padding: "0 2px" }}>
      <span style={{ width: 3, height: 18, borderRadius: 2, background: "var(--accent)", flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase" as const, letterSpacing: "0.8px" }}>
        {text}
      </span>
      {count !== undefined && (
        <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10, background: "rgba(59,130,246,0.15)", color: "var(--accent2)", fontFamily: "JetBrains Mono, monospace" }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 cursor-pointer"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-w-[95%] max-h-[90%] object-contain rounded-xl" />
    </div>
  );
}

// ─── WorkComment modal ────────────────────────────────────────────────────────

function WorkCommentModal({ current, onSave, onClose }: {
  current?: string;
  onSave:   (comment: string) => Promise<void>;
  onClose:  () => void;
}) {
  const [comment, setComment] = useState(current ?? "");
  const [saving, setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(comment.trim());
    onClose();
  }

  return (
    <Modal title="Отчёт о выполнении" onClose={onClose}>
      <FormGroup label="Что сделано">
        <Textarea
          placeholder="Заменил компрессор, залил масло, проверил давление..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
        />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </Button>
    </Modal>
  );
}

// ─── Add standalone service task modal ───────────────────────────────────────

function AddServiceTaskModal({ onClose }: { onClose: () => void }) {
  const { staff } = useData();
  const { myProfile } = useAuth();

  const [title,      setTitle]      = useState("");
  const [desc,       setDesc]       = useState("");
  const [taskType,   setTaskType]   = useState<"task" | "project">("task");
  const [assignee,   setAssignee]   = useState(myProfile?.id ?? "");
  const [saving,     setSaving]     = useState(false);

  async function handleSave() {
    const name = title.trim() || desc.trim();
    if (!name) return;
    setSaving(true);
    await addServiceTask({
      title:       title.trim() || undefined,
      description: desc.trim()  || undefined,
      taskType,
      assignees:   assignee ? [assignee] : [],
      doneBy:      [],
      status:      "in_progress",
      subtasks:    [],
    } as unknown as ServiceTask);
    onClose();
  }

  return (
    <Modal title={taskType === "project" ? "Новый проект" : "Новая задача"} onClose={onClose}>
      {/* Type toggle */}
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
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать"}
      </Button>
    </Modal>
  );
}

// ─── Add repair task modal ────────────────────────────────────────────────────

function AddRepairTaskModal({ client, repair, onClose }: {
  client:  Client;
  repair:  Repair;
  onClose: () => void;
}) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const [desc,       setDesc]       = useState("");
  const [assignee,   setAssignee]   = useState(myProfile?.id ?? "");
  const [isFreon,    setIsFreon]    = useState(false);
  const [freonType,  setFreonType]  = useState(repair.freonType ?? "");
  const [saving,     setSaving]     = useState(false);

  async function handleSave() {
    if (!desc.trim() && !isFreon) return;
    setSaving(true);
    const newTask: RepairTask = {
      id:          genId(),
      description: isFreon ? `Заправка фреоном ${freonType || ""}`.trim() : desc.trim(),
      assignees:   assignee ? [assignee] : [],
      doneBy:      [],
      status:      "in_progress",
      freonTask:   isFreon,
      freonKg:     "",
      photos:      [],
    };
    const repairs = (client.repairs ?? []).map((r) =>
      r.id === repair.id ? { ...r, tasks: [...(r.tasks ?? []), newTask] } : r,
    );
    await updateClientArray(client.id, "repairs", repairs);
    onClose();
  }

  return (
    <Modal title="Добавить задачу к ремонту" onClose={onClose}>
      <div className="flex gap-2 mb-4">
        {[false, true].map((isF) => (
          <button
            key={String(isF)}
            type="button"
            onClick={() => setIsFreon(isF)}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 10, fontSize: 13,
              fontWeight: 600, cursor: "pointer", transition: "all 0.18s",
              border: isFreon === isF
                ? `1px solid ${isF ? "var(--cyan)" : "var(--accent)"}`
                : "1px solid var(--border2)",
              background: isFreon === isF ? (isF ? "var(--cyan)" : "var(--accent)") : "var(--bg3)",
              color: isFreon === isF ? "white" : "var(--text2)",
            }}
          >
            {isF ? "❄️ Заправка фреоном" : "🔧 Обычная задача"}
          </button>
        ))}
      </div>
      {isFreon ? (
        <FormGroup label="Марка фреона">
          <Input placeholder="R134a, R404a..." value={freonType} onChange={(e) => setFreonType(e.target.value)} />
        </FormGroup>
      ) : (
        <FormGroup label="Задача">
          <Textarea placeholder="Что нужно сделать..." value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus />
        </FormGroup>
      )}
      <FormGroup label="Исполнитель">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">— не назначен —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? s.email}</option>)}
        </Select>
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Добавить задачу"}
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

  async function handleSave() {
    if (!desc.trim()) return;
    setSaving(true);
    const existing = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
    const newSub: Subtask = {
      id:          genId(),
      description: desc.trim(),
      assignees:   assignee ? [assignee] : [],
      doneBy:      [],
      status:      "in_progress",
      workComment: "",
    };
    await updateServiceTask(task.id, { subtasks: [...existing, newSub] } as Partial<ServiceTask>);
    onClose();
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
  const isAdmin = role === "admin" || role === "manager";
  const isDone  = subtask.status === "done";
  const myDone  = subtask.doneBy.includes(uid);
  const [showComment, setShowComment] = useState(false);
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const assigneeNames = subtask.assignees
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    const existing = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
    const newDoneBy = myDone ? subtask.doneBy.filter((d) => d !== uid) : [...subtask.doneBy, uid];
    const allDone   = subtask.assignees.length > 0 && subtask.assignees.every((a) => newDoneBy.includes(a));
    const updated   = existing.map((s) =>
      s.id === subtask.id ? { ...s, doneBy: newDoneBy, status: allDone ? "done" as const : "in_progress" as const } : s,
    );
    await updateServiceTask(task.id, { subtasks: updated } as Partial<ServiceTask>);
  }

  async function saveComment(comment: string) {
    const existing = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
    const updated  = existing.map((s) => s.id === subtask.id ? { ...s, workComment: comment } : s);
    await updateServiceTask(task.id, { subtasks: updated } as Partial<ServiceTask>);
  }

  async function addPhotos(photos: PhotoData[]) {
    const existing = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
    const updated  = existing.map((s) =>
      s.id === subtask.id ? { ...s, photos: [...(s.photos ?? []), ...photos] } : s,
    );
    await updateServiceTask(task.id, { subtasks: updated } as Partial<ServiceTask>);
  }

  async function handleDelete() {
    if (!isAdmin || !confirm("Удалить подзадачу?")) return;
    const existing = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
    await updateServiceTask(task.id, { subtasks: existing.filter((s) => s.id !== subtask.id) } as Partial<ServiceTask>);
  }

  return (
    <div className={`bg-white rounded-xl p-2.5 border border-[#E2E8F0] ${isDone ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-lg border text-xs font-bold flex items-center justify-center cursor-pointer
            ${isDone ? "bg-[#EAF3DE] border-[#3B6D11]/30 text-[#3B6D11]" : "bg-[#FAEEDA] border-[#BA7517]/30 text-[#BA7517]"}`}
        >
          {isDone ? "✓" : "●"}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#172033]">{subtask.description}</div>
          {assigneeNames && <div className="text-[10px] text-[#667085]">👤 {assigneeNames}</div>}
          {subtask.workComment && (
            <div className="mt-1 text-[10px] text-[#344054] bg-[#F7F9FC] rounded p-1 border border-[#E2E8F0]">
              <span className="text-purple-400 font-semibold">Отчёт: </span>{subtask.workComment}
            </div>
          )}
          <PhotoGrid photos={subtask.photos ?? []} readOnly onView={setLightbox} />
          {!isDone && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowComment(true)}
                className="text-[10px] text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded border border-[#E2E8F0] cursor-pointer"
              >
                📝 {subtask.workComment ? "Изменить" : "Отчёт"}
              </button>
              <InlinePhotoButton onUploaded={addPhotos} label="Фото" capture="environment" />
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="text-[10px] text-red-400 bg-white px-2 py-0.5 rounded border border-red-100 cursor-pointer"
                >
                  × удалить
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {showComment && (
        <WorkCommentModal current={subtask.workComment} onSave={saveComment} onClose={() => setShowComment(false)} />
      )}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── Service task card ────────────────────────────────────────────────────────

function ServiceTaskCard({ task }: { task: ServiceTask }) {
  const { myProfile } = useAuth();
  const { staff }     = useData();
  const uid     = myProfile?.id ?? "";
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

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
    const doneBy = task.doneBy ?? [];
    const newDoneBy = myDone ? doneBy.filter((d) => d !== uid) : [...doneBy, uid];
    const assignees = task.assignees ?? [];
    const allDone   = assignees.length > 0 && assignees.every((a) => newDoneBy.includes(a));
    await updateServiceTask(task.id, { doneBy: newDoneBy, status: allDone ? "done" : "in_progress" });
  }

  async function handleDelete() {
    if (!confirm("Удалить задачу?")) return;
    await deleteServiceTask(task.id);
  }

  async function saveComment(comment: string) {
    await updateServiceTask(task.id, { workComment: comment });
  }

  async function addPhotos(photos: PhotoData[]) {
    await updateServiceTask(task.id, { photos: [...(task.photos ?? []), ...photos] });
  }

  return (
    <div
      className={`bg-white rounded-[18px] border border-l-4 p-4 mb-2.5 shadow-sm transition-opacity ${isDone ? "opacity-60" : ""}`}
      style={{ borderLeftColor: isProject ? "var(--yellow)" : isDone ? "var(--green)" : "var(--accent)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isProject && (
              <span className="text-[10px] font-bold text-[#854F0B] bg-[#FAEEDA] px-2 py-0.5 rounded-full">Проект</span>
            )}
            <div className="text-sm font-semibold text-[#172033]">
              {task.title ?? task.description ?? "—"}
            </div>
          </div>
          {task.title && task.description && (
            <div className="text-xs text-[#667085] mt-0.5">{task.description}</div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => void toggle()}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer transition-all
              ${isDone ? "bg-[#EAF3DE] text-[#3B6D11] border-[#3B6D11]/20" : "bg-[#FAEEDA] text-[#BA7517] border-[#BA7517]/20"}`}
          >
            {isDone ? "✓" : "●"}
          </button>
          {isAdmin && (
            <button type="button" onClick={() => void handleDelete()}
              className="text-[#98A2B3] hover:text-red-400 cursor-pointer bg-transparent border-none text-base leading-none"
            >×</button>
          )}
        </div>
      </div>

      {assigneeNames && <div className="text-xs text-[#667085] mb-1">👤 {assigneeNames}</div>}

      {/* Subtask progress */}
      {isProject && subtasks.length > 0 && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-[#98A2B3] mb-1">
            <span>Подзадачи</span><span>{subDone}/{subtasks.length}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
            <div className="h-full rounded-full bg-[#185FA5]"
              style={{ width: `${subtasks.length > 0 ? (subDone/subtasks.length)*100 : 0}%` }} />
          </div>
        </div>
      )}

      {/* Work comment */}
      {task.workComment && (
        <div className="mt-1 mb-1.5 text-xs text-[#344054] bg-[#F7F9FC] rounded-lg p-2 border border-[#E2E8F0]">
          <span className="text-purple-400 font-semibold">Отчёт: </span>{task.workComment}
        </div>
      )}

      {/* Photos */}
      <PhotoGrid photos={task.photos ?? []} readOnly onView={setLightbox} />

      {/* Subtasks */}
      {isProject && subtasks.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {subtasks.map((s) => <SubtaskRow key={s.id} subtask={s} task={task} />)}
        </div>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setShowComment(true)}
            className="text-xs text-[#667085] bg-[#F2F4F7] px-2.5 py-1 rounded-lg border border-[#E2E8F0] cursor-pointer"
          >
            📝 {task.workComment ? "Изменить" : "Отчёт"}
          </button>
          <InlinePhotoButton onUploaded={addPhotos} label="Фото" capture="environment" />
          {isProject && isAdmin && (
            <button
              type="button"
              onClick={() => setShowAddSubtask(true)}
              className="text-xs text-[#185FA5] bg-[#E6F1FB] px-2.5 py-1 rounded-lg border border-[#185FA5]/10 cursor-pointer font-semibold"
            >
              + Подзадача
            </button>
          )}
        </div>
      )}

      {showComment    && <WorkCommentModal current={task.workComment} onSave={saveComment} onClose={() => setShowComment(false)} />}
      {showAddSubtask && <AddSubtaskModal task={task} onClose={() => setShowAddSubtask(false)} />}
      {lightbox       && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── Repair task row ──────────────────────────────────────────────────────────

function RepairTaskRow({ task, client, repair }: {
  task:   RepairTask;
  client: Client;
  repair: Repair;
}) {
  const { myProfile } = useAuth();
  const { staff }     = useData();
  const uid     = myProfile?.id ?? "";
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";
  const isDone  = taskStatus(task) === "done";
  const myDone  = (task.doneBy ?? []).includes(uid);
  const isFreon = task.freonTask === true;

  const [freonKg,     setFreonKg]     = useState(task.freonKg ?? "");
  const [showComment, setShowComment] = useState(false);
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const assigneeNames = getAssignees(task)
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function patchTask(patch: Partial<RepairTask>) {
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return { ...r, tasks: (r.tasks ?? []).map((t) => t.id === task.id ? { ...t, ...patch } : t) };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function toggle() {
    const doneBy    = task.doneBy ?? [];
    const newDoneBy = myDone ? doneBy.filter((d) => d !== uid) : [...doneBy, uid];
    const assignees = getAssignees(task);
    const allDone   = assignees.length > 0 && assignees.every((a) => newDoneBy.includes(a));
    await patchTask({ doneBy: newDoneBy, status: allDone ? "done" : "in_progress" });
  }

  async function saveFreon(done: boolean) {
    const patch: Partial<RepairTask> = { freonKg };
    if (done) patch.status = "done";
    // Also update repair.freonAmount for the parent repair
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return {
        ...r,
        freonAmount: freonKg,
        tasks: (r.tasks ?? []).map((t) => t.id === task.id ? { ...t, ...patch } : t),
      };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function addPhotos(photos: PhotoData[]) {
    await patchTask({ photos: [...(task.photos ?? []), ...photos] });
  }

  async function handleDelete() {
    if (!isAdmin || !confirm("Удалить задачу?")) return;
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return { ...r, tasks: (r.tasks ?? []).filter((t) => t.id !== task.id) };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  return (
    <div className={`bg-[#F7F9FC] rounded-xl p-3 mb-1.5 border border-[#E2E8F0] ${isDone ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        {/* Toggle button — hidden for freonTask (done via freon input) */}
        {!isFreon && (
          <button
            type="button"
            onClick={() => void toggle()}
            className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-lg border cursor-pointer text-xs font-bold flex items-center justify-center
              ${isDone ? "bg-[#EAF3DE] border-[#3B6D11]/30 text-[#3B6D11]" : "bg-[#FAEEDA] border-[#BA7517]/30 text-[#BA7517]"}`}
          >
            {isDone ? "✓" : "●"}
          </button>
        )}
        {isFreon && (
          <span className="flex-shrink-0 mt-0.5 text-cyan-500 text-base">❄️</span>
        )}

        <div className="flex-1 min-w-0">
          <div className="text-sm text-[#172033]">{task.description}</div>
          {assigneeNames && <div className="text-xs text-[#667085]">👤 {assigneeNames}</div>}

          {/* Freon input — only for active freonTask */}
          {isFreon && !isDone && (
            <div className="flex items-center gap-2 mt-2 bg-cyan-50 rounded-lg px-2 py-1.5 border border-cyan-100">
              <span className="text-xs text-cyan-600 font-semibold flex-shrink-0">Кг фреона:</span>
              <Input
                type="number"
                step="0.1"
                placeholder="0.0"
                value={freonKg}
                onChange={(e) => setFreonKg(e.target.value)}
                className="!min-h-0 !py-1 !px-2 !text-sm w-20 flex-shrink-0"
              />
              <button
                type="button"
                onClick={() => void saveFreon(false)}
                className="text-xs text-cyan-600 bg-white border border-cyan-200 px-2 py-1 rounded-lg cursor-pointer flex-shrink-0"
              >
                💾
              </button>
              <button
                type="button"
                onClick={() => void saveFreon(true)}
                className="text-xs text-white bg-green-600 px-2 py-1 rounded-lg cursor-pointer flex-shrink-0 font-bold"
              >
                ✓
              </button>
            </div>
          )}

          {/* Done freon — show kg */}
          {isFreon && isDone && task.freonKg && (
            <div className="text-xs text-cyan-600 mt-1">
              ❄️ Заправлено: <strong>{task.freonKg} кг</strong>
            </div>
          )}

          {/* Work comment */}
          {task.workComment && (
            <div className="mt-1 text-xs text-[#344054] bg-white rounded-lg p-1.5 border border-[#E2E8F0]">
              <span className="text-purple-400 font-semibold">Отчёт: </span>{task.workComment}
            </div>
          )}

          {/* Photos */}
          <PhotoGrid photos={task.photos ?? []} readOnly onView={setLightbox} />

          {/* Actions */}
          {!isDone && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {!isFreon && (
                <button
                  type="button"
                  onClick={() => setShowComment(true)}
                  className="text-xs text-[#667085] bg-white px-2 py-0.5 rounded-lg border border-[#E2E8F0] cursor-pointer"
                >
                  📝 {task.workComment ? "Изменить" : "Отчёт"}
                </button>
              )}
              <InlinePhotoButton onUploaded={addPhotos} label="Фото" capture="environment" />
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="text-xs text-red-400 bg-white px-2 py-0.5 rounded-lg border border-red-100 cursor-pointer"
                >
                  × удалить
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showComment && (
        <WorkCommentModal
          current={task.workComment}
          onSave={(c) => patchTask({ workComment: c })}
          onClose={() => setShowComment(false)}
        />
      )}
      {lightbox && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── Repair group ─────────────────────────────────────────────────────────────

function RepairGroup({ client, repair, tasks, canAdd }: {
  client:  Client;
  repair:  Repair;
  tasks:   RepairTask[];
  canAdd:  boolean;
}) {
  const vehicle = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const [showAdd,   setShowAdd]   = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [closeSum,  setCloseSum]  = useState(repair.cost ?? "");
  const [closing,   setClosing]   = useState(false);

  const doneTasks  = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const allDone    = totalTasks > 0 && doneTasks === totalTasks;

  async function closeRepair() {
    if (!closeSum.trim()) return;
    setClosing(true);
    const repairs = (client.repairs ?? []).map((r) =>
      r.id !== repair.id ? r : {
        ...r,
        cost: closeSum.trim(),
        closedByManager: true,
        status: "done" as const,
      }
    );
    await updateClientArray(client.id, "repairs", repairs);
    setClosing(false);
    setShowClose(false);
  }

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 14, overflow: "hidden", marginBottom: 10,
      borderLeft: "3px solid var(--accent)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 10px" }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
          background: "rgba(59,130,246,0.15)", color: "var(--accent2)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700,
        }}>
          {(client.name || "").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{client.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
            {vehicle?.plate && (
              <span style={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace", background: "var(--bg3)", color: "var(--text2)", padding: "1px 6px", borderRadius: 5 }}>
                {vehicle.plate}
              </span>
            )}
            {repair.description && (
              <span style={{ fontSize: 11.5, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {repair.description}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {repair.date && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
          )}
          {totalTasks > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              background: allDone ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
              color: allDone ? "#4ade80" : "#fbbf24",
              fontFamily: "JetBrains Mono, monospace",
            }}>
              {doneTasks}/{totalTasks}
            </span>
          )}
        </div>
      </div>

      {/* Tasks */}
      {tasks.length > 0 && (
        <div style={{ padding: "0 10px 6px" }}>
          {tasks.map((t) => <RepairTaskRow key={t.id} task={t} client={client} repair={repair} />)}
        </div>
      )}

      {/* Footer actions */}
      {canAdd && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: "var(--bg3)", border: "1px solid var(--border)",
              color: "var(--text2)", cursor: "pointer", alignSelf: "flex-start",
            }}
          >
            <i className="ti ti-plus" style={{ fontSize: 13 }} /> Задача
          </button>

          {/* Close repair */}
          {!showClose ? (
            <button
              type="button"
              onClick={() => setShowClose(true)}
              style={{
                padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
                color: "#4ade80", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <i className="ti ti-circle-check" style={{ fontSize: 15 }} />
              Закрыть наряд
            </button>
          ) : (
            <div style={{
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 10, padding: "10px 12px",
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "#4ade80", marginBottom: 8 }}>
                <i className="ti ti-currency-ruble" style={{ fontSize: 13 }} /> Закрыть заказ-наряд
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="number"
                  placeholder="Сумма ₽"
                  value={closeSum}
                  onChange={(e) => setCloseSum(e.target.value)}
                  style={{
                    width: 130, padding: "8px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700,
                    background: "var(--bg3)", border: "1px solid rgba(34,197,94,0.3)", color: "var(--text)",
                    outline: "none", fontFamily: "JetBrains Mono, monospace",
                  }}
                  autoFocus
                />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>₽</span>
                <button
                  type="button"
                  onClick={() => void closeRepair()}
                  disabled={closing || !closeSum.trim()}
                  style={{
                    marginLeft: "auto", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                    background: closing ? "rgba(34,197,94,0.2)" : "var(--green)", border: "none",
                    color: "white", cursor: closing ? "not-allowed" : "pointer",
                  }}
                >
                  {closing ? "..." : "✓ Закрыть"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowClose(false)}
                  style={{
                    padding: "8px 10px", borderRadius: 8, fontSize: 12,
                    background: "var(--bg3)", border: "1px solid var(--border)",
                    color: "var(--text3)", cursor: "pointer",
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && <AddRepairTaskModal client={client} repair={repair} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function MyTasksTab() {
  const { clients, tasks } = useData();
  const { myProfile }      = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const uid             = myProfile?.id ?? "";
  const role            = myProfile?.role ?? "mechanic";
  const isManagerOrAdmin = role === "admin" || role === "manager";

  // Standalone service tasks
  const activeSvcTasks = tasks.filter((t) => {
    if (t.status === "done") return false;
    return isManagerOrAdmin ? true : (t.assignees ?? []).includes(uid);
  });
  const myTasks    = activeSvcTasks.filter((t) => (t.assignees ?? []).includes(uid));
  const otherTasks = activeSvcTasks.filter((t) => !(t.assignees ?? []).includes(uid));

  // Repair task groups
  interface RepairGroupData { client: Client; repair: Repair; tasks: RepairTask[] }
  const repairGroups: RepairGroupData[] = [];
  clients.forEach((c) => {
    (c.repairs ?? []).forEach((r) => {
      if (repairStatus(r) !== "in_progress") return;
      const allActive = (r.tasks ?? []).filter((t) => taskStatus(t) !== "done");
      const visible   = isManagerOrAdmin ? allActive : allActive.filter((t) => getAssignees(t).includes(uid));
      if (!visible.length && !isManagerOrAdmin) return;
      if (allActive.length === 0 && !isManagerOrAdmin) return;
      repairGroups.push({ client: c, repair: r, tasks: isManagerOrAdmin ? allActive : visible });
    });
  });

  const hasAnything = myTasks.length || otherTasks.length || repairGroups.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Сервисные задачи ───────────────────────────────────────────────── */}
      {(activeSvcTasks.length > 0 || isManagerOrAdmin) && (
        <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.15s both" }}>
          <div className="section-header">
            <i className="ti ti-list-check" style={{ fontSize: 17, color: "var(--text2)" }} />
            <span className="section-title">Сервисные задачи</span>
            {activeSvcTasks.length > 0 && (
              <span className="section-count">{activeSvcTasks.length} активных</span>
            )}
            {isManagerOrAdmin && (
              <div className="section-actions">
                <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowAdd(true)}>
                  <i className="ti ti-plus" /> Задача
                </button>
              </div>
            )}
          </div>

          {activeSvcTasks.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              Нет активных задач
            </div>
          ) : (
            <div style={{ padding: "8px 12px 12px" }}>
              {myTasks.length > 0 && (
                <>
                  <SectionTitle text="Мои задачи" count={myTasks.length} />
                  {myTasks.map((t) => <ServiceTaskCard key={t.id} task={t} />)}
                </>
              )}
              {otherTasks.length > 0 && (
                <>
                  <SectionTitle text="Задачи сотрудников" count={otherTasks.length} />
                  {otherTasks.map((t) => <ServiceTaskCard key={t.id} task={t} />)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Ремонты в работе ──────────────────────────────────────────────── */}
      {(repairGroups.length > 0 || (!isManagerOrAdmin && !activeSvcTasks.length)) && (
        <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.25s both" }}>
          <div className="section-header">
            <i className="ti ti-tools" style={{ fontSize: 17, color: "var(--text2)" }} />
            <span className="section-title">Ремонты в работе</span>
            {repairGroups.length > 0 && (
              <span className="section-count">{repairGroups.length} нарядов</span>
            )}
          </div>

          {repairGroups.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              Нет ремонтов в работе
            </div>
          ) : (
            <div style={{ padding: "8px 12px 12px" }}>
              {repairGroups.map(({ client, repair, tasks: ts }) => (
                <RepairGroup
                  key={`${client.id}-${repair.id}`}
                  client={client}
                  repair={repair}
                  tasks={ts}
                  canAdd={isManagerOrAdmin}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!hasAnything && !isManagerOrAdmin && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)", fontSize: 13 }}>
          <i className="ti ti-check" style={{ fontSize: 32, display: "block", marginBottom: 8 }} />
          Нет активных задач
        </div>
      )}

      {showAdd && <AddServiceTaskModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
