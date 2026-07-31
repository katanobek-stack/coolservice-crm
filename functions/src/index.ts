import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

// Set once via: firebase functions:secrets:set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_GROUP_CHAT_ID
// (the legacy `firebase functions:config:set` API was shut down Dec 31, 2025 — secrets replace it)
//
// Recipients = TELEGRAM_CHAT_ID (личный чат — may itself be a comma-separated list)
//            + TELEGRAM_GROUP_CHAT_ID (группа админов), if set. Either can be empty/unset.
const TELEGRAM_BOT_TOKEN     = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID       = defineSecret("TELEGRAM_CHAT_ID");
const TELEGRAM_GROUP_CHAT_ID = defineSecret("TELEGRAM_GROUP_CHAT_ID");

const SECRETS = [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_GROUP_CHAT_ID];

// ─── Minimal Firestore data shapes ─────────────────────────────────────────
// Mirrors web/src/shared/types/client.ts — only the fields this function reads.

interface Photo {
  id:    string;
  url?:  string; // Firebase Storage download URL (current format) — publicly readable (storage.rules)
  data?: string; // legacy base64 data URL
}

interface RepairTask {
  id: string;
  description?:   string;
  status?:        "in_progress" | "done";
  assignees?:     string[];
  doneBy?:        string[]; // uids who marked themselves done — task is "done" once this ⊇ assignees
  workComment?:   string; // "примечание" left by whoever worked the task
  photos?:        Photo[];
  createdBy?:     string;
  createdByName?: string; // who created this task — also used as "кто добавил фото"
}

// Mirrors web/src/shared/utils/repair.ts taskStatus() — a task counts as done either by an
// explicit status flag or once every assignee has marked themselves done via doneBy.
function taskDone(t: RepairTask): boolean {
  if (t.status === "done") return true;
  const assignees = t.assignees ?? [];
  const doneBy    = t.doneBy ?? [];
  return assignees.length > 0 && assignees.every((uid) => doneBy.includes(uid));
}

interface Repair {
  id: string;
  vehicleId?:       string;
  cost?:             string;
  closedByManager?: boolean;
  createdByName?:   string; // fallback "автор" for tasks that predate task-level createdByName tracking
  tasks?:            RepairTask[];
}

interface Vehicle {
  id: string;
  plate: string;
  brand?: string;
  model?: string;
}

interface ClientDoc {
  name?:      string;
  vehicles?:  Vehicle[];
  repairs?:   Repair[];
}

// ─── Telegram — low-level senders ──────────────────────────────────────────

function chatIds(): string[] {
  const personal = (TELEGRAM_CHAT_ID.value() ?? "").split(",");
  const group    = (TELEGRAM_GROUP_CHAT_ID.value() ?? "").split(",");
  return [...personal, ...group].map((s) => s.trim()).filter(Boolean);
}

async function callTelegram(method: string, body: Record<string, unknown>): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.error(`Telegram ${method} failed`, { status: res.status, body: await res.text() });
    }
  } catch (err) {
    logger.error(`Telegram ${method} threw`, err);
  }
}

async function callTelegramMultipart(method: string, form: FormData): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
    if (!res.ok) {
      logger.error(`Telegram ${method} (multipart) failed`, { status: res.status, body: await res.text() });
    }
  } catch (err) {
    logger.error(`Telegram ${method} (multipart) threw`, err);
  }
}

// Plain text notification (заявка created/closed, задача created)
async function sendTelegram(text: string): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  const ids   = chatIds();
  if (!token || ids.length === 0) {
    logger.warn("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured — skipping notification");
    return;
  }
  await Promise.all(ids.map((chat_id) =>
    callTelegram("sendMessage", { chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  ));
}

// Single photo, by public Storage URL, with a caption
async function sendTelegramPhotoUrl(photoUrl: string, caption: string): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  const ids   = chatIds();
  if (!token || ids.length === 0) return;
  await Promise.all(ids.map((chat_id) =>
    callTelegram("sendPhoto", { chat_id, photo: photoUrl, caption, parse_mode: "Markdown" }),
  ));
}

// Several photos as one album (Telegram caps albums at 10 items) — caption on the first item only
async function sendTelegramMediaGroup(photoUrls: string[], caption: string): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  const ids   = chatIds();
  if (!token || ids.length === 0 || photoUrls.length === 0) return;
  const media = photoUrls.slice(0, 10).map((url, i) => ({
    type:  "photo",
    media: url,
    ...(i === 0 ? { caption, parse_mode: "Markdown" } : {}),
  }));
  await Promise.all(ids.map((chat_id) => callTelegram("sendMediaGroup", { chat_id, media })));
}

// Legacy base64 photo — Telegram can't fetch a data: URI, so upload the bytes directly
async function sendTelegramPhotoData(dataUrl: string, caption: string): Promise<void> {
  const token = TELEGRAM_BOT_TOKEN.value();
  const ids   = chatIds();
  if (!token || ids.length === 0) return;
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    logger.warn("Unrecognized base64 photo format — falling back to text notification");
    await sendTelegram(caption);
    return;
  }
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  await Promise.all(ids.map(async (chat_id) => {
    const form = new FormData();
    form.append("chat_id", chat_id);
    form.append("caption", caption);
    form.append("parse_mode", "Markdown");
    form.append("photo", new Blob([bytes], { type: mime }), "photo.jpg");
    await callTelegramMultipart("sendPhoto", form);
  }));
}

// Send one or more new photos for a task, with the given caption; falls back to a
// text-only notification if photo delivery fails so the event is never silently lost.
async function notifyNewPhotos(photos: Photo[], caption: string): Promise<void> {
  const urls     = photos.map((p) => p.url).filter((u): u is string => !!u);
  const dataUris = photos.filter((p) => !p.url && p.data).map((p) => p.data!);

  try {
    if (urls.length === 1) {
      await sendTelegramPhotoUrl(urls[0], caption);
    } else if (urls.length > 1) {
      await sendTelegramMediaGroup(urls, caption);
    }
    for (const dataUri of dataUris) {
      await sendTelegramPhotoData(dataUri, caption);
    }
    if (urls.length === 0 && dataUris.length === 0) {
      await sendTelegram(caption);
    }
  } catch (err) {
    logger.error("notifyNewPhotos failed, falling back to text", err);
    await sendTelegram(caption);
  }
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

// Escape Telegram legacy-Markdown special chars in user-supplied text
function esc(s: string | undefined | null): string {
  return (s ?? "").replace(/([_*`[])/g, "\\$1");
}

function vehicleLabel(vehicles: Vehicle[] | undefined, vehicleId: string | undefined): string {
  const v = (vehicles ?? []).find((veh) => veh.id === vehicleId);
  if (!v) return "";
  const brand = v.brand ?? v.model ?? "";
  return [brand, v.plate].filter(Boolean).map(esc).join(" · ");
}

function fmtMoney(cost: string | undefined): string {
  const n = parseFloat(cost ?? "0") || 0;
  return Math.round(n).toLocaleString("ru-RU") + " ₽";
}

function byId<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

function taskCaption(task: RepairTask, clientName: string, vehicleLbl: string, repairCreator?: string): string {
  const title    = esc(task.description) || "Задача";
  // Task-level createdByName only exists on tasks created after that tracking was added —
  // older tasks fall back to who created the containing заявка, then finally "Неизвестно".
  const creator  = esc(task.createdByName ?? repairCreator) || "Неизвестно";
  const lines = [
    `📷 *${title}*`,
    `Клиент: ${clientName}${vehicleLbl ? ` · ${vehicleLbl}` : ""}`,
    `Добавил: ${creator}`,
  ];
  if (task.workComment?.trim()) lines.push(esc(task.workComment.trim()));
  return lines.join("\n");
}

// ─── clients/{clientId} onCreate ───────────────────────────────────────────
// Covers the rare "new client created with a repair already attached" path
// (e.g. the voice assistant). Only fires the "новая заявка" event — task/photo
// notifications are left to onUpdate so a bulk creation doesn't spam the chat.

export const notifyClientCreated = onDocumentCreated(
  { document: "clients/{clientId}", secrets: SECRETS },
  async (event) => {
    const data = event.data?.data() as ClientDoc | undefined;
    if (!data) return;

    const clientName = esc(data.name) || "Клиент";
    for (const repair of data.repairs ?? []) {
      const label = vehicleLabel(data.vehicles, repair.vehicleId);
      await sendTelegram(`🆕 *Новая заявка:* ${clientName}${label ? ` — ${label}` : ""}`);
    }
  },
);

// ─── clients/{clientId} onUpdate ───────────────────────────────────────────
// repairs/tasks/photos live as nested arrays on the client document (no
// separate collections), so new заявки/задачи/фото are detected by diffing
// before.repairs vs after.repairs by id.

export const notifyClientUpdated = onDocumentUpdated(
  { document: "clients/{clientId}", secrets: SECRETS },
  async (event) => {
    const before = event.data?.before.data() as ClientDoc | undefined;
    const after  = event.data?.after.data()  as ClientDoc | undefined;
    if (!before || !after) return;

    const clientName    = esc(after.name) || "Клиент";
    const beforeRepairs = byId(before.repairs);

    for (const repair of after.repairs ?? []) {
      const label       = vehicleLabel(after.vehicles, repair.vehicleId);
      const vehiclePart = label ? ` — ${label}` : "";
      const prevRepair  = beforeRepairs.get(repair.id);

      if (!prevRepair) {
        // Новая заявка (added to an existing client via updateClientArray)
        await sendTelegram(`🆕 *Новая заявка:* ${clientName}${vehiclePart}`);
        continue;
      }

      // Заявка закрыта — closedByManager flips false → true
      if (!prevRepair.closedByManager && repair.closedByManager) {
        await sendTelegram(`✅ *Заявка закрыта:* ${clientName}${vehiclePart} — ${fmtMoney(repair.cost)}`);
      }

      // Task diffing within this repair
      const beforeTasks = byId(prevRepair.tasks);
      for (const task of repair.tasks ?? []) {
        const taskLabel = esc(task.description) || "Задача";
        const prevTask  = beforeTasks.get(task.id);

        if (!prevTask) {
          const creator = esc(task.createdByName ?? repair.createdByName) || "Неизвестно";
          await sendTelegram(`➕ *Задача:* ${taskLabel}\nЗаявка: ${clientName}\nСоздал: ${creator}`);
          continue;
        }

        // Задача закрыта — done flips false → true (independent of the repair itself closing)
        if (!taskDone(prevTask) && taskDone(task)) {
          await sendTelegram(`✅ *Задача закрыта:* ${taskLabel} — ${clientName}${vehiclePart}`);
        }

        // Photo diffing within this task
        const beforePhotoIds = new Set((prevTask.photos ?? []).map((p) => p.id));
        const newPhotos       = (task.photos ?? []).filter((p) => !beforePhotoIds.has(p.id));
        if (newPhotos.length > 0) {
          await notifyNewPhotos(newPhotos, taskCaption(task, clientName, label, repair.createdByName));
        }
      }
    }
  },
);
