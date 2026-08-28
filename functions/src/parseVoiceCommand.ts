import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

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

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

type VoiceAction = "create_client" | "add_task" | "both" | "create_appointment";
type ClientType = "individual" | "company";
type TaskType = "repair" | "freon" | "service";
type AppointmentType = "diagnostics" | "repair" | "consultation";

interface VoiceResult {
  action: VoiceAction;
  clientType?: ClientType;
  client?: {
    name: string;
    phone?: string;
    vehicle?: { plate: string; brand?: string };
  };
  tasks?: Array<{ description: string; type: TaskType }>;
  mechanic?: { name: string };
  clientName?: string;
  clientPhone?: string;
  carBrand?: string;
  carModel?: string;
  date?: string;
  time?: string;
  type?: AppointmentType;
  appointmentType?: AppointmentType;
  assigneeQuery?: string;
  note?: string;
}

const REPAIR_FIELDS = new Set(["action", "clientType", "client", "tasks", "mechanic"]);
const APPOINTMENT_FIELDS = new Set([
  "action", "clientName", "clientPhone", "carBrand", "carModel", "date", "time",
  "type", "appointmentType", "assigneeQuery", "note", "mechanic",
]);
const APPOINTMENT_TYPES = new Set<AppointmentType>(["diagnostics", "repair", "consultation"]);
const TASK_TYPES = new Set<TaskType>(["repair", "freon", "service"]);
const ACTIONS = new Set<VoiceAction>(["create_client", "add_task", "both", "create_appointment"]);

function invalidVoiceResult(reason: string): never {
  throw new HttpsError("internal", `Anthropic returned invalid VoiceResult: ${reason}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidVoiceResult(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unexpected) invalidVoiceResult(`${label}.${unexpected} is not allowed`);
}

function requiredString(value: Record<string, unknown>, field: string, label: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || !candidate.trim()) {
    return invalidVoiceResult(`${label}.${field} must be a non-empty string`);
  }
  return candidate;
}

function assertOptionalString(value: Record<string, unknown>, field: string, label: string): void {
  if (value[field] !== undefined && typeof value[field] !== "string") {
    invalidVoiceResult(`${label}.${field} must be a string`);
  }
}

function validateMechanic(value: unknown): void {
  if (value === undefined) return;
  const mechanic = asRecord(value, "mechanic");
  assertAllowedFields(mechanic, new Set(["name"]), "mechanic");
  requiredString(mechanic, "name", "mechanic");
}

function validateRepairResult(result: Record<string, unknown>): void {
  assertAllowedFields(result, REPAIR_FIELDS, "VoiceResult");

  if (result.clientType !== "individual" && result.clientType !== "company") {
    invalidVoiceResult("VoiceResult.clientType is invalid");
  }

  const client = asRecord(result.client, "client");
  assertAllowedFields(client, new Set(["name", "phone", "vehicle"]), "client");
  requiredString(client, "name", "client");
  assertOptionalString(client, "phone", "client");

  if (client.vehicle !== undefined) {
    const vehicle = asRecord(client.vehicle, "client.vehicle");
    assertAllowedFields(vehicle, new Set(["plate", "brand"]), "client.vehicle");
    requiredString(vehicle, "plate", "client.vehicle");
    assertOptionalString(vehicle, "brand", "client.vehicle");
  }

  if (!Array.isArray(result.tasks)) {
    invalidVoiceResult("VoiceResult.tasks must be an array");
  }
  result.tasks.forEach((taskValue, index) => {
    const label = `tasks[${index}]`;
    const task = asRecord(taskValue, label);
    assertAllowedFields(task, new Set(["description", "type"]), label);
    requiredString(task, "description", label);
    if (typeof task.type !== "string" || !TASK_TYPES.has(task.type as TaskType)) {
      invalidVoiceResult(`${label}.type is invalid`);
    }
  });

  validateMechanic(result.mechanic);
}

function validateAppointmentResult(result: Record<string, unknown>): void {
  assertAllowedFields(result, APPOINTMENT_FIELDS, "VoiceResult");
  ["clientName", "clientPhone", "carBrand", "carModel", "date", "time", "assigneeQuery", "note"]
    .forEach((field) => assertOptionalString(result, field, "VoiceResult"));

  for (const field of ["type", "appointmentType"] as const) {
    const value = result[field];
    if (value !== undefined && (typeof value !== "string" || !APPOINTMENT_TYPES.has(value as AppointmentType))) {
      invalidVoiceResult(`VoiceResult.${field} is invalid`);
    }
  }
  if (typeof result.date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    invalidVoiceResult("VoiceResult.date must use YYYY-MM-DD");
  }
  if (typeof result.time === "string" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.time)) {
    invalidVoiceResult("VoiceResult.time must use HH:mm");
  }

  validateMechanic(result.mechanic);
}

function validateVoiceResult(value: unknown): VoiceResult {
  const result = asRecord(value, "VoiceResult");
  const action = result.action;
  if (typeof action !== "string" || !ACTIONS.has(action as VoiceAction)) {
    return invalidVoiceResult("VoiceResult.action is invalid");
  }

  if (action === "create_appointment") {
    validateAppointmentResult(result);
  } else {
    validateRepairResult(result);
  }
  return result as unknown as VoiceResult;
}

function currentVladivostokDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Vladivostok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to calculate Asia/Vladivostok date");
  return `${year}-${month}-${day}`;
}

function parseCommand(raw: string): { command: VoiceResult; cleaned: string } {
  const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new HttpsError("internal", "Anthropic returned an invalid response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]) as unknown;
  } catch {
    throw new HttpsError("internal", "Anthropic returned invalid JSON");
  }
  return { command: validateVoiceResult(parsed), cleaned };
}

export const parseVoiceCommand = onCall(
  {
    region: "europe-west1",
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 30,
    maxInstances: 3,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }

    const text = typeof request.data?.text === "string" ? request.data.text.trim() : "";
    if (!text) {
      throw new HttpsError("invalid-argument", "Voice command text is required");
    }
    if (text.length > 4000) {
      throw new HttpsError("invalid-argument", "Voice command text is too long");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY.value(),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: SYSTEM,
        messages: [{
          role: "user",
          content: `Сегодня: ${currentVladivostokDate()}. ${text}`,
        }],
      }),
    });

    if (!response.ok) {
      throw new HttpsError("unavailable", `Anthropic request failed (${response.status})`);
    }

    const data = await response.json() as AnthropicResponse;
    const raw = data.content?.find((block) => block.type === "text")?.text ?? "";
    const { command, cleaned } = parseCommand(raw);

    return { cmd: command, raw, cleaned };
  },
);
