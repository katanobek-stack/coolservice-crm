import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync } from "node:fs";
import { TaskCard } from "../src/features/daily-plan/PpzTasks";
import { PhotoEvidence, ReportPhotoPicker } from "../src/features/daily-plan/ReportPhotos";

const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#d5e9f8"/><path d="M25 85L60 40L110 70L135 25" fill="none" stroke="#5687b0" stroke-width="10"/><text x="24" y="110" fill="#416788" font-size="12">ДЕМО · ФОТО</text></svg>')}`;
const photo = { id: "demo", url: image };
const task = {
  id: "demo-task", title: "Подготовить холодильную камеру к монтажу", description: "Бокс №2 · сборка и подключение оборудования", assignees: ["a", "b"], status: "in_progress" as const,
  participants: { a: { name: "Александр", result: "Собрал раму, установил панели и проверил герметичность.", photos: [photo], revision: 1 } },
};
const name = (id: string) => id === "a" ? "Александр" : "Владимир";
test("task shows each employee, personal photo evidence and accessible upload controls", () => {
  const html = renderToStaticMarkup(createElement(TaskCard, { task, uid: "b", name }));
  assert.match(html, /Александр/); assert.match(html, /Владимир/);
  assert.match(html, /ppz-task--in_progress/); assert.match(html, /is-reported/); assert.match(html, /is-waiting/);
  assert.match(html, /Фотоотчёт · 1/); assert.match(html, /Снять фото работы/); assert.match(html, /Фото работы из галереи/);
  const foreign = renderToStaticMarkup(createElement(TaskCard, { task, uid: "not-assigned", name }));
  assert.doesNotMatch(foreign, /Фото работы из галереи/);
});
test("legacy evidence can be absent and busy picker is disabled", () => {
  assert.equal(renderToStaticMarkup(createElement(PhotoEvidence, {})), "");
  const html = renderToStaticMarkup(createElement(ReportPhotoPicker, { files: [], onChange() {}, disabled: true }));
  assert.match(html, /fieldset disabled/); assert.match(html, /до 6/);
});
if (process.env.PPZ_PHOTO_PREVIEW) {
  const cards = renderToStaticMarkup(createElement("div", { className: "ppz" },
    createElement("h2", null, "ППЗ · задачи команды"), createElement("p", null, "Локальное превью · демонстрационные данные"),
    createElement(TaskCard, { task, uid: "b", name }),
    createElement(TaskCard, { task: { ...task, id: "open", title: "Подготовить инструмент для выезда", status: "open", participants: {} }, uid: "a", name })));
  writeFileSync(process.env.PPZ_PHOTO_PREVIEW, `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/index.css"><link rel="stylesheet" href="/ppz.css"><body><main style="max-width:1050px;margin:24px auto;padding:16px">${cards}</main></body></html>`);
}
