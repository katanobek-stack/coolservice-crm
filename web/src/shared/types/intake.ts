import type { Repair } from "./client";

/** Vehicle transport type as picked by the mechanic at intake. */
export type IntakeServiceType = "refrigerator" | "ac";

/** What kind of equipment the walk-in repair is on. */
export type IntakeKind = "vehicle" | "chamber";

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

/** A production chamber as described by the mechanic before it is linked to a client. */
export interface IntakeChamber {
  label: string;            // free-text identifier (shop / address / description)
  length?: number;          // mm
  width?: number;
  height?: number;
  wallThickness?: number;
  notes?: string;
  photo?: string;
  photoPath?: string;
}

/**
 * A repair a mechanic opened on walk-in equipment (a car or a chamber) that has
 * no client yet. Lives in `intakeRepairs` until a manager assigns it at close
 * time, at which point `repair` moves into `clients/{id}.repairs[]` and this
 * document is deleted. Legacy docs have no `kind` — treat as "vehicle".
 */
export interface IntakeRepair {
  id: string;
  kind: IntakeKind;
  vehicle?: IntakeVehicle;   // when kind === "vehicle"
  chamber?: IntakeChamber;   // when kind === "chamber"
  /** Same shape as an entry in `clients/{id}.repairs[]`; the equipment id is unset until assigned. */
  repair: Repair;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  editedBy?: string;
  editedAt?: string;
}

/** kind with the legacy fallback applied. */
export function intakeKind(intake: Pick<IntakeRepair, "kind" | "vehicle" | "chamber">): IntakeKind {
  return intake.kind ?? (intake.chamber ? "chamber" : "vehicle");
}
