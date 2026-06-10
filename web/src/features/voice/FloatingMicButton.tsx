import { useState, useRef, useCallback } from "react";
import { useAuth } from "../auth";
import { useData } from "../../shared/context/DataContext";
import { addClient, updateClient, addAppointment } from "../../shared/firebase/firestore";
import { genId } from "../../shared/utils/format";
import type { Vehicle, Repair, RepairTask } from "../../shared/types/client";

// ─── SpeechRecognition type shim ─────────────────────────────────────────────

interface SREvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface ISpeechRec extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: Event & { error: string }) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRec;
    webkitSpeechRecognition?: new () => ISpeechRec;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MicState = "idle" | "recording" | "processing" | "done" | "error";

interface VoiceCmd {
  action: "create_client" | "add_task" | "both" | "create_appointment";
  // for client / repair actions:
  clientType: "individual" | "company";
  client: {
    name: string;
    phone?: string;
    vehicle?: { plate: string; brand?: string };
  };
  tasks: Array<{ description: string; type: "repair" | "freon" | "service" }>;
  mechanic?: { name: string };
  // for create_appointment:
  clientName?: string;
  clientPhone?: string;
  carBrand?: string;
  carModel?: string;
  date?: string;
  time?: string;
  type?: "diagnostics" | "repair" | "consultation";        // новый формат
  appointmentType?: "diagnostics" | "repair" | "consultation"; // старый формат (совместимость)
  assigneeQuery?: string;  // имя механика/менеджера из нового формата
  note?: string;
}

// ─── Util: strip undefined fields recursively (Firestore не принимает undefined) ──

function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, val]) => val !== undefined)
        .map(([key, val]) => [key, clean(val)]),
    ) as T;
  }
  return v;
}

// ─── Claude API ───────────────────────────────────────────────────────────────

const SYSTEM = `Ты ИИ-агент CRM рефрижераторного сервиса (Владивосток).
Из голосовой команды извлеки данные и верни ТОЛЬКО JSON без пояснений и форматирования.

ЕСЛИ речь о записи на приём (слова: "запиши", "запись", "записать", "назначь визит", "визит"):
{"action":"create_appointment","clientName":"Иван Петров","clientPhone":"+79147771234","carBrand":"Toyota","carModel":"Hiace","date":"2026-06-09","time":"14:00","type":"diagnostics","assigneeQuery":"Сергей","note":""}

ЕСЛИ речь о ремонте/заявке (по умолчанию):
{"action":"both","clientType":"individual","client":{"name":"Иван Петров","phone":"89147771234","vehicle":{"plate":"К123АВ125","brand":"Toyota Hiace"}},"tasks":[{"description":"не морозит","type":"repair"}],"mechanic":{"name":"Сергей"}}

Правила:
- action "create_appointment" — запись клиента на приём (диагностика, консультация, визит)
- action "both" — создать клиента и задачи (ремонт, неисправность)
- action "create_client" — только клиент без задач
- action "add_task" — клиент уже существует, добавить задачу
- clientType "individual" — физлицо; "company" — юрлицо (ООО, ИП)
- appointmentType: "diagnostics" — диагностика; "repair" — ремонт; "consultation" — консультация
- type "repair" — ремонт, неисправность; "service" — плановое ТО
- phone (для клиента ремонта) и clientPhone (для записи на приём) — формат +7XXXXXXXXXX
- plate — кириллица+цифры без пробелов
- date — формат YYYY-MM-DD; если не указана дата явно — используй сегодняшнюю из начала сообщения
- Если задач нет — tasks:[]
- Если нет телефона — не включай поле phone
- Если нет авто — не включай поле vehicle
- Если упоминается имя механика/мастера ("назначь на ...", "... займётся") — извлеки в mechanic: {"name":"имя"}
- Если механик не упомянут — не включай поле mechanic

---
Ты умеешь создавать записи на приём в сервис. Когда пользователь говорит что-то вроде:
- "создай запись на диагностику"
- "запишись на Toyota Mark 2"
- "запись на 10 утра Петя"
- "новая запись"
- "запиши машину"

Ответь ТОЛЬКО валидным JSON без markdown, без объяснений, без \`\`\`json блоков, просто голый JSON:
{"action":"create_appointment","clientName":"Клиент","carBrand":"Toyota","carModel":"Mark 2","date":"YYYY-MM-DD","time":"10:00","type":"diagnostics","assigneeQuery":"Петя"}

Правила заполнения:
- date: если не сказана — сегодняшняя дата в формате YYYY-MM-DD
- time: если не сказано — "09:00"
- type: "diagnostics" если сказано "диагностика", "repair" если "ремонт", "consultation" если "консультация". По умолчанию "diagnostics"
- clientName: если имя клиента не сказано — "Клиент"
- carBrand: марка авто заглавной буквой на английском (Toyota, Nissan, Honda...)
- carModel: модель как сказано
- assigneeQuery: имя механика или администратора если упомянуто в речи.
  Примеры фраз: "назначить на Петю", "запиши на Вову", "механик Сергей", "отдай Пете"
  Если механик не упомянут — пустая строка ""
---`;

async function callClaude(text: string): Promise<{ cmd: VoiceCmd; raw: string; cleaned: string }> {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!key) throw new Error("Добавьте VITE_ANTHROPIC_API_KEY в файл .env");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: `Сегодня: ${new Date().toISOString().slice(0, 10)}. ${text}` }],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Claude ${r.status}: ${msg.slice(0, 120)}`);
  }

  const d = await r.json() as { content: Array<{ type: string; text: string }> };
  const raw     = d.content.find((b) => b.type === "text")?.text ?? "";
  const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Не JSON: " + cleaned.slice(0, 60));
  return { cmd: JSON.parse(m[0]) as VoiceCmd, raw, cleaned };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function taskWord(n: number) {
  if (n === 1) return "задача";
  if (n >= 2 && n <= 4) return "задачи";
  return "задач";
}

const MAX_REC_MS = 60000;  // защита от забытой записи — 60 секунд

// ─── Component ────────────────────────────────────────────────────────────────

export function FloatingMicButton() {
  const { clients, staff } = useData();
  const { user, myProfile } = useAuth();
  const [state, setState]   = useState<MicState>("idle");
  const [toast, setToast]   = useState<{ msg: string; ok: boolean } | null>(null);
  const recRef      = useRef<ISpeechRec | null>(null);
  const txtRef      = useRef("");
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const supported = typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  function flash(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4500);
  }

  function clearTimers() {
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }

  function findClient(name: string, plate?: string) {
    const n = name.toLowerCase().trim();
    const p = (plate ?? "").toUpperCase().replace(/\s/g, "");
    return clients.find((c) => {
      if (p && (c.vehicles ?? []).some(
        (v) => v.plate.toUpperCase().replace(/\s/g, "") === p,
      )) return true;
      const cn = (c.name || "").toLowerCase();
      return cn.includes(n) || n.includes(cn);
    });
  }

  const processTranscript = useCallback(async (transcript: string) => {
    if (!transcript.trim()) { setState("idle"); return; }
    setState("processing");

    // ── Claude API (мягкий catch — fallback по ключевым словам ниже) ──────────
    let cmd: VoiceCmd | null = null;
    let rawAI = "";
    try {
      const result = await callClaude(transcript);
      cmd   = result.cmd;
      rawAI = result.raw;
    } catch (claudeErr) {
      rawAI = claudeErr instanceof Error ? claudeErr.message : "Ошибка Claude";
    }

    // ── KEYWORD FALLBACK ──────────────────────────────────────────────────────
    // Если AI не вернул create_appointment — определяем по тексту сами
    if (cmd?.action !== "create_appointment") {
      const lower = transcript.toLowerCase();
      const isAppointment = ["запись", "запиши", "записать", "диагностика", "приём", "прием"]
        .some((w) => lower.includes(w));

      if (isAppointment) {
        // Вытащить время из текста
        let apptTime = "09:00";
        const tmFull = lower.match(/(\d{1,2})[:\s](\d{2})/);
        if (tmFull) {
          apptTime = `${tmFull[1].padStart(2, "0")}:${tmFull[2]}`;
        } else {
          const tmHour = lower.match(/в\s+(\d{1,2})/);
          if (tmHour) apptTime = `${tmHour[1].padStart(2, "0")}:00`;
        }
        // Вытащить марку авто из текста
        const knownBrands = ["toyota","nissan","honda","bmw","mercedes","kia","hyundai","mazda","mitsubishi","lexus"];
        const foundBrand  = knownBrands.find((b) => lower.includes(b));
        const carBrand    = foundBrand
          ? foundBrand.charAt(0).toUpperCase() + foundBrand.slice(1)
          : undefined;

        try {
          await addAppointment(clean({
            clientName:    "Клиент",
            date:          new Date().toISOString().slice(0, 10),
            time:          apptTime,
            type:          "diagnostics" as const,
            assignees:     [] as string[],
            assigneeNames: [] as string[],
            status:        "pending" as const,
            createdBy:     user?.uid ?? "",
            createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
            ...(carBrand ? { carBrand } : {}),
          }));
          flash("✅ Запись создана по ключевым словам ✅");
          setState("done");
          setTimeout(() => setState("idle"), 1500);
        } catch (fbErr) {
          console.error("[VoiceAgent] Firestore write error (keyword fallback):", fbErr);
          const code = (fbErr as { code?: string })?.code ?? "";
          flash("❌ Firestore: " + code + " " + (fbErr instanceof Error ? fbErr.message : String(fbErr)), false);
          setState("error");
          setTimeout(() => setState("idle"), 3500);
        }
        return;
      }

      // Нет ни action от AI, ни ключевых слов — показываем ошибку
      if (!cmd) {
        setState("error");
        flash("❌ " + rawAI.slice(0, 100), false);
        setTimeout(() => setState("idle"), 3500);
        return;
      }
      // cmd есть, action ≠ create_appointment → идём в repair/client логику
    }

    // ── ЗАПИСЬ НА ПРИЁМ ОТ AI ─────────────────────────────────────────────────
    if (cmd?.action === "create_appointment") {
      const assignees: string[]     = [];
      const assigneeNames: string[] = [];
      // Поддерживаем оба формата: новый assigneeQuery и старый mechanic.name
      const assigneeSearch = cmd.assigneeQuery || cmd.mechanic?.name;
      if (assigneeSearch) {
        const n = assigneeSearch.toLowerCase().trim();
        const found = staff.find((s) => {
          const sn = (s.name ?? s.email ?? "").toLowerCase();
          return sn.includes(n) || n.includes((sn || "").split(" ")[0]);
        });
        if (found) {
          assignees.push(found.id);
          assigneeNames.push(found.name ?? found.email ?? found.id);
        }
      }
      // Поддерживаем оба поля: новый "type" и старый "appointmentType"
      const apptType = cmd.type ?? cmd.appointmentType ?? "diagnostics";
      try {
        await addAppointment(clean({
          clientName:    cmd.clientName  ?? "Клиент",
          clientPhone:   cmd.clientPhone ?? undefined,
          carBrand:      cmd.carBrand    ?? undefined,
          carModel:      cmd.carModel    ?? undefined,
          date:          cmd.date ?? new Date().toISOString().slice(0, 10),
          time:          cmd.time ?? "09:00",
          type:          apptType,
          assignees,
          assigneeNames,
          status:        "pending" as const,
          note:          cmd.note || undefined,
          createdBy:     user?.uid ?? "",
          createdByName: myProfile?.name ?? user?.email ?? "Неизвестно",
        }));
      } catch (fbErr) {
        console.error("[VoiceAgent] Firestore write error (AI appointment):", fbErr);
        const code = (fbErr as { code?: string })?.code ?? "";
        flash("❌ Firestore: " + code + " " + (fbErr instanceof Error ? fbErr.message : String(fbErr)), false);
        setState("error");
        setTimeout(() => setState("idle"), 3500);
        return;
      }
      // Формируем информативный toast
      const carStr = [cmd.carBrand, cmd.carModel].filter(Boolean).join(" ");
      let successMsg = "✅ Запись создана";
      if (carStr) successMsg += `: ${carStr}`;
      if (assigneeSearch && assigneeNames.length === 0) {
        successMsg += ` (механик не найден: '${assigneeSearch}')`;
      } else if (assigneeNames.length > 0) {
        successMsg += ` → ${assigneeNames[0]}`;
      }
      flash(successMsg);
      setState("done");
      setTimeout(() => setState("idle"), 1500);
      return;
    }

    // ── РЕМОНТ / КЛИЕНТ (action ≠ create_appointment) ────────────────────────
    if (!cmd) return;

    try {
      // Найти механика по имени из голосовой команды
      const mechAssignees: string[] = [];
      if (cmd.mechanic?.name) {
        const n = cmd.mechanic.name.toLowerCase();
        const found = staff.find((s) => {
          const sn = (s.name ?? s.email ?? "").toLowerCase();
          return sn.includes(n) || n.includes((sn || "").split(" ")[0]);
        });
        if (found) mechAssignees.push(found.id);
      }

      // Автоматическая freon-задача — всегда для каждого ремонта
      const autoFreonTask: RepairTask = {
        id:          genId(),
        description: "Заправка фреона",
        assignees:   mechAssignees,
        doneBy:      [],
        status:      "in_progress",
        freonTask:   true,
      };

      // Остальные задачи из голосовой команды (freon не дублируем — уже добавлен выше)
      const voiceTasks: RepairTask[] = (cmd.tasks || [])
        .filter((t) => t.type !== "freon")
        .map((t) => clean({
          id:          genId(),
          description: t.description || "Задача",
          assignees:   mechAssignees,
          doneBy:      [] as string[],
          status:      "in_progress" as const,
        }));

      const repairTasks: RepairTask[] = [autoFreonTask, ...voiceTasks];

      const vId   = genId();
      const vData = cmd.client.vehicle;
      const vehicle: Vehicle | null = vData
        ? clean({ id: vId, plate: vData.plate, brand: vData.brand })
        : null;

      const repair: Repair | null = repairTasks.length
        ? clean({
            id:          genId(),
            vehicleId:   vehicle ? vId : undefined,
            serviceType: "refrigerator" as const,
            date:        new Date().toISOString().slice(0, 10),
            status:      "in_progress" as const,
            tasks:       repairTasks,
          })
        : null;

      // Найти существующего клиента для "add_task"
      if (cmd.action === "add_task") {
        const existing = findClient(cmd.client.name, vData?.plate);
        if (existing) {
          const repairs  = [...(existing.repairs ?? [])];
          if (repair) repairs.push(repair);
          const vehicles = [...(existing.vehicles ?? [])];
          if (vehicle && !vehicles.some((v) => v.plate === vehicle.plate)) {
            vehicles.push(vehicle);
          }
          await updateClient(existing.id, clean({ repairs, vehicles }));
          setState("done");
          flash(`✅ Задача добавлена → ${existing.name}`);
          setTimeout(() => setState("idle"), 1500);
          return;
        }
        // не найден → создаём как нового клиента
      }

      // Создать нового клиента
      await addClient(clean({
        name:        cmd.client.name,
        clientType:  cmd.clientType === "individual" ? "phys" : "legal",
        phone:       cmd.client.phone,
        vehicles:    vehicle ? [vehicle] : [],
        repairs:     repair  ? [repair]  : [],
        appointments: [],
      }));

      const n = repairTasks.length;
      flash(n > 0
        ? `✅ Создан ${cmd.client.name} + ${n} ${taskWord(n)}`
        : `✅ Создан клиент ${cmd.client.name}`,
      );
      setState("done");
      setTimeout(() => setState("idle"), 1500);

    } catch (err) {
      setState("error");
      flash(`❌ ${err instanceof Error ? err.message : "Ошибка"}`, false);
      setTimeout(() => setState("idle"), 3500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, staff, user, myProfile]);

  function startRec() {
    if (!supported) {
      flash("❌ Нужен Chrome (Android или Desktop)", false);
      return;
    }

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    txtRef.current = "";
    const r = new SR();
    r.lang           = "ru-RU";
    r.continuous     = true;
    r.interimResults = false;

    r.onresult = (e: SREvent) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + " ";
      txtRef.current = t.trim();
    };

    r.onend = () => {
      clearTimers();
      void processTranscript(txtRef.current);
    };

    r.onerror = (e) => {
      clearTimers();
      const err = (e as Event & { error: string }).error;
      if (err === "no-speech" || err === "aborted") { setState("idle"); return; }
      setState("error");
      flash("❌ Ошибка микрофона: " + err, false);
      setTimeout(() => setState("idle"), 2500);
    };

    recRef.current = r;
    r.start();
    setState("recording");

    // Автостоп через 60с — защита от забытой записи
    maxTimerRef.current = setTimeout(() => {
      recRef.current?.stop();
    }, MAX_REC_MS);
  }

  function stopRec() {
    clearTimers();
    recRef.current?.stop();
    recRef.current = null;
  }

  // Toggle: первый клик = старт, второй = стоп
  function handleClick() {
    if (state === "idle")      return startRec();
    if (state === "recording") return stopRec();
    // processing / done / error — игнорируем
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const iconClass = {
    idle:       "ti-microphone",
    recording:  "ti-microphone",
    processing: "ti-loader-2",
    done:       "ti-check",
    error:      "ti-x",
  }[state];

  return (
    <div className="mic-nav-item">
      {/* Bubble с ответом — фиксированный тост над навбаром */}
      {toast && (
        <div className={`mic-bubble${toast.ok ? "" : " mic-bubble--err"}`}>
          {toast.msg}
        </div>
      )}

      {/* Круглый градиентный контейнер иконки */}
      <button
        type="button"
        className={`mic-icon-wrap mic-icon-wrap--${state}`}
        onClick={handleClick}
        aria-label="Голосовая команда"
      >
        <i className={`ti ${iconClass}`} />
      </button>

      <span className="mic-nav-label">Голос</span>
    </div>
  );
}
