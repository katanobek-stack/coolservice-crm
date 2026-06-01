import { useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { Badge } from "../../shared/ui/Badge";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { Input, Textarea, Select, FormGroup } from "../../shared/ui/Input";
import {
  addFreezer,
  updateFreezer,
  deleteFreezer,
} from "../../shared/firebase/firestore";
import type { Freezer, FreezerStatus } from "../../shared/types/freezer";

const STATUS_LABELS: Record<FreezerStatus, string> = {
  active:  "Работает",
  storage: "На хранении",
  rented:  "В аренде",
};

const STATUS_BADGE: Record<FreezerStatus, "green" | "gray" | "blue"> = {
  active:  "green",
  storage: "gray",
  rented:  "blue",
};

function FreezerForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<Freezer>;
  onSave: (data: Omit<Freezer, "id" | "createdAt">) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState<FreezerStatus>(initial?.status ?? "active");
  const [power, setPower] = useState(initial?.power ?? "");
  const [temp, setTemp] = useState(initial?.temp ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [rentalRate, setRentalRate] = useState(initial?.rentalRate ?? "");
  const [rentedTo, setRentedTo] = useState(initial?.rentedTo ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      status,
      power: power.trim() || undefined,
      temp: temp.trim() || undefined,
      location: location.trim() || undefined,
      rentalRate: rentalRate.trim() || undefined,
      rentedTo: status === "rented" ? rentedTo.trim() : undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
  }

  return (
    <>
      <FormGroup label="Название">
        <Input placeholder="Камера №1" value={name} onChange={(e) => setName(e.target.value)} />
      </FormGroup>
      <FormGroup label="Статус">
        <Select value={status} onChange={(e) => setStatus(e.target.value as FreezerStatus)}>
          <option value="active">Работает</option>
          <option value="storage">На хранении</option>
          <option value="rented">В аренде</option>
        </Select>
      </FormGroup>
      <div className="grid grid-cols-2 gap-2">
        <FormGroup label="Мощность">
          <Input placeholder="1.5 кВт" value={power} onChange={(e) => setPower(e.target.value)} />
        </FormGroup>
        <FormGroup label="Температура">
          <Input placeholder="-18°C" value={temp} onChange={(e) => setTemp(e.target.value)} />
        </FormGroup>
      </div>
      <FormGroup label="Расположение">
        <Input placeholder="Склад ул. Ленина" value={location} onChange={(e) => setLocation(e.target.value)} />
      </FormGroup>
      {status === "rented" && (
        <>
          <FormGroup label="Арендатор">
            <Input placeholder="Кто арендует" value={rentedTo} onChange={(e) => setRentedTo(e.target.value)} />
          </FormGroup>
          <FormGroup label="Ставка аренды (₽/мес)">
            <Input type="number" placeholder="5000" value={rentalRate} onChange={(e) => setRentalRate(e.target.value)} />
          </FormGroup>
        </>
      )}
      <FormGroup label="Примечания">
        <Textarea placeholder="..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormGroup>
      <Button size="lg" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </Button>
    </>
  );
}

function FreezerCard({
  freezer,
  isAdmin,
  onClick,
}: {
  freezer: Freezer;
  isAdmin: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="bg-white rounded-[18px] border border-[#E2E8F0] p-4 mb-2.5 cursor-pointer shadow-sm active:scale-[.99] transition-all"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-semibold text-[#172033] text-sm">{freezer.name}</div>
        <Badge variant={STATUS_BADGE[freezer.status]}>{STATUS_LABELS[freezer.status]}</Badge>
      </div>
      {freezer.location && <div className="text-xs text-[#667085]">📍 {freezer.location}</div>}
      <div className="flex flex-wrap gap-2 mt-1.5">
        {freezer.temp && <span className="text-xs text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-lg">❄️ {freezer.temp}</span>}
        {freezer.power && <span className="text-xs text-[#667085] bg-[#F2F4F7] px-2 py-0.5 rounded-lg">⚡ {freezer.power}</span>}
        {freezer.status === "rented" && freezer.rentalRate && (
          <span className="text-xs text-[#3B6D11] bg-[#EAF3DE] px-2 py-0.5 rounded-lg">
            💰 {freezer.rentalRate} ₽/мес
          </span>
        )}
      </div>
      {freezer.rentedTo && (
        <div className="text-xs text-[#667085] mt-1">👤 {freezer.rentedTo}</div>
      )}
    </div>
  );
}

export function FreezersTab() {
  const { freezers } = useData();
  const { myProfile } = useAuth();
  const role = myProfile?.role ?? "mechanic";
  const isAdmin = role === "admin" || role === "manager";
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Freezer | null>(null);

  const totalRentalIncome = freezers
    .filter((f) => f.status === "rented")
    .reduce((s, f) => s + (parseFloat(f.rentalRate ?? "0") || 0), 0);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-lg font-bold text-[#172033]">Склад</div>
          {isAdmin && totalRentalIncome > 0 && (
            <div className="text-xs text-[#3B6D11]">
              Аренда: {totalRentalIncome.toLocaleString("ru-RU")} ₽/мес
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
        {(["active", "rented", "storage"] as FreezerStatus[]).map((s) => {
          const count = freezers.filter((f) => f.status === s).length;
          return (
            <div key={s} className="bg-white rounded-xl p-2.5 border border-[#E2E8F0] text-center">
              <div className="text-lg font-bold text-[#172033]">{count}</div>
              <div className="text-[10px] text-[#667085]">{STATUS_LABELS[s]}</div>
            </div>
          );
        })}
      </div>

      {freezers.length === 0 && (
        <div className="text-center py-12 text-[#98A2B3] text-sm">
          Нет единиц на складе
        </div>
      )}

      {freezers.map((f) => (
        <FreezerCard
          key={f.id}
          freezer={f}
          isAdmin={isAdmin}
          onClick={() => setSelected(f)}
        />
      ))}

      {showAdd && (
        <Modal title="Новая камера" onClose={() => setShowAdd(false)}>
          <FreezerForm
            onSave={(data) => addFreezer(data).then(() => {})}
            onClose={() => setShowAdd(false)}
          />
        </Modal>
      )}

      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)}>
          {isAdmin && (
            <FreezerForm
              initial={selected}
              onSave={(data) => updateFreezer(selected.id, data).then(() => {})}
              onClose={() => setSelected(null)}
            />
          )}
          {!isAdmin && (
            <div className="space-y-2 text-sm text-[#344054]">
              <div><Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABELS[selected.status]}</Badge></div>
              {selected.location && <div>📍 {selected.location}</div>}
              {selected.temp && <div>❄️ Температура: {selected.temp}</div>}
              {selected.power && <div>⚡ Мощность: {selected.power}</div>}
              {selected.notes && <div className="text-[#667085]">{selected.notes}</div>}
            </div>
          )}
          {isAdmin && (
            <div className="mt-3 pt-3 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={() => {
                  if (!confirm("Удалить камеру?")) return;
                  void deleteFreezer(selected.id).then(() => setSelected(null));
                }}
                className="text-xs text-red-400 cursor-pointer bg-transparent border-none"
              >
                🗑 Удалить
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
