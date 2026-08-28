import type { Appointment } from "../types/appointment";
import type { Client, LegacyClientAppointment } from "../types/client";

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ru-RU");
}

function legacyDateTime(value: string, separateTime?: string): { date: string; time: string } {
  const [date = "", rawTime = ""] = value.split("T");
  return { date, time: (rawTime || separateTime || "").slice(0, 5) };
}

function reliableLegacyKey(
  client: Client,
  appointment: LegacyClientAppointment,
): string | null {
  const { date, time } = legacyDateTime(appointment.date, appointment.time);
  if (!date || !time) return null;
  const vehicle = client.vehicles?.find((item) => item.id === appointment.vehicleId);
  const note = normalized(appointment.description);
  const car = [vehicle?.plate, vehicle?.brand, vehicle?.model].map(normalized).join("|");
  if (!note && !car.replaceAll("|", "")) return null;
  return [date, time, note, car].join("::");
}

function reliableCanonicalKey(appointment: Appointment): string | null {
  if (!appointment.date || !appointment.time) return null;
  const note = normalized(appointment.note);
  const car = [appointment.carPlate, appointment.carBrand, appointment.carModel]
    .map(normalized)
    .join("|");
  if (!note && !car.replaceAll("|", "")) return null;
  return [appointment.date, appointment.time, note, car].join("::");
}

/**
 * Keeps legacy embedded records visible, but hides a legacy dual-write copy only
 * when there is an explicit link or a unique, exact, sufficiently specific match.
 */
export function legacyAppointmentsForDisplay(
  client: Client,
  canonicalAppointments: readonly Appointment[],
): LegacyClientAppointment[] {
  const canonicalForClient = canonicalAppointments.filter((item) => item.clientId === client.id);
  const canonicalKeyCounts = new Map<string, number>();
  for (const appointment of canonicalForClient) {
    const key = reliableCanonicalKey(appointment);
    if (key) canonicalKeyCounts.set(key, (canonicalKeyCounts.get(key) ?? 0) + 1);
  }

  const legacy = client.appointments ?? [];
  const legacyKeyCounts = new Map<string, number>();
  for (const appointment of legacy) {
    const key = reliableLegacyKey(client, appointment);
    if (key) legacyKeyCounts.set(key, (legacyKeyCounts.get(key) ?? 0) + 1);
  }

  return legacy.filter((appointment) => {
    if (appointment.standaloneAppointmentId) {
      return !canonicalForClient.some((item) => item.id === appointment.standaloneAppointmentId);
    }
    const key = reliableLegacyKey(client, appointment);
    if (!key) return true;
    return canonicalKeyCounts.get(key) !== 1 || legacyKeyCounts.get(key) !== 1;
  });
}
