import { useEffect, useRef, useState } from "react";
import { useData } from "../context/DataContext";
import { useAuth } from "../../features/auth";
import { taskStatus, getAssignees } from "../utils/repair";
import { genId } from "../utils/format";
import { deletePhoto, deletePhotoObjects } from "../utils/photos";
import type { PhotoData } from "../utils/photos";
import { assertFieldsUnchanged, findEntityIndex } from "../firebase/concurrency";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input, Textarea, FormGroup } from "../ui/Input";
import { PhotoGrid, DualPhotoButton } from "../ui/PhotoUploader";
import { CreatorLine } from "../ui/CreatorLine";
import type { Repair, RepairTask } from "../types/client";
import type { RepairEditor } from "./editor";

export const FREON_BADGES = ["R134a", "R404A", "R410A", "R507", "R22"] as const;

// ─── Lightbox ────────────────────────────────────────────────────────────────

export function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 cursor-pointer"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-w-[95%] max-h-[90%] object-contain rounded-xl" />
    </div>
  );
}

// ─── Work-comment modal ──────────────────────────────────────────────────────

export function WorkCommentModal({ current, onSave, onClose }: {
  current?: string;
  onSave: (comment: string) => Promise<void>;
  onClose: () => void;
}) {
  const [comment, setComment] = useState(current ?? "");
  const [saving, setSaving] = useState(false);

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

// ─── Add repair task modal ───────────────────────────────────────────────────

export function AddRepairTaskModal({ editor, repairFreonType, onClose }: {
  editor: RepairEditor;
  repairFreonType?: string;
  onClose: () => void;
}) {
  const { staff } = useData();
  const { myProfile, user } = useAuth();
  const [desc, setDesc] = useState("");
  const [assignees, setAssignees] = useState<string[]>(myProfile?.id ? [myProfile.id] : []);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [assigneeError, setAssigneeError] = useState("");
  const [isFreon, setIsFreon] = useState(false);
  const [freonType, setFreonType] = useState(repairFreonType ?? "");
  const [saving, setSaving] = useState(false);
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
    setAssignees((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  async function handleSave() {
    if (!desc.trim() && !isFreon) return;
    if (assignees.length === 0) {
      setAssigneeError("Выберите хотя бы одного исполнителя");
      return;
    }
    setSaving(true);
    const newTask: RepairTask = {
      id: genId(),
      description: isFreon ? `Заправка фреоном ${freonType || ""}`.trim() : desc.trim(),
      assignees,
      doneBy: [],
      status: "in_progress",
      freonTask: isFreon,
      freonKg: "",
      photos: [],
      createdBy: user?.uid ?? "",
      createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
      createdAt: new Date().toISOString(),
    };
    await editor.addTask(newTask);
    onClose();
  }

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
              {staff.map((s) => {
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

// ─── Task row ────────────────────────────────────────────────────────────────

function RepairTaskRow({ task, repair, editor, canManageTasks }: {
  task: RepairTask;
  repair: Repair;
  editor: RepairEditor;
  canManageTasks: boolean;
}) {
  const { myProfile } = useAuth();
  const { staff } = useData();
  const uid = myProfile?.id ?? "";
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "owner" || role === "admin" || role === "manager";
  const isDone = taskStatus(task) === "done";
  const isFreon = task.freonTask === true;

  const STANDARD_FREONS = FREON_BADGES as readonly string[];
  const isCustomFreon = !!(task.freonType && !STANDARD_FREONS.includes(task.freonType));

  const [freonKg, setFreonKg] = useState(task.freonKg ?? "");
  const [freonError, setFreonError] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [customFreon, setCustomFreon] = useState(isCustomFreon ? (task.freonType ?? "") : "");
  const [showComment, setShowComment] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const legacyTask = task as RepairTask & { assignee?: string };
  const assigneeNames = task.assignees?.length
    ? task.assignees.map((u) => staff.find((s) => s.id === u)?.name ?? u).join(", ")
    : legacyTask.assignee ? (staff.find((s) => s.id === legacyTask.assignee)?.name ?? legacyTask.assignee) : "";

  async function patchTask(patch: Partial<RepairTask>) {
    await editor.mutateTask(task, (current) => {
      assertFieldsUnchanged(current, task, Object.keys(patch) as (keyof RepairTask)[], "Задача ремонта");
      return { ...current, ...patch };
    });
  }

  async function patchFreonType(freonType: string) {
    await editor.mutateRepair((currentRepair) => {
      const tasks = [...(currentRepair.tasks ?? [])];
      const index = findEntityIndex(tasks, task, "repair task");
      assertFieldsUnchanged(currentRepair, repair, ["freonType"], "Ремонт");
      assertFieldsUnchanged(tasks[index], task, ["freonType"], "Задача ремонта");
      return {
        ...currentRepair,
        freonType,
        tasks: tasks.map((current, currentIndex) => (currentIndex === index ? { ...current, freonType } : current)),
      };
    });
  }

  async function toggle() {
    if (isAdmin) {
      await patchTask({ status: isDone ? "in_progress" : "done" });
      return;
    }
    await editor.mutateTask(task, (current) => {
      const doneBy = current.doneBy ?? [];
      const newDoneBy = doneBy.includes(uid) ? doneBy.filter((id) => id !== uid) : [...doneBy, uid];
      const assignees = getAssignees(current);
      const allDone = assignees.length > 0 && assignees.every((id) => newDoneBy.includes(id));
      return { ...current, doneBy: newDoneBy, status: allDone ? "done" : "in_progress" };
    });
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
    await editor.mutateRepair((currentRepair) => {
      const tasks = [...(currentRepair.tasks ?? [])];
      const index = findEntityIndex(tasks, task, "repair task");
      assertFieldsUnchanged(currentRepair, repair, ["freonAmount", "freonType"], "Ремонт");
      assertFieldsUnchanged(tasks[index], task, ["freonKg", "status"], "Задача ремонта");
      return {
        ...currentRepair,
        freonAmount: freonKg,
        ...(task.freonType ? { freonType: task.freonType } : {}),
        tasks: tasks.map((current, currentIndex) => (currentIndex === index ? { ...current, ...patch } : current)),
      };
    });
  }

  async function addPhotos(photos: PhotoData[]) {
    await editor.mutateTask(task, (current) => ({ ...current, photos: [...(current.photos ?? []), ...photos] }));
  }

  async function removePhoto(photoId: string) {
    const photo = (task.photos ?? []).find((p) => p.id === photoId);
    if (photo?.path) await deletePhoto(photo.path);
    await editor.mutateTask(task, (current) => ({
      ...current,
      photos: (current.photos ?? []).filter((item) => item.id !== photoId),
    }));
  }

  async function handleDelete() {
    if (!canManageTasks || !confirm("Удалить задачу?")) return;
    await editor.removeTask(task);
    void deletePhotoObjects(task.photos);
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

          <CreatorLine name={task.createdByName} date={task.createdAt} style={{ marginTop: 2 }} />

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
              {(showCustom || isCustomFreon) && (
                <input
                  type="text"
                  placeholder="Тип фреона..."
                  value={customFreon}
                  onChange={(e) => setCustomFreon(e.target.value)}
                  onBlur={() => {
                    const val = customFreon.trim();
                    if (val) { void patchFreonType(val); setShowCustom(false); }
                    else setShowCustom(false);
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

          {isFreon && isDone && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              {task.freonKg && (
                <span style={{ fontSize: 11, color: "#0e7490" }}>
                  ❄️ Заправлено: <strong>{task.freonKg} кг</strong>
                  {task.freonType && <span> ({task.freonType})</span>}
                </span>
              )}
              {canManageTasks && (
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

          {task.workComment && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 6, padding: "4px 8px" }}>
              <span style={{ color: "#6d28d9", fontWeight: 600 }}>📝 </span>{task.workComment}
            </div>
          )}

          <PhotoGrid photos={task.photos ?? []} onRemove={(id) => void removePhoto(id)} onView={setLightbox} />

          {!isDone && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {!isFreon && (
                <button type="button" onClick={() => setShowComment(true)} style={{ fontSize: 11, color: "var(--text2)", background: "var(--bg2)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: 6, cursor: "pointer" }}>
                  📝 {task.workComment ? "Изменить" : "Отчёт"}
                </button>
              )}
              <DualPhotoButton onUploaded={addPhotos} />
              {canManageTasks && (
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

// ─── Public list component ───────────────────────────────────────────────────

/** The editable task list shared by the client-repair and intake screens. */
export function RepairTaskWork({ repair, tasks, editor, canManageTasks }: {
  repair: Repair;
  /** Tasks to show — the caller filters (e.g. mechanics see only their own). */
  tasks: RepairTask[];
  editor: RepairEditor;
  canManageTasks: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div style={{ padding: "0 12px 6px" }}>
      {tasks.map((t) => (
        <RepairTaskRow key={t.id} task={t} repair={repair} editor={editor} canManageTasks={canManageTasks} />
      ))}
    </div>
  );
}
