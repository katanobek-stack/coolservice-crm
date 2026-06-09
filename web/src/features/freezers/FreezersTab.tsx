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

function FreezerCard({ freezer, onClick }: { freezer: Freezer; onClick: () => void }) {
  const rented   = isRented(freezer);
  const isActive = !rented;

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
      <svg viewBox="0 0 680 360" width="100%" role="img" style={{ display: "block" }}>
        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes spinR{to{transform:rotate(-360deg)}}
          @keyframes hl{0%{transform:translateX(0);opacity:0}18%{opacity:.78}100%{transform:translateX(-36px);opacity:0}}
          @keyframes bl{0%,100%{opacity:1}47%,53%{opacity:.1}}
          @keyframes pu{0%,100%{transform:scale(1)}50%{transform:scale(1.028)}}
        `}</style>
        <defs>
          <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
        </defs>

        {/* КРЫША */}
        <polygon points="80,148 260,148 488,14 308,14" fill="#1c3248" stroke="#1e4060" strokeWidth="1.5"/>
        <line x1="130" y1="148" x2="358" y2="14" stroke="#142436" strokeWidth=".8"/>
        <line x1="180" y1="148" x2="408" y2="14" stroke="#142436" strokeWidth=".8"/>
        <line x1="230" y1="148" x2="458" y2="14" stroke="#142436" strokeWidth=".8"/>

        {/* БОКОВАЯ СТЕНКА */}
        <polygon points="260,348 488,214 488,14 260,148" fill="#14253a" stroke="#1e4060" strokeWidth="1.5"/>
        <line x1="260" y1="330" x2="488" y2="196" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="312" x2="488" y2="178" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="294" x2="488" y2="160" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="276" x2="488" y2="142" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="258" x2="488" y2="124" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="240" x2="488" y2="106" stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="222" x2="488" y2="88"  stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="204" x2="488" y2="70"  stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="186" x2="488" y2="52"  stroke="#0e1e30" strokeWidth="1.2"/>
        <line x1="260" y1="168" x2="488" y2="34"  stroke="#0e1e30" strokeWidth="1.2"/>

        {/* РЕФАГРЕГАТ — фронтальный торец */}
        <polygon points="80,348 260,348 260,148 80,148" fill="#0b1724" stroke="#1e4060" strokeWidth="2"/>
        <line x1="80" y1="284" x2="260" y2="284" stroke="#1a3858" strokeWidth="1.5"/>

        {/* Решётки */}
        {[172,180,188,196,204,212,220,228,236,244,252,260,268,276].map(y => (
          <g key={y}>
            <line x1="82" y1={y} x2="110" y2={y} stroke="#142c44" strokeWidth=".8"/>
            <line x1="228" y1={y} x2="256" y2={y} stroke="#142c44" strokeWidth=".8"/>
          </g>
        ))}

        {/* ВЕНТИЛЯТОР */}
        <g transform="translate(170,216)">
          <circle r="60" fill="#08111f" stroke="#1a3248" strokeWidth="2"/>
          <g style={{ transformBox: "fill-box" as const, transformOrigin: "center", animation: rented ? "spinR .7s linear infinite" : "none" }}>
            <circle r="55" fill="#060c18" stroke="#102030" strokeWidth="1"/>
            {[0,60,120,180,240,300].map(deg => (
              <path key={deg} d="M0 0C-4-12-12-32-6-42C0-52 14-28 0 0Z" fill="#0d3a56" transform={`rotate(${deg})`}/>
            ))}
            <circle r="10" fill="#060e1c" stroke="#145880" strokeWidth="1.5"/>
            <circle r="5"  fill="#050b18" stroke="#1a6090" strokeWidth="1"/>
          </g>
          <circle r="60" fill="none" stroke="#0e2438" strokeWidth="1.5"/>
        </g>

        {/* ПАТРУБКИ */}
        <line x1="174" y1="283" x2="174" y2="270" stroke="#922010" strokeWidth="5" strokeLinecap="round"/>
        <rect x="168" y="266" width="12" height="7" rx="2" fill="#7a1a0c" stroke="#a02810" strokeWidth=".8"/>
        <line x1="92" y1="319" x2="82" y2="319" stroke="#124870" strokeWidth="5" strokeLinecap="round"/>
        <rect x="78" y="313" width="7" height="12" rx="2" fill="#0e3860" stroke="#1a5888" strokeWidth=".8"/>

        {/* КОМПРЕССОР BITZER */}
        <g style={{ transformBox: "fill-box" as const, transformOrigin: "center", animation: rented ? "pu 1.9s ease-in-out infinite" : "none" }}>
          <rect x="90" y="292" width="164" height="52" rx="26" fill="#09121e" stroke="#1e3e5c" strokeWidth="1.8"/>
          {[296,299,302,305,308,311,314,317,320,323,326,329,332,335,338].map(y => (
            <line key={y} x1="116" y1={y} x2="244" y2={y} stroke="#0e2535" strokeWidth="1.1"/>
          ))}
          <rect x="124" y="285" width="112" height="16" rx="3" fill="#07101c" stroke="#1a4060" strokeWidth="1.2"/>
          <circle cx="131" cy="293" r="3.5" fill="#0a1c2e" stroke="#1e4060" strokeWidth=".8"/>
          <circle cx="155" cy="293" r="3.5" fill="#0a1c2e" stroke="#1e4060" strokeWidth=".8"/>
          <circle cx="185" cy="293" r="3.5" fill="#0a1c2e" stroke="#1e4060" strokeWidth=".8"/>
          <circle cx="229" cy="293" r="3.5" fill="#0a1c2e" stroke="#1e4060" strokeWidth=".8"/>
          <circle cx="234" cy="318" r="8"   fill="#06101e" stroke="#1a4060" strokeWidth="1.2"/>
          <circle cx="234" cy="318" r="5"   fill="#040d1c" stroke="#145a80" strokeWidth="1"/>
          <circle cx="234" cy="318" r="2.5" fill="#030b18" stroke="#1a6090" strokeWidth=".8"/>
          <rect x="120" y="309" width="62" height="14" rx="2" fill="#03090f" stroke="#1a4060" strokeWidth=".8"/>
          <text x="151" y="320" textAnchor="middle" fill="#2060a0" fontSize="9" fontFamily="monospace" fontWeight="bold" letterSpacing="1">BITZER</text>
          <circle cx="248" cy="302" r="3" fill="#0a1c2e" stroke="#1e3e58" strokeWidth=".8"/>
          <circle cx="252" cy="318" r="3" fill="#0a1c2e" stroke="#1e3e58" strokeWidth=".8"/>
          <circle cx="248" cy="334" r="3" fill="#0a1c2e" stroke="#1e3e58" strokeWidth=".8"/>
        </g>

        {/* ГОРЯЧИЙ ВОЗДУХ */}
        {[{y:196,d:0},{y:216,d:.4},{y:236,d:.8}].map(({y,d}) => (
          <g key={y} style={{ animation: rented ? `hl 1.5s linear infinite ${d}s` : "none", opacity: rented ? 1 : 0 }}>
            <line x1="75" y1={y} x2="36" y2={y} stroke="#b02808" strokeWidth="2.5" markerEnd="url(#ar)"/>
          </g>
        ))}

        {/* LEDs */}
        <circle cx="94"  cy="157" r="5" fill="#00c853" style={{ animation: rented ? "bl 2s ease-in-out infinite" : "none", opacity: 1 }}/>
        <circle cx="109" cy="157" r="5" fill="#ffd600" style={{ animation: rented ? "bl 3.8s ease-in-out infinite .7s" : "none", opacity: rented ? 1 : 0.2 }}/>
        <circle cx="124" cy="157" r="5" fill="#1c2e40"/>
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
          <span style={{ fontSize: 10, color: "#0e7490", background: "rgba(6,182,212,0.12)", padding: "2px 6px", borderRadius: 5, fontWeight: 600 }}>
            ❄ {freezer.temp}
          </span>
        )}
        <span style={{
          fontSize: 10,
          color: rented ? "#3b82f6" : "#16a34a",
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
          <div className="kpi-value" style={{ color: "#16a34a" }}>{rentedCount}</div>
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
            <div className="kpi-value" style={{ color: "#b45309" }}>
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
