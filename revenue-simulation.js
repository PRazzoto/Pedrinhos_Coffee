import { localDay } from './metrics-summary.js';

// Illustrative scenario values, not researched market prices or recorded sales.
export const simulationProducts = [
  { key: 'cappuccino', name: 'Cappuccino', examplePriceCents: 1200 },
  { key: 'latte-quente', name: 'Latte quente', examplePriceCents: 1400 },
  { key: 'latte-gelado', name: 'Iced latte (inclui a recomendação)', examplePriceCents: 1600 },
  { key: 'americano', name: 'Americano', examplePriceCents: 800 },
  { key: 'macchiato', name: 'Macchiato', examplePriceCents: 900 },
];
const cents = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const safe = (value) => {
  if (!Number.isSafeInteger(value)) throw new RangeError('Simulation exceeds safe monetary precision');
  return value;
};

export function simulationProduct(item) {
  const id = String(item.baseId || item.id || '').split('--')[0];
  const product = String(item.productId || (id === 'iced-latte' ? 'latte' : id));
  const temperature = String(item.options?.temperature || item.optionLabels?.temperature || '').toLowerCase();
  let key = product;
  if (product === 'latte') {
    // Legacy variant IDs are explicit evidence; never guess from an absent temperature.
    const parts = String(item.id || '').toLowerCase().split('--');
    const iced = temperature === 'gelado' || temperature === 'iced' || id === 'iced-latte' || parts.includes('gelado');
    const hot = temperature === 'quente' || temperature === 'hot' || parts.includes('quente');
    key = iced ? 'latte-gelado' : hot ? 'latte-quente' : 'latte-sem-temperatura';
  }
  const known = simulationProducts.find((entry) => entry.key === key);
  if (known) return known;
  return {
    key: 'unknown:' + encodeURIComponent(product || id || item.name || 'unidentified'),
    name: product === 'latte' ? 'Latte (temperatura não registrada)' : String(item.productName || item.name || id || 'Bebida não identificada'),
    examplePriceCents: null,
  };
}

export function simulateRevenue(rows, {
  date = 'all', includeTests = false, timeZone = 'America/Sao_Paulo',
  scope = 'delivered', prices = {}, costs = {}, fixedCostsCents = 0, feeBasisPoints = 0,
} = {}) {
  if (!['delivered', 'all'].includes(scope)) throw new Error('Invalid simulation scope');
  const orders = rows.filter(({ data }) => {
    const day = localDay(data.createdAt, timeZone);
    return day && (date === 'all' || day === date) && (includeTests || data.isTest !== true)
      && (scope === 'all' || data.status === 'delivered');
  });
  const groups = new Map(simulationProducts.map((item) => [item.key, { ...item, quantity: 0 }]));
  let invalidLines = 0;
  for (const { data } of orders) {
    if (!Array.isArray(data.items) || !data.items.length) { invalidLines++; continue; }
    for (const item of data.items) {
      if (!item || !['number', 'string'].includes(typeof item.qty)) { invalidLines++; continue; }
      const qty = Number(item.qty);
      if (!Number.isSafeInteger(qty) || qty <= 0) { invalidLines++; continue; }
      const product = simulationProduct(item);
      if (!groups.has(product.key)) groups.set(product.key, { ...product, quantity: 0 });
      const group = groups.get(product.key);
      group.quantity = safe(group.quantity + qty);
    }
  }
  let quantity = 0, pricedQuantity = 0, costedQuantity = 0, knownRevenueCents = 0, knownCostCents = 0;
  const lines = [...groups.values()].map((group) => {
    const priceCents = Object.hasOwn(prices, group.key) ? cents(prices[group.key]) : null;
    const costCents = Object.hasOwn(costs, group.key) ? cents(costs[group.key]) : null;
    const revenueCents = priceCents === null ? null : safe(priceCents * group.quantity);
    const variableCostCents = costCents === null ? null : safe(costCents * group.quantity);
    quantity = safe(quantity + group.quantity);
    if (priceCents !== null) {
      pricedQuantity = safe(pricedQuantity + group.quantity);
      knownRevenueCents = safe(knownRevenueCents + revenueCents);
    }
    if (costCents !== null) {
      costedQuantity = safe(costedQuantity + group.quantity);
      knownCostCents = safe(knownCostCents + variableCostCents);
    }
    return { ...group, priceCents, costCents, revenueCents, variableCostCents };
  });
  const completePrices = pricedQuantity === quantity && invalidLines === 0;
  const completeCosts = costedQuantity === quantity && invalidLines === 0;
  const revenueCents = completePrices ? knownRevenueCents : null;
  const variableCostCents = completeCosts ? knownCostCents : null;
  const fixed = cents(fixedCostsCents);
  const rate = cents(feeBasisPoints);
  const validRate = rate !== null && rate <= 10000;
  const feeCents = revenueCents !== null && validRate ? safe(Math.round(safe(revenueCents * rate) / 10000)) : null;
  const totalCostsCents = variableCostCents !== null && fixed !== null && feeCents !== null
    ? safe(variableCostCents + fixed + feeCents) : null;
  return {
    scope, orderCount: orders.length, quantity, pricedQuantity, costedQuantity, invalidLines, lines,
    missingPriceQuantity: quantity - pricedQuantity,
    missingCostQuantity: quantity - costedQuantity,
    revenueCents, knownRevenueCents, variableCostCents, fixedCostsCents: fixed,
    feeBasisPoints: validRate ? rate : null, feeCents, totalCostsCents,
    balanceCents: revenueCents !== null && totalCostsCents !== null ? safe(revenueCents - totalCostsCents) : null,
    averageOrderCents: revenueCents !== null && orders.length ? Math.round(revenueCents / orders.length) : null,
    averageDrinkCents: revenueCents !== null && quantity ? Math.round(revenueCents / quantity) : null,
  };
}
