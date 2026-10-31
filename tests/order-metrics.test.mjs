import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderItemData, createOrderData, statusTransition } from '../order-metrics.js';
import { menu, allItems, eventSettings } from '../menu.js';
import { publicOrderData } from '../order-status.js';

const time = (milliseconds) => ({ toMillis: () => milliseconds });
const recommendation = allItems.find((item) => item.id === 'iced-latte');
const variant = (baseId, options = {}, name = baseId) => ({ id: baseId + '-variant', baseId, options, name });
const latte = () => orderItemData(variant('latte', { temperature: 'Gelado', syrup: 'Baunilha' }), 2, menu, 'BRL');
const initial = (overrides = {}) => createOrderData({
  customer: 'Ana', notes: '', items: [latte()], settings: eventSettings,
  at: time(0), eventId: 'event-0', ...overrides,
});

test('bride recommendation is a fixed iced Cumaru latte, still grouped with Latte for metrics', () => {
  assert.equal(recommendation.options, undefined);
  assert.equal(recommendation.attributes.temperature, 'Gelado');
  assert.equal(recommendation.attributes.syrup, 'Cumaru');
  const item = orderItemData(variant('iced-latte', { syrup: 'Baunilha' }), 1, menu, 'BRL');
  assert.equal(item.baseId, 'iced-latte');
  assert.equal(item.productId, 'latte');
  assert.equal(item.productName, 'Latte');
  assert.equal(item.featured, true);
  assert.deepEqual(item.options, { temperature: 'gelado', syrup: 'cumaru' });
});

test('all regular Latte combinations are structured independently of their display names', () => {
  for (const temperature of ['Quente', 'Gelado']) {
    for (const syrup of ['Baunilha', 'Cumaru']) {
      const item = orderItemData(variant('latte', { temperature, syrup }, 'Nome que pode mudar'), 3, menu, 'BRL');
      assert.equal(item.productId, 'latte');
      assert.equal(item.qty, 3);
      assert.equal(item.options.temperature, temperature.toLowerCase());
      assert.equal(item.options.syrup, syrup.toLowerCase());
      assert.deepEqual(item.optionLabels, { temperature, syrup });
    }
  }
});

test('order snapshots keep quantities, dimensions, unknown prices and event-local timezone', () => {
  const { order, event } = initial({ notes: 'Sem açúcar' });
  assert.equal(order.schemaVersion, 2);
  assert.equal(order.itemCount, 2);
  assert.equal(order.lineCount, 1);
  assert.equal(order.orderValueCents, null);
  assert.equal(order.items[0].unitPriceCents, null);
  assert.equal(order.timeZone, 'America/Sao_Paulo');
  assert.equal(order.eventId, eventSettings.id);
  assert.equal(order.hasNotes, true);
  assert.equal(order.historyComplete, true);
  assert.equal(order.lastEventId, 'event-0');
  assert.equal(order.createdAt, order.updatedAt);
  assert.equal(event.at, order.createdAt);
  assert.equal(event.actorUid, null);
  assert.equal(event.type, 'created');
  assert.equal(event.revision, 0);
});

test('known menu prices are snapshotted in integer cents and retain the currency', () => {
  const catalog = [{ category: 'Teste', items: [{ id: 'coffee', name: 'Café', price: 7.5 }] }];
  const item = orderItemData(variant('coffee'), 3, catalog, 'BRL');
  const { order } = initial({ items: [item] });
  assert.equal(item.unitPriceCents, 750);
  assert.equal(item.currency, 'BRL');
  assert.equal(order.orderValueCents, 2250);
  const unknown = { ...item, unitPriceCents: null };
  assert.equal(initial({ items: [item, unknown] }).order.orderValueCents, null);
});

test('lifecycle preserves server-supplied times for queue, preparation, pickup and total duration', () => {
  let { order, event } = initial();
  const events = [event];
  for (const [next, milliseconds, actor] of [
    ['preparing', 60000, 'barista-a'], ['ready', 180000, 'barista-b'], ['delivered', 240000, 'barista-b'],
  ]) {
    const result = statusTransition(order, order.status, next, actor, time(milliseconds), 'event-' + events.length);
    assert.equal(result.event.at, result.patch.updatedAt);
    assert.equal(result.event.actorUid, actor);
    order = { ...order, ...result.patch };
    events.push(result.event);
  }
  assert.equal(order.preparationStartedAt.toMillis() - order.createdAt.toMillis(), 60000);
  assert.equal(order.readyAt.toMillis() - order.preparationStartedAt.toMillis(), 120000);
  assert.equal(order.deliveredAt.toMillis() - order.readyAt.toMillis(), 60000);
  assert.equal(order.deliveredAt.toMillis() - order.createdAt.toMillis(), 240000);
  assert.deepEqual(events.map((event) => event.revision), [0, 1, 2, 3]);
  assert.deepEqual(events.map((event) => event.toStatus), ['pending', 'preparing', 'ready', 'delivered']);
});

test('reopening starts a new cycle without changing old events or the original creation time', () => {
  let { order, event } = initial();
  const events = [event];
  for (const next of ['preparing', 'ready', 'delivered']) {
    const result = statusTransition(order, order.status, next, 'barista-a', time(events.length * 1000), 'event-' + events.length);
    order = { ...order, ...result.patch };
    events.push(result.event);
  }
  const previousDelivery = order.deliveredAt;
  const reopened = statusTransition(order, 'delivered', 'pending', 'barista-b', time(4000), 'event-4');
  assert.equal(reopened.patch.cycle, 2);
  assert.equal(reopened.patch.reopenCount, 1);
  assert.equal(reopened.patch.preparationStartedAt, null);
  assert.equal(reopened.patch.readyAt, null);
  assert.equal(reopened.patch.deliveredAt, null);
  assert.equal(reopened.patch.lastReopenedAt.toMillis(), 4000);
  assert.equal(order.deliveredAt, previousDelivery);
  assert.equal(events[3].at, previousDelivery);
  assert.equal(order.createdAt.toMillis(), 0);
  assert.equal(reopened.event.cycle, 2);
  assert.equal(reopened.event.revision, 4);
});

test('stale barista actions and skipped stages are rejected', () => {
  const { order } = initial();
  assert.throws(() => statusTransition({ ...order, status: 'preparing' }, 'pending', 'preparing', 'barista-a', time(1), 'e1'),
    { code: 'order/status-conflict' });
  assert.throws(() => statusTransition(order, 'pending', 'ready', 'barista-a', time(1), 'e1'));
  assert.throws(() => statusTransition(order, 'pending', 'preparing', '', time(1), 'e1'));
});

test('legacy orders do not receive invented timestamps or a claim of complete history', () => {
  const oldOrder = { customer: 'Ana', status: 'preparing', createdAt: time(1000) };
  const result = statusTransition(oldOrder, 'preparing', 'ready', 'barista-a', time(5000), 'new-event');
  assert.equal(result.patch.historyComplete, false);
  assert.equal(result.patch.historyStartedAt.toMillis(), 5000);
  assert.equal(result.patch.preparationStartedAt, null);
  assert.equal(result.patch.readyAt.toMillis(), 5000);
  assert.equal(result.patch.deliveredAt, null);
  assert.equal(result.event.fromStatus, 'preparing');
  assert.equal(result.event.revision, 1);
  assert.equal(oldOrder.createdAt.toMillis(), 1000);
});

test('quantity and option validation rejects incomplete or oversized orders', () => {
  assert.throws(() => orderItemData(variant('latte'), 1, menu, 'BRL'));
  assert.throws(() => orderItemData(variant('cappuccino'), 0, menu, 'BRL'));
  assert.throws(() => initial({ items: [{ ...latte(), qty: 21 }] }));
  assert.throws(() => initial({ items: [] }));
});

test('metric/history fields stay private and the creation schema agrees with the rules allowlist', () => {
  const { order } = initial();
  assert.deepEqual(Object.keys(publicOrderData(order)).sort(), ['createdAt', 'customer', 'status']);
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const privateRules = rules.slice(rules.indexOf('match /orders/{orderId}'));
  const allowlist = privateRules.match(/keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/)[1];
  const fields = [...allowlist.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(fields.sort(), Object.keys(order).sort());
});
