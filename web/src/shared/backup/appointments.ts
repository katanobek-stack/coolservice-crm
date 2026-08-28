import type { Appointment } from "../types/appointment";
import type { Client } from "../types/client";
import { Timestamp } from "firebase/firestore";

export interface JsonBackupData {
  version: number;
  exportedAt: string;
  exportedBy: string;
  clients: Client[];
  staff: unknown[];
  servicetasks: unknown[];
  freezers: unknown[];
  appointments?: Appointment[];
  settings: { finance: Record<string, unknown> };
}

export function buildJsonBackupData(
  data: Omit<JsonBackupData, "version" | "exportedAt">,
  exportedAt = new Date().toISOString(),
): JsonBackupData {
  return {
    version: 2,
    exportedAt,
    ...data,
    appointments: data.appointments ?? [],
  };
}

/** Version 1 backups remain valid; their embedded client appointments stay untouched. */
export function standaloneAppointmentsFromBackup(
  data: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(data.appointments)) return [];
  return data.appointments.map((item) => {
    const appointment = { ...(item as Record<string, unknown>) };
    for (const field of ["createdAt", "updatedAt"]) {
      const value = appointment[field];
      if (
        value && typeof value === "object" &&
        (value as Record<string, unknown>).type === "firestore/timestamp/1.0" &&
        typeof (value as Record<string, unknown>).seconds === "number" &&
        typeof (value as Record<string, unknown>).nanoseconds === "number"
      ) {
        appointment[field] = new Timestamp(
          (value as { seconds: number }).seconds,
          (value as { nanoseconds: number }).nanoseconds,
        );
      }
    }
    return appointment;
  });
}

/** Legacy arrays remain archival client data and are restored as-is. They are
 * never converted into standalone appointments, so restore cannot create a new
 * dual-write pair or lose an archive when restoring to an empty database. */
export function clientsFromBackup(
  data: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(data.clients)) return [];
  return data.clients.map((item) => {
    const client = item as Record<string, unknown>;
    if (!Array.isArray(client.appointments) || client.appointments.length > 0) return client;
    const { appointments: _emptyLegacyArchive, ...withoutEmptyArchive } = client;
    return withoutEmptyArchive;
  });
}
