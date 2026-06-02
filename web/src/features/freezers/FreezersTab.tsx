import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { addFreezer, updateFreezer, deleteFreezer } from "../../shared/firebase/firestore";
import { fmtDate } from "../../shared/utils/format";
import { FREEZER_TYPES } from "../../shared/types/freezer";
import type { Freezer, RentHistoryEntry } from "../../shared/types/freezer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRented(f: Freezer): boolean {
  if (f.rented === true) return true;
  if (f.status === "rented") return true;
  return false;
}

function getRentAmount(f: Freezer): number {
  return parseFloat(String(f.rentAmount ?? 0)) || 0;
}

// ─── Info cell ────────────────────────────────────────────────────────────────

function InfoCell({ label, value, color = "var(--text)" }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.5px", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color }}>{value || "—"}</div>
    </div>
  );
}

// ─── Add/Edit freezer modal ───────────────────────────────────────────────────

function FreezerFormModal({ freezer, onClose }: { freezer?: Freezer; onClose: () => void }) {
  const isEdit = !!freezer;
  const [type,     setType]     = useState(freezer?.type   ?? FREEZER_TYPES[1]);
  const [name,     setName]     = useState(freezer?.name   ?? "");
  const [volume,   setVolume]   = useState(String(freezer?.volume ?? ""));
  const [location, setLocation] = useState(freezer?.location ?? "");
  const [temp,     setTemp]     = useState(freezer?.temp   ?? "");
  const [notes,    setNotes]    = useState(freezer?.notes  ?? "");
  const [saving,   setSaving]   = useState(false);

  async function handleSave() {
    setSaving(true);
    const data: Partial<Freezer> = {
      type,
      name:     name.trim()     || undefined,
      volume:   parseFloat(volume) || undefined,
      location: location.trim() || undefined,
      temp:     temp.trim()     || undefined,
      notes:    notes.trim()    || undefined,
    };
    if (isEdit && freezer) {
      await updateFreezer(freezer.id, data);
    } else {
      await addFreezer({ ...data, rented: false, rentHistory: [] } as Omit<Freezer, "id" | "createdAt">);
    }
    onClose();
  }

  return (
    <Modal title={isEdit ? "Редактировать камеру" : "Добавить камеру"} onClose={onClose}>
      <FormGroup label="Тип оборудования">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {FREEZER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </FormGroup>
      <FormGroup label="Название (необязательно)">
        <Input placeholder="Камера №1" value={name} onChange={(e) => setName(e.target.value)} />
      </FormGroup>
      <div className="grid grid-cols-2 gap-2">
        <FormGroup label="Объём (м³)">
          <Input type="number" step="0.1" placeholder="20" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </FormGroup>
        <FormGroup label="Темп-ра">
          <Input placeholder="-18°C" value={temp} onChange={(e) => setTemp(e.target.value)} />
        </FormGroup>
      </div>
      <FormGroup label="Адрес / расположение">
        <Input placeholder="ул. Ленина, 1" value={location} onChange={(e) => setLocation(e.target.value)} />
      </FormGroup>
      <FormGroup label="Заметки">
        <Textarea placeholder="..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "..." : isEdit ? "Сохранить" : "Добавить камеру"}
      </Button>
    </Modal>
  );
}

// ─── Start rent modal ─────────────────────────────────────────────────────────

function StartRentModal({ freezer, onClose }: { freezer: Freezer; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [tenant,    setTenant]    = useState("");
  const [amount,    setAmount]    = useState("");
  const [from,      setFrom]      = useState(today);
  const [paidUntil, setPaidUntil] = useState("");
  const [meter,     setMeter]     = useState("");
  const [saving,    setSaving]    = useState(false);

  async function handleSave() {
    if (!tenant.trim() || !amount) return;
    setSaving(true);
    await updateFreezer(freezer.id, {
      rented:      true,
      tenant:      tenant.trim(),
      rentAmount:  parseFloat(amount),
      rentFrom:    from,
      paidUntil:   paidUntil || undefined,
      meterStart:  meter ? parseFloat(meter) : null,
      meterCurrent: meter ? parseFloat(meter) : null,
      status:      "rented",
    });
    onClose();
  }

  return (
    <Modal title="Сдать в аренду" onClose={onClose}>
      <FormGroup label="Арендатор">
        <Input placeholder="ООО «Ромашка»" value={tenant} onChange={(e) => setTenant(e.target.value)} />
      </FormGroup>
      <FormGroup label="Оплата (₽/мес)">
        <Input type="number" placeholder="5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormGroup>
      <div className="grid grid-cols-2 gap-2">
        <FormGroup label="С даты">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormGroup>
        <FormGroup label="Оплачено до">
          <Input type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
        </FormGroup>
      </div>
      <FormGroup label="Нач. показания счётчика (кВт·ч)">
        <Input type="number" step="0.1" placeholder="0.0" value={meter} onChange={(e) => setMeter(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "..." : "Сдать в аренду"}
      </Button>
    </Modal>
  );
}

// ─── Freezer detail modal ─────────────────────────────────────────────────────

function FreezerDetail({ freezer, onClose }: { freezer: Freezer; onClose: () => void }) {
  const { finance } = useData();
  const { myProfile } = useAuth();
  const isAdmin   = (myProfile?.role ?? "mechanic") !== "mechanic";
  const rented    = isRented(freezer);
  const rentAmt   = getRentAmount(freezer);
  const [showEdit,    setShowEdit]    = useState(false);
  const [showRent,    setShowRent]    = useState(false);
  const [meterInput,  setMeterInput]  = useState(String(freezer.meterCurrent ?? ""));
  const [savingMeter, setSavingMeter] = useState(false);

  // Electricity calculation
  const kwPrice = parseFloat(String((finance as Record<string, unknown>).kwPrice ?? 0)) || 0;
  const meterUsed = (freezer.meterCurrent != null && freezer.meterStart != null)
    ? Math.max(0, Number(freezer.meterCurrent) - Number(freezer.meterStart))
    : null;
  const elecCost = meterUsed != null && kwPrice > 0 ? Math.round(meterUsed * kwPrice) : null;

  async function saveMeter() {
    const val = parseFloat(meterInput);
    if (isNaN(val)) return;
    setSavingMeter(true);
    await updateFreezer(freezer.id, { meterCurrent: val });
    setSavingMeter(false);
  }

  async function endRent() {
    if (!confirm("Завершить аренду? Камера будет отмечена как свободная.")) return;
    const hist: RentHistoryEntry = {
      tenant:     freezer.tenant ?? "",
      rentFrom:   freezer.rentFrom ?? "",
      rentTo:     new Date().toISOString().slice(0, 10),
      rentAmount: rentAmt,
      meterStart: freezer.meterStart ?? null,
      meterEnd:   freezer.meterCurrent ?? null,
      paidUntil:  freezer.paidUntil,
    };
    await updateFreezer(freezer.id, {
      rented:       false,
      tenant:       "",
      rentFrom:     "",
      rentAmount:   0,
      meterStart:   null,
      meterCurrent: null,
      paidUntil:    "",
      status:       "active",
      rentHistory:  [...(freezer.rentHistory ?? []), hist],
    });
    onClose();
  }

  async function handleDelete() {
    if (!confirm(`Удалить камеру «${freezer.name ?? freezer.type}»?`)) return;
    await deleteFreezer(freezer.id);
    onClose();
  }

  const title = `${freezer.type ?? "Камера"}${freezer.name ? " · " + freezer.name : ""}`;

  return (
    <Modal title={title} onClose={onClose}>
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {freezer.volume && <InfoCell label="Объём" value={`${freezer.volume} м³`} />}
        {freezer.temp   && <InfoCell label="Температура" value={freezer.temp} color="#0891b2" />}
        {freezer.location && (
          <div className="col-span-2">
            <InfoCell label="Расположение" value={`📍 ${freezer.location}`} />
          </div>
        )}
      </div>

      {/* Rental block */}
      {rented && (
        <div className="bg-green-50 rounded-xl p-3.5 border border-green-100 mb-3">
          <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2.5">
            🟢 Аренда активна
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <InfoCell label="Арендатор"   value={freezer.tenant ?? ""}                  color="#7C3AED" />
            <InfoCell label="Оплата/мес"  value={rentAmt ? `${rentAmt.toLocaleString("ru-RU")} ₽` : "—"} color="#15803D" />
            <InfoCell label="С даты"      value={fmtDate(freezer.rentFrom)}            color="#0284C7" />
            <InfoCell label="Оплачено до" value={fmtDate(freezer.paidUntil)}           color="#D97706" />
          </div>

          {/* Electricity meter */}
          <div className="border-t border-green-100 pt-3">
            <div className="text-xs font-bold text-cyan-600 mb-2">⚡ Счётчик электроэнергии</div>
            <div className="grid grid-cols-2 gap-2 mb-2.5">
              <InfoCell label="Начало (кВт·ч)"   value={freezer.meterStart != null ? String(freezer.meterStart) : "—"} color="#EA580C" />
              <InfoCell label="Расход (кВт·ч)"   value={meterUsed != null ? meterUsed.toFixed(1) : "—"} color="#EA580C" />
              <InfoCell label="Тек. показания"   value={freezer.meterCurrent != null ? String(freezer.meterCurrent) : "—"} color="#D97706" />
              <InfoCell label="Стоим. электро"   value={elecCost != null ? `${elecCost.toLocaleString("ru-RU")} ₽` : kwPrice ? "—" : "Нет тарифа"} color="#DC2626" />
            </div>
            {isAdmin && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Текущие показания кВт·ч"
                  value={meterInput}
                  onChange={(e) => setMeterInput(e.target.value)}
                  className="flex-1 !min-h-0 !py-2 !text-sm"
                />
                <Button size="sm" onClick={() => void saveMeter()} disabled={savingMeter}>
                  {savingMeter ? "..." : "💾"}
                </Button>
              </div>
            )}
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => void endRent()}
              className="mt-3 w-full py-2 rounded-xl border border-red-200 bg-red-50 text-red-500 text-sm font-semibold cursor-pointer"
            >
              Завершить аренду
            </button>
          )}
        </div>
      )}

      {/* Free camera — start rent */}
      {!rented && isAdmin && (
        <Button
          variant="secondary"
          size="lg"
          className="mb-3 w-full"
          onClick={() => setShowRent(true)}
        >
          📤 Сдать в аренду
        </Button>
      )}

      {/* Rent history */}
      {(freezer.rentHistory ?? []).length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-2">
            История аренды ({freezer.rentHistory!.length})
          </div>
          <div className="space-y-1.5">
            {[...(freezer.rentHistory ?? [])].reverse().map((h, i) => (
              <div key={i} className="bg-[#F7F9FC] rounded-xl p-3 border border-[#E2E8F0]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-[#172033]">{h.tenant}</span>
                  <span className="text-xs font-bold text-[#3B6D11]">
                    {h.rentAmount ? `${h.rentAmount.toLocaleString("ru-RU")} ₽/мес` : ""}
                  </span>
                </div>
                <div className="text-xs text-[#667085]">
                  {fmtDate(h.rentFrom)} — {fmtDate(h.rentTo)}
                </div>
                {h.meterStart != null && h.meterEnd != null && (
                  <div className="text-xs text-cyan-600 mt-0.5">
                    ⚡ Расход: {Math.max(0, Number(h.meterEnd) - Number(h.meterStart)).toFixed(1)} кВт·ч
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {freezer.notes && (
        <div className="text-xs text-[#667085] bg-[#F7F9FC] rounded-xl p-3 border border-[#E2E8F0] mb-3">
          {freezer.notes}
        </div>
      )}

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex gap-2 pt-3 border-t border-[#E2E8F0]">
          <Button variant="secondary" size="sm" className="flex-1" onClick={() => setShowEdit(true)}>
            ✏️ Редактировать
          </Button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="text-xs text-red-400 cursor-pointer bg-transparent border-none px-3"
          >
            🗑
          </button>
        </div>
      )}

      {showEdit && <FreezerFormModal freezer={freezer} onClose={() => setShowEdit(false)} />}
      {showRent && <StartRentModal  freezer={freezer} onClose={() => setShowRent(false)} />}
    </Modal>
  );
}

// ─── Isometric freezer card ───────────────────────────────────────────────────

function FanBlades({ cx, cy, r, spinning }: { cx: number; cy: number; r: number; spinning: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1} fill="rgba(15,25,45,0.7)" stroke="rgba(100,140,180,0.4)" strokeWidth="0.6" />
      <g style={{ transformBox: "fill-box" as const, transformOrigin: "center", animation: spinning ? "fanSpin 0.7s linear infinite" : "none" }}>
        <ellipse cx={cx} cy={cy - r * 0.55} rx={r * 0.38} ry={r * 0.6} fill="rgba(186,230,253,0.75)" />
        <ellipse cx={cx + r * 0.55} cy={cy} rx={r * 0.6} ry={r * 0.38} fill="rgba(186,230,253,0.6)" />
        <ellipse cx={cx} cy={cy + r * 0.55} rx={r * 0.38} ry={r * 0.6} fill="rgba(186,230,253,0.75)" />
        <ellipse cx={cx - r * 0.55} cy={cy} rx={r * 0.6} ry={r * 0.38} fill="rgba(186,230,253,0.6)" />
      </g>
      <circle cx={cx} cy={cy} r={r * 0.22} fill="rgba(120,160,210,0.9)" />
    </g>
  );
}

function FreezerCard({ freezer, onClick }: { freezer: Freezer; onClick: () => void }) {
  const rented   = isRented(freezer);
  const isActive = !rented;
  const uid      = freezer.id.slice(-4);

  const edgeColor = rented ? "rgba(96,165,250,0.8)"  : "rgba(148,163,184,0.30)";
  const ew        = rented ? 1.4 : 0.7;

  return (
    <div
      onClick={onClick}
      style={{
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 6px 10px",
        background: "var(--bg3)",
        border: rented ? "1px solid rgba(96,165,250,0.30)" : "1px solid var(--border)",
        borderRadius: 18,
        boxShadow: rented ? "0 0 22px rgba(59,130,246,0.11), 0 2px 8px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.2)",
        transition: "box-shadow 0.2s",
        position: "relative",
      }}
    >
      <svg width="100%" viewBox="0 0 200 140" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <filter id={`glow${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id={`tg${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={rented ? "rgba(147,197,253,0.22)" : "rgba(180,210,255,0.10)"} />
            <stop offset="100%" stopColor={rented ? "rgba(59,130,246,0.08)"  : "rgba(90,130,200,0.05)"} />
          </linearGradient>
        </defs>

        {/* ── Container body ── */}
        {/* Top face */}
        <polygon points="20,60 110,20 190,60 110,100"
          fill={`url(#tg${uid})`} stroke={edgeColor} strokeWidth={ew} strokeLinejoin="round" />
        {/* Front face */}
        <polygon points="20,60 110,100 110,132 20,92"
          fill={rented ? "rgba(59,130,246,0.10)" : "rgba(80,110,170,0.06)"}
          stroke={edgeColor} strokeWidth={ew} strokeLinejoin="round" />
        {/* Right face */}
        <polygon points="110,100 190,60 190,92 110,132"
          fill={rented ? "rgba(30,80,200,0.13)" : "rgba(50,80,150,0.05)"}
          stroke={edgeColor} strokeWidth={ew} strokeLinejoin="round" />

        {/* Vertical ribs — front face */}
        {[0.33, 0.66].map((t, i) => (
          <line key={i}
            x1={20 + t * 90} y1={60 + t * 40}
            x2={20 + t * 90} y2={92 + t * 40}
            stroke={edgeColor} strokeWidth={ew * 0.55} opacity={0.5} />
        ))}
        {/* Vertical ribs — right face */}
        {[0.33, 0.66].map((t, i) => (
          <line key={i}
            x1={110 + t * 80} y1={100 - t * 40}
            x2={110 + t * 80} y2={132 - t * 40}
            stroke={edgeColor} strokeWidth={ew * 0.55} opacity={0.5} />
        ))}

        {/* ── Blue edge glow when rented ── */}
        {rented && (
          <>
            <line x1="20" y1="60" x2="20" y2="92"   stroke="rgba(96,165,250,0.65)" strokeWidth="1.5" filter={`url(#glow${uid})`} />
            <line x1="20" y1="60" x2="110" y2="20"  stroke="rgba(96,165,250,0.55)" strokeWidth="1.5" filter={`url(#glow${uid})`} />
            <line x1="190" y1="60" x2="190" y2="92" stroke="rgba(96,165,250,0.65)" strokeWidth="1.5" filter={`url(#glow${uid})`} />
            <line x1="110" y1="20" x2="190" y2="60" stroke="rgba(96,165,250,0.55)" strokeWidth="1.5" filter={`url(#glow${uid})`} />
          </>
        )}

        {/* ── Carrier unit on top-left of top face ── */}
        {/* Carrier top */}
        <polygon points="38,54 84,32 122,54 76,76"
          fill="rgba(22,32,52,0.85)" stroke="rgba(100,130,170,0.55)" strokeWidth="0.9" />
        {/* Carrier front */}
        <polygon points="38,54 76,76 76,88 38,66"
          fill="rgba(15,24,42,0.88)" stroke="rgba(90,120,160,0.45)" strokeWidth="0.9" />
        {/* Carrier right */}
        <polygon points="76,76 122,54 122,66 76,88"
          fill="rgba(10,18,36,0.88)" stroke="rgba(80,110,150,0.40)" strokeWidth="0.9" />

        {/* Brand text on carrier front */}
        <text x="41" y="85" fontSize="5" fill="rgba(148,163,184,0.75)" fontWeight="bold" letterSpacing="0.6">CARRIER</text>

        {/* ── Fans ── */}
        <FanBlades cx={52} cy={68} r={7} spinning={rented} />
        <FanBlades cx={68} cy={76} r={7} spinning={rented} />
      </svg>

      {/* ── Name + indicators ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        {isActive && (
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0,
            animation: "pulseGreen 1.8s ease-in-out infinite",
            boxShadow: "0 0 5px #22c55e",
          }} />
        )}
        {rented && (
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", flexShrink: 0, boxShadow: "0 0 7px rgba(59,130,246,0.8)" }} />
        )}
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {freezer.name ?? freezer.type ?? "Камера"}
        </span>
      </div>

      {/* Temp + status */}
      <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap", justifyContent: "center" }}>
        {freezer.temp && (
          <span style={{ fontSize: 10, color: "#67e8f9", background: "rgba(6,182,212,0.12)", padding: "2px 6px", borderRadius: 5, fontWeight: 600 }}>
            ❄ {freezer.temp}
          </span>
        )}
        <span style={{
          fontSize: 10,
          color: rented ? "#93c5fd" : "#6ee7b7",
          background: rented ? "rgba(59,130,246,0.12)" : "rgba(34,197,94,0.12)",
          padding: "2px 6px", borderRadius: 5, fontWeight: 600,
        }}>
          {rented ? "Сдана" : "Свободна"}
        </span>
      </div>

      {rented && freezer.tenant && (
        <div style={{ fontSize: 9.5, color: "var(--text2)", marginTop: 3, textAlign: "center", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {freezer.tenant}
        </div>
      )}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function FreezersTab() {
  const { freezers } = useData();
  const { myProfile } = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";
  const [showAdd,  setShowAdd]  = useState(false);
  const [selected, setSelected] = useState<Freezer | null>(null);

  const totalRentIncome = freezers
    .filter((f) => isRented(f))
    .reduce((s, f) => s + getRentAmount(f), 0);

  const rentedCount  = freezers.filter((f) => isRented(f)).length;
  const freeCount    = freezers.filter((f) => !isRented(f)).length;

  // Keep selected live
  const selectedLive = selected ? (freezers.find((f) => f.id === selected.id) ?? selected) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* KPI */}
      <div className="kpi-grid" style={{ animation: "fadeUp 0.45s ease 0.1s both" }}>
        <div className="kpi-card blue">
          <i className="ti ti-package kpi-icon" />
          <div className="kpi-label">Всего камер</div>
          <div className="kpi-value" style={{ color: "var(--accent2)" }}>{freezers.length}</div>
        </div>
        <div className="kpi-card green">
          <i className="ti ti-home kpi-icon" />
          <div className="kpi-label">Сдаётся</div>
          <div className="kpi-value" style={{ color: "#4ade80" }}>{rentedCount}</div>
        </div>
        <div className="kpi-card" style={{ borderTop: "2px solid var(--text3)" }}>
          <i className="ti ti-lock-open kpi-icon" />
          <div className="kpi-label">Свободно</div>
          <div className="kpi-value" style={{ color: "var(--text2)" }}>{freeCount}</div>
        </div>
        {isAdmin && totalRentIncome > 0 && (
          <div className="kpi-card yellow">
            <i className="ti ti-currency-ruble kpi-icon" />
            <div className="kpi-label">Аренда / мес</div>
            <div className="kpi-value" style={{ color: "#fbbf24" }}>
              {totalRentIncome.toLocaleString("ru-RU")}₽
            </div>
          </div>
        )}
      </div>

      {/* Freezer list */}
      <div className="crm-section" style={{ animation: "fadeUp 0.45s ease 0.2s both" }}>
        <div className="section-header">
          <i className="ti ti-snowflake" style={{ fontSize: 17, color: "var(--text2)" }} />
          <span className="section-title">Холодильные камеры</span>
          <span className="section-count">{freezers.length} ед.</span>
          {isAdmin && (
            <div className="section-actions">
              <button className="btn-primary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setShowAdd(true)}>
                <i className="ti ti-plus" /> Камера
              </button>
            </div>
          )}
        </div>

        {freezers.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
            Нет камер на балансе
          </div>
        ) : (
          <div style={{ padding: "8px 12px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {freezers.map((f) => (
              <FreezerCard key={f.id} freezer={f} onClick={() => setSelected(f)} />
            ))}
          </div>
        )}
      </div>

      {showAdd       && <FreezerFormModal onClose={() => setShowAdd(false)} />}
      {selectedLive  && <FreezerDetail freezer={selectedLive} onClose={() => setSelected(null)} />}
    </div>
  );
}
