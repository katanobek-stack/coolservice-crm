import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isServiceControllerOnline,
  SERVICE_MONITOR_OFFLINE_MINUTES,
} from "../src/shared/serviceMonitorStatus";
import { mapServiceController, mapServiceCommand, mapServiceLog } from '../src/shared/serviceMonitorData';
import { serviceHealth, selectServiceControllers, serviceSummary, serviceDateTime, filterServiceLogs, serviceLogText, scopedServiceFeed, serviceCanCommand } from '../src/features/service-monitor/serviceMonitorLogic';
import type { ServiceController, ServiceControllerLog } from '../src/shared/types/serviceMonitor';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceMonitorWorkspace } from '../src/features/service-monitor/ServiceMonitorWorkspace';
import { ServiceCommandPanel, ServiceLogPanel } from '../src/features/service-monitor/ServiceControllerPanels';

describe("service monitor connection state", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");

  test("marks a registered controller online only while its heartbeat is fresh", () => {
    assert.equal(
      isServiceControllerOnline(true, new Date(now - SERVICE_MONITOR_OFFLINE_MINUTES * 60_000), now),
      true,
    );
    assert.equal(
      isServiceControllerOnline(true, new Date(now - SERVICE_MONITOR_OFFLINE_MINUTES * 60_000 - 1), now),
      false,
    );
  });

  test("does not show disabled or never-contacted controllers as online", () => {
    assert.equal(isServiceControllerOnline(false, new Date(now), now), false);
    assert.equal(isServiceControllerOnline(true, null, now), false);
  });

  test("prefers a fresh heartbeat over an older retained MQTT offline state", () => {
    assert.equal(
      isServiceControllerOnline(true, new Date(now - 1_000), now, "offline", new Date(now - 60_000)),
      true,
    );
  });

  test("uses MQTT status when no fresh heartbeat is available", () => {
    assert.equal(
      isServiceControllerOnline(true, new Date(now - SERVICE_MONITOR_OFFLINE_MINUTES * 60_000 - 1), now, "offline", new Date(now)),
      false,
    );
    assert.equal(
      isServiceControllerOnline(true, null, now, "online", new Date(now)),
      true,
    );
  });
});

const now = Date.parse('2026-10-30T14:00:00Z');
const device = (id: string, patch: Partial<ServiceController> = {}) => mapServiceController(id, { name: id, objectName: 'Склад Север', deviceId: `esp-${id}`, enabled: true, lastHeartbeatAt: new Date(now - 1000), gprsConnected: true, simSignal: 20, uartConnected: true, ...patch });
const filters = { search: '', state: 'all' as const, attention: false, sort: 'attention' as const };

test('fleet distinguishes offline, never contacted, disabled and current connection using heartbeat precedence', () => {
  assert.equal(serviceHealth(device('a', { connectionState: 'offline', lastStatusAt: new Date(now - 60000) }), now).state, 'online');
  assert.equal(serviceHealth(device('a', { lastHeartbeatAt: null, lastStatusAt: new Date(now), connectionState: 'online' }), now).state, 'online');
  assert.equal(serviceHealth(device('b', { lastHeartbeatAt: new Date(now - 600001) }), now).state, 'offline');
  assert.equal(serviceHealth(device('c', { lastHeartbeatAt: null }), now).state, 'unknown');
  assert.equal(serviceHealth(device('d', { enabled: false }), now).state, 'disabled');
});

test('missing diagnostics remain unknown, while real signal and connection failures explain attention', () => {
  const missing = mapServiceController('x', { enabled: true, lastHeartbeatAt: new Date(now) });
  assert.equal(missing.gprsConnected, null);
  assert.equal(serviceHealth(missing, now).issues.length, 0);
  const warning = serviceHealth(device('x', { simSignal: 5, uartConnected: false, gprsConnected: false }), now);
  assert.equal(warning.issues.length, 3);
  assert.equal(warning.attention, true);
  assert.equal(mapServiceController('x', { simSignal: 99, uptimeSeconds: -1 }).simSignal, null);
  assert.equal(mapServiceController('x', { uptimeSeconds: -1 }).uptimeSeconds, null);
});

test('fleet search and filters combine without mutations and put actionable devices first', () => {
  const rows = [device('online'), device('offline', { lastHeartbeatAt: new Date(now - 600001) }), device('disabled', { enabled: false })];
  const before = JSON.stringify(rows);
  assert.deepEqual(selectServiceControllers(rows, { ...filters, search: 'север esp-off', attention: true }, now).map(d => d.id), ['offline']);
  assert.deepEqual(selectServiceControllers(rows, { ...filters, state: 'disabled' }, now).map(d => d.id), ['disabled']);
  assert.equal(selectServiceControllers(rows, filters, now)[0].id, 'offline');
  assert.deepEqual(serviceSummary(rows, now), { total: 3, online: 1, attention: 1, disabled: 1 });
  assert.equal(JSON.stringify(rows), before);
});

test('selected feed never exposes old controller data, including while a new subscription starts', () => {
  const feed = { controllerId: 'a', status: 'ready' as const, data: ['private-a'], error: '' };
  assert.deepEqual(scopedServiceFeed(feed, 'b').data, []);
  assert.equal(scopedServiceFeed(feed, 'b').status, 'loading');
  assert.deepEqual(scopedServiceFeed(feed, 'a').data, ['private-a']);
});

test('log filtering and text export use visible rows, preserve multiline text and Vladivostok timestamps', () => {
  const logs: ServiceControllerLog[] = [{ id: 'e', level: 'ERROR', message: 'Модем\nНет сети', receivedAt: new Date(now), reportedAt: null }, { id: 'i', level: 'INFO', message: 'Готов', receivedAt: new Date(now), reportedAt: null }];
  const visible = filterServiceLogs(logs, 'ERROR', 'модем сети');
  assert.deepEqual(visible.map(l => l.id), ['e']);
  assert.equal(filterServiceLogs(logs, 'INFO', 'нет').length, 0);
  const text = serviceLogText(device('a'), visible);
  assert.match(text, /31\.10\.2026/);
  assert.match(text, /Модем\nНет сети/);
  assert.doesNotMatch(text, /Готов/);
  assert.match(serviceDateTime(new Date(now)), /31\.10\.2026/);
});

test('command normalization never turns queued or unknown statuses into successful execution', () => {
  assert.equal(mapServiceCommand('q', { command: 'SERVICE PING', status: 'queued' })?.status, 'queued');
  assert.equal(mapServiceCommand('q', { command: 'SERVICE INFO', status: 'surprise' })?.status, 'unknown');
  assert.equal(mapServiceCommand('q', { command: 'RESET', status: 'completed' }), null);
  assert.equal(mapServiceLog('l', { level: 'ERROR', message: '<script>plain text</script>' })?.message, '<script>plain text</script>');
  assert.equal(serviceCanCommand('mechanic', device('a')), false);
  assert.equal(serviceCanCommand('manager', device('a')), true);
  assert.equal(serviceCanCommand('owner', device('a', { enabled: false })), false);
});

const feed = { controllerId: 'a', status: 'ready' as const, data: [], error: '' };
test('registry loading and errors hide stale controllers, totals and command controls', () => {
  for (const status of ['loading', 'error'] as const) {
    const html = renderToStaticMarkup(createElement(ServiceMonitorWorkspace, { controllers: [device('secret-stale')], status, selectedId: 'secret-stale', nowMs: now, role: 'owner', logs: feed, commands: feed, commandBusy: false, feedback: null, onSelect() {}, onRetry() {}, onCommand() {} }));
    assert.doesNotMatch(html, /secret-stale|Проверить связь/);
    assert.match(html, status === 'error' ? /Не удалось загрузить/ : /Загружаем/);
  }
});

test('mechanic command panel has no command buttons or privileged history', () => {
  const html = renderToStaticMarkup(createElement(ServiceCommandPanel, { controller: device('a'), nowMs: now, role: 'mechanic', busy: false, feedback: null, history: { ...feed, data: [mapServiceCommand('private-id', { command: 'SERVICE PING', status: 'completed' })!] }, onCommand() {}, onRetry() {} }));
  assert.doesNotMatch(html, /private-id|Проверить связь/);
  assert.match(html, /доступны менеджеру/);
});

test('disabled controller commands cannot be clicked and queued history is not rendered as completed', () => {
  const html = renderToStaticMarkup(createElement(ServiceCommandPanel, { controller: device('a', { enabled: false }), nowMs: now, role: 'owner', busy: false, feedback: null, history: { ...feed, data: [mapServiceCommand('q', { command: 'SERVICE PING', status: 'queued' })!] }, onCommand() {}, onRetry() {} }));
  assert.equal((html.match(/type="button" disabled=""/g) ?? []).length, 3);
  assert.match(html, /В очереди/);
  assert.doesNotMatch(html, />Выполнена</);
});

test('failed log source never renders or exports stale messages', () => {
  const html = renderToStaticMarkup(createElement(ServiceLogPanel, { controller: device('a'), feed: { ...feed, status: 'error', data: [{ id: 's', level: 'ERROR', message: 'stale-secret', reportedAt: null, receivedAt: null }] }, onRetry() {} }));
  assert.doesNotMatch(html, /stale-secret/);
  assert.match(html, /Не удалось загрузить журнал/);
});

test('switching controller hides another device feedback and log records before its listener delivers', () => {
  const oldLog = { ...feed, data: [{ id: 'old', level: 'INFO' as const, message: 'old-device-message', reportedAt: null, receivedAt: null }] };
  const html = renderToStaticMarkup(createElement(ServiceLogPanel, { controller: device('b'), feed: oldLog, onRetry() {} }));
  assert.doesNotMatch(html, /old-device-message/);
  assert.match(html, /Загружаем журнал/);
  const commands = renderToStaticMarkup(createElement(ServiceCommandPanel, { controller: device('b'), nowMs: now, role: 'owner', busy: false, feedback: { controllerId: 'a', command: 'SERVICE PING', state: 'queued', message: 'old-device-feedback' }, history: feed, onCommand() {}, onRetry() {} }));
  assert.doesNotMatch(commands, /old-device-feedback/);
  assert.match(commands, /Загружаем историю/);
});
