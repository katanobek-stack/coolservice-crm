import { useRef, useState } from "react";
import { useData } from "../../shared/context/DataContext";
import { useAuth } from "../auth";
import { repairStatus, taskStatus, getAssignees, SERVICE_TYPES } from "../../shared/utils/repair";
import { fmtDate } from "../../shared/utils/format";
import { Button } from "../../shared/ui/Button";
import { getFirebaseDb } from "../../shared/firebase/app";
import { restoreDocumentFromBackup } from "../../shared/firebase/concurrency";
import {
  buildJsonBackupData,
  clientsFromBackup,
  standaloneAppointmentsFromBackup,
} from "../../shared/backup/appointments";
import * as XLSX from "xlsx";

// ─── JSON backup ──────────────────────────────────────────────────────────────

function downloadJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Excel export ─────────────────────────────────────────────────────────────

function exportExcel(
  clients: ReturnType<typeof useData>["clients"],
  tasks:   ReturnType<typeof useData>["tasks"],
  freezers: ReturnType<typeof useData>["freezers"],
  finance:  ReturnType<typeof useData>["finance"],
) {
  const wb   = XLSX.utils.book_new();
  const stamp = new Date().toISOString().slice(0, 10);

  // Лист 1: Клиенты
  const clRows: unknown[][] = [["ID", "Тип", "Имя/Название", "Телефон", "ИНН", "Абонплата ₽/мес", "Машин", "Ремонтов"]];
  clients.forEach((c) => {
    clRows.push([
      c.id,
      (c.clientType ?? c.type) === "legal" ? "Юр.лицо" : "Физ.лицо",
      c.name, c.phone ?? "", c.inn ?? "", c.subscription ?? 0,
      (c.vehicles ?? []).length, (c.repairs ?? []).length,
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(clRows);
  ws1["!cols"] = [{wch:14},{wch:10},{wch:30},{wch:16},{wch:14},{wch:14},{wch:8},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws1, "Клиенты");

  // Лист 2: Машины
  const vhRows: unknown[][] = [["Клиент", "Гос.номер", "Марка", "Тип оборудования"]];
  clients.forEach((c) => {
    (c.vehicles ?? []).forEach((v) => {
      const svc = SERVICE_TYPES.find((s) => s.id === v.serviceType) ?? SERVICE_TYPES[3];
      vhRows.push([c.name, v.plate, v.brand ?? v.model ?? "", svc.label]);
    });
  });
  const ws2 = XLSX.utils.aoa_to_sheet(vhRows);
  ws2["!cols"] = [{wch:30},{wch:12},{wch:16},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws2, "Машины");

  // Лист 3: Ремонты
  const rpRows: unknown[][] = [["Клиент","Гос.номер","Тип услуги","Дата","Описание","Статус","Стоимость ₽","Фреон","Кг фреона","Задач","Готово задач"]];
  clients.forEach((c) => {
    (c.repairs ?? []).forEach((r) => {
      const v   = (c.vehicles ?? []).find((vv) => vv.id === r.vehicleId);
      const st  = repairStatus(r);
      const stTxt = st === "done" ? "Готово" : st === "cancelled" ? "Отказ" : "В работе";
      const ts  = r.tasks ?? [];
      const doneTs = ts.filter((t) => taskStatus(t) === "done").length;
      const freonKgTotal = ts.reduce((s, t) => s + (parseFloat(t.freonKg ?? "0") || 0), 0);
      rpRows.push([
        c.name, v?.plate ?? "", (SERVICE_TYPES.find((s) => s.id === r.serviceType) ?? SERVICE_TYPES[3]).label,
        r.date ?? "", r.description ?? "", stTxt,
        parseFloat(r.cost ?? "0") || 0, r.freonType ?? "", freonKgTotal || "",
        ts.length, doneTs,
      ]);
    });
  });
  const ws3 = XLSX.utils.aoa_to_sheet(rpRows);
  ws3["!cols"] = [{wch:30},{wch:12},{wch:14},{wch:12},{wch:40},{wch:10},{wch:12},{wch:10},{wch:8},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, "Ремонты");

  // Лист 4: Задачи в ремонтах
  const tkRows: unknown[][] = [["Клиент","Гос.номер","Дата ремонта","Исполнители","Описание","Статус","Комментарий","Фреон кг"]];
  clients.forEach((c) => {
    (c.repairs ?? []).forEach((r) => {
      const v = (c.vehicles ?? []).find((vv) => vv.id === r.vehicleId);
      (r.tasks ?? []).forEach((t) => {
        const names = getAssignees(t).join(", ");
        tkRows.push([
          c.name, v?.plate ?? "", r.date ?? "", names,
          t.description ?? "", taskStatus(t) === "done" ? "Готова" : "В работе",
          t.workComment ?? "", t.freonKg ?? "",
        ]);
      });
    });
  });
  const ws4 = XLSX.utils.aoa_to_sheet(tkRows);
  ws4["!cols"] = [{wch:30},{wch:12},{wch:12},{wch:24},{wch:40},{wch:10},{wch:30},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws4, "Задачи");

  // Лист 5: Сервисные задачи
  const stRows: unknown[][] = [["Тип","Заголовок","Описание","Исполнители","Статус"]];
  tasks.forEach((t) => {
    stRows.push([
      t.taskType ?? "task",
      t.title ?? "", t.description ?? "",
      (t.assignees ?? []).join(", "),
      t.status === "done" ? "Готова" : "В работе",
    ]);
  });
  const ws5 = XLSX.utils.aoa_to_sheet(stRows);
  ws5["!cols"] = [{wch:10},{wch:30},{wch:40},{wch:24},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws5, "Сервисные задачи");

  // Лист 6: Камеры
  const fzRows: unknown[][] = [["Тип","Название","Статус","Арендатор","Дата начала","Оплата ₽/мес","Объём м³"]];
  freezers.forEach((f) => {
    fzRows.push([
      f.type ?? "", f.name ?? "",
      (f.rented || f.status === "rented") ? "В аренде" : "Свободна",
      f.tenant ?? "", f.rentFrom ?? "",
      f.rentAmount ?? 0, f.volume ?? "",
    ]);
  });
  const ws6 = XLSX.utils.aoa_to_sheet(fzRows);
  ws6["!cols"] = [{wch:20},{wch:16},{wch:12},{wch:30},{wch:12},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws6, "Камеры");

  // Лист 7: Закупки
  const f = finance as { purchases?: Array<{ date?: string; amount?: number; comment?: string; addedByName?: string }> };
  const purRows: unknown[][] = [["Дата","Сумма ₽","Комментарий","Кто добавил"]];
  (f.purchases ?? []).slice().sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).forEach((p) => {
    purRows.push([p.date ?? "", p.amount ?? 0, p.comment ?? "", p.addedByName ?? ""]);
  });
  const ws7 = XLSX.utils.aoa_to_sheet(purRows);
  ws7["!cols"] = [{wch:12},{wch:14},{wch:50},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws7, "Закупки");

  XLSX.writeFile(wb, `РефСервисДВ_данные_${stamp}.xlsx`);
}

// ─── JSON import ──────────────────────────────────────────────────────────────

async function importJSON(file: File, onStatus: (msg: string) => void): Promise<{ clients: number; tasks: number; freezers: number; appointments: number; errors: number }> {
  const text = await file.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Файл повреждён или это не JSON");
  }
  if (!data || !data.version) throw new Error("Это не бэкап РефСервисДВ (нет поля version)");

  const db    = getFirebaseDb();
  const stats = { clients: 0, tasks: 0, freezers: 0, appointments: 0, errors: 0 };

  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function writeCollection(name: string, items: Array<Record<string, unknown>>, key: keyof typeof stats) {
    if (!items?.length) return;
    onStatus(`Записываю ${name} (${items.length})...`);
    for (const batch_items of chunk(items, 20)) {
      await Promise.all(batch_items.map(async (item) => {
        const id = item.id as string;
        if (!id) return;
        const clean = { ...item }; delete clean.id;
        try {
          await restoreDocumentFromBackup(name, id, clean, db);
          stats[key]++;
        } catch (err) {
          stats.errors++;
          console.warn(`${name}/${id} restore err`, err);
        }
      }));
    }
  }

  await writeCollection("clients",      clientsFromBackup(data), "clients");
  await writeCollection("servicetasks", (data.servicetasks as Array<Record<string, unknown>>) ?? [], "tasks");
  await writeCollection("freezers",     (data.freezers     as Array<Record<string, unknown>>) ?? [], "freezers");
  await writeCollection("appointments", standaloneAppointmentsFromBackup(data), "appointments");

  if (data.settings && (data.settings as Record<string, unknown>).finance) {
    onStatus("Записываю настройки финансов...");
    await restoreDocumentFromBackup(
      "settings",
      "finance",
      (data.settings as Record<string, unknown>).finance as Record<string, unknown>,
      db,
    );
  }

  return stats;
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export function BackupTab() {
  const { clients, tasks, freezers, finance, staff, appointments } = useData();
  const { myProfile, user }                          = useAuth();

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing,   setImporting]   = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [exporting,   setExporting]   = useState(false);

  const now   = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  function handleExportJSON() {
    const data = buildJsonBackupData({
      exportedBy: user?.email ?? "",
      clients,
      staff,
      servicetasks: tasks,
      freezers,
      appointments,
      settings: { finance },
    });
    downloadJSON(data, `РефСервисДВ_бэкап_${stamp}.json`);
    setImportResult(`✅ Бэкап скачан: ${clients.length} клиентов, ${appointments.length} записей, ${tasks.length} задач, ${freezers.length} камер`);
  }

  async function handleExportExcel() {
    setExporting(true);
    try {
      exportExcel(clients, tasks, freezers, finance);
    } catch (e) {
      alert("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    }
    setExporting(false);
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportStatus("Читаю файл...");
    setImportResult(null);
    try {
      const stats = await importJSON(file, setImportStatus);
      setImportResult(
        `✅ Импорт завершён: ${stats.clients} клиентов, ${stats.appointments} записей, ${stats.tasks} задач, ${stats.freezers} камер` +
        (stats.errors ? `, ошибок: ${stats.errors}` : ""),
      );
    } catch (e) {
      setImportResult(`❌ Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    }
    setImporting(false);
    setImportStatus("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="p-4">
      <div className="text-lg font-bold text-[#172033] mb-1">Бэкап и экспорт</div>
      <div className="text-xs text-[#667085] mb-4">Только для администратора</div>

      {/* Info */}
      <div className="bg-[#E6F1FB] rounded-xl p-3 border border-[#185FA5]/20 mb-4 text-xs text-[#344054] leading-relaxed">
        JSON-бэкап содержит ВСЕ данные базы (клиенты, ремонты, задачи, камеры, финансы).
        Фото остаются в Storage — в бэкапе только ссылки на них.
        Рекомендуем делать бэкап раз в неделю.
      </div>

      {/* Export buttons */}
      <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
        <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-3">📥 Экспорт данных</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleExportJSON}
            className="py-3 rounded-xl bg-[#185FA5] text-white text-sm font-semibold cursor-pointer border-none shadow-sm active:scale-95 transition-all"
          >
            📄 JSON-бэкап
          </button>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={exporting}
            className="py-3 rounded-xl bg-[#3B6D11] text-white text-sm font-semibold cursor-pointer border-none shadow-sm active:scale-95 transition-all disabled:opacity-60"
          >
            {exporting ? "..." : "📊 Excel"}
          </button>
        </div>
        <div className="text-[10px] text-[#98A2B3] mt-2 text-center">
          {clients.length} клиентов · {appointments.length} записей · {tasks.length} задач · {freezers.length} камер
        </div>
      </div>

      {/* Import */}
      <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm mb-3">
        <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-1">📤 Восстановление из JSON</div>
        <div className="text-xs text-[#BA7517] bg-[#FAEEDA] rounded-lg p-2 border border-[#BA7517]/20 mb-3">
          ⚠️ Режим MERGE — добавляет/обновляет по ID. Существующие данные не удаляются.
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />

        <Button
          variant="secondary"
          size="lg"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          {importing ? importStatus || "Импорт..." : "Выбрать файл бэкапа (.json)"}
        </Button>

        {importResult && (
          <div
            className={`mt-3 p-3 rounded-xl text-xs font-semibold ${
              importResult.startsWith("✅")
                ? "bg-[#EAF3DE] text-[#3B6D11] border border-[#3B6D11]/20"
                : "bg-[#FBEAEA] text-[#A32D2D] border border-[#A32D2D]/20"
            }`}
          >
            {importResult}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="bg-white rounded-[18px] p-4 border border-[#E2E8F0] shadow-sm">
        <div className="text-xs font-bold text-[#667085] uppercase tracking-wide mb-3">📊 Состояние базы</div>
        {[
          { label: "Клиентов", value: clients.length },
          { label: "Ремонтов всего", value: clients.reduce((s, c) => s + (c.repairs ?? []).length, 0) },
          { label: "Записей на приём", value: appointments.length },
          { label: "Сервисных задач", value: tasks.length },
          { label: "Камер на балансе", value: freezers.length },
          { label: "Сотрудников", value: staff.length },
        ].map((s) => (
          <div key={s.label} className="flex justify-between py-1.5 border-b border-[#E2E8F0] last:border-0">
            <span className="text-sm text-[#667085]">{s.label}</span>
            <span className="text-sm font-bold text-[#172033]">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
