import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { TaskCard } from "../src/features/daily-plan/PpzTasks";
import { PhotoEvidence, ReportPhotoPicker } from "../src/features/daily-plan/ReportPhotos";
import { ReportText } from "../src/shared/ui/ReportText";
import { appendDictation, startDictation, type Recognition } from "../src/shared/utils/reportDictation";
import { WorkCommentForm } from "../src/shared/repair-work/RepairTaskWork";
import { Timestamp } from "firebase/firestore";

class FakeRecognition implements Recognition {
  lang = ""; continuous = false; interimResults = true;
  onresult: Recognition["onresult"] = null; onerror: Recognition["onerror"] = null; onend: Recognition["onend"] = null;
  started = 0; stopped = 0; aborted = 0;
  start() { this.started++; }
  stop() { this.stopped++; }
  abort() { this.aborted++; }
  result(texts: string[], final = true, resultIndex = 0) { this.onresult?.({ resultIndex, results: texts.map(transcript => ({ isFinal: final, 0: { transcript } })) }); }
}
function recording(rec = new FakeRecognition()) {
  const texts: string[] = [], errors: string[] = []; let ended = 0;
  const session = startDictation(rec, { text: text => texts.push(text), error: text => errors.push(text), end: () => ended++ });
  return { rec, session, texts, errors, ended: () => ended };
}
test("dictation adds text without overwriting a manual draft and respects server limits", () => {
  assert.deepEqual(appendDictation("Заменил фильтр. ", " Проверил давление. ", 100), { value: "Заменил фильтр. Проверил давление.", limited: false });
  assert.deepEqual(appendDictation("1234", "5678", 7), { value: "1234 56", limited: true });
});
test("only final speech is accepted once, including cumulative browser results", () => {
  const r = recording();
  r.rec.result(["черновик"], false); r.rec.result(["Заменил фильтр."]); r.rec.result(["Заменил фильтр.", "Проверил давление."]); r.rec.result(["Заменил фильтр.", "Проверил давление."], true, 1);
  assert.deepEqual(r.texts, ["Заменил фильтр.", "Проверил давление."]);
  assert.equal(r.rec.lang, "ru-RU"); assert.equal(r.rec.interimResults, false);
  r.session.cancel();
});
test("stop waits for final text, end detaches callbacks and late results cannot edit another report", () => {
  const r = recording(); const late = r.rec.onresult;
  r.session.stop(); assert.equal(r.rec.stopped, 1); assert.equal(r.ended(), 0);
  r.rec.result(["Готово"]); r.rec.onend?.();
  late?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Поздний ответ" } }] });
  assert.deepEqual(r.texts, ["Готово"]); assert.equal(r.ended(), 1); assert.equal(r.rec.onresult, null);
});
test("denied microphone and network errors keep text, release recording and allow retry", () => {
  for (const error of ["not-allowed", "network", "audio-capture", "no-speech"]) {
    const r = recording(); r.rec.result(["Сохранённый черновик"]); r.rec.onerror?.({ error });
    assert.equal(r.ended(), 1); assert.equal(r.errors.length, 1); assert.deepEqual(r.texts, ["Сохранённый черновик"]);
    assert.equal(r.rec.aborted, 1);
  }
  const retry = recording(); assert.equal(retry.rec.started, 1); retry.session.cancel();
});
test("starting another report cancels the old microphone; cancellation never accepts late speech", () => {
  const first = recording(); const late = first.rec.onresult; const second = recording();
  assert.equal(first.rec.aborted, 1); assert.equal(first.ended(), 1);
  late?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Чужой отчёт" } }] });
  assert.deepEqual(first.texts, []); assert.deepEqual(second.texts, []); second.session.cancel();
});
test("60 second recording limit stops and cleans up even when browser never sends end", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const r = recording(); context.mock.timers.tick(60000); assert.equal(r.rec.stopped, 1);
  context.mock.timers.tick(3000); assert.equal(r.ended(), 1); assert.equal(r.rec.aborted, 1);
});
test("a synchronous microphone start failure releases state", () => {
  const rec = new FakeRecognition(); rec.start = () => { throw new Error("busy"); };
  const r = recording(rec); assert.equal(r.ended(), 1); assert.equal(r.errors.length, 1);
});
test("report keeps manual input and never promises automatic save or paid AI", () => {
  const html = renderToStaticMarkup(createElement(ReportText, { value: "Черновик", onChange() {}, label: "Отчёт", placeholder: "Работа", maxLength: 1000, disabled: false, onListeningChange() {} }));
  assert.match(html, /Надиктовать отчёт/); assert.match(html, /Черновик/); assert.match(html, /maxlength="1000"/i); assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Платный ИИ CRM не вызывается/);
});
test("repair and intake report form keeps the saved text, microphone and explicit save", () => {
  let saves = 0;
  const html = renderToStaticMarkup(createElement(WorkCommentForm, { current: "Проверил компрессор", async onSave() { saves++; }, onClose() {} }));
  assert.match(html, /Надиктовать отчёт/); assert.match(html, /Проверил компрессор/);
  assert.match(html, /Отчёт о выполнении задачи/); assert.match(html, /Сохранить/); assert.equal(saves, 0);
  const legacy = "Старый отчёт ".repeat(250);
  const legacyHtml = renderToStaticMarkup(createElement(WorkCommentForm, { current: legacy, async onSave() {}, onClose() {} }));
  assert.ok(legacyHtml.includes(legacy)); assert.ok(legacyHtml.includes(`maxLength="${legacy.length}"`));
});
test("intake and request/service/subtask report buttons share the dictation modal", () => {
  const intake = readFileSync(new URL("../src/features/intake/IntakeTab.tsx", import.meta.url), "utf8");
  const tasks = readFileSync(new URL("../src/features/mytasks/MyTasksTab.tsx", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/shared/repair-work/RepairTaskWork.tsx", import.meta.url), "utf8");
  assert.match(intake, /<RepairTaskWork/); assert.match(tasks, /<RepairTaskWork/);
  assert.match(tasks, /<WorkCommentModal current=\{subtask.workComment\}/); assert.match(tasks, /<WorkCommentModal current=\{task.workComment\}/);
  assert.match(shared, /<WorkCommentForm current=\{current\}/); assert.match(shared, /disabled=\{saving \|\| dictating\}/);
});

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
  assert.match(html, /Надиктовать отчёт/);
  const foreign = renderToStaticMarkup(createElement(TaskCard, { task, uid: "not-assigned", name }));
  assert.doesNotMatch(foreign, /Фото работы из галереи/);
  assert.doesNotMatch(foreign, /Надиктовать отчёт/);
});
test("PPZ card shows original creator, time, assigned people and self-assignment, preserving legacy unknowns", () => {
  const html = renderToStaticMarkup(createElement(TaskCard, { task: { ...task, createdBy: "a", createdByName: "Автор при создании", assigneeNames: { a: "Исполнитель A", b: "Исполнитель B" }, createdAt: Timestamp.fromDate(new Date("2026-10-05T10:00:00Z")) }, uid: "b", name }));
  assert.match(html, /Автор при создании/); assert.match(html, /05\.10\.2026/); assert.match(html, /Исполнитель A, Исполнитель B/); assert.match(html, /автор назначил задачу в том числе себе/);
  const old = renderToStaticMarkup(createElement(TaskCard, { task, uid: "b", name }));
  assert.match(old, /Автор не зафиксирован/); assert.match(old, /Дата создания не зафиксирована/);
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
