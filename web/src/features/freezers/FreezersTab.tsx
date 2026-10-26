import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import { addFreezer } from "../../shared/firebase/firestore";
import {
  endFreezerRental,
  removeDocumentIfUnchanged,
  updateDocumentFieldsIfUnchanged,
} from "../../shared/firebase/concurrency";
import { fmtDate } from "../../shared/utils/format";
import { FREEZER_TYPES } from "../../shared/types/freezer";
import type { Freezer } from "../../shared/types/freezer";
import { WarehouseWorkspace } from "./WarehouseWorkspace";
import { businessDate, isRented, money, paymentLabel, paymentState, rentAmount, rentalTerms, rentalRateInput } from "./warehouseLogic";

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
  const [tenant, setTenant] = useState(freezer?.tenant ?? "");
  const [tenantPhone, setTenantPhone] = useState(freezer?.tenantPhone ?? "");
  const [rentRate, setRentRate] = useState(rentalRateInput(freezer));
  const [paidUntil, setPaidUntil] = useState(freezer?.paidUntil ?? "");
  const [saving,   setSaving]   = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (saving) return;
    setError("");
    if (volume && (!Number.isFinite(Number(volume)) || Number(volume) <= 0)) { setError("Укажите объём больше нуля или оставьте поле пустым."); return; }
    if (freezer && isRented(freezer) && (!tenant.trim() || (rentRate && (!Number.isFinite(Number(rentRate)) || Number(rentRate) <= 0)))) { setError("Укажите арендатора и корректную стоимость аренды."); return; }
    setSaving(true);
    try {
    const data: Partial<Freezer> = {
      type,
      name:     name.trim(),
      volume:   parseFloat(volume) || undefined,
      location: location.trim(),
      temp:     temp.trim(),
      notes:    notes.trim(),
      ...(freezer && isRented(freezer) ? { tenant: tenant.trim(), tenantPhone: tenantPhone.trim(), ...rentalTerms(rentRate, paidUntil) } : {}),
    };
    if (isEdit && freezer) {
      await updateDocumentFieldsIfUnchanged("freezers", freezer, data);
    } else {
      await addFreezer({ ...data, rented: false, rentHistory: [] } as Omit<Freezer, "id" | "createdAt">);
    }
    onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить камеру. Проверьте подключение и повторите."); }
    finally { setSaving(false); }
  }

  return (
    <Modal className="warehouse-modal" title={isEdit ? "Редактировать камеру" : "Добавить камеру"} onClose={onClose}>
      {error && <div className="warehouse-error" role="alert">{error}</div>}
      <FormGroup label="Тип оборудования">
        <Select aria-label="Тип оборудования" value={type} onChange={(e) => setType(e.target.value)}>
          {!FREEZER_TYPES.includes(type) && <option value={type}>{type || "Тип не указан"}</option>}
          {FREEZER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </FormGroup>
      <FormGroup label="Название (необязательно)">
        <Input aria-label="Название камеры" placeholder="Камера №1" value={name} onChange={(e) => setName(e.target.value)} />
      </FormGroup>
      <div className="grid grid-cols-2 gap-2">
        <FormGroup label="Объём (м³)">
          <Input aria-label="Объём камеры в кубических метрах" type="number" min="0.1" step="0.1" placeholder="20" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </FormGroup>
        <FormGroup label="Темп-ра">
          <Input aria-label="Заданная температура" placeholder="-18°C" value={temp} onChange={(e) => setTemp(e.target.value)} />
        </FormGroup>
      </div>
      <FormGroup label="Адрес / расположение">
        <Input aria-label="Адрес или расположение" placeholder="ул. Ленина, 1" value={location} onChange={(e) => setLocation(e.target.value)} />
      </FormGroup>
      <FormGroup label="Заметки">
        <Textarea aria-label="Заметки об оборудовании" placeholder="..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormGroup>
      {freezer && isRented(freezer) && <>
        <h3 style={{fontSize:12,fontWeight:800,color:"#245e9f",margin:"18px 0 12px"}}>Условия действующей аренды</h3>
        <FormGroup label="Имя / название арендатора"><Input aria-label="Арендатор" value={tenant} onChange={(e) => setTenant(e.target.value)} /></FormGroup>
        <FormGroup label="Телефон арендатора"><Input aria-label="Телефон арендатора" type="tel" autoComplete="tel" maxLength={64} placeholder="+7 …" value={tenantPhone} onChange={(e) => setTenantPhone(e.target.value)} /></FormGroup>
        <div className="grid grid-cols-2 gap-2"><FormGroup label="Стоимость, ₽/мес"><Input aria-label="Стоимость аренды в месяц" type="number" step="0.01" min="0.01" value={rentRate} onChange={e => setRentRate(e.target.value)} /></FormGroup><FormGroup label="Оплачено до"><Input aria-label="Оплачено до" type="date" value={paidUntil} onChange={e => setPaidUntil(e.target.value)} /></FormGroup></div>
      </>}
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "..." : isEdit ? "Сохранить" : "Добавить камеру"}
      </Button>
    </Modal>
  );
}

// ─── Start rent modal ─────────────────────────────────────────────────────────

function StartRentModal({ freezer, onClose }: { freezer: Freezer; onClose: () => void }) {
  const today = businessDate();
  const [tenant,    setTenant]    = useState("");
  const [tenantPhone, setTenantPhone] = useState("");
  const [amount,    setAmount]    = useState("");
  const [from,      setFrom]      = useState(today);
  const [paidUntil, setPaidUntil] = useState("");
  const [meter,     setMeter]     = useState("");
  const [saving,    setSaving]    = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (saving) return;
    setError("");
    if (!tenant.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError("Укажите арендатора и стоимость аренды больше нуля."); return; }
    if (!from || (paidUntil && paidUntil < from)) { setError("Проверьте даты: оплата не может предшествовать началу аренды."); return; }
    if (meter && (!Number.isFinite(Number(meter)) || Number(meter) < 0)) { setError("Показания счётчика должны быть неотрицательным числом."); return; }
    setSaving(true);
    try {
    await updateDocumentFieldsIfUnchanged("freezers", freezer, {
      rented:      true,
      tenant:      tenant.trim(),
      tenantPhone: tenantPhone.trim(),
      rentAmount:  parseFloat(amount),
      rentFrom:    from,
      paidUntil:   paidUntil || undefined,
      meterStart:  meter ? parseFloat(meter) : null,
      meterCurrent: meter ? parseFloat(meter) : null,
      status:      "rented",
    });
    onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось оформить аренду. Проверьте подключение и повторите."); }
    finally { setSaving(false); }
  }

  return (
    <Modal className="warehouse-modal" title="Сдать в аренду" onClose={onClose}>
      <p style={{fontSize:12, marginBottom:16, color:"#52687c"}}>{freezer.name || freezer.type || "Камера"} · условия новой аренды</p>
      {error && <div className="warehouse-error" role="alert">{error}</div>}
      <FormGroup label="Арендатор">
        <Input aria-label="Арендатор" placeholder="ООО «Ромашка»" value={tenant} onChange={(e) => setTenant(e.target.value)} />
      </FormGroup>
      <FormGroup label="Телефон арендатора (необязательно)">
        <Input aria-label="Телефон арендатора" type="tel" autoComplete="tel" maxLength={64} placeholder="+7 …" value={tenantPhone} onChange={(e) => setTenantPhone(e.target.value)} />
      </FormGroup>
      <FormGroup label="Оплата (₽/мес)">
        <Input aria-label="Стоимость аренды в месяц" type="number" min="0.01" step="0.01" placeholder="5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </FormGroup>
      <div className="grid grid-cols-2 gap-2">
        <FormGroup label="С даты">
          <Input aria-label="Дата начала аренды" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormGroup>
        <FormGroup label="Оплачено до">
          <Input aria-label="Оплачено до" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
        </FormGroup>
      </div>
      <FormGroup label="Нач. показания счётчика (кВт·ч)">
        <Input aria-label="Начальные показания счётчика" min="0" type="number" step="0.1" placeholder="0.0" value={meter} onChange={(e) => setMeter(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "..." : "Сдать в аренду"}
      </Button>
    </Modal>
  );
}

// ─── Freezer detail modal ─────────────────────────────────────────────────────

function FreezerDetail({ freezer, onClose }: { freezer: Freezer; onClose: () => void }) {
  const { finance, sourceStatus } = useData();
  const { myProfile } = useAuth();
  const isAdmin   = (myProfile?.role ?? "mechanic") !== "mechanic";
  const rented    = isRented(freezer);
  const rentAmt   = rentAmount(freezer);
  const [showEdit,    setShowEdit]    = useState(false);
  const [showRent,    setShowRent]    = useState(false);
  const [meterInput,  setMeterInput]  = useState(String(freezer.meterCurrent ?? ""));
  const [savingMeter, setSavingMeter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Electricity calculation
  const kwPrice = sourceStatus.finance === "ready" ? rentAmount({id: "tariff", rentAmount: finance.kwPrice as number}) : 0;
  const meterUsed = (freezer.meterCurrent != null && freezer.meterStart != null)
    ? Math.max(0, Number(freezer.meterCurrent) - Number(freezer.meterStart))
    : null;
  const elecCost = meterUsed != null && kwPrice > 0 ? Math.round(meterUsed * kwPrice) : null;

  async function saveMeter() {
    if (savingMeter || busy) return;
    const val = Number(meterInput);
    setError("");
    if (!meterInput.trim() || !Number.isFinite(val) || val < 0 || (freezer.meterStart != null && val < freezer.meterStart)) {
      setError("Укажите корректные показания, не меньше начальных."); return;
    }
    setSavingMeter(true);
    try { await updateDocumentFieldsIfUnchanged("freezers", freezer, { meterCurrent: val }); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить показания. Повторите попытку."); }
    finally { setSavingMeter(false); }
  }

  async function endRent() {
    if (busy || savingMeter) return;
    if (!confirm("Завершить аренду? Камера будет отмечена как свободная.")) return;
    setBusy(true); setError("");
    try { await endFreezerRental(freezer.id, businessDate()); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось завершить аренду. Повторите попытку."); }
    finally { setBusy(false); }
  }

  async function handleDelete() {
    if (busy || savingMeter) return;
    if (!confirm(`Удалить камеру «${freezer.name ?? freezer.type}»?`)) return;
    setBusy(true); setError("");
    try { await removeDocumentIfUnchanged("freezers", freezer); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось удалить камеру. Повторите попытку."); }
    finally { setBusy(false); }
  }

  const title = `${freezer.type ?? "Камера"}${freezer.name ? " · " + freezer.name : ""}`;

  return (
    <Modal className="warehouse-modal" title={title} onClose={onClose}>
      {error && <div className="warehouse-error" role="alert">{error}</div>}
      <div className="warehouse-detail-heading"><span className={`warehouse-badge ${rented ? "warehouse-badge--blue" : ""}`}>{rented ? "В аренде" : "Свободна для аренды"}</span><p className={`warehouse-payment--${paymentState(freezer)}`}>{paymentLabel(freezer)}</p></div>
      <section className="warehouse-detail-section"><h3>Оборудование</h3>
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
      </section>

      {/* Rental block */}
      {rented && (
        <section className="warehouse-detail-section warehouse-detail-section--rental">
          <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2.5">
            Условия аренды
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <InfoCell label="Арендатор"   value={freezer.tenant ?? ""}                  color="#7C3AED" />
            <InfoCell label="Телефон арендатора" value={freezer.tenantPhone ?? "Не указан"} />
            <InfoCell label="Оплата/мес"  value={rentAmt ? money(rentAmt) : "Не указана"} color="#15803D" />
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
              <InfoCell label="Стоимость электроэнергии" value={sourceStatus.finance !== "ready" ? "Тариф недоступен" : elecCost != null ? money(elecCost) : kwPrice ? "—" : "Нет тарифа"} color="#9b5620" />
            </div>
            {isAdmin && (
              <div className="warehouse-detail-action">
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Текущие показания кВт·ч"
                  aria-label="Текущие показания счётчика, кВт·ч"
                  value={meterInput}
                  onChange={(e) => setMeterInput(e.target.value)}
                  className="flex-1 !min-h-0 !py-2 !text-sm"
                />
                <Button size="sm" onClick={() => void saveMeter()} disabled={savingMeter || busy}>
                  {savingMeter ? "Сохраняем…" : "Сохранить показания"}
                </Button>
              </div>
            )}
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => void endRent()}
              disabled={busy || savingMeter}
              className="mt-3 w-full py-2 rounded-xl border border-red-200 bg-red-50 text-red-500 text-sm font-semibold cursor-pointer"
            >
              Завершить аренду
            </button>
          )}
        </section>
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
        <section className="warehouse-detail-section">
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
                {h.tenantPhone && <div className="text-xs text-[#667085]">Телефон: {h.tenantPhone}</div>}
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
        </section>
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
          <Button variant="secondary" size="sm" className="flex-1" disabled={busy || savingMeter} onClick={() => setShowEdit(true)}>
            ✏️ Редактировать
          </Button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy || savingMeter}
            aria-label="Удалить камеру"
            className="text-xs text-red-400 cursor-pointer bg-transparent border-none px-3"
          >
            Удалить
          </button>
        </div>
      )}

      {showEdit && <FreezerFormModal freezer={freezer} onClose={() => setShowEdit(false)} />}
      {showRent && <StartRentModal  freezer={freezer} onClose={() => setShowRent(false)} />}
    </Modal>
  );
}


// ─── Main tab ─────────────────────────────────────────────────────────────────

export function FreezersTab() {
  const { freezers, sourceStatus } = useData();
  const { myProfile } = useAuth();
  const isAdmin = (myProfile?.role ?? "mechanic") !== "mechanic";
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Freezer | null>(null);
  const selectedLive = selected ? freezers.find(f => f.id === selected.id) : null;
  return <>
    <WarehouseWorkspace freezers={freezers} status={sourceStatus.freezers} manager={isAdmin} onOpen={setSelected} onAdd={() => setShowAdd(true)} />
    {showAdd && sourceStatus.freezers === "ready" && <FreezerFormModal onClose={() => setShowAdd(false)} />}
    {selected && sourceStatus.freezers !== "ready" && <Modal className="warehouse-modal" title="Камера недоступна" onClose={() => setSelected(null)}><p role="alert">Данные склада временно недоступны. Закройте карточку и повторите после загрузки.</p></Modal>}
    {selected && sourceStatus.freezers === "ready" && !selectedLive && <Modal className="warehouse-modal" title="Камера не найдена" onClose={() => setSelected(null)}><p role="status">Запись удалена или больше недоступна. Обновлённый каталог находится за этим окном.</p></Modal>}
    {selectedLive && sourceStatus.freezers === "ready" && <FreezerDetail key={selectedLive.id} freezer={selectedLive} onClose={() => setSelected(null)} />}
  </>;
}
