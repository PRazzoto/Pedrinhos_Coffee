// Data snapshots and lifecycle events use server timestamps supplied by Firestore.
// This module is pure so the schema and transition behavior can be tested locally.
const transitions = { pending: 'preparing', preparing: 'ready', ready: 'delivered', delivered: 'pending' };
const optionCode = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-');

export function orderItemData(variant, qty, menu, currency) {
  const group = menu.find((group) => group.items.some((item) => item.id === variant.baseId));
  const item = group?.items.find((item) => item.id === variant.baseId);
  if (!item || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Invalid order item');
  const optionLabels = { ...item.attributes, ...variant.options };
  for (const option of item.options ?? []) {
    if (!option.values.includes(optionLabels[option.key])) throw new Error('Missing drink option');
  }
  // Fixed recipes, including the bride's recommendation, cannot be overridden.
  Object.assign(optionLabels, item.attributes);
  const price = item.price;
  if (price != null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0)) {
    throw new Error('Invalid menu price');
  }
  return {
    id: variant.id,
    baseId: item.id,
    productId: item.productId ?? item.id,
    productName: item.productName ?? item.name,
    name: variant.name,
    category: group.category,
    qty,
    options: Object.fromEntries(Object.entries(optionLabels).map(([key, value]) => [key, optionCode(value)])),
    optionLabels,
    featured: Boolean(item.featured),
    unitPriceCents: price == null ? null : Math.round(price * 100),
    currency,
  };
}

export function createOrderData({ customer, notes, items, settings, at, eventId }) {
  const itemCount = items.reduce((sum, item) => sum + item.qty, 0);
  if (!items.length || items.length > 12 || itemCount > 20) throw new Error('Invalid order size');
  const allPriced = items.every((item) => item.unitPriceCents !== null);
  const order = {
    schemaVersion: 2,
    eventId: settings.id,
    timeZone: settings.timeZone,
    currency: settings.currency,
    isTest: settings.isTest,
    channel: 'web',
    customer,
    notes,
    hasNotes: notes.length > 0,
    items,
    itemCount,
    lineCount: items.length,
    orderValueCents: allPriced ? items.reduce((sum, item) => sum + item.unitPriceCents * item.qty, 0) : null,
    status: 'pending',
    createdAt: at,
    updatedAt: at,
    preparationStartedAt: null,
    readyAt: null,
    deliveredAt: null,
    lastReopenedAt: null,
    cycle: 1,
    reopenCount: 0,
    statusRevision: 0,
    lastEventId: eventId,
    historyComplete: true,
    historyStartedAt: at,
  };
  const event = {
    type: 'created', revision: 0, fromStatus: null, toStatus: 'pending',
    at, actorUid: null, cycle: 1,
  };
  return { order, event };
}

export function statusTransition(order, expectedStatus, nextStatus, actorUid, at, eventId) {
  if (order.status !== expectedStatus) {
    const error = new Error('Order changed since it was displayed');
    error.code = 'order/status-conflict';
    throw error;
  }
  if (transitions[order.status] !== nextStatus || !actorUid || !eventId) {
    throw new Error('Invalid status transition');
  }
  const reopening = nextStatus === 'pending';
  const revision = (order.statusRevision ?? 0) + 1;
  const cycle = (order.cycle ?? 1) + (reopening ? 1 : 0);
  const patch = {
    status: nextStatus,
    updatedAt: at,
    statusRevision: revision,
    lastEventId: eventId,
    cycle,
    reopenCount: (order.reopenCount ?? 0) + (reopening ? 1 : 0),
    historyComplete: order.historyComplete === true,
    historyStartedAt: order.historyStartedAt ?? at,
    preparationStartedAt: reopening ? null : nextStatus === 'preparing' ? at : order.preparationStartedAt ?? null,
    readyAt: reopening ? null : nextStatus === 'ready' ? at : order.readyAt ?? null,
    deliveredAt: reopening ? null : nextStatus === 'delivered' ? at : order.deliveredAt ?? null,
    lastReopenedAt: reopening ? at : order.lastReopenedAt ?? null,
  };
  const event = {
    type: 'status_changed', revision, fromStatus: order.status, toStatus: nextStatus,
    at, actorUid, cycle,
  };
  return { patch, event };
}
