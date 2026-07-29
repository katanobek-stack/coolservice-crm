import { useState, useEffect, useRef } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { PhotoGrid, DualPhotoButton } from "../../shared/ui/PhotoUploader";
import { updateClientArray, addServiceTask, updateServiceTask, deleteServiceTask } from "../../shared/firebase/firestore";
import { deletePhoto } from "../../shared/utils/photos";
import type { PhotoData } from "../../shared/utils/photos";
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
  const [desc,          setDesc]          = useState("");
  const [assignees,     setAssignees]     = useState<string[]>(myProfile?.id ? [myProfile.id] : []);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [assigneeError, setAssigneeError] = useState("");
  const [isFreon,       setIsFreon]       = useState(false);
  const [freonType,     setFreonType]     = useState(repair.freonType ?? "");
  const [saving,        setSaving]        = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!assigneesOpen) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAssigneesOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [assigneesOpen]);

  function toggleAssignee(uid: string) {
    setAssigneeError("");
    setAssignees((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  }

  async function handleSave() {
    if (!desc.trim() && !isFreon) return;
    if (assignees.length === 0) {
      setAssigneeError("Выберите хотя бы одного исполнителя");
      return;
    }
    setSaving(true);
    const newTask: RepairTask = {
      id:          genId(),
      description: isFreon ? `Заправка фреоном ${freonType || ""}`.trim() : desc.trim(),
      assignees,
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

  const assignableStaff = staff;
  const selectedNames = assignees
    .map((uid) => staff.find((s) => s.id === uid)?.name ?? "")
    .filter(Boolean)
    .join(", ");

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

      {/* ── Исполнители (мультиселект) ── */}
      <FormGroup label="Исполнители *">
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setAssigneesOpen((o) => !o)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderRadius: 10,
              background: "var(--bg3)",
              border: `1px solid ${assigneeError ? "#dc2626" : assigneesOpen ? "var(--accent)" : "var(--border2)"}`,
              color: assignees.length ? "var(--text)" : "var(--text3)",
              fontSize: 13, cursor: "pointer", fontFamily: "Manrope, sans-serif", textAlign: "left",
            }}
          >
            <span>{assignees.length === 0 ? "Выберите исполнителей..." : selectedNames}</span>
            <span style={{ fontSize: 10, color: "var(--text3)", transition: "transform 0.18s", transform: assigneesOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>▼</span>
          </button>

          {assigneesOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
              background: "var(--bg2)", border: "1px solid var(--border2)",
              borderRadius: 12, overflow: "hidden",
              boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
            }}>
              {assignableStaff.map((s) => {
                const selected = assignees.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleAssignee(s.id)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "11px 14px",
                      background: selected ? "rgba(59,130,246,0.12)" : "transparent",
                      border: "none", borderBottom: "1px solid var(--border)",
                      color: selected ? "var(--accent2)" : "var(--text)",
                      fontSize: 13, fontWeight: selected ? 600 : 400,
                      cursor: "pointer", textAlign: "left", fontFamily: "Manrope, sans-serif",
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      border: `2px solid ${selected ? "var(--accent)" : "rgba(0,0,0,0.15)"}`,
                      background: selected ? "rgba(59,130,246,0.25)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: selected ? "#3b82f6" : "transparent",
                    }}>
                      {selected && "✓"}
                    </span>
                    {s.name ?? s.email}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setAssigneesOpen(false)}
                style={{
                  width: "100%", padding: "10px 14px",
                  background: "var(--bg3)", border: "none",
                  color: "var(--accent2)", fontSize: 13, fontWeight: 700,
                  cursor: "pointer", fontFamily: "Manrope, sans-serif",
                }}
              >
                ✓ Готово
              </button>
            </div>
          )}
        </div>

        {assigneeError && (
          <div style={{ marginTop: 5, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>⚠ {assigneeError}</div>
        )}

        {assignees.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            {assignees.map((uid) => {
              const s = staff.find((m) => m.id === uid);
              return (
                <span key={uid} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 6px 3px 10px", borderRadius: 14,
                  background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)",
                  color: "var(--accent2)", fontSize: 12, fontWeight: 600,
                }}>
                  {s?.name ?? s?.email ?? uid}
                  <button
                    type="button"
                    onClick={() => toggleAssignee(uid)}
                    style={{
                      background: "transparent", border: "none",
                      color: "rgba(147,197,253,0.7)", cursor: "pointer",
                      fontSize: 15, lineHeight: 1, padding: "0 2px",
                    }}
                  >×</button>
                </span>
              );
            })}
          </div>
        )}
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
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
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
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const isDone  = taskStatus(task) === "done";
  const myDone  = (task.doneBy ?? []).includes(uid);
  const isFreon = task.freonTask === true;

  const STANDARD_FREONS = FREON_BADGES as readonly string[];
  const isCustomFreon  = !!(task.freonType && !STANDARD_FREONS.includes(task.freonType));

  const [freonKg,      setFreonKg]      = useState(task.freonKg ?? "");
  const [freonError,   setFreonError]   = useState("");
  const [showCustom,   setShowCustom]   = useState(false);
  const [customFreon,  setCustomFreon]  = useState(isCustomFreon ? (task.freonType ?? "") : "");
  const [showComment,  setShowComment]  = useState(false);
  const [lightbox,     setLightbox]     = useState<string | null>(null);

  const legacyTask = task as RepairTask & { assignee?: string };
  const assigneeNames = task.assignees?.length
    ? task.assignees.map((uid) => staff.find((s) => s.id === uid)?.name ?? uid).join(", ")
    : legacyTask.assignee ? (staff.find((s) => s.id === legacyTask.assignee)?.name ?? legacyTask.assignee) : "";

  async function patchTask(patch: Partial<RepairTask>) {
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return { ...r, tasks: (r.tasks ?? []).map((t) => t.id === task.id ? { ...t, ...patch } : t) };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  // Syncs freonType to both task-level AND repair-level fields
  async function patchFreonType(freonType: string) {
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return {
        ...r,
        freonType,
        tasks: (r.tasks ?? []).map((t) => t.id === task.id ? { ...t, freonType } : t),
      };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function toggle() {
    if (isAdmin) {
      await patchTask({ status: isDone ? "in_progress" : "done" });
      return;
    }
    const doneBy    = task.doneBy ?? [];
    const newDoneBy = myDone ? doneBy.filter((d) => d !== uid) : [...doneBy, uid];
    const assignees = getAssignees(task);
    const allDone   = assignees.length > 0 && assignees.every((a) => newDoneBy.includes(a));
    await patchTask({ doneBy: newDoneBy, status: allDone ? "done" : "in_progress" });
  }

  async function saveFreon(done: boolean) {
    setFreonError("");
    const kg = parseFloat(freonKg);
    if (done && kg > 0 && !task.freonType) {
      setFreonError("Укажите марку фреона");
      return;
    }
    const patch: Partial<RepairTask> = { freonKg };
    if (done) patch.status = "done";
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return {
        ...r,
        freonAmount: freonKg,
        ...(task.freonType ? { freonType: task.freonType } : {}),
        tasks: (r.tasks ?? []).map((t) => t.id === task.id ? { ...t, ...patch } : t),
      };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function addPhotos(photos: PhotoData[]) {
    await patchTask({ photos: [...(task.photos ?? []), ...photos] });
  }

  async function removePhoto(photoId: string) {
    const photo = (task.photos ?? []).find((p) => p.id === photoId);
    if (photo?.path) await deletePhoto(photo.path);
    await patchTask({ photos: (task.photos ?? []).filter((p) => p.id !== photoId) });
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
              border: `2px solid ${isDone ? "#16a34a" : "rgba(0,0,0,0.15)"}`,
              background: isDone ? "rgba(34,197,94,0.15)" : "transparent",
              color: isDone ? "#16a34a" : "transparent",
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
            <div style={{ display: "flex", gap: 4, marginTop: 7, flexWrap: "wrap", alignItems: "center" }}>
              {FREON_BADGES.map((fr) => {
                const active = task.freonType === fr;
                return (
                  <button
                    key={fr}
                    type="button"
                    onClick={() => { setShowCustom(false); void patchFreonType(fr); }}
                    style={{
                      padding: "2px 9px", borderRadius: 6,
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${active ? "#0891b2" : "var(--border)"}`,
                      background: active ? "rgba(6,182,212,0.2)" : "transparent",
                      color: active ? "#0891b2" : "var(--text3)",
                    }}
                  >
                    {fr}
                  </button>
                );
              })}
              {/* Custom freon badge */}
              <button
                type="button"
                onClick={() => {
                  setCustomFreon(isCustomFreon ? (task.freonType ?? "") : "");
                  setShowCustom(true);
                }}
                style={{
                  padding: "2px 9px", borderRadius: 6,
                  fontSize: 10, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${isCustomFreon ? "#0891b2" : "var(--border)"}`,
                  background: isCustomFreon ? "rgba(6,182,212,0.2)" : "transparent",
                  color: isCustomFreon ? "#0891b2" : "var(--text3)",
                }}
              >
                Др.
              </button>
              {/* Custom freon text input */}
              {(showCustom || isCustomFreon) && (
                <input
                  type="text"
                  placeholder="Тип фреона..."
                  value={customFreon}
                  onChange={(e) => setCustomFreon(e.target.value)}
                  onBlur={() => {
                    const val = customFreon.trim();
                    if (val) {
                      void patchFreonType(val);
                      setShowCustom(false);
                    } else {
                      setShowCustom(false);
                    }
                  }}
                  autoFocus={showCustom && !isCustomFreon}
                  style={{
                    width: 110, padding: "1px 8px", borderRadius: 6,
                    fontSize: 10, fontWeight: 700,
                    background: "rgba(6,182,212,0.08)",
                    border: "1px solid rgba(6,182,212,0.4)",
                    color: "#0891b2", outline: "none",
                  }}
                />
              )}
            </div>
          )}

          {/* Freon kg input */}
          {isFreon && !isDone && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#0e7490", fontWeight: 600 }}>кг:</span>
                <Input
                  type="number" step="0.1" placeholder="0.0"
                  value={freonKg}
                  onChange={(e) => { setFreonKg(e.target.value); setFreonError(""); }}
                  onBlur={() => void saveFreon(false)}
                  style={{ width: 100 }}
                  className="!min-h-0 !py-1 !px-2 !text-sm flex-shrink-0"
                />
                <button type="button" onClick={() => void saveFreon(false)} style={{ fontSize: 11, color: "#0e7490", background: "transparent", border: "1px solid rgba(6,182,212,0.3)", padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}>
                  💾
                </button>
                <button type="button" onClick={() => void saveFreon(true)} style={{ fontSize: 11, color: "white", background: "#16a34a", border: "none", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
                  ✓ Готово
                </button>
              </div>
              {freonError && (
                <div style={{ marginTop: 4, fontSize: 10, color: "#dc2626", fontWeight: 600 }}>
                  ⚠ {freonError}
                </div>
              )}
            </div>
          )}

          {/* Done freon — show kg + reopen button */}
          {isFreon && isDone && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {task.freonKg && (
                <span style={{ fontSize: 11, color: "#0e7490" }}>
                  ❄️ Заправлено: <strong>{task.freonKg} кг</strong>
                  {task.freonType && <span> ({task.freonType})</span>}
                </span>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void patchTask({ status: "in_progress", doneBy: [] })}
                  title="Вернуть задачу в работу"
                  style={{
                    padding: "2px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
                    color: "#b45309", cursor: "pointer",
                  }}
                >
                  ↩ Вернуть
                </button>
              )}
            </div>
          )}

          {/* Work comment */}
          {task.workComment && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, padding: "4px 8px" }}>
              <span style={{ color: "#6d28d9", fontWeight: 600 }}>📝 </span>{task.workComment}
            </div>
          )}

          <PhotoGrid photos={task.photos ?? []} onRemove={(id) => void removePhoto(id)} onView={setLightbox} />

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
                <button type="button" onClick={() => void handleDelete()} style={{ fontSize: 11, color: "#dc2626", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", padding: "3px 9px", borderRadius: 6, cursor: "pointer" }}>
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

function RepairGroup({ client, repair, tasks, canAdd, onOpenClient }: {
  client:        Client;
  repair:        Repair;
  tasks:         RepairTask[];
  canAdd:        boolean;
  onOpenClient?: (client: Client) => void;
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 10px" }}>

        {/* Vehicle photo or colored avatar with car icon */}
        {vehicle?.photo ? (
          <img
            src={vehicle.photo}
            alt=""
            style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
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
      {tasks.length > 0 && (
        <div style={{ padding: "0 12px 6px" }}>
          {tasks.map((t) => <RepairTaskRow key={t.id} task={t} client={client} repair={repair} />)}
        </div>
      )}

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

      {showAdd && <AddRepairTaskModal client={client} repair={repair} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function MyTasksTab({ onOpenClient }: { onOpenClient?: (client: Client) => void } = {}) {
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
