import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRevenue, simulationProduct, simulationProducts } from '../revenue-simulation.js';
import { parseDecimal } from '../revenue-widget.js';
import { orderItemData } from '../order-metrics.js';
import { menu } from '../menu.js';

const prices = Object.fromEntries(simulationProducts.map((p) => [p.key, p.examplePriceCents]));
const item = (baseId, qty = 1, temperature) => ({ baseId, qty,
  productId: baseId === 'iced-latte' ? 'latte' : baseId,
  options: temperature ? { temperature } : {},
});
const order = (items, extra = {}) => ({ id: 'order', data: {
  createdAt: new Date('2026-11-01T15:00:00Z'), status: 'delivered', items, ...extra,
} });
const sales = [order([item('cappuccino', 2), item('iced-latte')]),
  order([item('latte', 1, 'quente'), item('americano')])];

test('revenue multiplies quantities once and calculates order and drink averages in cents', () => {
  const s = simulateRevenue(sales, { prices });
  assert.equal(s.revenueCents, 6200);
  assert.equal(s.orderCount, 2);
  assert.equal(s.quantity, 5);
  assert.equal(s.averageOrderCents, 3100);
  assert.equal(s.averageDrinkCents, 1240);
  assert.equal(s.lines.find((p) => p.key === 'latte-gelado').quantity, 1);
  assert.equal(s.balanceCents, null, 'Costs are unknown, never silently assumed zero');
});

test('simulation uses delivered status by default, date in event timezone, and explicit test inclusion', () => {
  const rows = [
    order([item('americano')], { createdAt: new Date('2026-11-02T01:30:00Z') }),
    order([item('americano')], { status: 'ready' }),
    order([item('americano')], { status: 'pending', isTest: true }),
    order([item('americano')], { createdAt: new Date('2026-11-02T15:00:00Z') }),
    order([item('americano')], { createdAt: null }),
  ];
  assert.equal(simulateRevenue(rows, { prices }).revenueCents, 1600);
  assert.equal(simulateRevenue(rows, { prices, date: '2026-11-01' }).revenueCents, 800);
  assert.equal(simulateRevenue(rows, { prices, date: '2026-11-01', scope: 'all' }).revenueCents, 1600);
  assert.equal(simulateRevenue(rows, { prices, date: '2026-11-01', scope: 'all', includeTests: true }).revenueCents, 2400);
});

test('actual menu recipes and legacy variant IDs use the appropriate hot or iced price', () => {
  const variants = [
    { id: 'iced-latte', baseId: 'iced-latte', options: {}, name: 'Noiva' },
    { id: 'latte--gelado--baunilha', baseId: 'latte', options: { temperature: 'Gelado', syrup: 'Baunilha' } },
    { id: 'latte--quente--cumaru', baseId: 'latte', options: { temperature: 'Quente', syrup: 'Cumaru' } },
  ];
  const items = variants.map((v) => orderItemData(v, 1, menu, 'BRL'));
  const s = simulateRevenue([order(items)], { prices });
  assert.equal(s.revenueCents, 4600);
  assert.equal(s.quantity, 3);
  assert.equal(s.lines.find((p) => p.key === 'latte-gelado').quantity, 2);
  assert.equal(simulationProduct({ id: 'latte--gelado--cumaru' }).key, 'latte-gelado');
  assert.equal(simulationProduct({ id: 'latte--quente--cumaru' }).key, 'latte-quente');
  assert.equal(simulationProduct({ id: 'iced-latte' }).key, 'latte-gelado');
});

test('prices missing from legacy drinks leave total and averages unavailable until explicitly priced', () => {
  const rows = [order([item('cappuccino'), { id: 'espresso', name: 'Espresso', qty: 2 }, item('latte')])];
  const s = simulateRevenue(rows, { prices });
  assert.equal(s.revenueCents, null);
  assert.equal(s.averageOrderCents, null);
  assert.equal(s.averageDrinkCents, null);
  assert.equal(s.knownRevenueCents, 1200);
  assert.equal(s.missingPriceQuantity, 3);
  assert.equal(s.lines.find((p) => p.key === 'unknown:latte').name, 'Latte (temperatura não registrada)');
  assert.equal(simulateRevenue(rows, { prices: { ...prices, 'unknown:espresso': 700, 'unknown:latte': 1400 } }).revenueCents, 4000);
});

test('only explicit prices are used, with zero valid and invalid values never treated as free', () => {
  const rows = [order([{ ...item('cappuccino', 3), unitPriceCents: 100 }])];
  for (const price of [null, undefined, -1, 1.5, NaN, Infinity, '1200']) {
    assert.equal(simulateRevenue(rows, { prices: { cappuccino: price } }).revenueCents, null);
  }
  assert.equal(simulateRevenue(rows).revenueCents, null);
  assert.equal(simulateRevenue(rows, { prices: { cappuccino: 0 } }).revenueCents, 0);
  assert.equal(simulateRevenue(rows, { prices }).revenueCents, 3600);
});

test('cost balance includes unit costs, period expenses and rounded percentage fees', () => {
  const costs = { cappuccino: 400, 'latte-gelado': 600, 'latte-quente': 500, americano: 200 };
  const s = simulateRevenue(sales, { prices, costs, fixedCostsCents: 500, feeBasisPoints: 300 });
  assert.equal(s.variableCostCents, 2100);
  assert.equal(s.feeCents, 186);
  assert.equal(s.totalCostsCents, 2786);
  assert.equal(s.balanceCents, 3414);
  assert.equal(simulateRevenue(sales, { prices, costs, fixedCostsCents: 10000 }).balanceCents, -5900);
  assert.equal(simulateRevenue(sales, { prices, costs: { ...costs, americano: null } }).balanceCents, null);
  for (const feeBasisPoints of [null, -1, 10001, 1.5]) {
    assert.equal(simulateRevenue(sales, { prices, costs, feeBasisPoints }).balanceCents, null);
  }
  assert.equal(simulateRevenue(sales, { prices, costs, fixedCostsCents: null }).balanceCents, null);
  assert.equal(simulateRevenue([order([item('americano')])], {
    prices: { americano: 1 }, costs: { americano: 0 }, feeBasisPoints: 5000,
  }).feeCents, 1, 'Percentage fees round to the nearest cent');
});

test('empty samples show zero revenue and no averages; corrupt quantities never produce a complete estimate', () => {
  const s = simulateRevenue([], { prices });
  assert.equal(s.revenueCents, 0);
  assert.equal(s.averageOrderCents, null);
  assert.equal(s.averageDrinkCents, null);
  for (const items of [[], null, [null], [item('americano', -1)], [item('americano', 0)], [item('americano', 1.5)], [item('americano', true)]]) {
    const invalid = simulateRevenue([order(items)], { prices });
    assert.equal(invalid.revenueCents, null);
    assert.equal(invalid.invalidLines, 1);
  }
});

test('simulation does not modify order snapshots or assumptions', () => {
  const before = structuredClone(sales);
  const assumptionCopy = { ...prices };
  simulateRevenue(sales, { prices });
  assert.deepEqual(sales, before);
  assert.deepEqual(prices, assumptionCopy);
});

test('decimal entry accepts reais with comma or dot and rejects ambiguous or invalid values', () => {
  for (const value of ['12,50', '12.50', ' 12,5 ']) assert.equal(parseDecimal(value), 1250);
  assert.equal(parseDecimal('0'), 0);
  assert.equal(parseDecimal('3,25'), 325);
  for (const value of ['', ' ', '-1', 'NaN', '1e3', '1.000,00', '1.001', '12,345', 'Infinity']) {
    assert.equal(parseDecimal(value), null);
  }
});
