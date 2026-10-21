import { getFirestore, FieldValue, Timestamp, type Transaction, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { randomUUID } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { auditId } from "./workAccountingLogic";
import { appendWorkPhotos, parseWorkPhotos } from "./workPhotos";
import { parsePlanItems, planDate, safeId, planMessage, splitMessage, taskComplete, telegramGroupIds, type PlanSource, type PlanItem } from "./dailyPlanLogic";

const REGION = "europe-west1";
const BOT = defineSecret("TELEGRAM_BOT_TOKEN");
// PPZ uses the same bot and configured groups as existing repair notifications.
// Personal TELEGRAM_CHAT_ID recipients are intentionally not included in group plans.
const GROUP = defineSecret("TELEGRAM_GROUP_CHAT_ID");
const secrets = [BOT, GROUP];
const stamp = () => FieldValue.serverTimestamp();
const db = () => getFirestore();

async function actor(request: CallableRequest, managerOnly = true) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Войдите в CRM");
  const profile = (await db().doc(`staff/${request.auth.uid}`).get()).data();
  if (!profile) throw new HttpsError("permission-denied", "Профиль сотрудника не найден");
  const manager = request.auth.token.role === "owner" || ["owner", "admin", "manager"].includes(profile.role);
  if (managerOnly && !manager) throw new HttpsError("permission-denied", "План составляет руководитель");
  return { uid: request.auth.uid, name: String(profile.name || "Сотрудник"), manager };
}
function input(request: CallableRequest) {
  const data = request.data;
  if (!data || typeof data !== "object") throw new HttpsError("invalid-argument", "Некорректный запрос");
  const staffId = safeId(data.staffId), date = planDate(data.date);
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new HttpsError("invalid-argument", "Некорректная версия плана");
  return { data, staffId, date, ref: db().doc(`dailyPlans/${staffId}_${date}`) };
}
function checkRevision(data: DocumentData | undefined, revision: number) {
  if ((data?.revision ?? 0) !== revision) throw new HttpsError("aborted", "План изменён другим сотрудником. Загрузите актуальный план.");
}
function sourcePath(source: PlanSource): string {
  return `${source.kind === "service" ? "servicetasks" : source.kind === "repair" ? "clients" : "intakeRepairs"}/${source.documentId}`;
}
async function readSource(tx: Transaction, source: PlanSource) {
  const ref = db().doc(sourcePath(source));
  const snap = await tx.get(ref);
  const document = snap.data();
  const repair = source.kind === "repair"
    ? document?.repairs?.find((r: DocumentData) => r.id === source.repairId)
    : source.kind === "intake" ? document?.repair : undefined;
  const task = source.kind === "service" ? document : repair?.tasks?.find((t: DocumentData) => t.id === source.taskId);
  return { ref, document, repair, task };
}
function assertAssigned(task: DocumentData | undefined, staffId: string) {
  if (!task) throw new HttpsError("failed-precondition", "Исходная задача удалена или перемещена. Обновите план.");
  if (!Array.isArray(task.assignees) || !task.assignees.includes(staffId)) {
    throw new HttpsError("failed-precondition", "Задача должна быть назначена выбранному сотруднику в разделе «Заявки» или «Приёмка».");
  }
}

export const saveDailyPlan = onCall({ region: REGION }, async request => {
  const by = await actor(request);
  const { data, staffId, date, ref } = input(request);
  const items = parsePlanItems(data.items);
  return db().runTransaction(async tx => {
    const plan = await tx.get(ref);
    checkRevision(plan.data(), data.revision);
    const staff = await tx.get(db().doc(`staff/${staffId}`));
    if (!staff.exists) throw new HttpsError("not-found", "Сотрудник не найден");
    const previous = await tx.get(ref.collection("draftItems"));
    const resolved = [];
    for (const item of items) {
      const source = await readSource(tx, item.source);
      if (!(item.newService && !source.document)) assertAssigned(source.task, staffId);
      resolved.push({ item, source });
    }
    for (const { item, source } of resolved) {
      if (item.newService && !source.document) {
        tx.create(source.ref, { title: item.title, taskType: "task", assignees: [staffId], doneBy: [], status: "in_progress", createdAt: stamp(), createdBy: by.uid });
      }
    }
    for (const doc of previous.docs) tx.delete(doc.ref);
    for (const item of items) {
      const { newService: _newService, ...stored } = item;
      tx.set(ref.collection("draftItems").doc(item.id), stored);
    }
    const revision = data.revision + 1;
    tx.set(ref, { staffId, date, revision, status: plan.data()?.status ?? "draft", version: plan.data()?.version ?? 0,
      hasDraft: true, updatedAt: stamp(), updatedBy: by.uid, updatedByName: by.name,
      ...(plan.exists ? {} : { createdAt: stamp(), createdBy: by.uid, createdByName: by.name, staffName: String(staff.data()?.name || "Сотрудник") }) }, { merge: true });
    return { revision };
  });
});

export const publishDailyPlan = onCall({ region: REGION, secrets }, async request => {
  const by = await actor(request);
  const { data, staffId, date, ref } = input(request);
  const chatIds = telegramGroupIds(GROUP.value());
  if (!BOT.value().trim()) throw new HttpsError("failed-precondition", "Проверьте существующий токен Telegram-бота CRM");
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const plan = snap.data();
    checkRevision(plan, data.revision);
    // Repeating the same publication must not create a second notification.
    if (!plan?.hasDraft) return { revision: plan?.revision ?? 0, version: plan?.version ?? 0 };
    const staff = await tx.get(db().doc(`staff/${staffId}`));
    if (!staff.exists) throw new HttpsError("not-found", "Сотрудник не найден");
    const draft = await tx.get(ref.collection("draftItems"));
    const old = await tx.get(ref.collection("items"));
    const items = parsePlanItems(draft.docs.map(doc => doc.data()).sort((a, b) => a.order - b.order));
    const publishedItems: { title: string; workKey: string; sourceKind: string }[] = [];
    for (const item of items) {
      const source = await readSource(tx, item.source);
      assertAssigned(source.task, staffId);
      publishedItems.push({ title: item.title, sourceKind: item.source.kind,
        workKey: item.source.kind === "service" ? `service/${item.source.documentId}` : `repair/${source.repair.id}/task/${item.source.taskId}` });
    }
    const version = (plan.version ?? 0) + 1;
    const revision = data.revision + 1;
    for (const doc of old.docs) tx.delete(doc.ref);
    for (const item of items) tx.set(ref.collection("items").doc(item.id), item);
    tx.update(ref, { status: "published", hasDraft: false, version, revision, publishedAt: stamp(), publishedBy: by.uid, publishedByName: by.name, updatedAt: stamp(), deliveryStatus: "pending" });
    tx.create(db().doc(`workEvents/${auditId("plan-published", ref.id, String(version))}`), {
      type: "plan_published", workKey: `plan/${ref.id}`, sourceKind: "plan", sourcePath: ref.path,
      title: `Дневной ППЗ ${date} · версия ${version}`, staffId, actorId: by.uid, actorName: by.name,
      createdBy: plan.createdBy ?? null, createdByName: plan.createdByName ?? null, createdAt: plan.createdAt ?? null,
      assigneeIds: [staffId], assigneeNames: { [staffId]: String(staff.data()?.name || "Сотрудник") },
      visibleTo: [...new Set([staffId, by.uid])], selfReported: false, text: "", evidence: "authenticated_action",
      occurredAt: stamp(), recordedAt: stamp(), planDate: date, planVersion: version, planItems: publishedItems,
    });
    const parts = splitMessage(planMessage(date, String(staff.data()?.name || "Сотрудник"), version, items));
    chatIds.forEach((chatId, recipient) => parts.forEach((text, part) => tx.create(db().doc(`dailyPlanNotifications/${ref.id}_${version}_${recipient}_${part}`), {
      planId: ref.id, version, recipient, part, parts: parts.length, chatId, text, status: "pending", attempts: 0, nextAttemptAt: Timestamp.now(), createdAt: stamp(),
    })));
    return { revision, version };
  });
});

export const updateDailyPlanWork = onCall({ region: REGION }, async request => {
  const by = await actor(request, false);
  const data = request.data;
  if (!data || typeof data !== "object" || (data.done !== undefined && typeof data.done !== "boolean") || typeof data.comment !== "string" || data.comment.length > 1000
    || (data.done === undefined && !data.comment.trim() && !data.photos?.length)) {
    throw new HttpsError("invalid-argument", "Некорректная отметка выполнения");
  }
  const planId = safeId(data.planId), itemId = safeId(data.itemId);
  const photos = parseWorkPhotos(data.photos, `work-reports/${by.uid}/plan/${planId}/${itemId}`, getApp().options.projectId || process.env.GCLOUD_PROJECT || "");
  await db().runTransaction(async tx => {
    const ref = db().doc(`dailyPlans/${planId}`);
    const plan = (await tx.get(ref)).data();
    if (plan?.staffId !== by.uid || plan.status !== "published") throw new HttpsError("permission-denied", "Можно отмечать только свой опубликованный план");
    const item = (await tx.get(ref.collection("items").doc(itemId))).data() as PlanItem | undefined;
    if (!item) throw new HttpsError("not-found", "Пункт плана не найден");
    const receipt = photos.length ? ref.collection("photoRequests").doc(auditId(by.uid, itemId, String(data.done), data.comment, ...photos.map(p => p.path))) : null;
    if (receipt && (await tx.get(receipt)).exists) return;
    const source = await readSource(tx, item.source);
    assertAssigned(source.task, by.uid);
    if (source.repair?.closedByManager || source.repair?.status === "cancelled") throw new HttpsError("failed-precondition", "Заявка уже закрыта");
    const task = source.task!;
    const existingPhotos = task.photos ?? [];
    const added = photos.filter(p => !existingPhotos.some((old: DocumentData) => old.path === p.path));
    const nextPhotos = photos.length ? appendWorkPhotos(existingPhotos, photos) : existingPhotos;
    const changedDone = data.done !== undefined && (task.doneBy ?? []).includes(by.uid) !== data.done;
    const doneBy = [...new Set<string>(task.doneBy ?? [])].filter(uid => uid !== by.uid);
    if (data.done) doneBy.push(by.uid);
    const updated = { ...task,
      ...(photos.length ? { photos: nextPhotos } : {}),
      ...(data.done === undefined ? {} : { doneBy, status: taskComplete({ assignees: task.assignees, doneBy }) ? "done" : "in_progress" }),
      ...(data.comment.trim() ? { workComment: [task.workComment, `${by.name}: ${data.comment.trim()}`].filter(Boolean).join("\n") } : {}) };
    if (item.source.kind === "service") tx.update(source.ref, updated);
    else {
      const repair = { ...source.repair, tasks: source.repair.tasks.map((t: DocumentData) => t.id === item.source.taskId ? updated : t) };
      tx.update(source.ref, item.source.kind === "intake" ? { repair } : { repairs: source.document!.repairs.map((r: DocumentData) => r.id === item.source.repairId ? repair : r) });
    }
    // Separate photo evidence never adds another personal completion. Stable path
    // deduplicates retries, including after a lost callable response.
    if (added.length) {
      const workKey = item.source.kind === "service" ? `service/${item.source.documentId}` : `repair/${source.repair.id}/task/${item.source.taskId}`;
      tx.create(db().doc(`workEvents/${auditId("plan-photos", workKey, by.uid, ...added.map(p => p.path))}`), {
        type: "photo_added", workKey, sourceKind: item.source.kind, sourcePath: source.ref.path, title: item.title,
        staffId: by.uid, actorId: by.uid, actorName: by.name, visibleTo: [...new Set([...task.assignees, by.uid])],
        text: data.comment.trim(), photos: added, selfReported: true, occurredAt: stamp(), recordedAt: stamp(), evidence: "authenticated_action",
      });
    }
    if (receipt) tx.create(receipt, { createdAt: stamp(), staffId: by.uid });
    if (changedDone) {
      // The callable knows the actual user; the Firestore trigger only sees a service account.
      const workKey = item.source.kind === "service" ? `service/${item.source.documentId}` : `repair/${source.repair.id}/task/${item.source.taskId}`;
      tx.create(db().collection("workEvents").doc(), {
        type: data.done ? "completed" : "completion_revoked", workKey, sourceKind: item.source.kind, sourcePath: source.ref.path,
        title: item.title, staffId: by.uid, actorId: by.uid, actorName: by.name, selfReported: true,
        visibleTo: [...new Set([...task.assignees, by.uid])], text: data.comment.trim(), occurredAt: stamp(), recordedAt: stamp(), evidence: "authenticated_action",
      });
    }
  });
  return { ok: true };
});

export const retryDailyPlanNotification = onCall({ region: REGION }, async request => {
  await actor(request);
  const planId = safeId(request.data?.planId);
  await db().runTransaction(async tx => {
    const plan = await tx.get(db().doc(`dailyPlans/${planId}`));
    const notifications = await tx.get(db().collection("dailyPlanNotifications").where("planId", "==", planId));
    let retried = false;
    for (const doc of notifications.docs) {
      const record = doc.data();
      // Ambiguous sends are never automatically resent; the manager explicitly accepts this risk.
      if (record.version === plan.data()?.version && ["failed", "unknown", "blocked"].includes(record.status)) {
        tx.update(doc.ref, { status: "pending", attempts: 0, nextAttemptAt: Timestamp.now() });
        retried = true;
      }
    }
    if (retried) tx.update(plan.ref, { deliveryStatus: "pending" });
  });
  return { ok: true };
});

async function refreshDelivery(planId: string, version: number) {
  await db().runTransaction(async tx => {
    const ref = db().doc(`dailyPlans/${planId}`);
    const plan = await tx.get(ref);
    const records = await tx.get(db().collection("dailyPlanNotifications").where("planId", "==", planId));
    const statuses = records.docs.filter(doc => doc.data().version === version).map(doc => doc.data().status);
    const status = statuses.length > 0 && statuses.every(s => s === "sent") ? "sent" : statuses.includes("unknown") ? "unknown"
      : statuses.some(s => ["failed", "blocked"].includes(s)) ? "failed" : "pending";
    if (plan.data()?.version === version) tx.update(ref, { deliveryStatus: status });
  });
}
export async function deliverDailyPlanNotification(id: string) {
  const ref = db().doc(`dailyPlanNotifications/${id}`);
  const record = await db().runTransaction<DocumentData | undefined>(async tx => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || data.status !== "pending" || data.nextAttemptAt.toMillis() > Date.now()) return undefined;
    const plan = (await tx.get(db().doc(`dailyPlans/${data.planId}`))).data();
    if (plan?.version !== data.version) { tx.update(ref, { status: "superseded" }); return undefined; }
    if (data.part > 0) {
      const prefix = `${data.planId}_${data.version}${data.recipient === undefined ? "" : `_${data.recipient}`}`;
      const previous = (await tx.get(db().doc(`dailyPlanNotifications/${prefix}_${data.part - 1}`))).data();
      if (previous?.status !== "sent") {
        if (["failed", "unknown", "blocked"].includes(previous?.status)) tx.update(ref, { status: "blocked" });
        return undefined;
      }
    }
    const attemptId = randomUUID();
    tx.update(ref, { status: "sending", startedAt: stamp(), attempts: data.attempts + 1, attemptId });
    return { ...data, attemptId };
  });
  if (!record) return;
  let result: DocumentData;
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT.value()}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: record.chatId, text: record.text, disable_web_page_preview: true }), signal: AbortSignal.timeout(15000),
    });
    const body = await response.json() as { ok?: boolean; result?: { message_id: number }; error_code?: number; parameters?: { retry_after?: number } };
    if (body.ok && body.result) result = { status: "sent", messageId: body.result.message_id, sentAt: stamp() };
    // Retry only an explicit Telegram rejection; network/parse failures may have delivered.
    else if (body.ok === false && (body.error_code === 429 || (body.error_code ?? 0) >= 500) && record.attempts < 4) {
      result = { status: "pending", nextAttemptAt: Timestamp.fromMillis(Date.now() + Math.max(60, body.parameters?.retry_after ?? 60) * 1000) };
    } else result = { status: body.ok === false ? "failed" : "unknown", errorCode: body.error_code ?? response.status };
  } catch {
    result = { status: "unknown", errorCode: "network-or-response" };
  }
  await db().runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.status === "sending" && current.attemptId === record.attemptId) tx.update(ref, result);
  });
  await refreshDelivery(record.planId, record.version);
}
export const notifyDailyPlanPublished = onDocumentCreated({ document: "dailyPlanNotifications/{id}", region: REGION, secrets }, async event => {
  await deliverDailyPlanNotification(event.params.id);
});
export const retryDailyPlanDeliveries = onSchedule({ schedule: "every 1 minutes", region: REGION, timeZone: "Asia/Vladivostok", timeoutSeconds: 540, secrets }, async () => {
  const pending = await db().collection("dailyPlanNotifications").where("status", "==", "pending")
    .where("nextAttemptAt", "<=", Timestamp.now()).orderBy("nextAttemptAt").limit(100).get();
  for (let offset = 0; offset < pending.docs.length; offset += 5) {
    await Promise.all(pending.docs.slice(offset, offset + 5).map(doc => deliverDailyPlanNotification(doc.id)));
  }
  const sending = await db().collection("dailyPlanNotifications").where("status", "==", "sending").limit(100).get();
  for (const doc of sending.docs) {
    if ((doc.data().startedAt?.toMillis() ?? Date.now()) < Date.now() - 5 * 60000) {
      // A crash after send can leave delivery uncertain. Do not blindly duplicate it.
      await db().runTransaction(async tx => {
        const fresh = (await tx.get(doc.ref)).data();
        if (fresh?.status === "sending" && fresh.startedAt.toMillis() < Date.now() - 5 * 60000) tx.update(doc.ref, { status: "unknown" });
      });
      await refreshDelivery(doc.data().planId, doc.data().version);
    }
  }
});
