import { getFirestore, FieldValue, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { randomUUID } from "node:crypto";
import { safeId } from "./dailyPlanLogic";
import { auditId } from "./workAccountingLogic";
import { getApp } from "firebase-admin/app";
import { appendWorkPhotos, parseWorkPhotos } from "./workPhotos";

// A shared closure and an employee's own work report are separate facts.
export const savePpzTask = onCall({ region: "europe-west1" }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Войдите в CRM");
  const uid = request.auth.uid, data = request.data;
  if (!data || !["create", "start", "report", "complete", "attach_photos"].includes(data.action)) throw new HttpsError("invalid-argument", "Некорректное действие");
  const id = safeId(data.id), requestId = safeId(data.requestId ?? randomUUID());
  if (data.report !== undefined && (typeof data.report !== "string" || data.report.length > 2000)) throw new HttpsError("invalid-argument", "Отчёт — до 2000 символов");
  const report = (data.report ?? "").trim();
  const photos = parseWorkPhotos(data.photos, `work-reports/${uid}/ppz/${id}`, getApp().options.projectId || process.env.GCLOUD_PROJECT || "");
  if (photos.length && !["report", "complete", "attach_photos"].includes(data.action)) throw new HttpsError("invalid-argument", "Фотографии прикладываются к отчёту или задаче");
  if (data.action === "attach_photos" && !photos.length) throw new HttpsError("invalid-argument", "Выберите фотографии задачи");
  const signatureParts = [data.action, report, String(data.title ?? ""), JSON.stringify(data.assignees ?? []), String(data.reportRevision ?? "")];
  const signature = auditId(...(photos.length ? [...signatureParts, JSON.stringify(photos)] : signatureParts));
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const profile = (await tx.get(db.doc(`staff/${uid}`))).data();
    if (!profile) throw new HttpsError("permission-denied", "Профиль сотрудника не найден");
    const administrator = request.auth!.token.role === "owner" || ["owner", "admin"].includes(profile.role);
    if (data.action === "attach_photos" && !administrator) throw new HttpsError("permission-denied", "Общие фото задачи добавляет администратор или владелец");
    const ref = db.doc(`ppzTasks/${id}`), existing = (await tx.get(ref)).data();
    const receipt = ref.collection("requests").doc(auditId(uid, requestId));
    const prior = (await tx.get(receipt)).data();
    if (prior) {
      if (prior.signature !== signature) throw new HttpsError("already-exists", "Идентификатор запроса уже использован");
      return { id };
    }
    const stamp = () => FieldValue.serverTimestamp();
    const name = String(profile.name || "Сотрудник");
    const events: DocumentData[] = [];
    let task: DocumentData;
    if (data.action === "create") {
      if (!administrator) throw new HttpsError("permission-denied", "Задачи назначает администратор или владелец");
      if (existing) throw new HttpsError("already-exists", "Задача уже существует");
      if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 200 || !Array.isArray(data.assignees) || !data.assignees.length || data.assignees.length > 50) throw new HttpsError("invalid-argument", "Укажите название и исполнителей");
      const assignees = [...new Set<string>(data.assignees.map(safeId))];
      const assigneeNames: Record<string, string> = {};
      for (const assignee of assignees) {
        const person = await tx.get(db.doc(`staff/${assignee}`));
        if (!person.exists) throw new HttpsError("not-found", "Исполнитель не найден");
        assigneeNames[assignee] = String(person.data()?.name || "Сотрудник");
      }
      task = { title: data.title.trim(), assignees, assigneeNames, status: "open", createdBy: uid, createdByName: name, createdAt: stamp() };
      tx.create(ref, task);
      events.push({ type: "task_created", staffId: uid, selfReported: false, text: "" });
    } else if (data.action === "attach_photos") {
      if (!existing) throw new HttpsError("not-found", "Задача не найдена");
      task = existing;
      const contributions: Record<string, DocumentData> = existing.photoAttachments ?? {};
      const previousPhotos = Object.values(contributions).flatMap(entry => entry.photos ?? []);
      // Same path cannot create another batch/event, even with a new request ID.
      appendWorkPhotos(previousPhotos, photos);
      const added = photos.filter(photo => !previousPhotos.some(old => old.path === photo.path));
      if (added.length) {
        tx.update(ref, { photoAttachments: { ...contributions, [auditId(uid, requestId)]: {
          actorId: uid, actorName: name, createdAt: stamp(), photos: added,
        } } });
        events.push({ type: "photo_added", staffId: uid, selfReported: false, text: "Фото задачи добавлены руководителем", photos: added });
      }
    } else {
      if (!existing) throw new HttpsError("not-found", "Задача не найдена");
      if (!existing.assignees.includes(uid)) throw new HttpsError("permission-denied", "Вы не назначены на эту задачу");
      task = existing;
      const participants = { ...(existing.participants ?? {}) };
      const own = { ...(participants[uid] ?? {}) };
      const patch: DocumentData = {};
      if (data.action === "start" && existing.status !== "done" && !own.startedAt) {
        own.name = name; own.startedAt = stamp();
        participants[uid] = own; patch.participants = participants;
        if (existing.status === "open") Object.assign(patch, { status: "in_progress", startedBy: uid, startedAt: stamp() });
        events.push({ type: "started", staffId: uid, selfReported: true, text: "" });
      }
      if (data.action === "report" || (data.action === "complete" && (report || photos.length))) {
        if (!report && !(photos.length && own.result)) throw new HttpsError("invalid-argument", "Опишите, что вы выполнили");
        if (!Number.isSafeInteger(data.reportRevision) || data.reportRevision !== (own.revision ?? 0)) throw new HttpsError("aborted", "Ваш отчёт уже изменён. Обновите задачу.");
        const first = !own.reportedAt;
        Object.assign(own, { name, result: report || own.result, revision: (own.revision ?? 0) + 1, updatedAt: stamp(), ...(first ? { reportedAt: stamp() } : {}),
          ...(photos.length ? { photos: appendWorkPhotos(own.photos ?? [], photos) } : {}) });
        participants[uid] = own; patch.participants = participants;
        events.push({ type: first ? "completed" : "report_updated", staffId: uid, selfReported: true, text: own.result, ...(photos.length ? { photos } : {}) });
      }
      if (data.action === "complete" && existing.status !== "done") {
        // Old open browser tabs can still close a task, but receive no personal
        // completion credit without a report. Updated clients require a report.
        if (!own.result && data.reportRevision !== undefined) throw new HttpsError("failed-precondition", "Сначала опишите свою выполненную работу");
        Object.assign(patch, { status: "done", completedBy: uid, completedByName: name, completedAt: stamp() });
        events.push({ type: "task_closed", staffId: uid, selfReported: false, text: own.result || "" });
      }
      if (Object.keys(patch).length) tx.update(ref, patch);
    }
    events.forEach((event, index) => tx.create(db.doc(`workEvents/${auditId("ppz", id, uid, requestId, String(index))}`), {
      ...event, workKey: `ppz/${id}`, sourceKind: "ppz", sourcePath: ref.path, title: task.title,
      actorId: uid, actorName: name, visibleTo: [...new Set<string>([...task.assignees, uid])],
      createdBy: task.createdBy ?? null, createdByName: task.createdByName ?? null,
      createdAt: task.createdAt ?? null, assigneeIds: task.assignees, assigneeNames: task.assigneeNames ?? {},
      occurredAt: stamp(), recordedAt: stamp(), evidence: "authenticated_action",
    }));
    if (events.length) tx.create(receipt, { signature, createdAt: stamp() });
    return { id };
  });
});
