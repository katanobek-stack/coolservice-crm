import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStaffResults, selectStaff, staffEditPolicy, staffProfileChanges, staffMonth } from '../src/features/staff/staffLogic';
import type { Client, Repair } from '../src/shared/types/client';
import type { StaffMember } from '../src/shared/types/staff';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffWorkspace } from '../src/features/staff/StaffWorkspace';

const staff: StaffMember[] = [{ id: 'a', name: 'Анна', role: 'mechanic', email: 'anna@test.ru' }, { id: 'b', name: 'Борис', role: 'mechanic' }, { id: 'boss', role: 'owner' }];
const repair = (id: string, changes: Partial<Repair> = {}): Repair => ({ id, serviceType: 'refrigerator', date: '2026-10-01', closedAt: '2026-10-20', closedByManager: true, cost: '1 000,50', tasks: [{ id: 't', description: '', assignees: ['a', 'a', 'b'], doneBy: [], status: 'done' }], ...changes });
const client = (repairs: Repair[]): Client[] => [{ id: 'c', name: 'Тестовый клиент', vehicles: [], repairs }];

test('only manager-closed work enters monthly attribution, each assignee once', () => {
  const results = buildStaffResults(staff, client([
    repair('closed'), repair('open', { closedByManager: false, closedAt: undefined }),
    repair('cancelled', { status: 'cancelled' }), repair('previous', { closedAt: '2026-09-30' }),
  ]), [], '2026-10');
  const a = results.find(r => r.member.id === 'a')!;
  assert.equal(a.total, 500.25);
  assert.equal(a.closed, 1);
  assert.equal(a.active, 1);
  assert.equal(a.rank, 1);
  assert.equal(a.tied, true);
  assert.equal(a.repairs[0].clientName, 'Тестовый клиент');
  assert.equal(a.repairs[0].participants, 2);
  assert.equal(results.find(r => r.member.id === 'boss')!.rank, undefined);
});

test('legacy closedAt and assignee fallback survive, invalid money is never revenue', () => {
  const legacy = repair('legacy', { closedByManager: undefined, tasks: [], mechanics: ['a'], cost: '250,75' });
  const invalid = repair('bad', { cost: '500oops' });
  const rows = buildStaffResults(staff, client([legacy, invalid]), [], '2026-10');
  assert.equal(rows[0].total, 250.75);
  assert.equal(rows[0].closed, 2);
  assert.equal(buildStaffResults(staff, client([repair('neg', { cost: '-10' }), repair('inf', { cost: 'Infinity' })]), [], '2026-10')[0].total, 0);
});

test('ranking compares all mechanics, excludes other roles and keeps unknown historical coworkers in denominator', () => {
  const rows = buildStaffResults(staff, client([repair('r', { mechanics: ['a', 'gone', 'boss'], tasks: [], cost: '900' })]), [], '2026-10');
  assert.equal(rows[0].total, 300);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[2].total, 300);
  assert.equal(rows[2].rank, undefined);
});

test('directory combines multiword search, role and active-work filtering without mutation', () => {
  const rows = buildStaffResults(staff, client([repair('open', { closedByManager: false, closedAt: undefined })]), [], '2026-10');
  const before = JSON.stringify(rows);
  assert.deepEqual(selectStaff(rows, { search: 'анна test', role: 'mechanic', activity: 'active', sort: 'name' }).map(r => r.member.id), ['a']);
  assert.deepEqual(selectStaff(rows, { search: '', role: 'all', activity: 'idle', sort: 'name' }).map(r => r.member.id), ['boss']);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(buildStaffResults([{ id: 'old' }], [{ id: 'c' } as Client], [], '2026-10')[0].closed, 0);
});

test('month rolls at Vladivostok midnight regardless of host timezone', () => {
  assert.equal(staffMonth(new Date('2026-10-31T14:00:00Z')), '2026-11');
  assert.equal(staffMonth(new Date('2026-10-31T13:59:59Z')), '2026-10');
});

test('UTC close timestamps belong to the Vladivostok business day and month', () => {
  const repairs = client([repair('midnight', { closedAt: '2026-10-31T14:30:00.000Z' })]);
  const november = buildStaffResults(staff, repairs, [], '2026-11');
  assert.equal(november[0].closed, 1);
  assert.equal(november[0].repairs[0].date, '2026-11-01');
  assert.equal(buildStaffResults(staff, repairs, [], '2026-10')[0].closed, 0);
});

test('self and owner editing match database policy, with no client role escalation', () => {
  assert.deepEqual(staffEditPolicy('boss', 'owner', { id: 'boss', role: 'owner' }), { name: true, role: false, permissions: false });
  assert.equal(staffEditPolicy('a', 'admin', { id: 'a', role: 'admin' }).role, false);
  assert.equal(staffEditPolicy('a', 'admin', { id: 'boss', role: 'owner' }).name, false);
  assert.equal(staffEditPolicy('boss', 'owner', { id: 'a', role: 'admin' }).permissions, true);
  assert.equal(staffEditPolicy('a', 'mechanic', { id: 'b', role: 'mechanic' }).name, false);
});

test('profile patch contains only changed allowed fields and never rewrites email', () => {
  const member = { id: 'a', name: 'Анна', role: 'admin' as const, email: 'anna@test.ru' };
  const values = { name: ' Анна ', role: 'admin' as const, permissions: { dashboard_financials: true, reports_amounts: true, pl_panel: true } };
  assert.deepEqual(staffProfileChanges(member, values, 'a', 'admin'), {});
  assert.throws(() => staffProfileChanges(member, { ...values, role: 'owner' }, 'a', 'admin'));
  assert.throws(() => staffProfileChanges(member, { ...values, name: '   ' }, 'a', 'admin'));
  assert.deepEqual(staffProfileChanges(member, { ...values, name: 'Анна новая' }, 'a', 'admin'), { name: 'Анна новая' });
  assert.deepEqual(staffProfileChanges(member, { ...values, permissions: { ...values.permissions, pl_panel: false } }, 'boss', 'owner'), { permissions: { dashboard_financials: true, reports_amounts: true, pl_panel: false } });
});

const workspace = { rows: buildStaffResults(staff, client([repair('r')]), [], '2026-10'), staffStatus: 'ready' as const, resultsStatus: 'ready' as const, workStatus: 'ready' as const, month: '2026-10', onMonthChange() {}, actorId: 'boss', actorRole: 'owner' as const, showAmounts: true, onEdit() {} };
test('loading and failed staff source do not present stale employees or financial totals', () => {
  for (const status of ['loading', 'error'] as const) {
    const html = renderToStaticMarkup(createElement(StaffWorkspace, { ...workspace, staffStatus: status }));
    assert.doesNotMatch(html, /Анна|500,25/);
    assert.match(html, status === 'error' ? /Не удалось загрузить/ : /Загружаем/);
  }
});
test('restricted financial access removes money, monetary rank and monetary sorting', () => {
  const html = renderToStaticMarkup(createElement(StaffWorkspace, { ...workspace, showAmounts: false }));
  assert.doesNotMatch(html, /500,25|₽|По доле выручки|Место в рейтинге/);
  assert.match(html, /Анна/);
  assert.match(html, /Поиск сотрудников/);
  assert.match(html, /Без имени/);
});
test('source failures mark derived results unavailable instead of reporting zero', () => {
  const html = renderToStaticMarkup(createElement(StaffWorkspace, { ...workspace, resultsStatus: 'error', workStatus: 'loading' }));
  assert.doesNotMatch(html, /500,25/);
  assert.match(html, /Результаты недоступны/);
  assert.match(html, /Загрузка/);
});
