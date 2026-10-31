import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig, firebaseConfigured } from './firebase-config.js';
import { cafeName } from './menu.js';

const $ = (id) => document.getElementById(id);
$('brand').textContent = cafeName;
document.title = `Fila de pedidos · ${cafeName}`;
let auth;
let db;
let unsubscribe;
let hasInitialSnapshot = false;
let showCompleted = false;
let lastOrders = [];
let soundEnabled = false;
let audioContext;
const STATUS_LABELS = { pending: 'Na fila', preparing: 'Preparando', ready: 'Pronto para retirar', delivered: 'Entregue' };

function setNotice(message, kind = '') {
  $('admin-notice').textContent = message;
  $('admin-notice').className = `notice ${kind}`;
  $('admin-notice').classList.toggle('sr-only', kind === 'good');
}
function setView(loggedIn) {
  $('login-view').hidden = loggedIn;
  $('queue-view').hidden = !loggedIn;
}
function beep() {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  for (const [index, freq] of [740, 980].entries()) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    const start = now + index * 0.17;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  }
}

function makeOrderCard(order) {
  const data = order.data;
  const card = document.createElement('article');
  card.className = `order-card ${data.status || 'pending'}`;
  const top = document.createElement('div');
  top.className = 'order-top';
  const heading = document.createElement('h3');
  heading.textContent = data.customer || 'Sem nome';
  const time = document.createElement('span');
  time.className = 'order-time';
  time.textContent = data.createdAt?.toDate()?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) || 'Agora';
  top.append(heading, time);
  const status = document.createElement('div');
  status.className = 'order-status';
  status.textContent = STATUS_LABELS[data.status] || 'Na fila';
  const items = document.createElement('ul');
  items.className = 'order-items';
  for (const item of Array.isArray(data.items) ? data.items : []) {
    const li = document.createElement('li');
    li.textContent = `${item.qty}× ${item.name}`;
    items.append(li);
  }
  card.append(top, status, items);
  if (data.notes) {
    const notes = document.createElement('p');
    notes.className = 'order-notes';
    notes.textContent = `Obs.: ${data.notes}`;
    card.append(notes);
  }
  const actions = document.createElement('div');
  actions.className = 'order-actions';
  const options = {
    pending: [['preparing', 'Começar preparo →']],
    preparing: [['ready', 'Marcar pronto']],
    ready: [['delivered', 'Confirmar entrega ✓']],
    delivered: [['pending', 'Reabrir pedido', true]],
  }[data.status] || [];
  for (const [next, label, quiet] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', `${label} · ${data.customer || 'Sem nome'}`);
    if (quiet) button.className = 'quiet';
    button.addEventListener('click', async () => {
      $('queue-error').hidden = true;
      for (const sibling of actions.querySelectorAll('button')) sibling.disabled = true;
      const previousLabel = button.textContent;
      button.textContent = 'Atualizando…';
      try {
        await updateDoc(doc(db, 'orders', order.id), { status: next, updatedAt: serverTimestamp() });
      } catch (error) {
        console.error(error);
        $('queue-error').textContent = 'Não foi possível atualizar. Verifique a conexão e tente novamente.';
        $('queue-error').hidden = false;
        button.textContent = previousLabel;
        for (const sibling of actions.querySelectorAll('button')) sibling.disabled = false;
      }
    });
    actions.append(button);
  }
  card.append(actions);
  return card;
}

function renderQueue(orders) {
  const oldestFirst = [...orders].sort((a, b) =>
    (a.data.createdAt?.toMillis() ?? 0) - (b.data.createdAt?.toMillis() ?? 0));
  const pending = oldestFirst.filter(({data}) => data.status === 'pending');
  const preparing = oldestFirst.filter(({data}) => data.status === 'preparing');
  const ready = oldestFirst.filter(({data}) => data.status === 'ready');
  const delivered = orders.filter(({data}) => data.status === 'delivered');
  $('count-pending').textContent = pending.length;
  $('count-preparing').textContent = preparing.length;
  $('count-ready').textContent = ready.length;
  const active = [...pending, ...preparing, ...ready];
  $('active-count').textContent = `${active.length} ${active.length === 1 ? 'pedido ativo' : 'pedidos ativos'}`;
  $('active-orders').replaceChildren(...active.map(makeOrderCard));
  $('queue-empty').hidden = active.length !== 0;
  $('completed-orders').replaceChildren(...delivered.map(makeOrderCard));
  if (!delivered.length) {
    const empty = document.createElement('p');
    empty.className = 'completed-empty';
    empty.textContent = 'Nenhum pedido entregue ainda.';
    $('completed-orders').append(empty);
  }
}

function listenToOrders() {
  unsubscribe?.();
  hasInitialSnapshot = false;
  setNotice('Buscando pedidos…');
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(200));
  unsubscribe = onSnapshot(q, (snapshot) => {
    if (hasInitialSnapshot && snapshot.docChanges().some((change) => change.type === 'added' && change.doc.data().status === 'pending')) beep();
    hasInitialSnapshot = true;
    lastOrders = snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
    renderQueue(lastOrders);
    setNotice('Atualizando em tempo real', 'good');
  }, (error) => {
    console.error(error);
    setNotice('Não foi possível carregar os pedidos. Verifique a conexão e o acesso da sua conta.', 'error');
  });
}

async function init() {
  if (!firebaseConfigured) {
    $('login-error').textContent = 'O painel ainda não está disponível. Entre em contato com a organização.';
    $('login-button').disabled = true;
    return;
  }
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  onAuthStateChanged(auth, (user) => {
    const isEmailUser = Boolean(user && !user.isAnonymous);
    setView(isEmailUser);
    if (isEmailUser) listenToOrders();
    else { unsubscribe?.(); unsubscribe = undefined; }
  });
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('login-error').textContent = '';
  $('login-button').disabled = true;
  $('login-button').firstElementChild.textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    $('password').value = '';
  } catch (error) {
    console.error(error);
    $('login-error').textContent = 'Não foi possível entrar. Confira o e-mail, a senha e sua conexão.';
  } finally {
    $('login-button').disabled = false;
    $('login-button').firstElementChild.textContent = 'Entrar';
  }
});
$('logout-button').addEventListener('click', async () => {
  unsubscribe?.(); unsubscribe = undefined;
  await signOut(auth);
});
$('toggle-completed').addEventListener('click', () => {
  showCompleted = !showCompleted;
  $('completed-orders').hidden = !showCompleted;
  $('toggle-completed').textContent = showCompleted ? 'Ocultar' : 'Mostrar';
  $('toggle-completed').setAttribute('aria-expanded', String(showCompleted));
});
$('sound-button').addEventListener('click', async () => {
  if (soundEnabled) {
    soundEnabled = false;
    $('sound-button').textContent = 'Ativar som';
    $('sound-button').setAttribute('aria-pressed', 'false');
    return;
  }
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    soundEnabled = true;
    $('sound-button').textContent = 'Som ativado ✓';
    $('sound-button').setAttribute('aria-pressed', 'true');
    beep();
  } catch (error) {
    console.error(error);
    setNotice('Não foi possível ativar o som. Os pedidos continuam aparecendo nesta tela.', 'error');
  }
});
init();
