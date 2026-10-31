/* Salem — server
 * Express + SQLite. Serves the admin area, supervisor panel and driver screen,
 * and the JSON API they use.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+ — nothing to compile

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const RETENTION_DAYS = Number(process.env.SNAPSHOT_RETENTION_DAYS || 30);
const REQUEST_EXPIRY_MS = Number(process.env.REQUEST_EXPIRY_MIN || 15) * 60 * 1000;
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true';
const HEARTBEAT_STALE_MS = 45 * 1000;

if (JWT_SECRET === 'dev-secret-change-me') {
  console.warn('[salem] WARNING: JWT_SECRET is not set. Set it in .env before going live.');
}
fs.mkdirSync(SNAP_DIR, { recursive: true });

/* ------------------------------------------------------------------ DB */
/* Small wrapper around Node's built-in SQLite so the rest of the code stays simple:
   - undefined -> null and true/false -> 1/0 for parameters
   - lastInsertRowid always a normal number */
const raw = new DatabaseSync(path.join(DATA_DIR, 'salem.db'));
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
const clean = args => args.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const db = {
  exec: sql => raw.exec(sql),
  prepare(sql) {
    const st = raw.prepare(sql);
    return {
      get: (...a) => st.get(...clean(a)),
      all: (...a) => st.all(...clean(a)),
      run: (...a) => {
        const r = st.run(...clean(a));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      }
    };
  },
  transaction(fn) {
    return (...a) => {
      raw.exec('BEGIN');
      try { const out = fn(...a); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    };
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  min_speed_kmh REAL NOT NULL DEFAULT 10,
  gaze_seconds REAL NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT DEFAULT '',
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (company_id, phone)
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  duration_min INTEGER NOT NULL,
  note TEXT DEFAULT '',
  test_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  started_at INTEGER,
  ends_at INTEGER,
  ended_at INTEGER,
  end_reason TEXT,
  last_seen_at INTEGER,
  last_lat REAL,
  last_lng REAL,
  last_speed REAL,
  last_state TEXT,
  face_visible INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  speed_kmh REAL,
  lat REAL,
  lng REAL,
  snapshot TEXT,
  details TEXT,
  review TEXT NOT NULL DEFAULT 'new',
  review_note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_company ON requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_req_driver ON requests(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_ev_company ON events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ev_request ON events(request_id);
`);

/* Migrations for databases created by earlier versions */
(function migrate() {
  const cols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  if (!cols.includes('face_lost_seconds')) db.exec('ALTER TABLE companies ADD COLUMN face_lost_seconds REAL NOT NULL DEFAULT 8');
})();

const now = () => Date.now();
const EVENT_TYPES = ['gaze', 'left_screen', 'face_lost', 'ended_early'];
const EVENT_WEIGHT = { gaze: 1, left_screen: 0.6, face_lost: 0.3, ended_early: 0.5 };

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += alphabet[crypto.randomInt(alphabet.length)];
  return c;
}
function makePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}
function normPhone(p) {
  return String(p || '').replace(/[^\d+]/g, '');
}

/* Seed platform admin */
(function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@salem.app';
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!exists) {
    const pw = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    db.prepare('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (NULL, ?, ?, ?, ?, ?)')
      .run('admin', process.env.ADMIN_NAME || 'Salem Admin', email, bcrypt.hashSync(pw, 10), now());
    console.log(`[salem] Admin account created: ${email}`);
  }
})();

/* Lazy status maintenance: expire pending requests, close finished sessions */
function maintain() {
  const t = now();
  db.prepare("UPDATE requests SET status='expired' WHERE status='pending' AND created_at < ?").run(t - REQUEST_EXPIRY_MS);
  db.prepare("UPDATE requests SET status='completed', ended_at=ends_at, end_reason='time_up' WHERE status='active' AND ends_at <= ?").run(t);
}

/* Snapshot retention */
function purgeSnapshots() {
  if (!RETENTION_DAYS) return;
  const cutoff = now() - RETENTION_DAYS * 86400000;
  const rows = db.prepare('SELECT id, snapshot FROM events WHERE snapshot IS NOT NULL AND created_at < ?').all(cutoff);
  for (const r of rows) {
    try { fs.unlinkSync(path.join(SNAP_DIR, r.snapshot)); } catch (_) {}
    db.prepare('UPDATE events SET snapshot = NULL WHERE id = ?').run(r.id);
  }
  if (rows.length) console.log(`[salem] Purged ${rows.length} old screenshots`);
}
purgeSnapshots();
setInterval(purgeSnapshots, 6 * 3600 * 1000).unref();

function saveSnapshot(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5 * 1024 * 1024) return null;
  const name = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(SNAP_DIR, name), buf);
  return name;
}

/* Driver safety score over the last 30 days. 100 = no confirmed/new events. */
function driverScore(driverId) {
  const since = now() - 30 * 86400000;
  const sessions = db.prepare(`SELECT started_at, COALESCE(ended_at, MIN(?, ends_at)) AS fin FROM requests
    WHERE driver_id = ? AND started_at IS NOT NULL AND started_at > ?`).all(now(), driverId, since);
  const hours = sessions.reduce((s, r) => s + Math.max(0, (r.fin || r.started_at) - r.started_at), 0) / 3600000;
  const evs = db.prepare(`SELECT type, COUNT(*) n FROM events WHERE driver_id = ? AND created_at > ? AND review != 'dismissed' GROUP BY type`).all(driverId, since);
  const counts = { gaze: 0, left_screen: 0, face_lost: 0, ended_early: 0 };
  let weighted = 0;
  for (const e of evs) { counts[e.type] = e.n; weighted += (EVENT_WEIGHT[e.type] || 0.5) * e.n; }
  const perHour = weighted / Math.max(hours, 1);
  const score = sessions.length ? Math.max(0, Math.round(100 - perHour * 20)) : null;
  return { score, hours: Math.round(hours * 10) / 10, sessions: sessions.length, counts };
}

/* ------------------------------------------------------------------ APP */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(express.text({ type: 'text/plain', limit: '3mb' })); // sendBeacon fallback
app.use(cookieParser());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self)');
  next();
});

function parseBody(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body || {};
}

function setAuth(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('salem', token, { httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: 30 * 86400000 });
}
function auth(...roles) {
  return (req, res, next) => {
    const token = req.cookies.salem;
    if (!token) return res.status(401).json({ error: 'not_signed_in' });
    try {
      const p = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(p.role)) return res.status(403).json({ error: 'forbidden' });
      req.auth = p;
      next();
    } catch (_) {
      return res.status(401).json({ error: 'not_signed_in' });
    }
  };
}
const wrap = fn => (req, res) => {
  try { fn(req, res); } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
};

/* ---------- Auth */
app.post('/api/auth/login', wrap((req, res) => {
  const { email, password } = parseBody(req);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'bad_credentials' });
  if (u.company_id) {
    const c = db.prepare('SELECT active FROM companies WHERE id = ?').get(u.company_id);
    if (!c || !c.active) return res.status(403).json({ error: 'company_disabled' });
  }
  setAuth(res, { id: u.id, role: u.role, company_id: u.company_id });
  res.json({ role: u.role });
}));

app.post('/api/auth/driver-login', wrap((req, res) => {
  const { company_code, phone, pin } = parseBody(req);
  const c = db.prepare('SELECT * FROM companies WHERE code = ?').get(String(company_code || '').trim().toUpperCase());
  if (!c || !c.active) return res.status(401).json({ error: 'bad_credentials' });
  const d = db.prepare('SELECT * FROM drivers WHERE company_id = ? AND phone = ?').get(c.id, normPhone(phone));
  if (!d || !d.active || !bcrypt.compareSync(String(pin || ''), d.pin_hash)) return res.status(401).json({ error: 'bad_credentials' });
  setAuth(res, { id: d.id, role: 'driver', company_id: c.id });
  res.json({ role: 'driver' });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('salem');
  res.json({ ok: true });
});

app.get('/api/me', auth(), wrap((req, res) => {
  const { id, role, company_id } = req.auth;
  const company = company_id ? db.prepare('SELECT id, name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?').get(company_id) : null;
  if (role === 'driver') {
    const d = db.prepare('SELECT id, name, phone, vehicle FROM drivers WHERE id = ?').get(id);
    if (!d) return res.status(401).json({ error: 'not_signed_in' });
    return res.json({ role, user: d, company });
  }
  const u = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id);
  if (!u) return res.status(401).json({ error: 'not_signed_in' });
  res.json({ role, user: u, company });
}));

/* ---------- Platform admin */
const admin = express.Router();
admin.use(auth('admin'));

admin.get('/companies', wrap((req, res) => {
  const rows = db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM drivers d WHERE d.company_id = c.id) AS drivers,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS supervisors,
      (SELECT COUNT(*) FROM requests r WHERE r.company_id = c.id AND r.status = 'active') AS active_sessions,
      (SELECT COUNT(*) FROM events e WHERE e.company_id = c.id AND e.created_at > ?) AS events_30d
    FROM companies c ORDER BY c.created_at DESC`).all(now() - 30 * 86400000);
  res.json(rows);
}));

admin.post('/companies', wrap((req, res) => {
  const { name, supervisor_name, supervisor_email, supervisor_password } = parseBody(req);
  if (!name || !supervisor_name || !supervisor_email || !supervisor_password) return res.status(400).json({ error: 'missing_fields' });
  if (String(supervisor_password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(supervisor_email)) return res.status(409).json({ error: 'email_taken' });
  let code;
  do { code = makeCode(); } while (db.prepare('SELECT id FROM companies WHERE code = ?').get(code));
  const tx = db.transaction(() => {
    const c = db.prepare('INSERT INTO companies (name, code, created_at) VALUES (?, ?, ?)').run(String(name).trim(), code, now());
    db.prepare('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.lastInsertRowid, 'supervisor', String(supervisor_name).trim(), String(supervisor_email).trim(), bcrypt.hashSync(String(supervisor_password), 10), now());
    return c.lastInsertRowid;
  });
  const id = tx();
  res.json({ id, code });
}));

admin.patch('/companies/:id', wrap((req, res) => {
  const { active, name } = parseBody(req);
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE companies SET active = ?, name = ? WHERE id = ?')
    .run(active === undefined ? c.active : (active ? 1 : 0), name ? String(name).trim() : c.name, c.id);
  res.json({ ok: true });
}));

admin.get('/companies/:id/supervisors', wrap((req, res) => {
  res.json(db.prepare('SELECT id, name, email, created_at FROM users WHERE company_id = ? ORDER BY created_at').all(req.params.id));
}));

admin.post('/companies/:id/supervisors', wrap((req, res) => {
  const { name, email, password } = parseBody(req);
  if (!name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (!db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'email_taken' });
  const r = db.prepare('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, 'supervisor', String(name).trim(), String(email).trim(), bcrypt.hashSync(String(password), 10), now());
  res.json({ id: r.lastInsertRowid });
}));

admin.delete('/supervisors/:id', wrap((req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'supervisor'").run(req.params.id);
  res.json({ ok: true });
}));

app.use('/api/admin', admin);

/* ---------- Supervisor */
const sup = express.Router();
sup.use(auth('supervisor'));

function liveRow(r) {
  const t = now();
  const stale = r.status === 'active' && (!r.last_seen_at || t - r.last_seen_at > HEARTBEAT_STALE_MS);
  return { ...r, connection: r.status === 'active' ? (stale ? 'lost' : 'live') : null };
}

sup.get('/overview', wrap((req, res) => {
  maintain();
  const cid = req.auth.company_id;
  const company = db.prepare('SELECT id, name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?').get(cid);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const live = db.prepare(`SELECT r.*, d.name AS driver_name, d.phone AS driver_phone, d.vehicle AS driver_vehicle,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count
    FROM requests r JOIN drivers d ON d.id = r.driver_id
    WHERE r.company_id = ? AND r.status IN ('active','pending') ORDER BY r.status = 'active' DESC, r.created_at DESC`).all(cid).map(liveRow);
  const kpi = {
    active: live.filter(r => r.status === 'active').length,
    pending: live.filter(r => r.status === 'pending').length,
    events_today: db.prepare('SELECT COUNT(*) n FROM events WHERE company_id = ? AND created_at >= ?').get(cid, startOfDay.getTime()).n,
    gaze_today: db.prepare("SELECT COUNT(*) n FROM events WHERE company_id = ? AND type = 'gaze' AND created_at >= ?").get(cid, startOfDay.getTime()).n,
    to_review: db.prepare("SELECT COUNT(*) n FROM events WHERE company_id = ? AND review = 'new'").get(cid).n,
    drivers: db.prepare('SELECT COUNT(*) n FROM drivers WHERE company_id = ? AND active = 1').get(cid).n
  };
  const recent = db.prepare(`SELECT e.*, d.name AS driver_name FROM events e JOIN drivers d ON d.id = e.driver_id
    WHERE e.company_id = ? ORDER BY e.created_at DESC LIMIT 8`).all(cid);
  res.json({ company, kpi, live, recent, server_time: now() });
}));

sup.get('/drivers', wrap((req, res) => {
  maintain();
  const rows = db.prepare(`SELECT d.id, d.name, d.phone, d.vehicle, d.active, d.created_at,
      (SELECT MAX(started_at) FROM requests r WHERE r.driver_id = d.id) AS last_session,
      (SELECT status FROM requests r WHERE r.driver_id = d.id ORDER BY created_at DESC LIMIT 1) AS last_status
    FROM drivers d WHERE d.company_id = ? ORDER BY d.name`).all(req.auth.company_id);
  res.json(rows.map(d => ({ ...d, stats: driverScore(d.id) })));
}));

sup.post('/drivers', wrap((req, res) => {
  const { name, phone, vehicle } = parseBody(req);
  const p = normPhone(phone);
  if (!name || p.length < 7) return res.status(400).json({ error: 'missing_fields' });
  if (db.prepare('SELECT id FROM drivers WHERE company_id = ? AND phone = ?').get(req.auth.company_id, p)) return res.status(409).json({ error: 'phone_taken' });
  const pin = makePin();
  const r = db.prepare('INSERT INTO drivers (company_id, name, phone, vehicle, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.auth.company_id, String(name).trim(), p, String(vehicle || '').trim(), bcrypt.hashSync(pin, 10), now());
  res.json({ id: r.lastInsertRowid, pin, phone: p });
}));

sup.post('/drivers/:id/reset-pin', wrap((req, res) => {
  const d = db.prepare('SELECT id, phone FROM drivers WHERE id = ? AND company_id = ?').get(req.params.id, req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const pin = makePin();
  db.prepare('UPDATE drivers SET pin_hash = ? WHERE id = ?').run(bcrypt.hashSync(pin, 10), d.id);
  res.json({ pin, phone: d.phone });
}));

sup.patch('/drivers/:id', wrap((req, res) => {
  const d = db.prepare('SELECT * FROM drivers WHERE id = ? AND company_id = ?').get(req.params.id, req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const { active, name, vehicle } = parseBody(req);
  db.prepare('UPDATE drivers SET active = ?, name = ?, vehicle = ? WHERE id = ?').run(
    active === undefined ? d.active : (active ? 1 : 0), name ? String(name).trim() : d.name,
    vehicle === undefined ? d.vehicle : String(vehicle).trim(), d.id);
  res.json({ ok: true });
}));

sup.post('/requests', wrap((req, res) => {
  maintain();
  const { driver_id, duration_min, note, test_mode } = parseBody(req);
  const dur = Math.round(Number(duration_min));
  if (!dur || dur < 5 || dur > 720) return res.status(400).json({ error: 'bad_duration' });
  const d = db.prepare('SELECT * FROM drivers WHERE id = ? AND company_id = ? AND active = 1').get(driver_id, req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const open = db.prepare("SELECT id FROM requests WHERE driver_id = ? AND status IN ('pending','active')").get(d.id);
  if (open) return res.status(409).json({ error: 'driver_busy' });
  const r = db.prepare('INSERT INTO requests (company_id, driver_id, supervisor_id, duration_min, note, test_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.auth.company_id, d.id, req.auth.id, dur, String(note || '').slice(0, 300), test_mode ? 1 : 0, now());
  res.json({ id: r.lastInsertRowid });
}));

sup.post('/requests/:id/cancel', wrap((req, res) => {
  const r = db.prepare("SELECT * FROM requests WHERE id = ? AND company_id = ? AND status IN ('pending','active')").get(req.params.id, req.auth.company_id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE requests SET status = 'cancelled', ended_at = ?, end_reason = 'supervisor' WHERE id = ?").run(now(), r.id);
  res.json({ ok: true });
}));

sup.get('/requests', wrap((req, res) => {
  maintain();
  const { driver_id } = req.query;
  const params = [req.auth.company_id];
  let where = 'r.company_id = ?';
  if (driver_id) { where += ' AND r.driver_id = ?'; params.push(driver_id); }
  const rows = db.prepare(`SELECT r.*, d.name AS driver_name, u.name AS supervisor_name,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id AND e.type = 'gaze') AS gaze_count
    FROM requests r JOIN drivers d ON d.id = r.driver_id LEFT JOIN users u ON u.id = r.supervisor_id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`).all(...params);
  res.json(rows.map(liveRow));
}));

sup.get('/events', wrap((req, res) => {
  const { type, review, driver_id, request_id } = req.query;
  const params = [req.auth.company_id];
  let where = 'e.company_id = ?';
  if (type && EVENT_TYPES.includes(type)) { where += ' AND e.type = ?'; params.push(type); }
  if (review && ['new', 'confirmed', 'dismissed'].includes(review)) { where += ' AND e.review = ?'; params.push(review); }
  if (driver_id) { where += ' AND e.driver_id = ?'; params.push(driver_id); }
  if (request_id) { where += ' AND e.request_id = ?'; params.push(request_id); }
  const rows = db.prepare(`SELECT e.*, d.name AS driver_name, d.vehicle AS driver_vehicle FROM events e JOIN drivers d ON d.id = e.driver_id
    WHERE ${where} ORDER BY e.created_at DESC LIMIT 300`).all(...params);
  res.json(rows);
}));

sup.patch('/events/:id', wrap((req, res) => {
  const { review, review_note } = parseBody(req);
  if (!['new', 'confirmed', 'dismissed'].includes(review)) return res.status(400).json({ error: 'bad_review' });
  const r = db.prepare('UPDATE events SET review = ?, review_note = ? WHERE id = ? AND company_id = ?')
    .run(review, String(review_note || '').slice(0, 500), req.params.id, req.auth.company_id);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

sup.get('/settings', wrap((req, res) => {
  res.json(db.prepare('SELECT name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?').get(req.auth.company_id));
}));

sup.put('/settings', wrap((req, res) => {
  const { min_speed_kmh, gaze_seconds, face_lost_seconds } = parseBody(req);
  const s = Math.min(60, Math.max(0, Number(min_speed_kmh)));
  const g = Math.min(10, Math.max(1, Number(gaze_seconds)));
  const f = Math.min(120, Math.max(3, Number(face_lost_seconds)));
  if (Number.isNaN(s) || Number.isNaN(g) || Number.isNaN(f)) return res.status(400).json({ error: 'bad_values' });
  db.prepare('UPDATE companies SET min_speed_kmh = ?, gaze_seconds = ?, face_lost_seconds = ? WHERE id = ?').run(s, g, f, req.auth.company_id);
  res.json({ ok: true });
}));

sup.get('/team', wrap((req, res) => {
  res.json(db.prepare('SELECT id, name, email, created_at FROM users WHERE company_id = ? ORDER BY created_at').all(req.auth.company_id));
}));

sup.post('/team', wrap((req, res) => {
  const { name, email, password } = parseBody(req);
  if (!name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'email_taken' });
  const r = db.prepare('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.auth.company_id, 'supervisor', String(name).trim(), String(email).trim(), bcrypt.hashSync(String(password), 10), now());
  res.json({ id: r.lastInsertRowid });
}));

app.use('/api/sup', sup);

/* Screenshots: only the owning company (or platform admin) may view */
app.get('/snapshots/:file', auth('supervisor', 'admin'), wrap((req, res) => {
  const file = path.basename(req.params.file);
  const ev = db.prepare('SELECT company_id FROM events WHERE snapshot = ?').get(file);
  if (!ev) return res.status(404).end();
  if (req.auth.role !== 'admin' && ev.company_id !== req.auth.company_id) return res.status(403).end();
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(SNAP_DIR, file));
}));

/* ---------- Driver */
const drv = express.Router();
drv.use(auth('driver'));

function driverRequest(req, id, statuses) {
  return db.prepare(`SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status IN (${statuses.map(() => '?').join(',')})`)
    .get(id, req.auth.id, ...statuses);
}

drv.get('/state', wrap((req, res) => {
  maintain();
  const d = db.prepare('SELECT id, name, phone, vehicle, active FROM drivers WHERE id = ?').get(req.auth.id);
  if (!d || !d.active) return res.status(401).json({ error: 'not_signed_in' });
  const company = db.prepare('SELECT name, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?').get(req.auth.company_id);
  const pending = db.prepare(`SELECT r.id, r.duration_min, r.note, r.test_mode, r.created_at, u.name AS supervisor_name
    FROM requests r LEFT JOIN users u ON u.id = r.supervisor_id WHERE r.driver_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`).all(d.id);
  const active = db.prepare("SELECT id, duration_min, note, test_mode, started_at, ends_at FROM requests WHERE driver_id = ? AND status = 'active'").get(d.id) || null;
  const history = db.prepare(`SELECT r.id, r.status, r.duration_min, r.started_at, r.ended_at,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count
    FROM requests r WHERE r.driver_id = ? AND r.status NOT IN ('pending','active') ORDER BY r.created_at DESC LIMIT 5`).all(d.id);
  res.json({ driver: d, company, pending, active, history, server_time: now(), expiry_ms: REQUEST_EXPIRY_MS });
}));

drv.post('/requests/:id/accept', wrap((req, res) => {
  maintain();
  const r = driverRequest(req, req.params.id, ['pending']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const t = now();
  db.prepare("UPDATE requests SET status = 'active', responded_at = ?, started_at = ?, ends_at = ?, last_seen_at = ? WHERE id = ?")
    .run(t, t, t + r.duration_min * 60000, t, r.id);
  res.json({ ok: true, started_at: t, ends_at: t + r.duration_min * 60000 });
}));

drv.post('/requests/:id/decline', wrap((req, res) => {
  const r = driverRequest(req, req.params.id, ['pending']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE requests SET status = 'declined', responded_at = ? WHERE id = ?").run(now(), r.id);
  res.json({ ok: true });
}));

drv.post('/requests/:id/end', wrap((req, res) => {
  const r = driverRequest(req, req.params.id, ['active']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const t = now();
  db.prepare("UPDATE requests SET status = 'ended_early', ended_at = ?, end_reason = 'driver' WHERE id = ?").run(t, r.id);
  db.prepare(`INSERT INTO events (request_id, company_id, driver_id, type, started_at, duration_ms, speed_kmh, lat, lng, details, created_at)
    VALUES (?, ?, ?, 'ended_early', ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.company_id, r.driver_id, t, Math.max(0, r.ends_at - t), r.last_speed, r.last_lat, r.last_lng,
      JSON.stringify({ minutes_left: Math.round((r.ends_at - t) / 60000) }), t);
  res.json({ ok: true });
}));

drv.post('/heartbeat', wrap((req, res) => {
  maintain();
  const b = parseBody(req);
  const r = db.prepare('SELECT * FROM requests WHERE id = ? AND driver_id = ?').get(b.request_id, req.auth.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status === 'active') {
    db.prepare('UPDATE requests SET last_seen_at = ?, last_lat = ?, last_lng = ?, last_speed = ?, last_state = ?, face_visible = ? WHERE id = ?')
      .run(now(), num(b.lat), num(b.lng), num(b.speed), String(b.state || '').slice(0, 20), b.face_visible ? 1 : 0, r.id);
  }
  res.json({ status: r.status, ends_at: r.ends_at, server_time: now() });
}));

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

drv.post('/events', wrap((req, res) => {
  const b = parseBody(req);
  if (!EVENT_TYPES.includes(b.type) || b.type === 'ended_early') return res.status(400).json({ error: 'bad_type' });
  const r = db.prepare("SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status IN ('active','completed','cancelled','ended_early')").get(b.request_id, req.auth.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const snap = saveSnapshot(b.snapshot);
  const startedAt = num(b.started_at) || now();
  const ins = db.prepare(`INSERT INTO events (request_id, company_id, driver_id, type, started_at, duration_ms, speed_kmh, lat, lng, snapshot, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.id, r.company_id, r.driver_id, b.type, startedAt, Math.max(0, Math.round(num(b.duration_ms) || 0)),
      num(b.speed), num(b.lat), num(b.lng), snap, JSON.stringify(b.details || {}).slice(0, 2000), now());
  res.json({ id: ins.lastInsertRowid });
}));

drv.patch('/events/:id', wrap((req, res) => {
  const b = parseBody(req);
  const ev = db.prepare('SELECT * FROM events WHERE id = ? AND driver_id = ?').get(req.params.id, req.auth.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  let details = {};
  try { details = JSON.parse(ev.details || '{}'); } catch (_) {}
  Object.assign(details, b.details || {});
  const snap = ev.snapshot || saveSnapshot(b.snapshot);
  db.prepare('UPDATE events SET duration_ms = ?, details = ?, snapshot = ? WHERE id = ?')
    .run(Math.max(ev.duration_ms, Math.round(num(b.duration_ms) || 0)), JSON.stringify(details).slice(0, 2000), snap, ev.id);
  res.json({ ok: true });
}));

app.use('/api/driver', drv);

/* ---------- Pages */
const pub = path.join(__dirname, 'public');
app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
app.get('/panel', (req, res) => res.sendFile(path.join(pub, 'panel.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(pub, 'admin.html')));
app.get('/driver', (req, res) => res.sendFile(path.join(pub, 'driver.html')));
// MediaPipe runtime served from our own domain (no third-party CDN needed on drivers' phones)
app.use('/vendor/mediapipe', express.static(path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision'), { maxAge: '7d' }));
app.get('/api/model-source', (req, res) => {
  res.json({ local: fs.existsSync(path.join(pub, 'models', 'face_landmarker.task')) });
});
app.use(express.static(pub, { index: false, maxAge: '1h' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(PORT, () => console.log(`[salem] Running on http://localhost:${PORT}`));
