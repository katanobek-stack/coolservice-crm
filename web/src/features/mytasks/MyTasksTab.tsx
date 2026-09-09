import { useState, useEffect, useRef } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees } from "../../shared/utils/repair";
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
  mutateClientRepair,
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
import type { ServiceTask } from "../../shared/types/task";
import type { RepairTask, Repair, Client } from "../../shared/types/client";

// ─── Avatar palette for repair cards ─────────────────────────────────────────

const REPAIR_AVATAR_PALETTES = [
  { bg: "rgba(59,130,246,0.20)",  border: "rgba(59,130,246,0.40)",  text: "#3b82f6" },
  { bg: "rgba(16,185,129,0.18)",  border: "rgba(16,185,129,0.38)",  text: "#16a34a" },
  { bg: "rgba(245,158,11,0.18)",  border: "rgba(245,158,11,0.38)",  text: "#fcd34d" },
  { bg: "rgba(139,92,246,0.18)",  border: "rgba(139,92,246,0.38)",  text: "#6d28d9" },
  { bg: "rgba(6,182,212,0.18)",   border: "rgba(6,182,212,0.38)",   text: "#0e7490" },
  { bg: "rgba(249,115,22,0.18)",  border: "rgba(249,115,22,0.38)",  text: "#fdba74" },
  { bg: "rgba(236,72,153,0.18)",  border: "rgba(236,72,153,0.38)",  text: "#f9a8d4" },
];

function repairAvatarPalette(name: string) {
  const sum = (name || "").split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  return REPAIR_AVATAR_PALETTES[sum % REPAIR_AVATAR_PALETTES.length];
}

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
    const newSub: Subtask = {
      id:          genId(),
      description: desc.trim(),
      assignees:   assignee ? [assignee] : [],
      doneBy:      [],
      status:      "in_progress",
      workComment: "",
    };
    await addServiceSubtask(task.id, newSub);
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
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const isDone  = subtask.status === "done";
  const myDone  = subtask.doneBy.includes(uid);
  const [showComment, setShowComment] = useState(false);
  const [lightbox,    setLightbox]    = useState<string | null>(null);

  const assigneeNames = subtask.assignees
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    await mutateServiceSubtask(task.id, subtask, (current) => {
      const doneBy = current.doneBy ?? [];
      const newDoneBy = doneBy.includes(uid) ? doneBy.filter((id) => id !== uid) : [...doneBy, uid];
      const allDone = current.assignees.length > 0 && current.assignees.every((id) => newDoneBy.includes(id));
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
              color: isDone ? "#16a34a" : "#6d28d9",
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
  );
}

// ─── Repair group card ────────────────────────────────────────────────────────

function RepairGroup({ client, repair, tasks, canAdd, onOpenClient }: {
  client:        Client;
  repair:        Repair;
  tasks:         RepairTask[];
  canAdd:        boolean;
  onOpenClient?: (client: Client, vehicleId?: string) => void;
}) {
  const vehicle = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const brand   = vehicle?.brand ?? vehicle?.model;
  const palette = repairAvatarPalette(client.name || "");
  const doneTasks  = tasks.filter((t) => taskStatus(t) === "done").length;
  const totalTasks = tasks.length;
  const allDone    = totalTasks > 0 && doneTasks === totalTasks;
  const stripe     = allDone ? "var(--green)" : "var(--accent)";

  const [showAdd, setShowAdd] = useState(false);

  async function markDone() {
    await mutateClientRepair(client.id, repair, (current) => ({ ...current, status: "done" }));
  }

  async function deleteRepair() {
    if (!confirm("Удалить наряд?")) return;
    await removeClientRepair(client.id, repair);
    void deletePhotoObjects(repairPhotos(repair));
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 10px" }}>

        {/* Vehicle photo or colored avatar with car icon */}
        {vehicle?.photo ? (
          <img
            src={vehicle.photo}
            alt=""
            onClick={onOpenClient && vehicle ? () => onOpenClient(client, vehicle.id) : undefined}
            title={onOpenClient && vehicle ? "Открыть карточку автомобиля" : undefined}
            style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)", cursor: onOpenClient && vehicle ? "pointer" : "default" }}
          />
        ) : (
          <div style={{
            width: 52, height: 52, borderRadius: 10, flexShrink: 0,
            background: palette.bg, border: `1px solid ${palette.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>
            🚗
          </div>
        )}

        {/* Main info: brand → plate + status → client name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={onOpenClient ? () => onOpenClient(client) : undefined}
            title={onOpenClient ? "Открыть карточку клиента" : undefined}
            style={{
              fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 5,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              cursor: onOpenClient ? "pointer" : "default",
              textDecoration: onOpenClient ? "underline" : "none",
              textDecorationColor: "rgba(59,130,246,0.35)",
              textUnderlineOffset: 2,
              width: "fit-content",
            }}
          >
            {brand || "Автомобиль"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            {vehicle?.plate && (
              <span
                onClick={onOpenClient ? () => onOpenClient(client) : undefined}
                title={onOpenClient ? "Открыть карточку клиента" : undefined}
                style={{
                  fontFamily: "JetBrains Mono, monospace", fontSize: 12, fontWeight: 700,
                  color: "#3b82f6", background: "rgba(59,130,246,0.12)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  padding: "2px 8px", borderRadius: 6,
                  cursor: onOpenClient ? "pointer" : "default",
                }}
              >
                {vehicle.plate}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
              background: allDone ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.15)",
              color: allDone ? "#16a34a" : "var(--accent2)",
            }}>
              {allDone ? "✓ Готово" : "В работе"}
            </span>
            {totalTasks > 0 && (
              <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "JetBrains Mono, monospace" }}>
                {doneTasks}/{totalTasks}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>{client.name}</div>
          <CreatorLine name={repair.createdByName} date={repair.createdAt} style={{ marginTop: 2 }} />
        </div>

        {/* Right: date + delete */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          {repair.date && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>{fmtDate(repair.date)}</span>
          )}
          {canAdd && (
            <button
              type="button"
              onClick={() => void deleteRepair()}
              title="Удалить наряд"
              style={{
                padding: "5px 7px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
                color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1,
              }}
            >
              <i className="ti ti-trash" />
            </button>
          )}
        </div>
      </div>

      {/* ── Task list ──────────────────────────────────────────────────── */}
      <RepairTaskWork
        repair={repair}
        tasks={tasks}
        editor={clientRepairEditor(client.id, repair)}
        canManageTasks={canAdd}
      />

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>

        {canAdd ? (
          /* Admin/manager: only add-task button; closing happens in Отчёты */
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
        ) : (
          /* Mechanic: simple "done" button (for no-task repairs) */
          <button
            type="button"
            onClick={() => void markDone()}
            style={{
              width: "100%", padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)",
              color: "#16a34a", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <i className="ti ti-check" style={{ fontSize: 15 }} />
            ✓ Выполнено
          </button>
        )}
      </div>

      {showAdd && (
        <AddRepairTaskModal
          editor={clientRepairEditor(client.id, repair)}
          repairFreonType={repair.freonType}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function MyTasksTab({ onOpenClient }: { onOpenClient?: (client: Client, vehicleId?: string) => void } = {}) {
  const { clients, tasks } = useData();
  const { myProfile }      = useAuth();
  const [showAdd, setShowAdd] = useState(false);

  const uid              = myProfile?.id ?? "";
  const role             = myProfile?.role ?? "mechanic";
  const isManagerOrAdmin = role === "owner" || role === "admin" || role === "manager";

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
      const allRepairTasks = r.tasks ?? [];
      const allActive      = allRepairTasks.filter((t) => taskStatus(t) !== "done");
      const visible        = isManagerOrAdmin
        ? allRepairTasks
        : allActive.filter((t) => getAssignees(t).includes(uid));
      if (!visible.length && !isManagerOrAdmin) return;
      repairGroups.push({ client: c, repair: r, tasks: visible });
    });
  });
  repairGroups.sort((a, b) => (b.repair.createdAt ?? "").localeCompare(a.repair.createdAt ?? ""));

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
                  onOpenClient={onOpenClient}
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
