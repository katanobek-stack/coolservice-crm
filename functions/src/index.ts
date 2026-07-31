import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

// Set once via: firebase functions:secrets:set TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
// (the legacy `firebase functions:config:set` API was shut down Dec 31, 2025 — secrets replace it)
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID   = defineSecret("TELEGRAM_CHAT_ID");

const SECRETS = [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID];

// ─── Minimal Firestore data shapes ─────────────────────────────────────────
// Mirrors web/src/shared/types/client.ts — only the fields this function reads.

interface Photo {
  id: string;
}

interface RepairTask {
  id: string;
  description?: string;
  photos?: Photo[];
}

interface Repair {
  id: string;
  vehicleId?: string;
  cost?: string;
  closedByManager?: boolean;
  tasks?: RepairTask[];
}

interface Vehicle {
  id: string;
  plate: string;
  brand?: string;
  model?: string;
}

interface ClientDoc {
  name?: string;
  vehicles?: Vehicle[];
  repairs?: Repair[];
}

// ─── Telegram ───────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  const token  = TELEGRAM_BOT_TOKEN.value();
  const chatId = TELEGRAM_CHAT_ID.value();
  if (!token || !chatId) {
    logger.warn("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured — skipping notification");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      logger.error("Telegram sendMessage failed", { status: res.status, body: await res.text() });
    }
  } catch (err) {
    logger.error("Telegram sendMessage threw", err);
  }
}

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
      const label      = vehicleLabel(after.vehicles, repair.vehicleId);
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
        const taskLabel = esc(task.description) || "задача";
        const prevTask  = beforeTasks.get(task.id);

        if (!prevTask) {
          await sendTelegram(`➕ *Задача:* ${taskLabel} в заявке ${clientName}`);
          continue;
        }

        // Photo diffing within this task
        const beforePhotoIds = new Set((prevTask.photos ?? []).map((p) => p.id));
        const newPhotoCount  = (task.photos ?? []).filter((p) => !beforePhotoIds.has(p.id)).length;
        if (newPhotoCount > 0) {
          const what = newPhotoCount > 1 ? `${newPhotoCount} фото` : "фото";
          await sendTelegram(`📷 *Добавлено ${what}:* ${taskLabel} — заявка ${clientName}`);
        }
      }
    }
  },
);
