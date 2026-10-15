import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { safeId } from "./dailyPlanLogic";

// One document per shared task. All transitions are serialized by a transaction.
export const savePpzTask = onCall({ region: "europe-west1" }, async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Войдите в CRM");
  const uid = request.auth.uid;
  const data = request.data;
  if (!data || !["create", "start", "complete"].includes(data.action)) {
    throw new HttpsError("invalid-argument", "Некорректное действие");
  }
  const id = safeId(data.id);
  const db = getFirestore();
  return db.runTransaction(async tx => {
    const profile = (await tx.get(db.doc(`staff/${uid}`))).data();
    if (!profile) throw new HttpsError("permission-denied", "Профиль сотрудника не найден");
    const administrator = request.auth!.token.role === "owner" || ["owner", "admin"].includes(profile.role);
    const ref = db.doc(`ppzTasks/${id}`);
    const existing = (await tx.get(ref)).data();
    if (data.action === "create") {
      if (!administrator) throw new HttpsError("permission-denied", "Задачи назначает администратор или владелец");
      if (existing) throw new HttpsError("already-exists", "Задача уже существует");
      if (typeof data.title !== "string" || !data.title.trim() || data.title.length > 200
        || !Array.isArray(data.assignees) || !data.assignees.length || data.assignees.length > 50) {
        throw new HttpsError("invalid-argument", "Укажите название и исполнителей");
      }
      const assignees = [...new Set<string>(data.assignees.map(safeId))];
      for (const assignee of assignees) {
        if (!(await tx.get(db.doc(`staff/${assignee}`))).exists) throw new HttpsError("not-found", "Исполнитель не найден");
      }
      tx.create(ref, { title: data.title.trim(), assignees, status: "open", createdBy: uid, createdAt: FieldValue.serverTimestamp() });
    } else {
      if (!existing) throw new HttpsError("not-found", "Задача не найдена");
      if (!existing.assignees.includes(uid)) throw new HttpsError("permission-denied", "Вы не назначены на эту задачу");
      // Retrying or concurrent completion preserves the first author and time.
      if (existing.status === "done") return { id };
      if (data.action === "complete") tx.update(ref, { status: "done", completedBy: uid, completedByName: String(profile.name || "Сотрудник"), completedAt: FieldValue.serverTimestamp() });
      else if (existing.status === "open") tx.update(ref, { status: "in_progress", startedBy: uid, startedAt: FieldValue.serverTimestamp() });
    }
    return { id };
  });
});
