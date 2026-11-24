(function () {
  'use strict';

  var board = document.getElementById('board');
  var liveEl = document.getElementById('live');
  var liveText = document.getElementById('live-text');
  var soundBtn = document.getElementById('sound');
  var msgWrap = document.getElementById('msg-wrap');
  var msgEl = document.getElementById('msg');

  var orders = [];
  var seen = null;
  var fresh = new Set();
  var soundOn = false;
  var audioCtx = null;
  var armed = null;
  var armTimer = null;
  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  var COLUMNS = [
    { key: 'nuevo', title: 'Nuevos', action: 'Preparar', next: 'preparando' },
    { key: 'preparando', title: 'En preparación', action: 'Marcar listo', next: 'listo' },
    { key: 'listo', title: 'Listos para servir', action: 'Entregado', next: 'entregado' }
  ];

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

  function ago(ms) {
    var mins = Math.floor((Date.now() - ms) / 60000);
    if (mins < 1) return 'ahora mismo';
    return 'hace ' + mins + ' min';
  }

  function showMessage(text) {
    msgEl.textContent = text;
    msgWrap.hidden = !text;
  }

  function beep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25].forEach(function (offset) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + offset + 0.2);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + offset);
        osc.stop(audioCtx.currentTime + offset + 0.22);
      });
    } catch (e) { /* sin audio disponible */ }
  }

  soundBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.textContent = soundOn ? 'Aviso sonoro activado' : 'Activar aviso sonoro';
    if (soundOn) beep();
  });

  function setStatus(order, status) {
    showMessage('');
    fetch('/api/staff/orders/' + order.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          showMessage((data.error || 'No se pudo actualizar el pedido.') + ' La lista se ha refrescado.');
        });
      }
    }).catch(function () {
      showMessage('Sin conexión con el servidor. Reintenta en unos segundos.');
    });
  }

  function disarm() {
    armed = null;
    clearTimeout(armTimer);
  }

  function card(col, order) {
    var isArmed = armed === order.id;
    return el('article', { class: 'order' + (fresh.has(order.id) ? ' fresh' : ''), 'aria-label': 'Mesa ' + order.table + ', pedido ' + order.number },
      el('div', { class: 'order-top' },
        el('div', { class: 'order-table', text: 'Mesa ' + order.table }),
        el('div', { class: 'order-meta num', text: '#' + order.number + ' · ' + ago(order.createdAt) })),
      el('ul', null, order.items.map(function (it) {
        return el('li', null, el('b', { class: 'num', text: it.qty + '×' }), el('span', { text: it.name }));
      })),
      order.note ? el('div', { class: 'order-note', text: 'Nota: ' + order.note }) : null,
      el('div', { class: 'order-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', text: col.action, onclick: function () { disarm(); setStatus(order, col.next); } }),
        el('button', {
          class: 'btn btn-small btn-danger' + (isArmed ? ' armed' : ''),
          type: 'button',
          text: isArmed ? 'Confirmar cancelación' : 'Cancelar',
          onclick: function () {
            if (isArmed) { disarm(); setStatus(order, 'cancelado'); return; }
            armed = order.id;
            clearTimeout(armTimer);
            armTimer = setTimeout(function () { disarm(); render(); }, 4000);
            render();
          }
        }),
        el('span', { class: 'order-total num', text: money.format(order.totalCents / 100) })));
  }

  function render() {
    var nuevos = orders.filter(function (o) { return o.status === 'nuevo'; }).length;
    document.title = (nuevos ? '(' + nuevos + ') ' : '') + 'Barra';

    board.replaceChildren.apply(board, COLUMNS.map(function (col) {
      var list = orders.filter(function (o) { return o.status === col.key; });
      return el('section', { class: 'col', 'aria-label': col.title },
        el('h2', null, el('span', { text: col.title }), el('span', { class: 'num', text: String(list.length) })),
        el('div', { class: 'col-list' },
          list.length ? list.map(function (o) { return card(col, o); }) : el('div', { class: 'empty', text: 'Sin pedidos.' })));
    }));
  }

  function setLive(on) {
    liveEl.classList.toggle('on', on);
    liveText.textContent = on ? 'En directo' : 'Reconectando…';
  }

  var source = new EventSource('/api/staff/stream');
  source.addEventListener('open', function () { setLive(true); });
  source.addEventListener('error', function () { setLive(false); });
  source.addEventListener('orders', function (e) {
    var list;
    try { list = JSON.parse(e.data); } catch (err) { return; }
    if (seen === null) {
      seen = new Set(list.map(function (o) { return o.id; }));
    } else {
      var added = list.filter(function (o) { return !seen.has(o.id); });
      added.forEach(function (o) {
        seen.add(o.id);
        fresh.add(o.id);
        setTimeout(function () { fresh.delete(o.id); render(); }, 60000);
      });
      if (added.length && soundOn) beep();
    }
    orders = list;
    render();
  });

  setInterval(render, 30000);
  render();
})();
