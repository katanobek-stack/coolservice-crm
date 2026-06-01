import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { addFreezer, updateFreezer, deleteFreezer } from "../../shared/firebase/firestore";
import { fmtDate, genId } from "../../shared/utils/format";
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

function InfoCell({ label, value, color = "#172033" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#F7F9FC] rounded-xl p-2.5 border border-[#E2E8F0]">
      <div className="text-[9px] text-[#98A2B3] font-bold uppercase tracking-wide mb-1">{label}</div>
      <div className="text-sm font-bold" style={{ color }}>{value || "—"}</div>
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

// ─── Freezer card ─────────────────────────────────────────────────────────────

function FreezerCard({ freezer, onClick }: { freezer: Freezer; onClick: () => void }) {
  const rented  = isRented(freezer);
  const rentAmt = getRentAmount(freezer);

  return (
    <div
      className="bg-white rounded-[18px] border border-[#E2E8F0] p-4 mb-2.5 cursor-pointer shadow-sm active:scale-[.99] transition-all"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <div className="font-semibold text-[#172033] text-sm">
            {freezer.name ?? freezer.type ?? "Камера"}
          </div>
          {freezer.name && freezer.type && (
            <div className="text-xs text-[#667085]">{freezer.type}</div>
          )}
        </div>
        <Badge variant={rented ? "green" : "gray"}>{rented ? "Сдаётся" : "Свободна"}</Badge>
      </div>

      <div className="flex flex-wrap gap-2 mt-1.5">
        {freezer.volume     && <span className="text-xs text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg">📦 {freezer.volume} м³</span>}
        {freezer.temp       && <span className="text-xs text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-lg">❄️ {freezer.temp}</span>}
        {freezer.location   && <span className="text-xs text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg">📍 {freezer.location}</span>}
        {rented && rentAmt > 0 && (
          <span className="text-xs text-[#3B6D11] bg-[#EAF3DE] px-2 py-0.5 rounded-lg">
            💰 {rentAmt.toLocaleString("ru-RU")} ₽/мес
          </span>
        )}
      </div>

      {rented && freezer.tenant && (
        <div className="text-xs text-[#667085] mt-1.5">👤 {freezer.tenant}</div>
      )}
      {rented && freezer.paidUntil && (
        <div className="text-xs text-[#BA7517] mt-0.5">До: {fmtDate(freezer.paidUntil)}</div>
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
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-bold text-[#172033]">Склад</div>
          {isAdmin && totalRentIncome > 0 && (
            <div className="text-xs text-[#3B6D11]">
              Доход от аренды: {totalRentIncome.toLocaleString("ru-RU")} ₽/мес
            </div>
          )}
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-[#185FA5] bg-[#E6F1FB] px-3 py-1.5 rounded-xl border border-[#185FA5]/10 cursor-pointer font-semibold"
          >
            + Камера
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-white rounded-xl p-2.5 border border-[#E2E8F0] text-center">
          <div className="text-lg font-bold text-[#172033]">{freezers.length}</div>
          <div className="text-[10px] text-[#667085]">Всего</div>
        </div>
        <div className="bg-white rounded-xl p-2.5 border border-[#E2E8F0] text-center">
          <div className="text-lg font-bold text-[#3B6D11]">{rentedCount}</div>
          <div className="text-[10px] text-[#667085]">Сдаётся</div>
        </div>
        <div className="bg-white rounded-xl p-2.5 border border-[#E2E8F0] text-center">
          <div className="text-lg font-bold text-[#667085]">{freeCount}</div>
          <div className="text-[10px] text-[#667085]">Свободно</div>
        </div>
      </div>

      {freezers.length === 0 && (
        <div className="text-center py-16 text-[#98A2B3] text-sm">
          Нет камер на балансе
        </div>
      )}

      {freezers.map((f) => (
        <FreezerCard key={f.id} freezer={f} onClick={() => setSelected(f)} />
      ))}

      {showAdd       && <FreezerFormModal onClose={() => setShowAdd(false)} />}
      {selectedLive  && <FreezerDetail freezer={selectedLive} onClose={() => setSelected(null)} />}
    </div>
  );
}
