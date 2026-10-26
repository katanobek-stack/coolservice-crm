import { test } from "node:test";
import assert from "node:assert/strict";
import { businessDate, isRented, paymentState, rentAmount, rentalTerms, rentalRateInput, selectFreezers, warehouseSummary } from "../src/features/freezers/warehouseLogic";
import type { Freezer } from "../src/shared/types/freezer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WarehouseWorkspace } from "../src/features/freezers/WarehouseWorkspace";

const fixtures: Freezer[] = [
  { id: "b", name: "Бета", rented: true, tenant: "ООО Север", tenantPhone: "+7 (999) 123-45-67", paidUntil: "2026-10-25", rentAmount: 5000, type: "Холодильная камера", volume: 20 },
  { id: "a", name: "Альфа", status: "rented", paidUntil: "2026-10-26", rentAmount: "2 500,50" as unknown as number },
  { id: "c", name: "Гамма", location: "Владивосток", notes: "Резерв", type: "Контейнер", volume: 40 },
  { id: "d", rented: true, paidUntil: "2026-02-30", rentAmount: -1 },
];
const filters = { search: "", status: "all" as const, type: "all", attention: "all" as const, sort: "name" as const };

test("clearing rental terms sends explicit values so Firestore updates remove old deadline and rate", () => {
  const changes = rentalTerms("", "");
  assert.deepEqual(changes, { rentAmount: 0, paidUntil: "" });
  const reopened = { ...fixtures[0], ...changes };
  assert.equal(paymentState(reopened, "2026-10-26"), "unknown");
  assert.equal(rentAmount(reopened), 0);
  assert.equal(rentalRateInput(reopened), "");
  assert.equal(rentalRateInput({ id: "legacy", rentAmount: -1 }), "");
  assert.equal(rentalRateInput(fixtures[0]), "5000");
  assert.deepEqual(rentalTerms("18500.5", "2026-11-01"), { rentAmount: 18500.5, paidUntil: "2026-11-01" });
});

test("warehouse rental compatibility and business midnight", () => {
  assert.equal(isRented(fixtures[1]), true);
  assert.equal(isRented({ id: "x", rented: false, status: "rented" }), true);
  assert.equal(businessDate(new Date("2026-10-25T14:00:00Z")), "2026-10-26");
  assert.equal(businessDate(new Date("2026-10-25T13:59:59Z")), "2026-10-25");
});
test("paid through today is current; absent and invalid dates stay unknown; free equipment has no payment state", () => {
  assert.deepEqual(fixtures.map(f => paymentState(f, "2026-10-26")), ["overdue", "current", "none", "unknown"]);
  assert.equal(paymentState({ id: "x", rented: true, paidUntil: "garbage" }, "2026-10-26"), "unknown");
});
test("summary handles localized amounts without invented revenue or invalid negatives", () => {
  assert.equal(rentAmount(fixtures[1]), 2500.5);
  assert.equal(rentAmount({ id: "x", rentAmount: Infinity }), 0);
  assert.deepEqual(warehouseSummary(fixtures, "2026-10-26"), { total: 4, rented: 3, available: 1, overdue: 1, unknown: 1, monthly: 7500.5 });
});
test("search combines tenant, normalized phone, notes and type filters without mutations", () => {
  const before = JSON.stringify(fixtures);
  assert.deepEqual(selectFreezers(fixtures, { ...filters, search: "север 79991234567", status: "rented", attention: "overdue" }, "2026-10-26").map(f => f.id), ["b"]);
  assert.deepEqual(selectFreezers(fixtures, { ...filters, search: "владивосток резерв", type: "Контейнер" }, "2026-10-26").map(f => f.id), ["c"]);
  assert.deepEqual(selectFreezers(fixtures, { ...filters, attention: "unknown" }, "2026-10-26").map(f => f.id), ["d"]);
  assert.equal(JSON.stringify(fixtures), before);
});
test("sorting puts known volume first and payment deadlines before missing ones", () => {
  assert.deepEqual(selectFreezers(fixtures, { ...filters, sort: "volume" }, "2026-10-26").map(f => f.id).slice(0, 2), ["c", "b"]);
  assert.deepEqual(selectFreezers(fixtures, { ...filters, sort: "payment" }, "2026-10-26").map(f => f.id).slice(0, 2), ["b", "a"]);
  assert.equal(selectFreezers([{ id: "legacy" }], filters, "2026-10-26").length, 1);
});

test("warehouse source loading and error never present stale counts or equipment", () => {
  for (const status of ["loading", "error"] as const) {
    const html = renderToStaticMarkup(createElement(WarehouseWorkspace, { freezers: fixtures, status, manager: true, onOpen() {}, onAdd() {} }));
    assert.doesNotMatch(html, /Бета|7\s?500|freezer-illustration/);
    assert.match(html, status === "loading" ? /Загружаем оборудование/ : /Не удалось загрузить склад/);
  }
});
test("warehouse has accessible controls and preserves illustrations, management summary is hidden for mechanics", () => {
  const render = (manager: boolean) => renderToStaticMarkup(createElement(WarehouseWorkspace, { freezers: fixtures, status: "ready", manager, today: "2026-10-26", onOpen() {}, onAdd() {} }));
  const manager = render(true);
  assert.match(manager, /Поиск оборудования/);
  assert.match(manager, /Все камеры/);
  assert.match(manager, /freezer-illustration/);
  assert.match(manager, /freezer-snow/);
  assert.match(manager, /Аренда в месяц/);
  const mechanic = render(false);
  assert.doesNotMatch(mechanic, /Аренда в месяц|Добавить камеру/);
  assert.match(mechanic, /Проверить оплату/);
});
