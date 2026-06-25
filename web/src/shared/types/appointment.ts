import type { Timestamp } from "firebase/firestore";

export interface AppointmentDoc {
  id: string;
  clientName: string;
  carBrand?: string;
  carModel?: string;
  carPlate?: string;
  date: string;               // "YYYY-MM-DD"
  time: string;               // "HH:MM"
  type: "diagnostics" | "repair" | "consultation";
  assignees: string[];
  assigneeNames: string[];
  status: "pending" | "closed";
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp;
  clientId?: string;
  repairId?: string;
  outcome?: "repair" | "declined";
  clientPhone?: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}
