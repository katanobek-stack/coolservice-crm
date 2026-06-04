import { useState, useRef, useCallback } from "react";
import { useData } from "../../shared/context/DataContext";
import { addClient, updateClient } from "../../shared/firebase/firestore";
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
  action: "create_client" | "add_task" | "both";
  clientType: "individual" | "company";
  client: {
    name: string;
    phone?: string;
    vehicle?: { plate: string; brand?: string };
  };
  tasks: Array<{ description: string; type: "repair" | "freon" | "service" }>;
  mechanic?: { name: string };
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

Пример формата:
{"action":"both","clientType":"individual","client":{"name":"Иван Петров","phone":"89147771234","vehicle":{"plate":"К123АВ125","brand":"Toyota Hiace"}},"tasks":[{"description":"не морозит","type":"repair"}],"mechanic":{"name":"Сергей"}}

Правила:
- action "both" — создать клиента и задачи (используй по умолчанию)
- action "create_client" — только клиент без задач
- action "add_task" — клиент уже существует, добавить задачу
- clientType "individual" — физлицо; "company" — юрлицо (ООО, ИП)
- type "repair" — ремонт, неисправность
- type "service" — плановое ТО
- phone — только цифры без пробелов и знаков
- plate — кириллица+цифры без пробелов
- Если задач нет — tasks:[]
- Если нет телефона — не включай поле phone
- Если нет авто — не включай поле vehicle
- Если упоминается имя механика/мастера ("назначь на ...", "... займётся") — извлеки в mechanic: {"name":"имя"}
- Если механик не упомянут — не включай поле mechanic`;

async function callClaude(text: string): Promise<VoiceCmd> {
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
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`Claude ${r.status}: ${msg.slice(0, 120)}`);
  }

  const d = await r.json() as { content: Array<{ type: string; text: string }> };
  const raw = d.content.find((b) => b.type === "text")?.text ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Неверный ответ Claude");
  return JSON.parse(m[0]) as VoiceCmd;
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

    try {
      const cmd = await callClaude(transcript);

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
  }, [clients, staff]);

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
      {/* Bubble с ответом — появляется над навбаром */}
      {toast && (
        <div className={`mic-bubble${toast.ok ? "" : " mic-bubble--err"}`}>
          {toast.msg}
        </div>
      )}

      {/* Кнопка, приподнятая над панелью */}
      <div className="mic-nav-btn-wrap">
        {state === "recording" && (
          <>
            <span className="mic-ring" />
            <span className="mic-ring mic-ring--delayed" />
          </>
        )}
        <button
          className={`mic-nav-btn mic-nav-btn--${state}`}
          onClick={handleClick}
          aria-label="Голосовая команда"
        >
          <i className={`ti ${iconClass}`} />
        </button>
      </div>

      <span className="mic-nav-label">Голос</span>
    </div>
  );
}
