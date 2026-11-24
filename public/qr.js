(function () {
  'use strict';

  var grid = document.getElementById('grid');
  var baseInput = document.getElementById('base');
  var errEl = document.getElementById('err');
  var menu = null;
  var timer = null;

  function showError(text) {
    errEl.textContent = text;
    errEl.hidden = !text;
  }

  function draw() {
    showError('');
    grid.replaceChildren();
    if (!menu) return;
    if (typeof window.QRCode !== 'function') {
      showError('No se pudo cargar el generador de códigos QR. Comprueba la conexión a internet y recarga la página.');
      return;
    }
    var base = baseInput.value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(base)) {
      showError('Escribe una dirección que empiece por http:// o https://');
      return;
    }
    for (var n = 1; n <= menu.tables; n++) {
      var url = base + '/?mesa=' + n;
      var img = document.createElement('div');
      img.className = 'qr-img';
      var card = document.createElement('section');
      card.className = 'qr-card';
      var title = document.createElement('h2');
      title.textContent = 'Mesa ' + n;
      var name = document.createElement('div');
      name.className = 'bar-name';
      name.textContent = menu.name + ' · Escanea y pide';
      var link = document.createElement('div');
      link.className = 'qr-url';
      link.textContent = url;
      card.append(title, name, img, link);
      grid.append(card);
      new window.QRCode(img, {
        text: url,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  }

  baseInput.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(draw, 300);
  });
  document.getElementById('print').addEventListener('click', function () { window.print(); });

  baseInput.value = location.origin;

  fetch('/api/menu').then(function (res) { return res.json(); }).then(function (data) {
    menu = data;
    draw();
  }).catch(function () {
    showError('No se pudo leer el número de mesas. Recarga la página.');
  });
})();
