(function () {
  'use strict';

  var app = document.getElementById('app');
  var dlg = document.getElementById('cart-dialog');
  var dlgBody = document.getElementById('cart-body');
  document.getElementById('cart-close').addEventListener('click', function () { dlg.close(); });

  var menu = null;
  var byId = new Map();
  var cart = new Map();
  var table = null;
  var note = '';
  var sending = false;
  var formError = '';
  var active = null;
  var pollTimer = null;
  var cartBar = null;
  var holders = new Map();
  var fmt = null;

  var LABELS = { nuevo: 'Recibido', preparando: 'En preparación', listo: 'Listo', entregado: 'Entregado', cancelado: 'Cancelado' };
  var MESSAGES = {
    nuevo: 'El bar ya tiene tu pedido.',
    preparando: 'Lo están preparando.',
    listo: 'Tu pedido está listo.',
    entregado: 'Que aproveche.',
    cancelado: 'El bar ha cancelado este pedido. Pregunta en barra.'
  };
  var STEPS = ['nuevo', 'preparando', 'listo', 'entregado'];

  /* ---------- utilidades ---------- */

  function store(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* sin almacenamiento: la página funciona igual */ }
  }
  function load(key) {
    try {
      var raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === false || v == null) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(node, k); }); return; }
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  function money(cents) { return fmt.format(cents / 100); }

  function totals() {
    var count = 0, cents = 0;
    cart.forEach(function (qty, id) {
      count += qty;
      cents += byId.get(id).cents * qty;
    });
    return { count: count, cents: cents };
  }

  function persistCart() { store('cart', Array.from(cart.entries())); }

  /* ---------- carta ---------- */

  function stepperButtons(item) {
    var q = cart.get(item.id) || 0;
    if (q === 0) {
      return [el('button', { class: 'add', type: 'button', 'aria-label': 'Añadir ' + item.name, text: 'Añadir', onclick: function () { change(item.id, 1); } })];
    }
    return [
      el('button', { type: 'button', 'aria-label': 'Quitar una unidad de ' + item.name, text: '−', onclick: function () { change(item.id, -1); } }),
      el('span', { class: 'qty num', text: String(q) }),
      el('button', { type: 'button', 'aria-label': 'Añadir una unidad de ' + item.name, text: '+', onclick: function () { change(item.id, 1); } })
    ];
  }

  function itemRow(item) {
    var holder = el('div', { class: 'stepper' }, stepperButtons(item));
    holders.set(item.id, holder);
    return el('li', { class: 'item' },
      el('div', { class: 'item-main' },
        el('div', { class: 'item-name', text: item.name }),
        item.desc ? el('div', { class: 'item-desc', text: item.desc }) : null,
        el('div', { class: 'item-price num', text: money(item.cents) })),
      holder);
  }

  function refreshItem(id, delta) {
    var holder = holders.get(id);
    if (!holder) return;
    var had = holder.contains(document.activeElement);
    holder.replaceChildren.apply(holder, stepperButtons(byId.get(id)));
    if (had) {
      var buttons = holder.querySelectorAll('button');
      (delta > 0 ? buttons[buttons.length - 1] : buttons[0]).focus();
    }
  }

  function refreshBar() {
    if (!cartBar) return;
    var t = totals();
    cartBar.hidden = t.count === 0;
    cartBar.querySelector('.bar-count').textContent = 'Ver pedido · ' + t.count + (t.count === 1 ? ' producto' : ' productos');
    cartBar.querySelector('.bar-total').textContent = money(t.cents);
  }

  function change(id, delta) {
    var next = Math.max(0, Math.min(20, (cart.get(id) || 0) + delta));
    if (next === 0) cart.delete(id); else cart.set(id, next);
    persistCart();
    refreshItem(id, delta);
    refreshBar();
    if (dlg.open) {
      if (cart.size === 0) dlg.close(); else renderCart();
    }
  }

  function showMenu() {
    clearTimeout(pollTimer);
    holders.clear();
    document.title = menu.name;

    var header = el('header', { class: 'wrap top' },
      el('div', null,
        el('h1', { text: menu.name }),
        el('div', { class: 'hint', text: 'Pide desde tu mesa' })),
      table ? el('div', { class: 'table-chip', text: 'Mesa ' + table }) : null);

    var nav = el('nav', { class: 'catnav', 'aria-label': 'Categorías' },
      el('div', { class: 'wrap catnav-inner' },
        menu.categories.map(function (c, i) { return el('a', { href: '#cat-' + i, text: c.name }); })));

    var sections = menu.categories.map(function (c, i) {
      return el('section', { class: 'cat', id: 'cat-' + i },
        el('h2', { text: c.name }),
        el('ul', { class: 'items' }, c.items.map(itemRow)));
    });

    app.replaceChildren(header, nav, el('div', { class: 'wrap' }, sections, el('div', { class: 'spacer' })));

    if (cartBar) cartBar.remove();
    cartBar = el('div', { class: 'cartbar', hidden: true },
      el('div', { class: 'inner' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: openCart },
          el('span', { class: 'bar-count' }),
          el('span', { class: 'bar-total num' }))));
    document.body.append(cartBar);
    refreshBar();
  }

  /* ---------- pedido ---------- */

  function openCart() {
    formError = '';
    renderCart();
    if (typeof dlg.showModal === 'function') dlg.showModal();
  }

  function renderCart() {
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    var t = totals();

    var lines = Array.from(cart.entries()).map(function (entry) {
      var id = entry[0], q = entry[1], item = byId.get(id);
      return el('div', { class: 'line' },
        el('div', { class: 'line-name', text: item.name }),
        el('div', { class: 'stepper' },
          el('button', { type: 'button', 'data-key': id + '-minus', 'aria-label': 'Quitar una unidad de ' + item.name, text: '−', onclick: function () { change(id, -1); } }),
          el('span', { class: 'qty num', text: String(q) }),
          el('button', { type: 'button', 'data-key': id + '-plus', 'aria-label': 'Añadir una unidad de ' + item.name, text: '+', onclick: function () { change(id, 1); } })),
        el('div', { class: 'line-price num', text: money(item.cents * q) }));
    });

    var tableField = null;
    if (!table) {
      var select = el('select', { id: 'table-select', onchange: function (e) { table = parseInt(e.target.value, 10) || null; store('table', table); } },
        el('option', { value: '', text: 'Elige tu mesa' }));
      for (var n = 1; n <= menu.tables; n++) select.append(el('option', { value: String(n), text: 'Mesa ' + n }));
      tableField = el('div', { class: 'field' }, el('label', { for: 'table-select', text: 'Mesa' }), select);
    }

    var noteArea = el('textarea', {
      id: 'order-note', maxlength: '200', rows: '3',
      placeholder: 'Por ejemplo: sin hielo, la caña bien fría…',
      oninput: function (e) { note = e.target.value; }
    });
    noteArea.value = note;

    var children = [
      el('div', null, lines),
      el('div', { class: 'total' }, el('span', { text: 'Total' }), el('span', { class: 'num', text: money(t.cents) })),
      menu.paymentNote ? el('p', { class: 'hint', text: menu.paymentNote }) : null,
      tableField,
      el('div', { class: 'field' }, el('label', { for: 'order-note', text: 'Nota para el bar (opcional)' }), noteArea),
      formError ? el('div', { class: 'error', role: 'alert', text: formError }) : null,
      el('div', { class: 'dlg-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', disabled: sending || cart.size === 0, onclick: sendOrder, text: sending ? 'Enviando…' : 'Enviar pedido al bar' }),
        el('button', { class: 'btn', type: 'button', onclick: function () { dlg.close(); }, text: 'Seguir pidiendo' }))
    ];
    dlgBody.replaceChildren.apply(dlgBody, children.filter(Boolean));

    if (focused) {
      var again = dlgBody.querySelector('[data-key="' + CSS.escape(focused) + '"]');
      if (again) again.focus();
    }
  }

  function sendOrder() {
    if (sending) return;
    formError = '';
    if (!table) {
      formError = 'Elige tu mesa para enviar el pedido.';
      renderCart();
      return;
    }
    sending = true;
    renderCart();
    fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: table,
        note: note,
        items: Array.from(cart.entries()).map(function (e) { return { id: e[0], qty: e[1] }; })
      })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'No se pudo enviar el pedido.');
        return data;
      });
    }).then(function (data) {
      active = { id: data.id, number: data.number, status: data.status, totalCents: data.totalCents, table: table };
      store('order', active);
      cart.clear();
      persistCart();
      note = '';
      sending = false;
      if (dlg.open) dlg.close();
      showStatus();
      poll();
    }).catch(function (err) {
      sending = false;
      formError = err instanceof TypeError
        ? 'No hay conexión. Comprueba el wifi e inténtalo otra vez, o pide en barra.'
        : err.message;
      if (dlg.open) renderCart();
    });
  }

  /* ---------- seguimiento ---------- */

  function showStatus() {
    holders.clear();
    if (cartBar) { cartBar.remove(); cartBar = null; }
    document.title = 'Pedido ' + active.number + ' · ' + menu.name;

    var reached = STEPS.indexOf(active.status);
    var steps = el('ol', { class: 'steps', 'aria-label': 'Progreso del pedido' },
      STEPS.map(function (s, i) {
        return el('li', { class: i <= reached ? 'done' : '', text: LABELS[s] });
      }));

    var card = el('section', { class: 'status-card', 'aria-live': 'polite' },
      el('h2', { text: 'Pedido nº ' + active.number }),
      el('p', { class: 'hint num', text: 'Mesa ' + active.table + ' · ' + money(active.totalCents) }),
      el('span', { class: 'badge badge-' + active.status, text: LABELS[active.status] }),
      el('p', { text: MESSAGES[active.status] }),
      active.status === 'cancelado' ? null : steps,
      menu.paymentNote ? el('p', { class: 'hint', text: menu.paymentNote }) : null,
      el('div', { class: 'dlg-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: newOrder, text: 'Pedir algo más' })));

    app.replaceChildren(
      el('header', { class: 'wrap top' }, el('div', null, el('h1', { text: menu.name }))),
      el('div', { class: 'wrap' }, card));
  }

  function poll() {
    clearTimeout(pollTimer);
    if (!active || active.status === 'entregado' || active.status === 'cancelado') return;
    pollTimer = setTimeout(function () {
      fetch('/api/orders/' + active.id).then(function (res) {
        if (res.status === 404) { active = null; store('order', null); showMenu(); return null; }
        return res.ok ? res.json() : null;
      }).then(function (data) {
        if (data && active) {
          if (data.status !== active.status) {
            active.status = data.status;
            store('order', active);
            showStatus();
          }
        }
      }).catch(function () { /* sin conexión: se reintenta */ }).then(poll);
    }, 6000);
  }

  function newOrder() {
    active = null;
    store('order', null);
    showMenu();
  }

  /* ---------- arranque ---------- */

  function fail() {
    app.replaceChildren(el('div', { class: 'wrap' },
      el('p', { class: 'error', role: 'alert', text: 'No se pudo cargar la carta. Recarga la página o pide en barra.' })));
  }

  fetch('/api/menu').then(function (res) {
    if (!res.ok) throw new Error('menu');
    return res.json();
  }).then(function (data) {
    menu = data;
    fmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: menu.currency });
    menu.categories.forEach(function (c) { c.items.forEach(function (i) { byId.set(i.id, i); }); });

    var fromUrl = parseInt(new URLSearchParams(location.search).get('mesa'), 10);
    if (fromUrl >= 1 && fromUrl <= menu.tables) { table = fromUrl; store('table', table); }
    else {
      var saved = load('table');
      table = saved >= 1 && saved <= menu.tables ? saved : null;
    }

    (load('cart') || []).forEach(function (pair) {
      if (byId.has(pair[0]) && pair[1] > 0) cart.set(pair[0], Math.min(20, pair[1]));
    });

    var savedOrder = load('order');
    if (savedOrder && savedOrder.id) { active = savedOrder; showStatus(); poll(); }
    else showMenu();
  }).catch(fail);
})();
