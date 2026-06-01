export type FreezerStatus = "active" | "storage" | "rented";

export interface Freezer {
  id: string;
  name: string;
  client?: string;
  power?: string;
  temp?: string;
  location?: string;
  notes?: string;
  status: FreezerStatus;
  rentalRate?: string;
  rentedTo?: string;
  rentedFrom?: string;
  createdAt?: unknown;
}
