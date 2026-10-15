import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { auditId, workChanges } from "./workAccountingLogic";

export async function recordWorkChanges(input: {
  eventId: string; sourceKind: string; documentId: string; sourcePath: string;
  before?: Record<string, any>; after?: Record<string, any>; occurredAt: Timestamp; authId?: string;
}) {
  const changes = workChanges(input.sourceKind, input.documentId, input.before, input.after);
  if (!changes.length) return;
  const db = getFirestore();
  const actor = input.authId && !input.authId.includes("/") ? await db.doc(`staff/${input.authId}`).get() : undefined;
  const actorId = actor?.exists ? actor.id : null;
  // Event IDs deduplicate retries. Source time handles late/out-of-order delivery.
  for (let offset = 0; offset < changes.length; offset += 200) {
    const page = changes.slice(offset, offset + 200);
    await db.runTransaction(async tx => {
      const refs = page.map((_, i) => db.doc(`workEvents/${auditId(input.sourceKind, input.documentId, input.eventId, String(offset + i))}`));
      const old = await tx.getAll(...refs);
      page.forEach((change, i) => {
        if (old[i].exists) return;
        tx.create(refs[i], { ...change, staffId: change.staffId ?? actorId, sourcePath: input.sourcePath, actorId,
          actorName: actor?.data()?.name || null, selfReported: change.type === "completed" && !!actorId && actorId === change.staffId,
          visibleTo: [...new Set([...change.visibleTo, ...(actorId ? [actorId] : [])])],
          evidence: actorId ? "authenticated_write" : "observed_change", occurredAt: input.occurredAt, recordedAt: FieldValue.serverTimestamp(),
        });
      });
    });
  }
}
function auditTrigger(sourceKind: string, document: string) {
  return onDocumentWrittenWithAuthContext({ document, region: "europe-west1", retry: true }, async event => {
    if (!event.data) return;
    const after = event.data.after, before = event.data.before;
    await recordWorkChanges({ eventId: event.id, sourceKind, documentId: after.id, sourcePath: after.ref.path,
      before: before.data(), after: after.data(), authId: event.authId,
      occurredAt: after.updateTime ?? before.updateTime ?? Timestamp.fromDate(new Date(event.time)),
    });
  });
}
export const auditRepairWork = auditTrigger("repair", "clients/{id}");
export const auditIntakeWork = auditTrigger("intake", "intakeRepairs/{id}");
export const auditServiceWork = auditTrigger("service", "servicetasks/{id}");
