export interface RentHistoryEntry {
  tenant:      string;
  rentFrom:    string;
  rentTo:      string;
  rentAmount:  number;
  meterStart:  number | null;
  meterEnd:    number | null;
  paidUntil?:  string;
}

export interface Freezer {
  id: string;

  // Basic info
  name?:   string;
  type?:   string;    // Рефрижераторный контейнер, Холодильная камера, ...
  volume?: number;    // м³
  notes?:  string;

  // Old app rental fields (boolean model)
  rented?:      boolean;
  tenant?:      string;
  rentAmount?:  number;
  rentFrom?:    string;
  paidUntil?:   string;
  meterStart?:  number | null;
  meterCurrent?: number | null;
  rentHistory?: RentHistoryEntry[];

  // New / extended fields
  status?:     "active" | "storage" | "rented";
  location?:   string;
  temp?:       string;
  power?:      string;

  createdAt?: unknown;
}

export const FREEZER_TYPES = [
  "Рефрижераторный контейнер",
  "Холодильная камера",
  "Морозильная камера",
  "Витрина",
  "Другое",
];
