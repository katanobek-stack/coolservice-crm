import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, DualPhotoButton } from "../../shared/ui/PhotoUploader";
import { updateClientArray, addServiceTask, updateServiceTask, deleteServiceTask } from "../../shared/firebase/firestore";
import type { PhotoData } from "../../shared/utils/photos";
import type { ServiceTask } from "../../shared/types/task";
import type { RepairTask, Repair, Client } from "../../shared/types/client";

// ─── Avatar palette for repair cards ─────────────────────────────────────────

const REPAIR_AVATAR_PALETTES = [
  { bg: "rgba(59,130,246,0.20)",  border: "rgba(59,130,246,0.40)",  text: "#93c5fd" },
  { bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.38)",  text: "#6ee7b7" },
  { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.38)",  text: "#fcd34d" },
  { bg: "rgba(139,92,246,0.18)",  border: "rgba(139,92,246,0.38)",  text: "#c4b5fd" },
  { bg: "rgba(6,182,212,0.18)",   border: "rgba(6,182,212,0.38)",   text: "#67e8f9" },
  { bg: "rgba(249,115,22,0.18)",  border: "rgba(249,115,22,0.38)",  text: "#fdba74" },
  { bg: "rgba(236,72,153,0.18)",  border: "rgba(236,72,153,0.38)",  text: "#f9a8d4" },
];

function repairAvatarPalette(name: string) {
  const sum = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return REPAIR_AVATAR_PALETTES[sum % REPAIR_AVATAR_PALETTES.length];
}

const FREON_BADGES = ["R134a", "R404A", "R410A", "R507", "R22"] as const;

// ─── Section title ────────────────────────────────────────────────────────────

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

  const [title,    setTitle]    = useState("");
  const [desc,     setDesc]     = useState("");
  const [taskType, setTaskType] = useState<"task" | "project">("task");
  const [assignee, setAssignee] = useState(myProfile?.id ?? "");
  const [saving,   setSaving]   = useState(false);

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
  const [desc,      setDesc]      = useState("");
  const [assignee,  setAssignee]  = useState(myProfile?.id ?? "");
  const [isFreon,   setIsFreon]   = useState(false);
  const [freonType, setFreonType] = useState(repair.freonType ?? "");
  const [saving,    setSaving]    = useState(false);

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
    const existing  = (task as ServiceTask & { subtasks?: Subtask[] }).subtasks ?? [];
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
            border: `2px solid ${isDone ? "#4ade80" : "rgba(255,255,255,0.2)"}`,
            background: isDone ? "rgba(34,197,94,0.15)" : "transparent",
            color: isDone ? "#4ade80" : "transparent",
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
              <span style={{ color: "#c4b5fd", fontWeight: 600 }}>📝 </span>{subtask.workComment}
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
                <button type="button" onClick={() => void handleDelete()} style={{ fontSize: 10, color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", padding: "2px 7px", borderRadius: 5, cursor: "pointer" }}>
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
    const doneBy    = task.doneBy ?? [];
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
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${isProject ? "rgba(245,158,11,0.8)" : "rgba(139,92,246,0.8)"}`,
      borderRadius: 12,
      padding: "10px 12px",
      marginBottom: 8,
      opacity: isDone ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isProject && (
              <span style={{ fontSize: 9, fontWeight: 700, color: "#fcd34d", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)", padding: "1px 6px", borderRadius: 5 }}>
                ПРОЕКТ
              </span>
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? "var(--text3)" : "var(--text)", textDecoration: isDone ? "line-through" : "none" }}>
              {task.title ?? task.description ?? "—"}
            </span>
          </div>
          {task.title && task.description && (
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{task.description}</div>
          )}
          {assigneeNames && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>👤 {assigneeNames}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => void toggle()}
            style={{
              padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700,
              border: `1px solid ${isDone ? "rgba(34,197,94,0.3)" : "rgba(139,92,246,0.3)"}`,
              background: isDone ? "rgba(34,197,94,0.12)" : "rgba(139,92,246,0.12)",
              color: isDone ? "#4ade80" : "#c4b5fd",
              cursor: "pointer",
            }}
          >
            {isDone ? "✓ Готово" : "●"}
          </button>
          {isAdmin && (
            <button type="button" onClick={() => void handleDelete()}
              style={{ background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px" }}
            >×</button>
          )}
        </div>
      </div>

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
          <span style={{ color: "#c4b5fd", fontWeight: 600 }}>📝 </span>{task.workComment}
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
            <button type="button" onClick={() => setShowAddSubtask(true)} style={{ fontSize: 11, color: "#c4b5fd", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", padding: "4px 10px", borderRadius: 7, cursor: "pointer", fontWeight: 600 }}>
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
    <div style={{
      background: isDone ? "transparent" : "var(--bg3)",
      border: `1px solid ${isDone ? "transparent" : "var(--border)"}`,
      borderRadius: 10,
      padding: isDone ? "6px 10px" : "10px 12px",
      marginBottom: 6,
      opacity: isDone ? 0.5 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>

        {/* Checkbox / freon icon */}
        {!isFreon ? (
          <button
            type="button"
            onClick={() => void toggle()}
            style={{
              flexShrink: 0, marginTop: 2,
              width: 20, height: 20, borderRadius: "50%",
              border: `2px solid ${isDone ? "#4ade80" : "var(--border2)"}`,
              background: isDone ? "rgba(34,197,94,0.15)" : "transparent",
              color: isDone ? "#4ade80" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 11, fontWeight: 700,
            }}
          >
            {isDone && "✓"}
          </button>
        ) : (
          <span style={{ flexShrink: 0, marginTop: 1, fontSize: 15 }}>❄️</span>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Description */}
          <div style={{
            fontSize: 13,
            fontWeight: isDone ? 400 : 600,
            color: isDone ? "var(--text3)" : "var(--text)",
            textDecoration: isDone ? "line-through" : "none",
          }}>
            {task.description}
          </div>

          {assigneeNames && (
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>👤 {assigneeNames}</div>
          )}

          {/* Freon type badges */}
          {isFreon && !isDone && (
            <div style={{ display: "flex", gap: 4, marginTop: 7, flexWrap: "wrap" }}>
              {FREON_BADGES.map((fr) => {
                const active = task.freonType === fr;
                return (
                  <button
                    key={fr}
                    type="button"
                    onClick={() => void patchTask({ freonType: fr })}
                    style={{
                      padding: "2px 9px", borderRadius: 6,
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${active ? "#22d3ee" : "var(--border)"}`,
                      background: active ? "rgba(6,182,212,0.2)" : "transparent",
                      color: active ? "#22d3ee" : "var(--text3)",
                    }}
                  >
                    {fr}
                  </button>
                );
              })}
            </div>
          )}

          {/* Freon kg input */}
          {isFreon && !isDone && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#67e8f9", fontWeight: 600 }}>кг:</span>
              <Input
                type="number" step="0.1" placeholder="0.0"
                value={freonKg} onChange={(e) => setFreonKg(e.target.value)}
                className="!min-h-0 !py-1 !px-2 !text-sm w-20 flex-shrink-0"
              />
              <button type="button" onClick={() => void saveFreon(false)} style={{ fontSize: 11, color: "#67e8f9", background: "transparent", border: "1px solid rgba(6,182,212,0.3)", padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}>
                💾
              </button>
              <button type="button" onClick={() => void saveFreon(true)} style={{ fontSize: 11, color: "white", background: "#16a34a", border: "none", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
                ✓ Готово
              </button>
            </div>
          )}

          {/* Done freon — show kg */}
          {isFreon && isDone && task.freonKg && (
            <div style={{ fontSize: 11, color: "#67e8f9", marginTop: 2 }}>
              ❄️ Заправлено: <strong>{task.freonKg} кг</strong>
            </div>
          )}

          {/* Work comment */}
          {task.workComment && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, padding: "4px 8px" }}>
              <span style={{ color: "#c4b5fd", fontWeight: 600 }}>📝 </span>{task.workComment}
            </div>
          )}

          <PhotoGrid photos={task.photos ?? []} readOnly onView={setLightbox} />

          {/* Actions */}
          {!isDone && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {!isFreon && (
                <button type="button" onClick={() => setShowComment(true)} style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg2)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 6, cursor: "pointer" }}>
                  📝 {task.workComment ? "Изменить" : "Отчёт"}
                </button>
              )}
              <DualPhotoButton onUploaded={addPhotos} />
              {isAdmin && (
                <button type="button" onClick={() => void handleDelete()} style={{ fontSize: 11, color: "#f87171", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", padding: "3px 9px", borderRadius: 6, cursor: "pointer" }}>
                  🗑
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

// ─── Repair group card ────────────────────────────────────────────────────────

function RepairGroup({ client, repair, tasks, canAdd }: {
  client:  Client;
  repair:  Repair;
  tasks:   RepairTask[];
  canAdd:  boolean;
}) {
  const vehicle    = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const brand      = vehicle?.brand ?? vehicle?.model;
  const palette    = repairAvatarPalette(client.name || "");
  const initials   = (client.name || "").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
  const doneTasks  = tasks.filter((t) => t.status === "done").length;
  const totalTasks = tasks.length;
  const allDone    = totalTasks > 0 && doneTasks === totalTasks;
  const stripe     = allDone ? "var(--green)" : "var(--accent)";

  const [showAdd,   setShowAdd]   = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [closeSum,  setCloseSum]  = useState(repair.cost ?? "");
  const [closing,   setClosing]   = useState(false);

  async function closeRepair() {
    if (!closeSum.trim()) return;
    setClosing(true);
    const repairs = (client.repairs ?? []).map((r) =>
      r.id !== repair.id ? r : { ...r, cost: closeSum.trim(), closedByManager: true, status: "done" as const },
    );
    await updateClientArray(client.id, "repairs", repairs);
    setClosing(false);
    setShowClose(false);
  }

  async function markDone() {
    const repairs = (client.repairs ?? []).map((r) =>
      r.id !== repair.id ? r : { ...r, status: "done" as const },
    );
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function deleteRepair() {
    if (!confirm("Удалить наряд?")) return;
    const repairs = (client.repairs ?? []).filter((r) => r.id !== repair.id);
    await updateClientArray(client.id, "repairs", repairs);
  }

  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${stripe}`,
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 12,
      boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
    }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px 10px" }}>

        {/* Avatar */}
        <div style={{
          width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
          background: palette.bg, border: `1.5px solid ${palette.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color: palette.text,
        }}>
          {initials}
        </div>

        {/* Client info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {client.name || "—"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {vehicle?.plate && (
              <span style={{
                fontSize: 11, fontFamily: "JetBrains Mono, monospace", fontWeight: 700,
                color: "#93c5fd", background: "rgba(59,130,246,0.12)",
                border: "1px solid rgba(59,130,246,0.25)",
                padding: "2px 8px", borderRadius: 6,
              }}>
                {vehicle.plate}
              </span>
            )}
            {brand && (
              <span style={{ fontSize: 11, color: "var(--text3)" }}>{brand}</span>
            )}
          </div>
        </div>

        {/* Right: date + status */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          {repair.date && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
              background: allDone ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
              color: allDone ? "#4ade80" : "var(--accent2)",
            }}>
              {allDone ? "✓ Готово" : "В работе"}
            </span>
            {totalTasks > 0 && (
              <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
                {doneTasks}/{totalTasks}
              </span>
            )}
          </div>
        </div>

        {/* Delete button — admin only */}
        {canAdd && (
          <button
            type="button"
            onClick={() => void deleteRepair()}
            title="Удалить наряд"
            style={{
              flexShrink: 0, padding: "6px 8px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              color: "#f87171", cursor: "pointer", fontSize: 14, lineHeight: 1,
            }}
          >
            <i className="ti ti-trash" />
          </button>
        )}
      </div>

      {/* ── Task list ──────────────────────────────────────────────────── */}
      {tasks.length > 0 && (
        <div style={{ padding: "0 12px 6px" }}>
          {tasks.map((t) => <RepairTaskRow key={t.id} task={t} client={client} repair={repair} />)}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>

        {canAdd ? (
          <>
            {/* Add task */}
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              style={{
                alignSelf: "flex-start", padding: "5px 14px", borderRadius: 8,
                fontSize: 12, fontWeight: 600,
                background: "var(--bg3)", border: "1px solid var(--border)",
                color: "var(--text2)", cursor: "pointer",
              }}
            >
              <i className="ti ti-plus" style={{ fontSize: 12 }} /> Задача
            </button>

            {/* Close repair — blue, admin only */}
            {!showClose ? (
              <button
                type="button"
                onClick={() => setShowClose(true)}
                style={{
                  padding: "11px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
                  color: "var(--accent2)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <i className="ti ti-circle-check" style={{ fontSize: 15 }} />
                Закрыть наряд
              </button>
            ) : (
              <div style={{ background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent2)", marginBottom: 8 }}>
                  Сумма работ
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="number"
                    placeholder="Сумма ₽"
                    value={closeSum}
                    onChange={(e) => setCloseSum(e.target.value)}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 14, fontWeight: 700,
                      background: "var(--bg3)", border: "1px solid rgba(59,130,246,0.3)",
                      color: "var(--text)", outline: "none", fontFamily: "JetBrains Mono, monospace",
                    }}
                    autoFocus
                  />
                  <span style={{ fontSize: 14, color: "var(--text2)" }}>₽</span>
                  <button
                    type="button"
                    onClick={() => void closeRepair()}
                    disabled={closing || !closeSum.trim()}
                    style={{
                      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                      background: closing ? "rgba(59,130,246,0.2)" : "var(--accent)",
                      border: "none", color: "white",
                      cursor: closing ? "not-allowed" : "pointer",
                    }}
                  >
                    {closing ? "..." : "✓"}
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
                    ✕
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Mechanic: simple "done" button */
          <button
            type="button"
            onClick={() => void markDone()}
            style={{
              width: "100%", padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
              color: "#4ade80", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <i className="ti ti-check" style={{ fontSize: 15 }} />
            ✓ Выполнено
          </button>
        )}
      </div>

      {showAdd && <AddRepairTaskModal client={client} repair={repair} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function MyTasksTab() {
  const { clients, tasks } = useData();
  const { myProfile }      = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const uid              = myProfile?.id ?? "";
  const role             = myProfile?.role ?? "mechanic";
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

      {/* ── Сервисные задачи ──────────────────────────────────────────────── */}
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
