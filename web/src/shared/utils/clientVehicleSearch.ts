import type { Client, Vehicle } from "../types/client";
import { normalizePlate, platesMatch } from "./plate";

export interface VehicleSuggestion {
  client: Client;
  vehicle: Vehicle;
  exact: boolean;
}

/** The first digit group is the car number, not the trailing region code. */
export function primaryPlateDigits(plate: string): string {
  return normalizePlate(plate).match(/\d+/)?.[0] ?? "";
}

export function suggestIntakeVehicles(clients: readonly Client[], plate: string): VehicleSuggestion[] {
  const normalized = normalizePlate(plate);
  if (!normalized) return [];
  const digits = primaryPlateDigits(plate);
  const suggestions: VehicleSuggestion[] = [];
  for (const client of clients) {
    for (const vehicle of client.vehicles ?? []) {
      const exact = platesMatch(vehicle.plate, plate);
      if (exact || (digits && primaryPlateDigits(vehicle.plate) === digits)) {
        suggestions.push({ client, vehicle, exact });
      }
    }
  }
  return suggestions.sort((a, b) => Number(b.exact) - Number(a.exact));
}

export function vehicleMatchesSearch(vehicle: Vehicle, search: string): boolean {
  const query = normalizePlate(search);
  if (!query) return false;
  const plate = normalizePlate(vehicle.plate);
  return plate.includes(query) || (/^\d+$/.test(query) && plate.replace(/\D/g, "").includes(query));
}

/** Never silently choose the first vehicle when the search has several matches. */
export function suggestedVehicleForClient(client: Client, search: string, intakePlate: string): string {
  const searched = (client.vehicles ?? []).filter((v) => vehicleMatchesSearch(v, search));
  if (searched.length) return searched.length === 1 ? searched[0].id : "";
  const suggested = suggestIntakeVehicles([client], intakePlate);
  return suggested.length === 1 ? suggested[0].vehicle.id : suggested.length ? "" : "new";
}
