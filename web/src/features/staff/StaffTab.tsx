import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Select, FormGroup } from "../../shared/ui/Input";
import { saveStaffProfile, saveStaffPermissions } from "../../shared/firebase/firestore";
import type { StaffMember, StaffRole, StaffPermissions } from "../../shared/types/staff";

const ROLE_LABELS: Record<StaffRole, string> = {
  owner:    "Владелец",
  admin:    "Администратор",
  manager:  "Менеджер",
  mechanic: "Механик",
};

const ROLE_COLORS: Record<StaffRole, { bg: string; text: string }> = {
  owner:    { bg: "rgba(239,68,68,0.15)",   text: "#dc2626" },
  admin:    { bg: "rgba(245,158,11,0.15)",  text: "#b45309" },
  manager:  { bg: "rgba(59,130,246,0.15)",  text: "var(--accent2)" },
  mechanic: { bg: "rgba(34,197,94,0.15)",   text: "#16a34a" },
};

const ROLE_ORDER: Record<StaffRole, number> = {
  owner: 0, admin: 1, manager: 2, mechanic: 3,
};

// ─── Edit staff modal ─────────────────────────────────────────────────────────

function EditStaffModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const [name,   setName]   = useState(member.name ?? "");
  const [role,   setRole]   = useState<Exclude<StaffRole, "owner">>(
    (member.role === "owner" ? "admin" : (member.role ?? "mechanic")) as Exclude<StaffRole, "owner">,
  );
  const [saving, setSaving] = useState(false);

  const isEditingOwner = member.role === "owner";

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    // Preserve owner role — never overwrite it from client
    const roleToSave: StaffRole = isEditingOwner ? "owner" : role;
    await saveStaffProfile(member.id, { name: name.trim(), role: roleToSave, email: member.email ?? "" });
    onClose();
  }

  return (
    <Modal title="Редактировать сотрудника" onClose={onClose}>
      <div className="text-xs text-[#98A2B3] mb-3">{member.email}</div>
      <FormGroup label="Имя">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иван Иванов" />
      </FormGroup>
      <FormGroup label="Роль">
        {isEditingOwner ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          }}>
            <span style={{ fontSize: 16 }}>👑</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#dc2626" }}>Владелец</span>
            <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>системная роль</span>
          </div>
        ) : (
          <Select value={role} onChange={(e) => setRole(e.target.value as Exclude<StaffRole, "owner">)}>
            <option value="admin">Администратор</option>
            <option value="manager">Менеджер</option>
            <option value="mechanic">Механик</option>
          </Select>
        )}
      </FormGroup>
      {!isEditingOwner && (
        <div className="bg-[#FAEEDA] rounded-xl p-3 border border-[#BA7517]/20 mb-3 text-xs text-[#BA7517]">
          ⚠️ Смена роли вступит в силу при следующем входе сотрудника в систему.
        </div>
      )}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </Button>
    </Modal>
  );
}

// ─── Permission toggle (owner-only section on admin cards) ────────────────────

const PERM_DEFS: Array<{ key: keyof StaffPermissions; icon: string; label: string; desc: string }> = [
  { key: "dashboard_financials", icon: "📊", label: "Финансы дашборда",  desc: "Суммы, график детально, карточки выручки" },
  { key: "reports_amounts",      icon: "📋", label: "Суммы в отчётах",   desc: "Итоговые суммы по заявкам" },
  { key: "pl_panel",             icon: "💼", label: "P&L панель",         desc: "Полный доступ к разделу P&L" },
];

function PermissionToggles({ member }: { member: StaffMember }) {
  const perms = member.permissions ?? {};
  const [saving, setSaving] = useState<keyof StaffPermissions | null>(null);

  async function toggle(key: keyof StaffPermissions) {
    const current: StaffPermissions = {
      dashboard_financials: perms.dashboard_financials !== false,
      reports_amounts:      perms.reports_amounts      !== false,
      pl_panel:             perms.pl_panel             !== false,
    };
    setSaving(key);
    await saveStaffPermissions(member.id, { ...current, [key]: !current[key] });
    setSaving(null);
  }

  return (
    <div
      style={{
        marginTop: 12, paddingTop: 12, borderTop: "1px solid #E8F0FE",
        background: "rgba(59,130,246,0.03)", borderRadius: "0 0 16px 16px",
        margin: "12px -16px -16px", padding: "12px 16px 14px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "#98A2B3", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
        🔒 Доступ к данным
      </div>
      {PERM_DEFS.map(({ key, icon, label, desc }) => {
        const enabled = perms[key] !== false;
        const isSaving = saving === key;
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            {/* Toggle switch */}
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void toggle(key)}
              style={{
                width: 38, height: 22, borderRadius: 11, flexShrink: 0,
                background: enabled ? "#3b82f6" : "#D0D5DD",
                border: "none", cursor: isSaving ? "not-allowed" : "pointer",
                position: "relative", transition: "background 0.2s",
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              <span style={{
                position: "absolute", top: 3, left: enabled ? 19 : 3,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: enabled ? "#172033" : "#98A2B3" }}>
                {icon} {label}
              </div>
              <div style={{ fontSize: 11, color: "#98A2B3", marginTop: 1 }}>{desc}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Staff card ───────────────────────────────────────────────────────────────

function StaffCard({ member, canEdit, isOwner, onClick }: {
  member: StaffMember; canEdit: boolean; isOwner: boolean; onClick: () => void;
}) {
  const role   = member.role ?? "mechanic";
  const colors = ROLE_COLORS[role];
  const showPerms = isOwner && role === "admin";

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

      {showPerms && <PermissionToggles member={member} />}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function StaffTab() {
  const { staff } = useData();
  const { myProfile, isOwner } = useAuth();
  const role    = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "owner";

  const [editing, setEditing] = useState<StaffMember | null>(null);

  const sorted = [...staff].sort((a, b) => {
    return (ROLE_ORDER[a.role ?? "mechanic"] ?? 3) - (ROLE_ORDER[b.role ?? "mechanic"] ?? 3);
  });

  function canEditMember(member: StaffMember): boolean {
    if (!isAdmin) return false;
    if (member.role === "owner") return isOwner;
    return true;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* KPI */}
      <div className="kpi-grid" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        {(["owner", "admin", "manager", "mechanic"] as StaffRole[]).map((r) => {
          const count = staff.filter((s) => s.role === r).length;
          if (r === "owner" && count === 0) return null;
          const c     = ROLE_COLORS[r];
          const icons: Record<StaffRole, string> = {
            owner:    "ti-crown",
            admin:    "ti-shield",
            manager:  "ti-user-star",
            mechanic: "ti-tools",
          };
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
              <StaffCard
                key={s.id}
                member={s}
                canEdit={canEditMember(s)}
                isOwner={isOwner}
                onClick={() => setEditing(s)}
              />
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
