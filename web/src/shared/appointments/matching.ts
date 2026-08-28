import type { Client } from "../types/client";

export interface AppointmentClientIdentity {
  clientName?: string;
  clientPhone?: string;
  carBrand?: string;
  carModel?: string;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function normalizePhone(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Returns a client only for an unambiguous exact identity match. */
export function findExistingAppointmentClient(
  clients: readonly Client[],
  identity: AppointmentClientIdentity,
): Client | undefined {
  const phone = normalizePhone(identity.clientPhone);
  if (phone.length >= 7) {
    const byPhone = clients.filter((client) => normalizePhone(client.phone) === phone);
    if (byPhone.length === 1) return byPhone[0];
  }

  const name = normalizeText(identity.clientName);
  if (!name || name === "клиент") return undefined;
  let matches = clients.filter((client) => normalizeText(client.name) === name);
  if (matches.length === 1) return matches[0];

  const brand = normalizeText(identity.carBrand);
  const model = normalizeText(identity.carModel);
  if (matches.length > 1 && (brand || model)) {
    matches = matches.filter((client) => (client.vehicles ?? []).some((vehicle) =>
      (!brand || normalizeText(vehicle.brand) === brand) &&
      (!model || normalizeText(vehicle.model) === model)));
  }
  return matches.length === 1 ? matches[0] : undefined;
}
