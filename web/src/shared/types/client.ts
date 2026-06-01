export type ClientType = "phys" | "legal";

export interface Vehicle {
  id: string;
  plate: string;
  model?: string;
  year?: string;
  photo?: string;
}

export interface RepairTask {
  id: string;
  description: string;
  assignees: string[];
  doneBy: string[];
  status: "in_progress" | "done";
  workComment?: string;
  photos?: Photo[];
  freonTask?: boolean;
  freonKg?: string;
}

export interface Photo {
  id: string;
  url: string;
  path: string;
}

export type ServiceType = "refrigerator" | "ac" | "freezer" | "other";

export interface Repair {
  id: string;
  vehicleId?: string;
  serviceType: ServiceType;
  description?: string;
  date?: string;
  cost?: string;
  status?: "in_progress" | "done" | "cancelled";
  closedByManager?: boolean;
  freonType?: string;
  freonAmount?: string;
  photos?: Photo[];
  tasks: RepairTask[];
}

export interface Appointment {
  id: string;
  date: string;
  time?: string;
  description?: string;
}

export interface Client {
  id: string;
  name: string;
  type?: ClientType;
  phone?: string;
  note?: string;
  inn?: string;
  contactPerson?: string;
  vehicles: Vehicle[];
  repairs: Repair[];
  appointments: Appointment[];
  createdAt?: unknown;
}
