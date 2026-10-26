import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { equipmentArtwork } from "../src/features/freezers/EquipmentScene";
import { FreezerCard } from "../src/features/freezers/FreezerCard";
import type { Freezer } from "../src/shared/types/freezer";

const examples: Freezer[] = [
  { id: "demo-1", name: "Север · камера 01", type: "Холодильная камера", volume: 24, temp: "+2…+6 °C", location: "Владивосток · склад №1", rented: false },
  { id: "demo-2", name: "Полюс · камера 02", type: "Морозильная камера", volume: 18, temp: "−18 °C", location: "Холодильный комплекс · секция Б", status: "rented", tenant: "Пример арендатора", tenantPhone: "+7 (000) 000-00-00" },
  { id: "demo-3", name: "Рефконтейнер 03", type: "Рефрижераторный контейнер", volume: 32, temp: "−20…+5 °C", location: "Открытая площадка" },
];
const render = (freezer: Freezer) => renderToStaticMarkup(createElement(FreezerCard, { freezer, onClick() {} }));

test("card keeps names/specs and rental status without claiming a live connection", () => {
  const before = JSON.stringify(examples);
  const html = render(examples[1]);
  assert.match(html, /В аренде/);
  assert.match(html, /Пример арендатора/);
  assert.ok(html.includes("+7 (000) 000-00-00"));
  assert.match(html, /18 м³/);
  assert.match(html, /Температура · заданная/);
  assert.match(html, /type="button"/);
  assert.doesNotMatch(html, /Онлайн|Работает|BITZER/);
  assert.equal(JSON.stringify(examples), before);
});

test("a vacant card does not expose stale contact data from an old rental", () => {
  const html = render({ id: "vacant", rented: false, tenant: "OLD TENANT", tenantPhone: "OLD PHONE" });
  assert.doesNotMatch(html, /OLD TENANT|OLD PHONE/);
  assert.match(html, /Нет · камера свободна/);
});

test("new animation uses mechanically layered rotors and fixed guards, not fake telemetry", () => {
  const rented = render(examples[1]);
  assert.match(rented, /is-rented/);
  assert.match(rented, /Анимация аренды · не телеметрия/);
  assert.match(rented, /equipment-rotor/);
  assert.match(rented, /equipment-fan-guard/);
  assert.match(rented, /equipment-airflow/);
  assert.doesNotMatch(rented, /freezer-snow|freezer-snowflake/);
  const css = readFileSync(new URL("../src/features/freezers/equipmentScene.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
  assert.match(css, /pointer-events: none/);
});

test("legacy rented flag and missing optional fields remain readable", () => {
  assert.match(render({ id: "legacy", rented: true }), /В аренде/);
  const empty = render({ id: "empty" });
  assert.match(empty, /Открыть камеру: Камера/);
  assert.match(empty, /Свободна/);
  assert.match(empty, /Расположение не указано/);
  assert.match(empty, /Не указан/);
  assert.match(empty, /aria-hidden="true"/);
});

test("equipment categories have distinct finished artwork and fallback without altering records", () => {
  assert.equal(equipmentArtwork("Холодильная камера").asset,"coldroom.webp");
  assert.equal(equipmentArtwork("Морозильная камера").asset,"deepfreeze.webp");
  assert.equal(equipmentArtwork("Рефрижераторный контейнер").asset,"container.webp");
  assert.equal(equipmentArtwork("Витрина").asset,"cabinet.webp");
  assert.equal(equipmentArtwork(undefined).asset,"coldroom.webp");
  assert.equal(equipmentArtwork("Другое").asset,"coldroom.webp");
  const html=render(examples[0]);
  assert.match(html,/src="\/warehouse\/coldroom.webp"/);
  assert.match(html,/alt=""/);
  assert.match(html,/loading="lazy"/);
  assert.match(html,/width="1200"/);
  assert.match(html,/height="800"/);
});

test("scene clip and material IDs are unique across cards", () => {
  const html=renderToStaticMarkup(createElement("div",null,examples.map(f=>createElement(FreezerCard,{key:f.id,freezer:f,onClick(){}}))));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(ids.length>0);
  assert.equal(new Set(ids).size,ids.length);
  for(const ref of html.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref[1]));
});

test("all equipment artwork is packaged as compact WebP files outside the JavaScript bundle", () => {
  for (const name of ["coldroom", "deepfreeze", "container", "cabinet"]) {
    const bytes = readFileSync(new URL(`../public/warehouse/${name}.webp`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.ok(bytes.length < 150_000, `${name} should remain small enough for catalog cards`);
  }
});

if (process.env.FREEZER_CARD_PREVIEW) {
  const cards = renderToStaticMarkup(createElement("div", { className: "freezer-grid" }, examples.map((freezer) => createElement(FreezerCard, { key: freezer.id, freezer, onClick() {} }))));
  writeFileSync(process.env.FREEZER_CARD_PREVIEW, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/freezers.css"><body><main style="max-width:1160px;margin:40px auto;padding:20px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px"><div><p style="color:#7b91a6;font-size:11px;letter-spacing:2px;margin:0 0 8px">REFSERVICE / ОБОРУДОВАНИЕ</p><h1 style="margin:0;font-size:28px;letter-spacing:-1px">Холодильные камеры</h1><p style="color:#6d8092;font-size:13px">Локальный дизайн-превью · демонстрационные данные</p></div><span style="padding:9px 14px;background:#fff;border:1px solid #dee7ee;border-radius:12px;font-size:12px">3 камеры / 2 свободны</span></div><section class="crm-section">${cards}</section></main></body></html>`);
}
