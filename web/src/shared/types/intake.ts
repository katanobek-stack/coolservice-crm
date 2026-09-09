import type { Repair } from "./client";

/** Vehicle transport type as picked by the mechanic at intake. */
export type IntakeServiceType = "refrigerator" | "ac";

/** The car as described by the mechanic before it is linked to a client. */
export interface IntakeVehicle {
  plate: string;            // exactly as typed
  plateNormalized: string;  // normalizePlate(plate) — for matching
  brand?: string;
  model?: string;
  photo?: string;           // Firebase Storage download URL
  photoPath?: string;       // Storage path, kept so the file can be cleaned up
  serviceType: IntakeServiceType;
}

/**
 * A repair a mechanic opened on a walk-in car that has no client yet. Lives in
 * the `intakeRepairs` collection until a manager assigns it at close time, at
 * which point `repair` is moved into `clients/{id}.repairs[]` and this document
 * is deleted.
 */
export interface IntakeRepair {
  id: string;
  vehicle: IntakeVehicle;
  /** Same shape as an entry in `clients/{id}.repairs[]`; `vehicleId` is unset until assigned. */
  repair: Repair;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  editedBy?: string;
  editedAt?: string;
}
