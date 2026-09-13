import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";

function activeAlertMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(
    ([ruleId, eventId]) => ruleId.length > 0 && typeof eventId === "string",
  ));
}

export const closeAlertsOnMonitoringDeviceDisable = onDocumentUpdated(
  {
    document: "monitoringDevices/{deviceId}",
    region: "europe-west1",
    retry: false,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (before?.enabled !== true || after?.enabled === true) return;

    const firestore = getFirestore();
    const stateRef = firestore.doc(`monitoringDeviceState/${event.params.deviceId}`);
    const closedAt = Timestamp.now();
    await firestore.runTransaction(async (transaction) => {
      const state = await transaction.get(stateRef);
      const activeAlerts = activeAlertMap(state.data()?.activeAlertIds);
      const eventRefs = Object.values(activeAlerts).map(
        (eventId) => firestore.doc(`monitoringAlertEvents/${eventId}`),
      );
      const events = eventRefs.length ? await transaction.getAll(...eventRefs) : [];
      events.forEach((alertEvent) => {
        if (alertEvent.exists && alertEvent.data()?.state === "active") {
          transaction.update(alertEvent.ref, {
            state: "closed_by_settings",
            closedAt,
            closedReason: "device_disabled",
          });
        }
      });
      if (state.exists) {
        const stateUpdate = { activeAlertIds: {}, alertActive: false };
        transaction.set(stateRef, stateUpdate, { mergeFields: Object.keys(stateUpdate) });
      }
    });
  },
);
