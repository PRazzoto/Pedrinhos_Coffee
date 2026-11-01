import test from 'node:test';
import assert from 'node:assert/strict';
import { localDay, summarizeOrders } from '../metrics-summary.js';

const stamp = (iso) => ({ toDate: () => new Date(iso) });
const order = (id, created, extra = {}) => ({
  id,
  data: {
    createdAt: stamp(created),
    isTest: false,
    status: 'delivered',
    historyComplete: true,
    reopenCount: 0,
    preparationStartedAt: stamp('2026-11-01T15:02:00Z'),
    readyAt: stamp('2026-11-01T15:05:00Z'),
    deliveredAt: stamp('2026-11-01T15:07:00Z'),
    items: [{ productName: 'Latte', qty: 2, featured: true,
      options: { temperature: 'gelado', syrup: 'cumaru' } }],
    ...extra,
  },
});

test('local day uses event timezone instead of UTC day', () => {
  assert.equal(localDay(stamp('2026-11-02T01:30:00Z')), '2026-11-01');
  assert.equal(localDay(null), '');
});

test('totals count orders once and sum item quantities', () => {
  const result = summarizeOrders([order('a', '2026-11-01T15:00:00Z')]);
  assert.equal(result.orderCount, 1);
  assert.equal(result.beverageCount, 2);
  assert.equal(result.featuredCount, 2);
  assert.equal(result.products[0].name, 'Latte');
  assert.equal(result.temperature[0].count, 2);
  assert.equal(result.syrup[0].count, 2);
  assert.equal(result.statuses.delivered, 1);
  assert.equal(result.times.queue.average, 2);
  assert.equal(result.times.preparation.average, 3);
  assert.equal(result.times.pickup.average, 2);
  assert.equal(result.times.total.average, 7);
});

test('test orders are excluded by default and date filter is applied', () => {
  const rows = [
    order('a', '2026-11-01T15:00:00Z'),
    order('b', '2026-11-01T16:00:00Z', { isTest: true }),
    order('c', '2026-11-02T16:00:00Z'),
  ];
  assert.equal(summarizeOrders(rows).orderCount, 2);
  assert.equal(summarizeOrders(rows, { date: '2026-11-01' }).orderCount, 1);
  assert.equal(summarizeOrders(rows, { date: '2026-11-01', includeTests: true }).orderCount, 2);
});

test('legacy or reopened orders never invent operational timing', () => {
  const rows = [
    order('old', '2026-11-01T15:00:00Z', { historyComplete: false }),
    order('reopened', '2026-11-01T15:00:00Z', { reopenCount: 1 }),
  ];
  const result = summarizeOrders(rows);
  assert.equal(result.orderCount, 2);
  assert.equal(result.legacyOrders, 1);
  assert.equal(result.times.queue.samples, 0);
  assert.equal(result.times.queue.average, null);
});

test('barista metrics use actual history event actors', () => {
  const result = summarizeOrders([order('a', '2026-11-01T15:00:00Z')], {
    eventsByOrder: {
      a: [
        { actorUid: null, toStatus: 'pending' },
        { actorUid: 'first', toStatus: 'preparing' },
        { actorUid: 'second', toStatus: 'ready' },
        { actorUid: 'second', toStatus: 'delivered' },
      ],
    },
  });
  assert.equal(result.baristas.length, 2);
  assert.equal(result.baristas.find((b) => b.uid === 'first').started, 1);
  assert.equal(result.baristas.find((b) => b.uid === 'second').delivered, 1);
});

test('hour and quarter groups are based on local event time', () => {
  const result = summarizeOrders([order('a', '2026-11-01T15:07:00Z')]);
  assert.deepEqual(result.hours, [{ slot: '12:00', count: 1 }]);
  assert.deepEqual(result.quarters, [{ slot: '12:00', count: 1 }]);
});