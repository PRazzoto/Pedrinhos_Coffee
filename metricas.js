import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, startAfter, getDocs } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig, firebaseConfigured } from './firebase-config.js';
import { cafeName, eventSettings } from './menu.js';
import { localDay, summarizeOrders } from './metrics-summary.js';

const $ = (id) => document.getElementById(id);
$('brand').textContent = cafeName;
document.title = 'Métricas · ' + cafeName;

let auth;
let db;
let allOrders = [];
let eventCache = {};
let currentSummary = null;
let requestVersion = 0;
let baristasLoaded = false;

const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const minutes = (value) => value == null ? '—' : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const selectedOrders = () => allOrders.filter(({ data }) =>
  ($('include-tests').checked || data.isTest !== true) &&
  ($('date-filter').value === 'all' ||
    localDay(data.createdAt, eventSettings.timeZone) === $('date-filter').value));

function status(message, isError = false) {
  $('status-line').textContent = message;
  $('status-line').classList.toggle('error', isError);
}

function setView(loggedIn) {
  $('login-view').hidden = loggedIn;
  $('metrics-view').hidden = !loggedIn;
  if (!loggedIn) {
    $('metrics-content').hidden = true;
    allOrders = [];
    eventCache = {};
    currentSummary = null;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function renderStats(summary) {
  const cards = [
    ['Pedidos recebidos', number(summary.orderCount), 'Um por pedido, mesmo se reaberto'],
    ['Bebidas pedidas', number(summary.beverageCount), 'Soma de todas as quantidades'],
    ['Pedidos entregues', number(summary.statuses.delivered), 'Conforme status marcado pelo barista'],
    ['Recomendação da noiva', number(summary.featuredCount), 'Iced Latte com Cumaru'],
    ['Ainda na fila', number(summary.statuses.pending), 'Pedidos aguardando preparo'],
    ['Preparando', number(summary.statuses.preparing), 'Pedidos em preparo'],
    ['Prontos para retirada', number(summary.statuses.ready), 'Aguardando confirmação da entrega'],
    ['Com observações', number(summary.ordersWithNotes), 'Pedidos com pelo menos uma observação'],
  ];
  $('key-metrics').replaceChildren(...cards.map(([label, value, hint]) => {
    const card = element('article', 'metrics-card');
    card.append(element('p', 'metric-label', label), element('p', 'metric-value', value), element('p', 'metric-description', hint));
    return card;
  }));
}

function renderRanking(id, entries, maxRows = 12) {
  const parent = $(id);
  if (!entries.length) {
    parent.replaceChildren(element('p', 'empty', 'Sem dados para este filtro.'));
    return;
  }
  const max = Math.max(...entries.map((entry) => entry.count), 1);
  parent.replaceChildren(...entries.slice(0, maxRows).map(({ name, count }) => {
    const row = element('div', 'ranking-row');
    const head = element('div', 'ranking-heading');
    head.append(element('span', '', name), element('strong', '', number(count)));
    const track = element('div', 'track');
    const bar = element('div', 'fill');
    bar.style.width = String(Math.max(0, Math.min(100, count / max * 100))) + '%';
    track.append(bar);
    row.append(head, track);
    return row;
  }));
}

function renderTimes(summary) {
  const labels = {
    queue: 'Espera na fila',
    preparation: 'Tempo de preparo',
    pickup: 'Espera para retirada',
    total: 'Tempo total até entrega',
  };
  $('time-table').replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const data = summary.times[key];
    const tr = element('tr');
    for (const value of [label, minutes(data.average), minutes(data.median), minutes(data.p90), number(data.samples)]) {
      tr.append(element('td', '', value));
    }
    return tr;
  }));
}

function renderBaristas(summary) {
  $('barista-table').hidden = !baristasLoaded || !summary.baristas.length;
  if (!baristasLoaded) return;
  $('barista-rows').replaceChildren(...summary.baristas.map((entry, index) => {
    const tr = element('tr');
    tr.append(
      element('td', '', 'Barista ' + (index + 1)),
      element('td', '', number(entry.started)),
      element('td', '', number(entry.delivered)),
    );
    return tr;
  }));
  $('barista-button').textContent = summary.baristas.length
    ? 'Atualizar histórico dos baristas' : 'Nenhuma etapa identificada no histórico';
}

function render() {
  if (!allOrders) return;
  const day = $('date-filter').value;
  currentSummary = summarizeOrders(allOrders, {
    date: day,
    includeTests: $('include-tests').checked,
    timeZone: eventSettings.timeZone,
    eventsByOrder: eventCache,
  });
  const m = currentSummary;
  renderStats(m);
  renderRanking('product-ranking', m.products);
  renderRanking('temperature-ranking', m.temperature);
  renderRanking('syrup-ranking', m.syrup);
  renderRanking('variant-ranking', m.variants, 15);
  renderRanking('hour-ranking', m.hours, 24);
  renderTimes(m);
  renderBaristas(m);
  $('peak-description').textContent = m.peakQuarter
    ? 'Faixa de 15 minutos mais movimentada: ' + m.peakQuarter.name + ' (' + number(m.peakQuarter.count) + ' pedidos).' +
      (day === 'all' ? ' Somando todas as datas selecionadas.' : '')
    : 'Sem horários registrados.';
  $('data-caveat').textContent = m.legacyOrders
    ? number(m.legacyOrders) + ' de ' + number(m.orderCount) + ' pedidos não têm histórico completo. Eles entram nos totais e rankings, mas não nas médias de tempo.' +
      ' Reaberturas também ficam fora das médias para evitar cálculos imprecisos.'
    : 'As durações são calculadas apenas com etapas efetivamente registradas e pedidos sem reabertura. Os cliques do barista definem os horários; não representam medições automáticas.';
  $('metrics-content').hidden = false;
  $('export-button').disabled = m.orderCount === 0;
}

function updateDates() {
  const select = $('date-filter');
  const previous = select.value;
  const dates = [...new Set(allOrders.map(({ data }) => localDay(data.createdAt, eventSettings.timeZone)).filter(Boolean))]
    .sort().reverse();
  select.replaceChildren(new Option('Todas as datas', 'all'),
    ...dates.map((day) => new Option(day.split('-').reverse().join('/'), day)));
  select.value = dates.includes(previous) ? previous : 'all';
}

async function loadOrders() {
  const version = ++requestVersion;
  $('refresh-button').disabled = true;
  $('barista-button').disabled = true;
  $('metrics-content').hidden = true;
  status('Consultando os pedidos registrados…');
  try {
    const rows = [];
    let cursor = null;
    // Do not use the 200-order limit of the operational barista dashboard.
    while (true) {
      const filters = [orderBy('createdAt', 'asc'), limit(250)];
      if (cursor) filters.push(startAfter(cursor));
      const snapshot = await getDocs(query(collection(db, 'orders'), ...filters));
      if (version !== requestVersion) return;
      rows.push(...snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() })));
      if (snapshot.size < 250) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
    allOrders = rows;
    updateDates();
    render();
    status(number(rows.length) + ' pedidos carregados do Firestore. Filtre a data para ver apenas o evento.');
  } catch (error) {
    console.error(error);
    status(error?.code === 'permission-denied'
      ? 'Esta conta não tem autorização para consultar pedidos. Entre com um dos usuários cadastrados como barista no Firestore.'
      : 'Não foi possível carregar os dados. Confira sua conexão e as regras do Firestore.', true);
  } finally {
    if (version === requestVersion) {
      $('refresh-button').disabled = false;
      $('barista-button').disabled = false;
    }
  }
}

async function loadBaristaEvents() {
  const button = $('barista-button');
  button.disabled = true;
  const rows = selectedOrders().filter(({ id, data }) =>
    Number(data.statusRevision || 0) > 0 && !Object.hasOwn(eventCache, id));
  status('Consultando o histórico privado das etapas de preparo…');
  let failures = 0;
  let cursor = 0;
  // A small worker pool limits concurrent Firestore requests.
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        const snapshot = await getDocs(collection(db, 'orders', row.id, 'events'));
        eventCache[row.id] = snapshot.docs.map((record) => record.data());
      } catch (error) {
        failures++;
        console.error('Erro ao carregar histórico do pedido', row.id, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, rows.length) }, worker));
  baristasLoaded = true;
  render();
  status(failures
    ? 'Alguns históricos não puderam ser carregados (' + failures + '). O detalhamento por barista pode estar incompleto.'
    : 'Histórico dos baristas carregado.');
  button.disabled = false;
}

function csvCell(value) {
  const string = String(value ?? '');
  // Prevent spreadsheet formula execution in labels coming from old snapshots.
  const safe = /^[=+\-@\t\r]/.test(string) ? "'" + string : string;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function exportCsv() {
  const m = currentSummary;
  if (!m) return;
  const rows = [
    ['Métrica', 'Nome', 'Quantidade'],
    ['Resumo', 'Pedidos', m.orderCount],
    ['Resumo', 'Bebidas', m.beverageCount],
    ['Resumo', 'Entregues', m.statuses.delivered],
    ['Resumo', 'Recomendação da noiva', m.featuredCount],
    ['Resumo', 'Pedidos com observações', m.ordersWithNotes],
    ...m.products.map((v) => ['Bebida', v.name, v.count]),
    ...m.variants.map((v) => ['Combinação', v.name, v.count]),
    ...m.temperature.map((v) => ['Temperatura', v.name, v.count]),
    ...m.syrup.map((v) => ['Xarope', v.name, v.count]),
    ...m.hours.map((v) => ['Hora', v.slot, v.count]),
    ...m.quarters.map((v) => ['15 minutos', v.slot, v.count]),
    ...Object.entries(m.times).flatMap(([name, t]) => [
      ['Tempo médio (min)', name, t.average == null ? '' : t.average.toFixed(2)],
      ['Tempo mediano (min)', name, t.median == null ? '' : t.median.toFixed(2)],
      ['Tempo p90 (min)', name, t.p90 == null ? '' : t.p90.toFixed(2)],
      ['Amostras de tempo', name, t.samples],
    ]),
    ...m.baristas.flatMap((v, i) => [
      ['Barista: preparos iniciados', 'Barista ' + (i + 1), v.started],
      ['Barista: entregas confirmadas', 'Barista ' + (i + 1), v.delivered],
    ]),
  ];
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pedrinhos-metricas-' + $('date-filter').value + '.csv';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  $('login-button').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    $('password').value = '';
  } catch (error) {
    console.error(error);
    $('login-error').textContent = 'Não foi possível entrar. Confira suas credenciais e a conexão.';
  } finally {
    $('login-button').disabled = false;
  }
});
$('logout-button').addEventListener('click', async () => { ++requestVersion; await signOut(auth); });
$('date-filter').addEventListener('change', () => { render(); baristasLoaded = false; render(); });
$('include-tests').addEventListener('change', () => { baristasLoaded = false; render(); });
$('refresh-button').addEventListener('click', loadOrders);
$('barista-button').addEventListener('click', loadBaristaEvents);
$('export-button').addEventListener('click', exportCsv);

if (!firebaseConfigured) {
  $('login-error').textContent = 'Configuração do Firebase indisponível. Verifique as variáveis do deploy.';
  $('login-button').disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (user) => {
    const barista = Boolean(user && !user.isAnonymous);
    setView(barista);
    if (barista) loadOrders();
  });
}
