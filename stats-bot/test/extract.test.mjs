import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDaily, filterMetrics, toDay } from '../src/extract.mjs';
import { trend } from '../src/table.mjs';
import { prevDay, localParts } from '../src/main.mjs';

test('array of daily records', () => {
  const out = extractDaily([{ url: 'x', body: { data: [
    { date: '2026-10-19T00:00:00Z', gameplays: 10, users: '5', name: 'a' },
    { date: '2026-10-20', gameplays: 12, users: 6 },
  ] } }]);
  assert.deepEqual(out, { '2026-10-19': { gameplays: 10, users: 5 }, '2026-10-20': { gameplays: 12, users: 6 } });
});

test('chart series x/y takes parent key name', () => {
  const ts = Date.UTC(2026, 9, 20);
  const out = extractDaily([{ url: 'x', body: { playtime: { data: [{ x: ts, y: 7.5 }] }, retention: [{ timestamp: ts / 1000, value: 21 }] } }]);
  assert.deepEqual(out, { '2026-10-20': { playtime: 7.5, retention: 21 } });
});

test('object keyed by date', () => {
  const out = extractDaily([{ url: 'x', body: { revenue: { '2026-10-19': 1.5, '2026-10-20': 2 } } }]);
  assert.deepEqual(out, { '2026-10-19': { revenue: 1.5 }, '2026-10-20': { revenue: 2 } });
});

test('ignores non-date data and excluded keys', () => {
  assert.deepEqual(extractDaily([{ url: 'x', body: { list: [{ id: 1, n: 2 }] } }]), {});
  assert.deepEqual(extractDaily([{ url: 'x', body: [{ date: '2026-10-20', id: 3, p: 1 }] }], { exclude: ['id'] }), { '2026-10-20': { p: 1 } });
});

test('filterMetrics whitelist', () => {
  assert.deepEqual(filterMetrics({ d: { a: 1, b: 2 } }, { a: {} }), { d: { a: 1 } });
  assert.deepEqual(filterMetrics({ d: { a: 1 } }, {}), { d: { a: 1 } });
});

test('toDay rejects small numbers', () => {
  assert.equal(toDay(42), null);
  assert.equal(toDay('1729382400'), '2024-10-20');
});

test('trend colors', () => {
  const cfg = { neutralThresholdPct: 1, lowerIsBetter: ['bounceRate'] };
  assert.equal(trend(110, 100, 'plays', cfg).kind, 'good');
  assert.equal(trend(90, 100, 'plays', cfg).kind, 'bad');
  assert.equal(trend(90, 100, 'bounceRate', cfg).kind, 'good');
  assert.equal(trend(100.5, 100, 'plays', cfg).kind, 'flat');
  assert.equal(trend(1, undefined, 'plays', cfg), null);
});

test('dates', () => {
  assert.equal(prevDay('2026-03-01'), '2026-02-28');
  assert.deepEqual(localParts('Europe/Kyiv', new Date('2026-10-20T22:30:00Z')), { date: '2026-10-21', hour: 1 });
});
