(function () {
  'use strict';

  var money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  var percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });
  var dayInput = document.getElementById('day');
  var reportEl = document.getElementById('report');
  var historyEl = document.getElementById('history');
  var errEl = document.getElementById('err');
  var okEl = document.getElementById('ok');

  var live = null;     // informe del día que se está viendo en vivo
  var saving = false;

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

  function showError(text) { errEl.textContent = text || ''; errEl.hidden = !text; }
  function showOk(text) { okEl.textContent = text || ''; okEl.hidden = !text; }

  function formatDay(day) {
    var p = day.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }
  function formatTime(ms) {
    return new Date(ms).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  function api(url, options) {
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Error del servidor');
        return data;
      });
    });
  }

  function tile(label, value, main) {
    return el('div', { class: 'tile' + (main ? ' main' : '') },
      el('div', { class: 'label', text: label }),
      el('div', { class: 'value num', text: value }));
  }

  function share(fraction) {
    var fill = el('i');
    fill.style.width = Math.max(0, Math.min(1, fraction)) * 100 + '%';
    return el('span', { class: 'share', 'aria-hidden': 'true' }, fill);
  }

  function breakdown(title, firstHeader, secondHeader, rows, total) {
    if (!rows.length) return null;
    return el('section', null,
      el('h2', { class: 'section-title', text: title }),
      el('div', { class: 'tbl-wrap' },
        el('table', { class: 'tbl' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: firstHeader }),
            el('th', { scope: 'col', class: 'r', text: secondHeader }),
            el('th', { scope: 'col', class: 'r', text: 'Importe' }),
            el('th', { scope: 'col', class: 'r', text: '%' }),
            el('th', { scope: 'col', class: 'bar-col', text: '' }))),
          el('tbody', null, rows.map(function (r) {
            var f = total ? r.cents / total : 0;
            return el('tr', null,
              el('td', null, r.label, r.sub ? el('div', { class: 'hint', text: r.sub }) : null),
              el('td', { class: 'r', text: String(r.count) }),
              el('td', { class: 'r', text: money.format(r.cents / 100) }),
              el('td', { class: 'r', text: percent.format(f) }),
              el('td', { class: 'bar-col' }, share(f)));
          })))));
  }

  function render(report, snapshot) {
    var blocks = [];

    if (snapshot) {
      blocks.push(el('div', { class: 'notice info' },
        'Cierre guardado el ' + formatTime(snapshot.closedAt) + '. Estos importes no cambian aunque se modifiquen pedidos después. ',
        el('button', { class: 'btn btn-small no-print', type: 'button', text: 'Volver al día en curso', onclick: function () { loadDay(report.day); } })));
    }

    blocks.push(el('h2', { class: 'section-title', text: formatDay(report.day) }));

    blocks.push(el('div', { class: 'summary' },
      tile('Total ingresado', money.format(report.totalCents / 100), true),
      tile('Pedidos entregados', String(report.orders)),
      tile('Ticket medio', money.format(report.avgCents / 100)),
      tile('Unidades vendidas', String(report.units))));

    if (report.pending.orders > 0) {
      blocks.push(el('div', { class: 'notice warn', role: 'status' },
        report.pending.orders + (report.pending.orders === 1 ? ' pedido sigue sin entregar' : ' pedidos siguen sin entregar') +
        ' (' + money.format(report.pending.cents / 100) + ') y no ' + (report.pending.orders === 1 ? 'está incluido' : 'están incluidos') +
        ' en el total. Entrégalos o cancélalos desde el panel de barra antes de cerrar.'));
    }
    if (report.cancelled.orders > 0) {
      blocks.push(el('p', { class: 'hint',
        text: report.cancelled.orders + (report.cancelled.orders === 1 ? ' pedido cancelado' : ' pedidos cancelados') +
          ' (' + money.format(report.cancelled.cents / 100) + '), no incluido' + (report.cancelled.orders === 1 ? '' : 's') + ' en el total.' }));
    }

    if (report.orders === 0) {
      blocks.push(el('p', { class: 'load-msg', text: 'No hay ventas entregadas este día.' }));
    } else {
      blocks.push(breakdown('Por categoría', 'Categoría', 'Uds.',
        report.byCategory.map(function (c) { return { label: c.name, count: c.units, cents: c.cents }; }), report.totalCents));
      blocks.push(breakdown('Por producto', 'Producto', 'Uds.',
        report.byProduct.map(function (p) { return { label: p.name, sub: p.category, count: p.units, cents: p.cents }; }), report.totalCents));
      blocks.push(breakdown('Por mesa', 'Mesa', 'Pedidos',
        report.byTable.map(function (t) { return { label: 'Mesa ' + t.table, count: t.orders, cents: t.cents }; }), report.totalCents));
    }

    if (!snapshot) {
      blocks.push(el('div', { class: 'dlg-actions no-print' },
        el('button', {
          class: 'btn btn-primary', type: 'button',
          disabled: saving || report.orders === 0,
          text: saving ? 'Guardando…' : 'Guardar cierre de caja',
          onclick: saveClosing
        }),
        el('p', { class: 'hint', text: 'Guarda una copia de estos importes tal como están ahora. Queda en la lista de cierres guardados.' })));
    }

    reportEl.replaceChildren.apply(reportEl, blocks.filter(Boolean));
  }

  function loadDay(day) {
    showError('');
    return api('/api/staff/report' + (day ? '?day=' + encodeURIComponent(day) : '')).then(function (report) {
      live = report;
      dayInput.value = report.day;
      render(report, null);
    }).catch(function (e) { showError(e.message); });
  }

  function saveClosing() {
    if (!live || saving) return;
    saving = true;
    showError('');
    showOk('');
    render(live, null);
    api('/api/staff/closings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: live.day })
    }).then(function (closing) {
      showOk('Cierre guardado: ' + money.format(closing.report.totalCents / 100) + ' el ' + formatTime(closing.closedAt) + '.');
      return loadHistory();
    }).catch(function (e) {
      showError(e.message);
    }).then(function () {
      saving = false;
      if (live) render(live, null);
    });
  }

  function loadHistory() {
    return api('/api/staff/closings').then(function (list) {
      if (!list.length) {
        historyEl.replaceChildren(el('p', { class: 'hint', text: 'Todavía no has guardado ningún cierre.' }));
        return;
      }
      historyEl.replaceChildren(el('ul', { class: 'history' }, list.map(function (c) {
        return el('li', null,
          el('div', null,
            el('div', { text: formatDay(c.day) }),
            el('div', { class: 'hint', text: 'Guardado el ' + formatTime(c.closedAt) + ' · ' + c.orders + (c.orders === 1 ? ' pedido' : ' pedidos') })),
          el('div', { class: 'history-right' },
            el('strong', { class: 'num', text: money.format(c.totalCents / 100) }),
            el('button', { class: 'btn btn-small', type: 'button', text: 'Ver', onclick: function () { openClosing(c.id); } })));
      })));
    }).catch(function () {
      historyEl.replaceChildren(el('p', { class: 'hint', text: 'No se pudo cargar la lista de cierres.' }));
    });
  }

  function openClosing(id) {
    showError('');
    showOk('');
    api('/api/staff/closings/' + id).then(function (c) {
      render(c.report, c);
      window.scrollTo({ top: 0 });
    }).catch(function (e) { showError(e.message); });
  }

  dayInput.addEventListener('change', function () {
    showOk('');
    if (dayInput.value) loadDay(dayInput.value);
  });
  document.getElementById('refresh').addEventListener('click', function () {
    showOk('');
    loadDay(dayInput.value || null);
  });
  document.getElementById('print').addEventListener('click', function () { window.print(); });

  loadDay(null);
  loadHistory();
})();
