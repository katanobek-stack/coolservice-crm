import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees } from "../../shared/utils/repair";
import { fmtDate, genId } from "../../shared/utils/format";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { updateClientArray, addServiceTask, updateServiceTask, deleteServiceTask } from "../../shared/firebase/firestore";
import type { ServiceTask } from "../../shared/types/task";
import type { RepairTask, Repair, Client } from "../../shared/types/client";

function SectionTitle({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2 px-0.5">
      <span className="w-0.5 h-3.5 rounded-full bg-gradient-to-b from-[#185FA5] to-[#7CB7EA] flex-shrink-0" />
      <span className="text-xs font-bold text-[#667085] uppercase tracking-wider">{text}</span>
    </div>
  );
}

// ─── Add service task modal ──────────────────────────────────────────────────

function AddServiceTaskModal({ onClose }: { onClose: () => void }) {
  const { staff } = useData();
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desc.trim()) return;
    setSaving(true);
    await addServiceTask({
      description: desc.trim(),
      assignees: assignee ? [assignee] : [],
      doneBy: [],
      status: "in_progress",
    });
    onClose();
  }

  return (
    <Modal title="Новая задача" onClose={onClose}>
      <FormGroup label="Описание">
        <Textarea
          placeholder="Что нужно сделать..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </FormGroup>
      <FormGroup label="Назначить">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">— не назначена —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name ?? s.email}</option>
          ))}
        </Select>
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Создать задачу"}
      </Button>
    </Modal>
  );
}

// ─── Add repair task modal ───────────────────────────────────────────────────

function AddRepairTaskModal({
  client,
  repair,
  onClose,
}: {
  client: Client;
  repair: Repair;
  onClose: () => void;
}) {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState(myProfile?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!desc.trim()) return;
    setSaving(true);
    const newTask: RepairTask = {
      id: genId(),
      description: desc.trim(),
      assignees: assignee ? [assignee] : [],
      doneBy: [],
      status: "in_progress",
    };
    const repairs = (client.repairs ?? []).map((r) =>
      r.id === repair.id ? { ...r, tasks: [...(r.tasks ?? []), newTask] } : r,
    );
    await updateClientArray(client.id, "repairs", repairs);
    onClose();
  }

  return (
    <Modal title="Добавить задачу к ремонту" onClose={onClose}>
      <FormGroup label="Задача">
        <Textarea
          placeholder="Что нужно сделать..."
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          autoFocus
        />
      </FormGroup>
      <FormGroup label="Исполнитель">
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">— не назначен —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name ?? s.email}</option>
          ))}
        </Select>
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Добавить задачу"}
      </Button>
    </Modal>
  );
}

// ─── WorkComment modal (отчёт механика) ─────────────────────────────────────

function WorkCommentModal({
  task,
  onSave,
  onClose,
}: {
  task: { id: string; workComment?: string; type: "service" | "repair" };
  onSave: (comment: string) => Promise<void>;
  onClose: () => void;
}) {
  const [comment, setComment] = useState(task.workComment ?? "");
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

// ─── Service task card ───────────────────────────────────────────────────────

function ServiceTaskCard({ task }: { task: ServiceTask }) {
  const { myProfile } = useAuth();
  const { staff } = useData();
  const uid = myProfile?.id ?? "";
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";

  const isDone = task.status === "done";
  const myDone = (task.doneBy ?? []).includes(uid);
  const [showComment, setShowComment] = useState(false);

  const assigneeNames = (task.assignees ?? [])
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    const doneBy = task.doneBy ?? [];
    const newDoneBy = myDone ? doneBy.filter((d) => d !== uid) : [...doneBy, uid];
    const assignees = task.assignees ?? [];
    const allDone = assignees.length > 0 && assignees.every((a) => newDoneBy.includes(a));
    await updateServiceTask(task.id, {
      doneBy: newDoneBy,
      status: allDone ? "done" : "in_progress",
    });
  }

  async function handleDelete() {
    if (!confirm("Удалить задачу?")) return;
    await deleteServiceTask(task.id);
  }

  async function saveComment(comment: string) {
    await updateServiceTask(task.id, { workComment: comment });
  }

  return (
    <div
      className={`bg-white rounded-[18px] border border-l-4 p-4 mb-2.5 shadow-sm transition-opacity ${
        isDone ? "opacity-60" : ""
      }`}
      style={{ borderLeftColor: isDone ? "#3B6D11" : "#185FA5" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-sm font-semibold text-[#172033] flex-1">
          {task.description ?? task.title ?? "—"}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void toggle()}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer transition-all
              ${isDone
                ? "bg-[#EAF3DE] text-[#3B6D11] border-[#3B6D11]/20"
                : "bg-[#FAEEDA] text-[#BA7517] border-[#BA7517]/20"
              }`}
          >
            {isDone ? "✓ Готово" : "● В работе"}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="text-[#98A2B3] hover:text-red-400 cursor-pointer bg-transparent border-none text-base leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {assigneeNames && (
        <div className="text-xs text-[#667085]">👤 {assigneeNames}</div>
      )}

      {task.workComment && (
        <div className="mt-2 text-xs text-[#344054] bg-[#F7F9FC] rounded-lg p-2 border border-[#E2E8F0]">
          <span className="text-purple-400 font-semibold">Отчёт: </span>
          {task.workComment}
        </div>
      )}

      {!isDone && (
        <button
          type="button"
          onClick={() => setShowComment(true)}
          className="mt-2 text-xs text-[#667085] bg-[#F2F4F7] px-2.5 py-1 rounded-lg border border-[#E2E8F0] cursor-pointer"
        >
          📝 {task.workComment ? "Изменить отчёт" : "Добавить отчёт"}
        </button>
      )}

      {showComment && (
        <WorkCommentModal
          task={{ id: task.id, workComment: task.workComment, type: "service" }}
          onSave={saveComment}
          onClose={() => setShowComment(false)}
        />
      )}
    </div>
  );
}

// ─── Repair task row ─────────────────────────────────────────────────────────

function RepairTaskRow({
  task,
  client,
  repair,
}: {
  task: RepairTask;
  client: Client;
  repair: Repair;
}) {
  const { myProfile } = useAuth();
  const { staff } = useData();
  const uid = myProfile?.id ?? "";
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";
  const isDone = taskStatus(task) === "done";
  const myDone = (task.doneBy ?? []).includes(uid);
  const [showComment, setShowComment] = useState(false);

  const assigneeNames = getAssignees(task)
    .map((id) => staff.find((s) => s.id === id)?.name ?? id)
    .join(", ");

  async function toggle() {
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      const tasks = (r.tasks ?? []).map((t) => {
        if (t.id !== task.id) return t;
        const doneBy = t.doneBy ?? [];
        const newDoneBy = myDone ? doneBy.filter((d) => d !== uid) : [...doneBy, uid];
        const assignees = getAssignees(t);
        const allDone = assignees.length > 0 && assignees.every((a) => newDoneBy.includes(a));
        return {
          ...t,
          doneBy: newDoneBy,
          status: (allDone ? "done" : "in_progress") as "done" | "in_progress",
        };
      });
      return { ...r, tasks };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function saveComment(comment: string) {
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      const tasks = (r.tasks ?? []).map((t) =>
        t.id === task.id ? { ...t, workComment: comment } : t,
      );
      return { ...r, tasks };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  async function handleDelete() {
    if (!confirm("Удалить задачу?")) return;
    const repairs = (client.repairs ?? []).map((r) => {
      if (r.id !== repair.id) return r;
      return { ...r, tasks: (r.tasks ?? []).filter((t) => t.id !== task.id) };
    });
    await updateClientArray(client.id, "repairs", repairs);
  }

  return (
    <div
      className={`bg-[#F7F9FC] rounded-xl p-3 mb-1.5 border border-[#E2E8F0] ${
        isDone ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-lg border cursor-pointer text-xs font-bold flex items-center justify-center
            ${isDone
              ? "bg-[#EAF3DE] border-[#3B6D11]/30 text-[#3B6D11]"
              : "bg-[#FAEEDA] border-[#BA7517]/30 text-[#BA7517]"
            }`}
        >
          {isDone ? "✓" : "●"}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[#172033]">{task.description}</div>
          {assigneeNames && (
            <div className="text-xs text-[#667085]">👤 {assigneeNames}</div>
          )}
          {task.workComment && (
            <div className="mt-1 text-xs text-[#344054] bg-white rounded-lg p-1.5 border border-[#E2E8F0]">
              <span className="text-purple-400 font-semibold">Отчёт: </span>
              {task.workComment}
            </div>
          )}
          {!isDone && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setShowComment(true)}
                className="text-xs text-[#667085] bg-white px-2 py-0.5 rounded-lg border border-[#E2E8F0] cursor-pointer"
              >
                📝 {task.workComment ? "Изменить" : "Отчёт"}
              </button>
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
          task={{ id: task.id, workComment: task.workComment, type: "repair" }}
          onSave={saveComment}
          onClose={() => setShowComment(false)}
        />
      )}
    </div>
  );
}

// ─── Repair group ────────────────────────────────────────────────────────────

function RepairGroup({
  client,
  repair,
  tasks,
  canAdd,
}: {
  client: Client;
  repair: Repair;
  tasks: RepairTask[];
  canAdd: boolean;
}) {
  const vehicle = (client.vehicles ?? []).find((v) => v.id === repair.vehicleId);
  const [showAddTask, setShowAddTask] = useState(false);

  return (
    <div className="bg-white rounded-[18px] border border-[#E2E8F0] p-3 mb-2.5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold text-[#172033] flex-1">{client.name}</span>
        {vehicle?.plate && (
          <span className="text-xs bg-[#F2F4F7] text-[#344054] px-2 py-0.5 rounded font-mono">
            {vehicle.plate}
          </span>
        )}
        {repair.date && (
          <span className="text-xs text-[#98A2B3]">{fmtDate(repair.date)}</span>
        )}
      </div>

      {tasks.map((t) => (
        <RepairTaskRow key={t.id} task={t} client={client} repair={repair} />
      ))}

      {canAdd && (
        <button
          type="button"
          onClick={() => setShowAddTask(true)}
          className="mt-1.5 w-full text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold"
        >
          + Задача
        </button>
      )}

      {showAddTask && (
        <AddRepairTaskModal
          client={client}
          repair={repair}
          onClose={() => setShowAddTask(false)}
        />
      )}
    </div>
  );
}

// ─── Main tab ────────────────────────────────────────────────────────────────

export function MyTasksTab() {
  const { clients, tasks } = useData();
  const { myProfile } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const uid = myProfile?.id ?? "";
  const role = myProfile?.role ?? "mechanic";
  const isManagerOrAdmin = role === "admin" || role === "manager";

  // Standalone service tasks
  const activeSvcTasks = tasks.filter((t) => {
    if (t.status === "done") return false;
    return isManagerOrAdmin ? true : (t.assignees ?? []).includes(uid);
  });
  const myTasks = activeSvcTasks.filter((t) => (t.assignees ?? []).includes(uid));
  const otherTasks = activeSvcTasks.filter((t) => !(t.assignees ?? []).includes(uid));

  // Repair tasks — group by repair
  interface RepairGroupData {
    client: Client;
    repair: Repair;
    tasks: RepairTask[];
  }
  const repairGroups: RepairGroupData[] = [];
  clients.forEach((c) => {
    (c.repairs ?? []).forEach((r) => {
      if (repairStatus(r) !== "in_progress") return;
      const allActive = (r.tasks ?? []).filter((t) => taskStatus(t) !== "done");
      if (!allActive.length && !isManagerOrAdmin) return;
      // Show group if admin/manager (to allow adding tasks), or if mechanic has tasks
      const visible = isManagerOrAdmin
        ? allActive
        : allActive.filter((t) => getAssignees(t).includes(uid));
      if (!visible.length && !isManagerOrAdmin) return;
      repairGroups.push({ client: c, repair: r, tasks: visible });
    });
  });

  const hasAnything = myTasks.length || otherTasks.length || repairGroups.length;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-lg font-bold text-[#172033]">Заявки</div>
        {isManagerOrAdmin && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold"
          >
            + Задача
          </button>
        )}
      </div>

      {!hasAnything && (
        <div className="text-center py-12 text-[#98A2B3] text-sm">
          Нет активных задач
        </div>
      )}

      {myTasks.length > 0 && (
        <>
          <SectionTitle text={`Мои задачи (${myTasks.length})`} />
          {myTasks.map((t) => <ServiceTaskCard key={t.id} task={t} />)}
        </>
      )}

      {otherTasks.length > 0 && (
        <>
          <SectionTitle text={`Задачи сотрудников (${otherTasks.length})`} />
          {otherTasks.map((t) => <ServiceTaskCard key={t.id} task={t} />)}
        </>
      )}

      {repairGroups.length > 0 && (
        <>
          <SectionTitle
            text={`Ремонты в работе (${repairGroups.length})`}
          />
          {repairGroups.map(({ client, repair, tasks: ts }) => (
            <RepairGroup
              key={`${client.id}-${repair.id}`}
              client={client}
              repair={repair}
              tasks={ts}
              canAdd={isManagerOrAdmin}
            />
          ))}
        </>
      )}

      {showAdd && <AddServiceTaskModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
