import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, collection, query, where, limit, onSnapshot } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig, firebaseConfigured } from './firebase-config.js';
import { cafeName } from './menu.js';
import { activeOrderStatuses, groupActiveOrders } from './order-status.js';

const $ = (id) => document.getElementById(id);
$('brand').textContent = cafeName;
document.title = `Acompanhar pedidos · ${cafeName}`;
let auth;
let db;
let unsubscribe;
let connecting = false;
let receivedServerSnapshot = false;
let readyIds = new Set();
let hasSnapshot = false;
let connectionVersion = 0;

function setNotice(message, kind = '', canRetry = false) {
  $('tracking-notice').textContent = message;
  $('tracking-notice').className = `notice ${kind}`;
  $('tracking-retry').hidden = !canRetry;
}

function renderTracking(orders) {
  const groups = groupActiveOrders(orders);
  for (const status of activeOrderStatuses) {
    const list = $('tracking-' + status);
    // Preserve existing cards while updating their stage, order and name.
    const existing = new Map([...list.children].map((node) => [node.dataset.order, node]));
    const cards = groups[status].map((order) => {
      const card = existing.get(order.id) ?? document.createElement('li');
      card.className = 'tracking-ticket';
      card.dataset.order = order.id;
      card.textContent = order.data.customer || 'Sem nome';
      return card;
    });
    list.replaceChildren(...cards);
    $('tracking-count-' + status).textContent = groups[status].length;
    $('tracking-empty-' + status).hidden = groups[status].length > 0;
  }
  const ready = groups.ready;
  const newReady = hasSnapshot ? ready.filter((order) => !readyIds.has(order.id)) : [];
  if (newReady.length) {
    $('tracking-announcement').textContent = `Prontos para retirar: ${newReady.map((order) => order.data.customer).join(', ')}.`;
  }
  readyIds = new Set(ready.map((order) => order.id));
  hasSnapshot = true;
  $('tracking-board').hidden = false;
}

async function connect() {
  if (connecting) return;
  if (!firebaseConfigured) {
    setNotice('O acompanhamento ainda não está disponível.', 'error');
    return;
  }
  connecting = true;
  const version = ++connectionVersion;
  unsubscribe?.();
  unsubscribe = undefined;
  receivedServerSnapshot = false;
  setNotice('Conectando…');
  try {
    if (!auth) {
      const app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
    }
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    if (version !== connectionVersion) return;
    const q = query(collection(db, 'orderStatus'),
      where('status', 'in', activeOrderStatuses), limit(200));
    unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      if (version !== connectionVersion) return;
      const fromCache = snapshot.metadata.fromCache;
      if (!fromCache) receivedServerSnapshot = true;
      if (!fromCache || snapshot.docs.length || receivedServerSnapshot) {
        renderTracking(snapshot.docs.map((order) => ({ id: order.id, data: order.data() })));
      }
      if (fromCache) setNotice('Reconectando… Os pedidos podem estar desatualizados.', 'error', true);
      else setNotice('Ao vivo', 'good');
    }, (error) => {
      if (version !== connectionVersion) return;
      console.error(error);
      $('tracking-board').hidden = true;
      setNotice('Não foi possível carregar os pedidos. Tente novamente.', 'error', true);
    });
  } catch (error) {
    if (version !== connectionVersion) return;
    console.error(error);
    $('tracking-board').hidden = true;
    setNotice('Não foi possível conectar. Verifique a internet.', 'error', true);
  } finally {
    if (version === connectionVersion) connecting = false;
  }
}

$('tracking-retry').addEventListener('click', connect);
window.addEventListener('offline', () => setNotice('Sem conexão. Os pedidos podem estar desatualizados.', 'error', true));
window.addEventListener('online', connect);
window.addEventListener('pagehide', () => {
  unsubscribe?.();
  unsubscribe = undefined;
  ++connectionVersion;
  connecting = false;
});
window.addEventListener('pageshow', (event) => { if (event.persisted) connect(); });
connect();
