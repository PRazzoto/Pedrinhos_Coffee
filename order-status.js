// Public tracking uses only these fields; items and notes stay in /orders.
export const activeOrderStatuses = ['pending', 'preparing', 'ready'];

export function publicOrderData(order) {
  return { customer: order.customer, status: order.status, createdAt: order.createdAt };
}

export function samePublicOrder(order, published) {
  const createdAt = order.createdAt?.toMillis?.();
  return Boolean(published) &&
    Object.keys(published).length === 3 &&
    order.customer === published.customer &&
    order.status === published.status &&
    Number.isFinite(createdAt) &&
    createdAt === published.createdAt?.toMillis?.();
}

export function groupActiveOrders(orders) {
  const groups = Object.fromEntries(activeOrderStatuses.map((status) => [status, []]));
  for (const order of orders) {
    if (activeOrderStatuses.includes(order.data.status)) groups[order.data.status].push(order);
  }
  for (const orders of Object.values(groups)) {
    orders.sort((a, b) => (a.data.createdAt?.toMillis() ?? 0) - (b.data.createdAt?.toMillis() ?? 0)
      || a.id.localeCompare(b.id));
  }
  return groups;
}
