import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Select, FormGroup } from "../../shared/ui/Input";
import { saveStaffProfile } from "../../shared/firebase/firestore";
import type { StaffMember, StaffRole } from "../../shared/types/staff";

const ROLE_LABELS: Record<StaffRole, string> = {
  admin:    "Администратор",
  manager:  "Менеджер",
  mechanic: "Механик",
};

const ROLE_COLORS: Record<StaffRole, { bg: string; text: string }> = {
  admin:    { bg: "#FAEEDA", text: "#854F0B" },
  manager:  { bg: "#E6F1FB", text: "#185FA5" },
  mechanic: { bg: "#EAF3DE", text: "#3B6D11" },
};

// ─── Edit staff modal ─────────────────────────────────────────────────────────

function EditStaffModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const [name,   setName]   = useState(member.name ?? "");
  const [role,   setRole]   = useState<StaffRole>(member.role ?? "mechanic");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await saveStaffProfile(member.id, { name: name.trim(), role, email: member.email ?? "" });
    onClose();
  }

  return (
    <Modal title="Редактировать сотрудника" onClose={onClose}>
      <div className="text-xs text-[#98A2B3] mb-3">{member.email}</div>
      <FormGroup label="Имя">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" />
      </FormGroup>
      <FormGroup label="Роль">
        <Select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          <option value="admin">Администратор</option>
          <option value="manager">Менеджер</option>
          <option value="mechanic">Механик</option>
        </Select>
      </FormGroup>
      <div className="bg-[#FAEEDA] rounded-xl p-3 border border-[#BA7517]/20 mb-3 text-xs text-[#BA7517]">
        ⚠️ Смена роли вступит в силу при следующем входе сотрудника в систему.
      </div>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </Button>
    </Modal>
  );
}

// ─── Staff card ───────────────────────────────────────────────────────────────

function StaffCard({ member, canEdit, onClick }: {
  member: StaffMember; canEdit: boolean; onClick: () => void;
}) {
  const role   = member.role ?? "mechanic";
  const colors = ROLE_COLORS[role];

  return (
    <div
      className={`bg-white rounded-[18px] border border-[#E2E8F0] p-4 mb-2.5 shadow-sm transition-all ${canEdit ? "cursor-pointer active:scale-[.99]" : ""}`}
      onClick={canEdit ? onClick : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold flex-shrink-0"
          style={{ background: colors.bg, color: colors.text }}
        >
          {(member.name ?? member.email ?? "?").charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[#172033]">{member.name ?? "(без имени)"}</div>
          <div className="text-xs text-[#667085] truncate">{member.email}</div>
        </div>

        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{ background: colors.bg, color: colors.text }}
        >
          {ROLE_LABELS[role]}
        </span>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StaffTab() {
  const { staff } = useData();
  const { myProfile } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin";

  const [editing, setEditing] = useState<StaffMember | null>(null);

  const sorted = [...staff].sort((a, b) => {
    const order: Record<StaffRole, number> = { admin: 0, manager: 1, mechanic: 2 };
    return (order[a.role ?? "mechanic"] ?? 2) - (order[b.role ?? "mechanic"] ?? 2);
  });

  return (
    <div className="p-4">
      <div className="text-lg font-bold text-[#172033] mb-1">Персонал</div>
      <div className="text-xs text-[#667085] mb-4">{staff.length} сотрудников</div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(["admin", "manager", "mechanic"] as StaffRole[]).map((r) => {
          const count = staff.filter((s) => s.role === r).length;
          const c     = ROLE_COLORS[r];
          return (
            <div key={r} className="bg-white rounded-xl p-2.5 border border-[#E2E8F0] text-center">
              <div className="text-lg font-bold" style={{ color: c.text }}>{count}</div>
              <div className="text-[10px] text-[#667085]">{ROLE_LABELS[r].split("и")[0]}</div>
            </div>
          );
        })}
      </div>

      {sorted.map((s) => (
        <StaffCard
          key={s.id}
          member={s}
          canEdit={isAdmin}
          onClick={() => setEditing(s)}
        />
      ))}

      {!isAdmin && (
        <div className="text-center text-xs text-[#98A2B3] mt-4">
          Только администратор может менять роли
        </div>
      )}

      {editing && (
        <EditStaffModal member={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
