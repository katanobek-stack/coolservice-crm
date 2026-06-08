export type ClientType = "phys" | "legal";

export interface Vehicle {
  id: string;
  plate: string;
  brand?: string;   // поле в Firebase называется brand (не model)
  model?: string;   // алиас для совместимости
  year?: string;
  notes?: string;
  photo?: string;   // base64 data URL (сжатая миниатюра)
  serviceType?: string;
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
  freonType?: string;
  freonKg?: string;
}

export interface Photo {
  id:    string;
  url?:  string;   // Firebase Storage URL (новый формат)
  data?: string;   // base64 (устаревший формат)
  path?: string;
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
  closedAt?: string;
  freonType?: string;
  freonAmount?: string;
  photos?: Photo[];
  tasks: RepairTask[];
  mechanics?: string[];
  createdBy?: string;
  createdByName?: string;
  editedBy?: string;
  editedAt?: string;
}

export interface Appointment {
  id: string;
  date: string;
  time?: string;
  description?: string;
  vehicleId?: string;
  serviceType?: string;
}

export interface Client {
  id: string;
  name: string;
  // Firebase поле называется clientType, не type
  clientType?: ClientType;
  type?: ClientType;          // для совместимости с данными нового кода
  phone?: string;
  note?: string;
  inn?: string;
  contactPerson?: string;
  subscription?: number;
  vehicles: Vehicle[];
  repairs: Repair[];
  appointments: Appointment[];
  createdAt?: unknown;
  // Поля конвертации физлица в юрлицо
  companyName?: string;
  bankAccount?: string;
  legalAddress?: string;
  convertedFrom?: "individual";
  convertedAt?: string;
  convertedBy?: string;
  previousName?: string;
  comment?: string;
}
