const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseStatusExtensions, storedSimBalance } = require('../lib/controllerStatusExtensions');
const parseUtc = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('invalid UTC');
  return new Date(value);
};
const at = '2026-11-02T03:00:00.000Z';
test('legacy fields remain absent and HTTPS is explicit', () => {
  assert.deepEqual(parseStatusExtensions({}, parseUtc), {});
  assert.deepEqual(parseStatusExtensions({transport:'https'}, parseUtc), {transport:'https'});
  assert.throws(() => parseStatusExtensions({transport:'ftp'}, parseUtc));
});
test('real zero and negative balances are valid integer kopeks', () => {
  for (const amountMinor of [0, -125, 12345]) {
    const input = {status:'ok',amountMinor,currency:'RUB',checkedAt:at};
    assert.equal(parseStatusExtensions({simBalance:input},parseUtc).simBalance.amountMinor,amountMinor);
  }
});
test('rejects malformed balance rather than coercing it to zero', () => {
  for (const input of [null,{}, {status:'ok',checkedAt:at}, {status:'ok',checkedAt:at,amountMinor:1.5,currency:'RUB'}, {status:'ok',checkedAt:at,amountMinor:1,currency:'USD'}, {status:'error',checkedAt:at,amountMinor:0}, {status:'unsupported',checkedAt:at,extra:true}]) {
    assert.throws(() => parseStatusExtensions({simBalance:input},parseUtc));
  }
});
test('failed check preserves last successful value and time', () => {
  const last = {status:'ok',amountMinor:0,currency:'RUB',checkedAt:new Date(at),balanceAt:new Date(at)};
  const nextAt = new Date(Date.parse(at)+60000);
  const next = storedSimBalance(last,{status:'error',checkedAt:nextAt},date=>date);
  assert.equal(next.status,'error'); assert.equal(next.amountMinor,0);
  assert.deepEqual(next.balanceAt,last.balanceAt); assert.deepEqual(next.checkedAt,nextAt);
});
test('stale attempt and absent extension preserve newer known balance', () => {
  const last={status:'ok',amountMinor:123,currency:'RUB',checkedAt:new Date(at),balanceAt:new Date(at)};
  assert.deepEqual(storedSimBalance(last,undefined,date=>date),last);
  assert.deepEqual(storedSimBalance(last,{status:'error',checkedAt:new Date(Date.parse(at)-1)},date=>date),last);
});
