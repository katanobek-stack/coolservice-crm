import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/AppShell.tsx", import.meta.url), "utf8");
const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const alertCss = readFileSync(new URL("../src/features/monitoring/monitoring.css", import.meta.url), "utf8");
const topbarSource = source.slice(source.indexOf("function Topbar("), source.indexOf("// ─── Mobile bottom nav"));
let listeners = 0;
const Topbar = new Function("React", "TAB_TITLES", "MonitoringAlertCenter",
  ts.transpileModule(topbarSource, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText + "\nreturn Topbar;")(
  React,
  { monitoring: { title: "Мониторинг", sub: "температура и связь" } },
  () => {
    listeners++;
    return React.createElement("div", { className: "monitor-alert-center" },
      React.createElement("button", { className: "monitor-alert-button", "aria-label": "Температурные аварии" }, "♧"),
      React.createElement("div", { className: "monitor-alert-panel", role: "dialog" }, "Температурные аварии"));
  },
);
const markup = renderToStaticMarkup(React.createElement(Topbar, {
  tab: "monitoring", onSearch() {}, onNewRepair() {}, onOpenDevice() {},
}));

test("search, single alert center and new repair share the same header action row", () => {
  assert.equal(listeners, 1);
  assert.equal((source.match(/<MonitoringAlertCenter\b/g) ?? []).length, 1);
  assert.match(markup, /class="topbar-right"><button[^>]*aria-label="Поиск"[\s\S]*class="monitor-alert-center"[\s\S]*Новая заявка/);
  assert.match(source, /onOpenDevice=\{openMonitoringDevice\}/);
});

test("desktop alerts are in flow, with non-shrinking actions and truncating title", () => {
  const block = alertCss.match(/\.monitor-alert-center\s*\{([^}]+)\}/)[1];
  assert.match(block, /position:\s*relative/);
  assert.doesNotMatch(block, /\b(?:top|right):/);
  assert.match(indexCss, /\.topbar-right\s*\{[^}]*flex-shrink:\s*0/);
  assert.match(indexCss, /\.topbar-heading\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
});

test("mobile preserves floating alerts without hiding or duplicating the listener", () => {
  assert.match(alertCss, /@media \(max-width: 767px\)\s*\{\s*\.monitor-alert-center\s*\{\s*position:\s*fixed/);
  assert.doesNotMatch(indexCss, /\.topbar\s*\{\s*display:\s*none/);
  assert.match(indexCss, /\.topbar\s*\{[^}]*height:\s*0[^}]*backdrop-filter:\s*none[^}]*animation:\s*none/);
});

// Optional local visual fixture: real Topbar markup/CSS, no auth or Firestore.
if (process.env.HEADER_LAYOUT_FIXTURE) {
  writeFileSync(process.env.HEADER_LAYOUT_FIXTURE, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/monitoring.css"><body><div class="crm-app"><aside class="sidebar">CRM</aside><main class="crm-main">${markup}<div class="crm-content">Проверка верхней панели — без production-данных</div></main></div></body></html>`);
}
