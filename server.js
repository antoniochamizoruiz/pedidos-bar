'use strict';
/*
 * Pedidos por QR para un bar. Servidor sin dependencias (solo Node 18+).
 *
 *  - Clientes:  /?mesa=N        carta y pedido desde el móvil
 *  - Barra:     /barra          panel de pedidos en directo (usuario y contraseña)
 *  - QR:        /qr             códigos QR de todas las mesas (usuario y contraseña)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const STAFF_USER = process.env.STAFF_USER || 'barra';
let STAFF_PASSWORD = process.env.STAFF_PASSWORD || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'menu.json'), 'utf8'));
const TIMEZONE = config.timezone || 'Europe/Madrid';

if (!STAFF_PASSWORD) {
  STAFF_PASSWORD = crypto.randomBytes(6).toString('hex');
  console.log('No hay STAFF_PASSWORD definida. Contraseña temporal de barra: ' + STAFF_PASSWORD);
}

/* ---------- Carta ---------- */

const menuIndex = new Map();
for (const cat of config.categories) {
  for (const item of cat.items) {
    menuIndex.set(String(item.id), {
      id: String(item.id),
      name: item.name,
      category: cat.name,
      cents: Math.round(Number(item.price) * 100),
    });
  }
}

function publicMenu() {
  return {
    name: config.name,
    tables: config.tables,
    currency: config.currency || 'EUR',
    paymentNote: config.paymentNote || '',
    categories: config.categories.map((c) => ({
      name: c.name,
      items: c.items.map((i) => ({
        id: String(i.id),
        name: i.name,
        desc: i.desc || '',
        cents: Math.round(Number(i.price) * 100),
      })),
    })),
  };
}

/* ---------- Pedidos ---------- */

const ACTIVE = ['nuevo', 'preparando', 'listo'];
const TRANSITIONS = {
  nuevo: ['preparando', 'cancelado'],
  preparando: ['listo', 'cancelado'],
  listo: ['entregado', 'cancelado'],
};

let orders = [];

function loadOrders() {
  try {
    orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
    if (!Array.isArray(orders)) orders = [];
  } catch {
    orders = [];
  }
  pruneOrders();
}

function saveOrders() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ORDERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(orders));
  fs.renameSync(tmp, ORDERS_FILE);
}

function pruneOrders() {
  const limit = Date.now() - 7 * 24 * 3600 * 1000;
  orders = orders.filter((o) => o.createdAt >= limit);
}

// Día de negocio: un pedido de madrugada cuenta para la jornada que empezó el día anterior.
// La jornada empieza a la hora indicada en menu.json (businessDayStartsAt, por defecto las 6).
const DAY_START = Number.isFinite(Number(config.businessDayStartsAt)) ? Number(config.businessDayStartsAt) : 6;

function dayKey(ms) {
  return new Date(ms - DAY_START * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: TIMEZONE });
}

function nextNumber() {
  const today = dayKey(Date.now());
  let max = 0;
  for (const o of orders) if (dayKey(o.createdAt) === today && o.number > max) max = o.number;
  return max + 1;
}

function activeOrders() {
  return orders.filter((o) => ACTIVE.includes(o.status)).sort((a, b) => a.createdAt - b.createdAt);
}

/* ---------- Cierre de caja ---------- */

const CLOSINGS_FILE = path.join(DATA_DIR, 'closings.json');
let closings = [];

function loadClosings() {
  try {
    closings = JSON.parse(fs.readFileSync(CLOSINGS_FILE, 'utf8'));
    if (!Array.isArray(closings)) closings = [];
  } catch {
    closings = [];
  }
}

function saveClosings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CLOSINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(closings));
  fs.renameSync(tmp, CLOSINGS_FILE);
}

// Solo cuentan como ventas los pedidos entregados. Los que siguen en curso se avisan aparte
// y los cancelados se excluyen.
function buildReport(day) {
  const list = orders.filter((o) => dayKey(o.createdAt) === day);
  const sold = list.filter((o) => o.status === 'entregado');
  const pending = list.filter((o) => ACTIVE.includes(o.status));
  const cancelled = list.filter((o) => o.status === 'cancelado');
  const sum = (arr) => arr.reduce((s, o) => s + o.totalCents, 0);

  const byCategory = new Map();
  const byProduct = new Map();
  const byTable = new Map();
  let units = 0;
  for (const o of sold) {
    const t = byTable.get(o.table) || { table: o.table, orders: 0, cents: 0 };
    t.orders += 1;
    t.cents += o.totalCents;
    byTable.set(o.table, t);
    for (const l of o.items) {
      const cents = l.cents * l.qty;
      const category = l.category || (menuIndex.get(l.id) && menuIndex.get(l.id).category) || 'Otros';
      units += l.qty;
      const c = byCategory.get(category) || { name: category, units: 0, cents: 0 };
      c.units += l.qty;
      c.cents += cents;
      byCategory.set(category, c);
      const p = byProduct.get(l.id) || { id: l.id, name: l.name, category, units: 0, cents: 0 };
      p.units += l.qty;
      p.cents += cents;
      byProduct.set(l.id, p);
    }
  }
  const byMoney = (a, b) => b.cents - a.cents;
  const totalCents = sum(sold);
  return {
    day,
    generatedAt: Date.now(),
    orders: sold.length,
    totalCents,
    avgCents: sold.length ? Math.round(totalCents / sold.length) : 0,
    units,
    byCategory: Array.from(byCategory.values()).sort(byMoney),
    byProduct: Array.from(byProduct.values()).sort(byMoney),
    byTable: Array.from(byTable.values()).sort(byMoney),
    pending: { orders: pending.length, cents: sum(pending) },
    cancelled: { orders: cancelled.length, cents: sum(cancelled) },
  };
}

/* ---------- Tiempo real (SSE) hacia el panel de barra ---------- */

const streams = new Set();

function broadcast() {
  const payload = 'event: orders\ndata: ' + JSON.stringify(activeOrders()) + '\n\n';
  for (const res of streams) res.write(payload);
}

setInterval(() => {
  for (const res of streams) res.write(': ping\n\n');
}, 25000).unref();

setInterval(() => {
  pruneOrders();
  saveOrders();
}, 3600 * 1000).unref();

/* ---------- Utilidades ---------- */

const rateBuckets = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const list = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    rateBuckets.set(key, list);
    return true;
  }
  list.push(now);
  rateBuckets.set(key, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of rateBuckets) {
    if (!list.some((t) => now - t < 600000)) rateBuckets.delete(k);
  }
}, 600000).unref();

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'desconocida';
}

function sha(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

function isStaff(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  const okUser = crypto.timingSafeEqual(sha(user), sha(STAFF_USER));
  const okPass = crypto.timingSafeEqual(sha(pass), sha(STAFF_PASSWORD));
  return okUser && okPass;
}

function askAuth(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Barra", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Acceso solo para el personal.');
}

function send(res, status, body, extra) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, extra));
  res.end(data);
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) {
      return reject(Object.assign(new Error('Tipo de contenido no válido'), { status: 415 }));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Petición demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON no válido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

function csp(file) {
  const scripts = file === 'qr.html' ? "'self' https://cdnjs.cloudflare.com" : "'self'";
  return "default-src 'self'; script-src " + scripts + "; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
}

const STAFF_PAGES = new Set(['barra.html', 'qr.html', 'cierre.html']);

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/') rel = '/index.html';
  else if (rel === '/barra') rel = '/barra.html';
  else if (rel === '/qr') rel = '/qr.html';
  else if (rel === '/cierre') rel = '/cierre.html';
  const file = path.normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'No encontrado');
  if (STAFF_PAGES.has(file) && !isStaff(req)) return askAuth(res);
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': csp(file),
    }, SECURITY_HEADERS));
    res.end(data);
  });
}

/* ---------- Rutas ---------- */

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const method = req.method;

  if (pathname === '/api/menu' && method === 'GET') {
    return send(res, 200, publicMenu());
  }

  if (pathname === '/api/orders' && method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const ip = clientIp(req);
    if (rateLimited('ip:' + ip, 30, 10 * 60 * 1000)) {
      return send(res, 429, { error: 'Demasiados pedidos seguidos. Prueba en unos minutos o pídelo en barra.' });
    }
    const body = await readJson(req, 20000);
    const table = Number(body.table);
    if (!Number.isInteger(table) || table < 1 || table > config.tables) {
      return send(res, 400, { error: 'Mesa no válida' });
    }
    if (rateLimited('mesa:' + table, 4, 60 * 1000)) {
      return send(res, 429, { error: 'Esta mesa ha enviado varios pedidos en poco tiempo. Espera un minuto.' });
    }
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 40) {
      return send(res, 400, { error: 'El pedido está vacío' });
    }
    const merged = new Map();
    for (const it of body.items) {
      const m = menuIndex.get(String(it && it.id));
      const qty = Number(it && it.qty);
      if (!m || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        return send(res, 400, { error: 'Hay un producto que ya no está en la carta' });
      }
      merged.set(m.id, (merged.get(m.id) || 0) + qty);
    }
    let units = 0;
    let total = 0;
    const lines = [];
    for (const [id, qty] of merged) {
      const m = menuIndex.get(id);
      units += qty;
      total += m.cents * qty;
      lines.push({ id, name: m.name, category: m.category, qty, cents: m.cents });
    }
    if (units > 60) return send(res, 400, { error: 'Demasiadas unidades en un solo pedido' });

    const now = Date.now();
    const order = {
      id: crypto.randomBytes(8).toString('hex'),
      number: nextNumber(),
      table,
      items: lines,
      note: String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      totalCents: total,
      status: 'nuevo',
      createdAt: now,
      updatedAt: now,
    };
    orders.push(order);
    saveOrders();
    broadcast();
    return send(res, 201, { id: order.id, number: order.number, status: order.status, totalCents: total });
  }

  const single = pathname.match(/^\/api\/orders\/([a-f0-9]{16})$/);
  if (single && method === 'GET') {
    const o = orders.find((x) => x.id === single[1]);
    if (!o) return send(res, 404, { error: 'Pedido no encontrado' });
    return send(res, 200, { number: o.number, table: o.table, status: o.status, totalCents: o.totalCents });
  }

  if (pathname.startsWith('/api/staff/')) {
    if (!isStaff(req)) return askAuth(res);

    if (pathname === '/api/staff/stream' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      res.write('event: orders\ndata: ' + JSON.stringify(activeOrders()) + '\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    const upd = pathname.match(/^\/api\/staff\/orders\/([a-f0-9]{16})$/);
    if (upd && method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
      const body = await readJson(req, 2000);
      const o = orders.find((x) => x.id === upd[1]);
      if (!o) return send(res, 404, { error: 'Pedido no encontrado' });
      const allowed = TRANSITIONS[o.status] || [];
      if (!allowed.includes(body.status)) {
        return send(res, 409, { error: 'Cambio de estado no permitido', status: o.status });
      }
      o.status = body.status;
      o.updatedAt = Date.now();
      saveOrders();
      broadcast();
      return send(res, 200, { ok: true, status: o.status });
    }

    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

    if (pathname === '/api/staff/report' && method === 'GET') {
      const day = url.searchParams.get('day') || dayKey(Date.now());
      if (!DAY_RE.test(day)) return send(res, 400, { error: 'Fecha no válida' });
      return send(res, 200, buildReport(day));
    }

    if (pathname === '/api/staff/closings' && method === 'GET') {
      return send(res, 200, closings.slice().reverse().map((c) => ({
        id: c.id,
        day: c.day,
        closedAt: c.closedAt,
        totalCents: c.report.totalCents,
        orders: c.report.orders,
      })));
    }

    if (pathname === '/api/staff/closings' && method === 'POST') {
      if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
      const body = await readJson(req, 2000);
      const day = String(body.day || '');
      if (!DAY_RE.test(day)) return send(res, 400, { error: 'Fecha no válida' });
      const report = buildReport(day);
      if (report.orders === 0) {
        return send(res, 409, { error: 'No hay ventas entregadas en esa fecha, así que no hay nada que cerrar.' });
      }
      const closing = { id: crypto.randomBytes(8).toString('hex'), day, closedAt: Date.now(), report };
      closings.push(closing);
      saveClosings();
      return send(res, 201, closing);
    }

    const oneClosing = pathname.match(/^\/api\/staff\/closings\/([a-f0-9]{16})$/);
    if (oneClosing && method === 'GET') {
      const c = closings.find((x) => x.id === oneClosing[1]);
      if (!c) return send(res, 404, { error: 'Cierre no encontrado' });
      return send(res, 200, c);
    }

    return send(res, 404, { error: 'No encontrado' });
  }

  if (pathname.startsWith('/api/')) return send(res, 404, { error: 'No encontrado' });

  if (method === 'GET' || method === 'HEAD') return serveStatic(req, res, pathname);
  return send(res, 405, 'Método no permitido');
}

loadOrders();
loadClosings();

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Error interno' : err.message });
  });
});

server.listen(PORT, () => {
  console.log('Pedidos QR en marcha en http://localhost:' + PORT);
  console.log('Panel de barra: http://localhost:' + PORT + '/barra  (usuario: ' + STAFF_USER + ')');
});
