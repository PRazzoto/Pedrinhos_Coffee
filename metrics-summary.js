// Pure aggregation of Firestore order snapshots, without customer names.
const validDate = (value) => {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate()
    : value instanceof Date ? value
    : typeof value.seconds === 'number' ? new Date(value.seconds * 1000)
    : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};
const partsFor = (date, timeZone) => Object.fromEntries(
  new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
export const localDay = (dateValue, timeZone = 'America/Sao_Paulo') => {
  const date = validDate(dateValue);
  if (!date) return '';
  const p = partsFor(date, timeZone);
  return [p.year, p.month, p.day].join('-');
};
const localQuarter = (date, timeZone) => {
  const p = partsFor(date, timeZone);
  const minutes = Math.floor(Number(p.minute) / 15) * 15;
  return p.hour + ':' + String(minutes).padStart(2, '0');
};
const increment = (map, key, quantity = 1) => map.set(key, (map.get(key) || 0) + quantity);
const ranking = (map) => [...map].map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
const elapsed = (start, end) => {
  const a = validDate(start);
  const b = validDate(end);
  if (!a || !b || b < a) return null;
  return (b.getTime() - a.getTime()) / 60000;
};
const percentile = (array, fraction) => {
  if (!array.length) return null;
  const sorted = [...array].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * fraction;
  const left = Math.floor(pos);
  const weight = pos - left;
  return sorted[left] + (sorted[Math.ceil(pos)] - sorted[left]) * weight;
};

export function summarizeOrders(rows, { date = 'all', includeTests = false, timeZone = 'America/Sao_Paulo', eventsByOrder = {} } = {}) {
  const orders = rows.filter(({ data }) => (includeTests || data.isTest !== true) &&
    validDate(data.createdAt) && (date === 'all' || localDay(data.createdAt, timeZone) === date));
  const drinks = new Map(), variants = new Map(), temperature = new Map(), syrup = new Map();
  const quarters = new Map(), hours = new Map(), baristas = new Map();
  const durations = { queue: [], preparation: [], pickup: [], total: [] };
  const statuses = { pending: 0, preparing: 0, ready: 0, delivered: 0 };
  let beverageCount = 0, featuredCount = 0, ordersWithNotes = 0, completeHistory = 0, legacyOrders = 0;
  for (const { id, data } of orders) {
    statuses[data.status] = (statuses[data.status] || 0) + 1;
    if (data.hasNotes === true || (typeof data.notes === 'string' && data.notes.trim())) ordersWithNotes++;
    if (data.historyComplete === true) completeHistory++;
    else legacyOrders++;
    const created = validDate(data.createdAt);
    const hour = localQuarter(created, timeZone).slice(0, 2) + ':00';
    increment(hours, hour);
    increment(quarters, localQuarter(created, timeZone));
    for (const item of Array.isArray(data.items) ? data.items : []) {
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1) continue;
      beverageCount += qty;
      const product = String(item.productName || item.productId || item.name || 'Outro');
      increment(drinks, product, qty);
      const options = item.optionLabels || item.options || {};
      const variantLabel = [
        product, options.temperature || '', options.syrup || ''
      ].filter(Boolean).join(' · ');
      increment(variants, variantLabel, qty);
      if (item.featured === true) featuredCount += qty;
      if (options.temperature) increment(temperature, String(options.temperature), qty);
      if (options.syrup) increment(syrup, String(options.syrup), qty);
    }
    // Reopened and legacy orders need their cycle-by-cycle event history; never
    // silently substitute an original creation time for the next queue entry.
    if (data.historyComplete === true && !data.reopenCount) {
      for (const [key, start, end] of [
        ['queue', data.createdAt, data.preparationStartedAt],
        ['preparation', data.preparationStartedAt, data.readyAt],
        ['pickup', data.readyAt, data.deliveredAt],
        ['total', data.createdAt, data.deliveredAt],
      ]) {
        const mins = elapsed(start, end);
        if (mins !== null) durations[key].push(mins);
      }
    }
    for (const event of eventsByOrder[id] || []) {
      if (!event.actorUid) continue;
      const uid = event.actorUid;
      if (!baristas.has(uid)) baristas.set(uid, { uid, started: 0, delivered: 0 });
      const entry = baristas.get(uid);
      if (event.toStatus === 'preparing') entry.started++;
      if (event.toStatus === 'delivered') entry.delivered++;
    }
  }
  const times = Object.fromEntries(Object.entries(durations).map(([key, values]) => [key, {
    samples: values.length,
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
  }]));
  return {
    orderCount: orders.length, beverageCount, statuses, featuredCount, ordersWithNotes,
    completeHistory, legacyOrders,
    products: ranking(drinks), variants: ranking(variants),
    temperature: ranking(temperature), syrup: ranking(syrup),
    quarters: [...quarters].sort(([a], [b]) => a.localeCompare(b)).map(([slot, count]) => ({ slot, count })),
    hours: [...hours].sort(([a], [b]) => a.localeCompare(b)).map(([slot, count]) => ({ slot, count })),
    peakQuarter: ranking(quarters)[0] || null,
    times,
    baristas: [...baristas.values()].sort((a, b) => b.delivered - a.delivered || b.started - a.started),
  };
}