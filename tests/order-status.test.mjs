import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOrderData, samePublicOrder, groupActiveOrders } from '../order-status.js';

const time = (value) => ({ toMillis: () => value });

test('public projection excludes notes, drink choices and all other private fields', () => {
  const createdAt = time(1000);
  const result = publicOrderData({
    customer: 'Ana', status: 'pending', createdAt,
    notes: 'Informação privada', items: [{ name: 'Latte · Gelado · Baunilha' }],
    privateField: 'Nunca publicar',
  });
  assert.deepEqual(result, { customer: 'Ana', status: 'pending', createdAt });
  assert.deepEqual(Object.keys(result).sort(), ['createdAt', 'customer', 'status']);
});

test('active groups exclude delivered and unknown statuses, sort oldest first and keep duplicate names', () => {
  const order = (id, customer, status, value) => ({ id, data: { customer, status, createdAt: time(value) } });
  const groups = groupActiveOrders([
    order('z', 'Ana', 'pending', 2000),
    order('a', 'Ana', 'pending', 1000),
    order('b', 'Bia', 'ready', 3000),
    order('c', 'Caio', 'preparing', 1500),
    order('d', 'Dani', 'delivered', 1000),
    order('e', 'Eli', 'unknown', 1000),
  ]);
  assert.deepEqual(groups.pending.map((order) => order.id), ['a', 'z']);
  assert.deepEqual(groups.preparing.map((order) => order.data.customer), ['Caio']);
  assert.deepEqual(groups.ready.map((order) => order.data.customer), ['Bia']);
  assert.equal(Object.values(groups).flat().length, 4);
});

test('public synchronization detects outdated statuses, wrong names, timestamps and extra fields', () => {
  const current = { customer: 'Ana', status: 'preparing', createdAt: time(1000) };
  assert.ok(samePublicOrder(current, { ...current, createdAt: time(1000) }));
  assert.equal(samePublicOrder(current, undefined), false);
  assert.equal(samePublicOrder(current, { ...current, status: 'pending' }), false);
  assert.equal(samePublicOrder(current, { ...current, customer: 'Bia' }), false);
  assert.equal(samePublicOrder(current, { ...current, createdAt: time(2000) }), false);
  assert.equal(samePublicOrder(current, { ...current, notes: 'Must be removed' }), false);
  assert.equal(samePublicOrder({ ...current, createdAt: null }, { ...current, createdAt: null }), false);
});
