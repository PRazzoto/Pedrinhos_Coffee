import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore, collection, doc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig, firebaseConfigured } from './firebase-config.js';
import { cafeName, menu, allItems, eventSettings } from './menu.js';
import { publicOrderData } from './order-status.js';
import { orderItemData, createOrderData } from './order-metrics.js';

const $ = (id) => document.getElementById(id);
$('brand').textContent = cafeName;
document.title = `Peça seu café · ${cafeName}`;
const cart = new Map();
const cartItems = new Map();
const menuRows = new Map();
const selections = new Map();
const mobileLayout = window.matchMedia('(max-width: 760px)');
const MAX_ITEMS = 20;
const currency = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
let db;
let connected = false;
let sending = false;
let confirmationTimer;
let checkoutOpen = false;
let returnFocus;
let activeOptions;

const cartCount = () => [...cart.values()].reduce((sum, qty) => sum + qty, 0);
const drinkCountLabel = (count) => `${count} ${count === 1 ? 'bebida' : 'bebidas'}`;

function setNotice(message, kind = '') {
  $('connection').textContent = message;
  $('connection').className = `notice ${kind}`;
  $('connection').classList.toggle('sr-only', kind === 'good');
}

function quantityIcon(isPlus) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', isPlus ? 'M5 12h14M12 5v14' : 'M5 12h14');
  svg.append(path);
  return svg;
}

function resetItemSelection(item) {
  selections.set(item.id, Object.fromEntries(
    (item.options ?? []).filter((group) => group.values.length === 1)
      .map((group) => [group.key, group.values[0]])));
}

function resetSelections() {
  activeOptions = undefined;
  for (const item of allItems) resetItemSelection(item);
}

function selectedVariant(item) {
  if (item.baseId) return item;
  const choice = selections.get(item.id) ?? {};
  const groups = item.options ?? [];
  if (groups.some((group) => !group.values.includes(choice[group.key]))) return null;
  const values = groups.map((group) => choice[group.key]);
  return {
    id: [item.id, ...values.map((value) => encodeURIComponent(value.toLowerCase()))].join('--'),
    baseId: item.id,
    name: [item.orderName ?? item.name, ...values].join(' · '),
    options: { ...item.attributes, ...choice },
    price: item.price,
  };
}

function createDrinkOptions(item) {
  const options = document.createElement('div');
  options.className = 'drink-options';
  options.id = `${item.id}-options`;
  options.hidden = true;
  for (const group of item.options) {
    if (group.values.length === 1) continue;
    const fieldset = document.createElement('fieldset');
    fieldset.dataset.option = group.key;
    const legend = document.createElement('legend');
    legend.textContent = group.label;
    const values = document.createElement('div');
    values.className = 'drink-option-values';
    for (const value of group.values) {
      const label = document.createElement('label');
      label.className = 'drink-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `${item.id}-${group.key}`;
      input.value = value;
      input.dataset.option = group.key;
      input.required = true;
      input.checked = selections.get(item.id)[group.key] === value;
      input.addEventListener('change', () => {
        if (!input.checked || sending || activeOptions !== item.id) return;
        const choice = selections.get(item.id);
        choice[group.key] = value;
        // A changed earlier choice requires confirming the following steps again.
        for (const next of item.options.slice(item.options.indexOf(group) + 1)) {
          if (next.values.length > 1) delete choice[next.key];
        }
        renderCart();
        const next = item.options.find((step) => !step.values.includes(choice[step.key]));
        const target = next
          ? options.querySelector(`fieldset[data-option="${next.key}"] input`)
          : options.querySelector('.add-variant');
        target?.focus({ preventScroll: true });
      });
      const text = document.createElement('span');
      text.textContent = value;
      label.append(input, text);
      values.append(label);
    }
    fieldset.append(legend, values);
    options.append(fieldset);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'primary-button add-variant';
  add.hidden = true;
  const label = document.createElement('span');
  label.textContent = 'Adicionar ao pedido';
  const arrow = document.createElement('span');
  arrow.textContent = '→';
  arrow.setAttribute('aria-hidden', 'true');
  add.append(label, arrow);
  add.addEventListener('click', () => {
    const variant = selectedVariant(item);
    if (!variant || sending || cartCount() >= MAX_ITEMS) return;
    closeDrinkOptions(false);
    changeQuantity(variant, 1);
    menuRows.get(item.id).querySelector('.quantity-plus').focus({ preventScroll: true });
  });
  options.append(add);
  return options;
}

function syncDrinkOptions(item, count) {
  const panel = menuRows.get(item.id).querySelector('.drink-options');
  if (!panel) return;
  const isOpen = activeOptions === item.id;
  const choice = selections.get(item.id);
  panel.hidden = !isOpen;
  for (const fieldset of panel.querySelectorAll('fieldset')) {
    const index = item.options.findIndex((group) => group.key === fieldset.dataset.option);
    const unlocked = isOpen && item.options.slice(0, index)
      .every((group) => group.values.includes(choice[group.key]));
    fieldset.hidden = !unlocked;
    fieldset.disabled = !unlocked || sending;
    for (const input of fieldset.querySelectorAll('input')) {
      input.checked = choice[input.dataset.option] === input.value;
      input.disabled = !unlocked || sending;
    }
  }
  const add = panel.querySelector('.add-variant');
  add.hidden = !isOpen || !selectedVariant(item);
  add.disabled = sending || count >= MAX_ITEMS;
}

function closeDrinkOptions(restoreFocus = true) {
  if (!activeOptions) return;
  const item = allItems.find((candidate) => candidate.id === activeOptions);
  activeOptions = undefined;
  resetItemSelection(item);
  renderCart();
  if (restoreFocus) menuRows.get(item.id).querySelector('.quantity-plus').focus({ preventScroll: true });
}

function toggleDrinkOptions(item) {
  if (activeOptions === item.id) { closeDrinkOptions(); return; }
  if (sending || cartCount() >= MAX_ITEMS) return;
  closeDrinkOptions(false);
  resetItemSelection(item);
  activeOptions = item.id;
  renderCart();
  menuRows.get(item.id).querySelector('.drink-options input:not(:disabled)')?.focus({ preventScroll: true });
}

function createQuantityControl(item) {
  const control = document.createElement('div');
  control.className = 'quantity-control';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', `Quantidade de ${item.name}`);
  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'quantity-minus';
  minus.append(quantityIcon(false));
  minus.setAttribute('aria-label', `Remover um ${item.name}`);
  const value = document.createElement('span');
  value.className = 'quantity-value';
  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'quantity-plus';
  plus.append(quantityIcon(true));
  plus.setAttribute('aria-label', `Adicionar um ${item.name}`);
  minus.addEventListener('click', () => changeQuantity(item, -1));
  plus.addEventListener('click', () => {
    if (item.options) toggleDrinkOptions(item);
    else changeQuantity(item, 1);
  });
  control.append(minus, value, plus);
  return control;
}

function updateQuantityControl(control, item, count, hideEmpty = false) {
  const customizable = Boolean(item.options);
  const variant = selectedVariant(item);
  const qty = customizable
    ? [...cart].reduce((sum, [id, qty]) => sum + (cartItems.get(id).baseId === item.id ? qty : 0), 0)
    : variant ? cart.get(variant.id) ?? 0 : 0;
  const minus = control.querySelector('.quantity-minus');
  const plus = control.querySelector('.quantity-plus');
  const value = control.querySelector('.quantity-value');
  minus.hidden = customizable || (hideEmpty && qty === 0);
  minus.disabled = sending || qty === 0;
  value.hidden = hideEmpty && qty === 0;
  value.textContent = qty;
  value.setAttribute('aria-label', `${qty} ${qty === 1 ? 'unidade' : 'unidades'}`);
  const isOpen = customizable && activeOptions === item.id;
  plus.disabled = sending || (count >= MAX_ITEMS && !isOpen) || (!customizable && !variant);
  const name = customizable ? item.name : variant?.name ?? item.name;
  control.setAttribute('aria-label', `Quantidade de ${name}`);
  minus.setAttribute('aria-label', `Remover um ${name}`);
  plus.setAttribute('aria-label', `Adicionar um ${name}`);
  if (customizable) {
    plus.setAttribute('aria-controls', `${item.id}-options`);
    plus.setAttribute('aria-expanded', String(isOpen));
    plus.setAttribute('aria-label', `${isOpen ? 'Fechar opções de' : 'Escolher opções de'} ${name}`);
    plus.querySelector('path').setAttribute('d', isOpen ? 'M6 6l12 12M18 6 6 18' : 'M5 12h14M12 5v14');
  }
}

function changeQuantity(item, delta) {
  if (sending) return;
  const variant = selectedVariant(item);
  if (!variant) return;
  const qty = cart.get(variant.id) ?? 0;
  if (delta > 0 && cartCount() >= MAX_ITEMS) return;
  const wasInCart = Boolean(document.activeElement?.closest('.cart-line'));
  const next = Math.max(0, qty + delta);
  if (next) {
    cart.set(variant.id, next);
    cartItems.set(variant.id, variant);
  } else {
    cart.delete(variant.id);
    cartItems.delete(variant.id);
  }
  $('order-error').hidden = true;
  renderCart();
  // Keep keyboard focus on a useful control when its minus button disappears.
  if (next === 0) {
    if (wasInCart && cart.size) $('cart-lines').querySelector('.quantity-minus')?.focus();
    else menuRows.get(variant.baseId).querySelector('.quantity-plus').focus();
  }
  $('cart-feedback').textContent = `${variant.name}: ${next}. ${drinkCountLabel(cartCount())} no pedido.`;
}

function categoryIcon(isCold) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', isCold
    ? 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3'
    : 'M5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Zm12 2h2a3 3 0 0 1 0 6h-2M3 23h17M9 5V2m5 3V2');
  svg.append(path);
  return svg;
}

function renderMenu() {
  $('menu').replaceChildren();
  for (const group of menu) {
    const section = document.createElement('section');
    section.className = 'menu-section';
    const title = document.createElement('h3');
    title.className = 'category-heading';
    title.append(categoryIcon(/gelad|frio/i.test(group.category)), document.createTextNode(group.category));
    const grid = document.createElement('div');
    grid.className = 'menu-grid';
    for (const item of group.items) {
      const row = document.createElement('article');
      row.className = 'menu-card';
      row.classList.toggle('featured', Boolean(item.featured));
      const details = document.createElement('div');
      details.className = 'drink-details';
      const name = document.createElement('h3');
      name.textContent = item.name;
      details.append(name);
      if (item.description) {
        const description = document.createElement('p');
        description.textContent = item.description;
        details.append(description);
      }
      if (item.price != null) {
        const price = document.createElement('span');
        price.className = 'price';
        price.textContent = currency(item.price);
        details.append(price);
      }
      row.append(details, createQuantityControl(item));
      if (item.options) {
        row.classList.add('has-options');
        row.append(createDrinkOptions(item));
      }
      menuRows.set(item.id, row);
      grid.append(row);
    }
    section.append(title, grid);
    $('menu').append(section);
  }
}

function renderCart() {
  const count = cartCount();
  const selected = [...cart.keys()].map((id) => cartItems.get(id));
  const lines = $('cart-lines');
  // Reuse rows so tapping +/- never loses keyboard focus or scroll position.
  for (const row of [...lines.children]) {
    if (!cart.has(row.dataset.item)) row.remove();
  }
  for (const item of selected) {
    let row = [...lines.children].find((node) => node.dataset.item === item.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'cart-line';
      row.dataset.item = item.id;
      const details = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'cart-line-name';
      name.textContent = item.name;
      details.append(name);
      if (item.price != null) {
        const price = document.createElement('span');
        price.className = 'cart-line-price';
        details.append(price);
      }
      row.append(details, createQuantityControl(item));
      lines.append(row);
    }
    if (item.price != null) row.querySelector('.cart-line-price').textContent = currency(item.price * cart.get(item.id));
    updateQuantityControl(row.querySelector('.quantity-control'), item, count);
  }
  for (const item of allItems) {
    const row = menuRows.get(item.id);
    row.classList.toggle('selected', selected.some((variant) => variant.baseId === item.id));
    updateQuantityControl(row.querySelector('.quantity-control'), item, count, true);
    syncDrinkOptions(item, count);
  }
  $('cart-empty').hidden = count > 0;
  $('cart-count').hidden = count === 0;
  $('cart-count').textContent = drinkCountLabel(count);
  $('order-form').hidden = count === 0;
  $('cart-dock').hidden = count === 0;
  $('dock-count').textContent = count;
  $('review-order').setAttribute('aria-label', `Ver meu pedido, ${drinkCountLabel(count)}`);
  $('submit-order').disabled = !connected || sending || count === 0;
  $('customer-name').disabled = sending;
  $('customer-notes').disabled = sending;
  document.body.classList.toggle('has-cart', count > 0);
  if (count === 0 && checkoutOpen) closeCheckout(false);
}

function syncModalState() {
  const confirmationOpen = !$('confirmation').hidden;
  const isModal = checkoutOpen || confirmationOpen;
  document.body.classList.toggle('modal-open', isModal);
  // The checkout lives inside page-content, so only its siblings become inert.
  $('page-content').inert = confirmationOpen;
  document.querySelector('.topbar').inert = checkoutOpen;
  document.querySelector('.hero').inert = checkoutOpen;
  document.querySelector('.menu-panel').inert = checkoutOpen;
  $('cart-dock').inert = isModal;
}

function openCheckout() {
  if (!mobileLayout.matches || !cart.size) return;
  closeDrinkOptions(false);
  returnFocus = document.activeElement;
  checkoutOpen = true;
  $('checkout').classList.add('is-open');
  $('checkout').setAttribute('role', 'dialog');
  $('checkout').setAttribute('aria-modal', 'true');
  $('checkout-backdrop').hidden = false;
  $('review-order').setAttribute('aria-expanded', 'true');
  syncModalState();
  $('close-checkout').focus();
}

function closeCheckout(restoreFocus = true) {
  checkoutOpen = false;
  $('checkout').classList.remove('is-open');
  $('checkout').removeAttribute('role');
  $('checkout').removeAttribute('aria-modal');
  $('checkout-backdrop').hidden = true;
  $('review-order').setAttribute('aria-expanded', 'false');
  syncModalState();
  if (restoreFocus && mobileLayout.matches) {
    if (cart.size) returnFocus?.focus();
    else document.querySelector('.quantity-plus')?.focus();
  }
}

async function init() {
  if (!firebaseConfigured) {
    setNotice('Os pedidos ainda não estão disponíveis. Fale com o barista.', 'error');
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    db = getFirestore(app);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    connected = true;
    setNotice('Pronto para receber seu pedido', 'good');
  } catch (error) {
    console.error(error);
    setNotice('Não foi possível conectar. Verifique a internet e recarregue a página.', 'error');
  }
  renderCart();
}

$('order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending || !connected || !cart.size) return;
  const customer = $('customer-name').value.trim();
  const notes = $('customer-notes').value.trim();
  if (!customer) { $('customer-name').focus(); return; }
  const items = [...cart].map(([id, qty]) => orderItemData(cartItems.get(id), qty, menu, eventSettings.currency));
  sending = true;
  $('order-error').hidden = true;
  $('submit-order').firstElementChild.textContent = 'Enviando…';
  $('order-form').setAttribute('aria-busy', 'true');
  renderCart();
  try {
    const orderRef = doc(collection(db, 'orders'));
    const eventRef = doc(collection(db, 'orders', orderRef.id, 'events'));
    const { order, event } = createOrderData({
      customer, notes, items, settings: eventSettings,
      at: serverTimestamp(), eventId: eventRef.id,
    });
    const batch = writeBatch(db);
    batch.set(orderRef, order);
    batch.set(eventRef, event);
    batch.set(doc(db, 'orderStatus', orderRef.id), publicOrderData(order));
    await batch.commit();
    closeCheckout(false);
    cart.clear();
    cartItems.clear();
    resetSelections();
    $('order-form').reset();
    $('notes-details').open = false;
    renderCart();
    $('confirmation-name').textContent = `${customer}, retire no balcão.`;
    $('confirmation').hidden = false;
    syncModalState();
    $('new-order').focus();
    clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(closeConfirmation, 20000);
  } catch (error) {
    console.error(error);
    $('order-error').textContent = 'Não conseguimos enviar. Seu pedido continua aqui. Verifique a conexão e tente de novo.';
    $('order-error').hidden = false;
  } finally {
    sending = false;
    $('submit-order').firstElementChild.textContent = 'Enviar pedido';
    $('order-form').removeAttribute('aria-busy');
    renderCart();
  }
});

function closeConfirmation() {
  clearTimeout(confirmationTimer);
  $('confirmation').hidden = true;
  syncModalState();
  document.querySelector('.quantity-plus')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

$('review-order').addEventListener('click', openCheckout);
$('close-checkout').addEventListener('click', () => closeCheckout());
$('checkout-backdrop').addEventListener('click', () => closeCheckout());
$('new-order').addEventListener('click', closeConfirmation);
mobileLayout.addEventListener('change', () => { if (checkoutOpen) closeCheckout(false); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeOptions) {
    closeDrinkOptions();
    return;
  }
  const confirmationOpen = !$('confirmation').hidden;
  if (!checkoutOpen && !confirmationOpen) return;
  if (event.key === 'Escape') {
    if (confirmationOpen) closeConfirmation();
    else closeCheckout();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = confirmationOpen ? $('confirmation') : $('checkout');
  const controls = [...dialog.querySelectorAll('a[href], button, input, textarea, summary')]
    .filter((node) => !node.disabled && node.getClientRects().length);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
resetSelections();
renderMenu();
renderCart();
init();
