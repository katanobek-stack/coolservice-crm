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
  admin:    { bg: "rgba(245,158,11,0.15)", text: "#fbbf24" },
  manager:  { bg: "rgba(59,130,246,0.15)", text: "var(--accent2)" },
  mechanic: { bg: "rgba(34,197,94,0.15)",  text: "#4ade80" },
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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* KPI */}
      <div className="kpi-grid" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        {(["admin", "manager", "mechanic"] as StaffRole[]).map((r) => {
          const count = staff.filter((s) => s.role === r).length;
          const c     = ROLE_COLORS[r];
          const icons: Record<StaffRole, string> = { admin: "ti-shield", manager: "ti-user-star", mechanic: "ti-tools" };
          return (
            <div key={r} className="kpi-card" style={{ borderTop: `2px solid ${c.text}` }}>
              <i className={`ti ${icons[r]} kpi-icon`} />
              <div className="kpi-label">{ROLE_LABELS[r]}</div>
              <div className="kpi-value" style={{ color: c.text }}>{count}</div>
            </div>
          );
        })}
      </div>

      {/* Staff list */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.2s both" }}>
        <div className="section-header">
          <i className="ti ti-users" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Сотрудники</span>
          <span className="section-count">{staff.length} чел.</span>
        </div>

        {sorted.length === 0 ? (
          <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет сотрудников
          </div>
        ) : (
          <div style={{ padding: "8px 12px 12px" }}>
            {sorted.map((s) => (
              <StaffCard key={s.id} member={s} canEdit={isAdmin} onClick={() => setEditing(s)} />
            ))}
          </div>
        )}

        {!isAdmin && (
          <div style={{ padding: "8px 16px 12px", textAlign: "center", fontSize: 11, color: "var(--text3)" }}>
            Только администратор может менять роли
          </div>
        )}
      </div>

      {editing && <EditStaffModal member={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
