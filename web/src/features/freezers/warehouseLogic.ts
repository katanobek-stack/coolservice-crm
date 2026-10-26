import type { Freezer } from "../../shared/types/freezer";

export type WarehouseStatus = "all" | "available" | "rented";
export type PaymentState = "none" | "overdue" | "current" | "unknown";
export interface WarehouseFilters {
  search: string;
  status: WarehouseStatus;
  type: string;
  attention: "all" | "overdue" | "unknown";
  sort: "name" | "payment" | "volume";
}
export const defaultWarehouseFilters: WarehouseFilters = { search: "", status: "all", type: "all", attention: "all", sort: "name" };
export const isRented = (f: Freezer) => f.rented === true || f.status === "rented";
export const freezerName = (f: Freezer) => f.name?.trim() || f.type || "Камера без названия";
export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Vladivostok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function validDate(value?: string): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === value;
}
export function paymentState(f: Freezer, today = businessDate()): PaymentState {
  if (!isRented(f)) return "none";
  if (!validDate(f.paidUntil)) return "unknown";
  return f.paidUntil < today ? "overdue" : "current";
}
export function rentAmount(f: Freezer): number {
  const n = Number(String(f.rentAmount ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
/** Explicit empty values survive Firestore's undefined-field cleanup on update. */
export function rentalTerms(rate: string, paidUntil: string) {
  return { rentAmount: rate.trim() ? Number(rate) : 0, paidUntil };
}
export function rentalRateInput(freezer?: Freezer) {
  const rate = freezer ? rentAmount(freezer) : 0;
  return rate > 0 ? String(rate) : "";
}
export const money = (amount: number) => `${amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
export function paymentLabel(f: Freezer, today = businessDate()): string {
  const state = paymentState(f, today);
  if (state === "none") return "Готова к аренде";
  if (state === "unknown") return "Дата оплаты не указана";
  const date = new Date(`${f.paidUntil}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return state === "overdue" ? `Проверить оплату · до ${date}` : `Оплачено до ${date}`;
}
export function warehouseSummary(freezers: Freezer[], today = businessDate()) {
  const rented = freezers.filter(isRented);
  return { total: freezers.length, rented: rented.length, available: freezers.length - rented.length,
    overdue: rented.filter(f => paymentState(f, today) === "overdue").length,
    unknown: rented.filter(f => paymentState(f, today) === "unknown").length,
    monthly: rented.reduce((sum, f) => sum + rentAmount(f), 0) };
}
export function selectFreezers(freezers: Freezer[], filters: WarehouseFilters, today = businessDate()): Freezer[] {
  const tokens = filters.search.toLocaleLowerCase("ru").trim().split(/\s+/).filter(Boolean);
  const rows = freezers.filter(f => {
    if (filters.status !== "all" && isRented(f) !== (filters.status === "rented")) return false;
    if (filters.type !== "all" && (f.type || "Тип не указан") !== filters.type) return false;
    if (filters.attention !== "all" && paymentState(f, today) !== filters.attention) return false;
    const haystack = [f.name, f.type, f.location, f.notes, ...(isRented(f) ? [f.tenant, f.tenantPhone, f.tenantPhone?.replace(/\D/g, "")] : [])].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    return tokens.every(token => haystack.includes(token));
  });
  return rows.sort((a, b) => {
    if (filters.sort === "payment") {
      const deadline = (f: Freezer) => isRented(f) && validDate(f.paidUntil) ? f.paidUntil : "9999-99-99";
      const diff = deadline(a).localeCompare(deadline(b));
      if (diff) return diff;
    }
    if (filters.sort === "volume") {
      const size = (f: Freezer) => Number.isFinite(f.volume) && Number(f.volume) > 0 ? Number(f.volume) : -1;
      const diff = size(b) - size(a);
      if (diff) return diff;
    }
    return freezerName(a).localeCompare(freezerName(b), "ru", { numeric: true }) || a.id.localeCompare(b.id);
  });
}
