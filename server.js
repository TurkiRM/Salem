/* Salem — server
 * Express + PostgreSQL. Serves the admin area, supervisor panel and driver screen,
 * and the JSON API they use. Violation photos are stored in the database too, so
 * nothing is lost when the host redeploys or restarts.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool, types } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL;
const RETENTION_DAYS = Number(process.env.SNAPSHOT_RETENTION_DAYS || 30);
const REQUEST_EXPIRY_MS = Number(process.env.REQUEST_EXPIRY_MIN || 15) * 60 * 1000;
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true';
const HEARTBEAT_STALE_MS = 45 * 1000;

if (!DATABASE_URL) {
  console.error('[salem] DATABASE_URL is not set. Add your Postgres connection string to .env (see README).');
  process.exit(1);
}
if (JWT_SECRET === 'dev-secret-change-me') {
  console.warn('[salem] WARNING: JWT_SECRET is not set. Set it in .env before going live.');
}

/* ------------------------------------------------------------------ DB */
// Postgres returns BIGINT / COUNT(*) / NUMERIC as strings by default; we want numbers.
types.setTypeParser(20, v => Number(v));
types.setTypeParser(1700, v => Number(v));

/* SSL: hosted databases (Neon, Supabase, Render external URL) need it; localhost and
   Render's internal hostnames (no dots, e.g. dpg-xxxx-a) don't. Override with DATABASE_SSL=true/false. */
function sslOption() {
  const forced = process.env.DATABASE_SSL;
  if (forced === 'false') return false;
  if (forced === 'true') return { rejectUnauthorized: false };
  let host = '';
  try { host = new URL(DATABASE_URL).hostname; } catch (_) {}
  const local = !host || host === 'localhost' || host === '127.0.0.1' || !host.includes('.');
  return local ? false : { rejectUnauthorized: false };
}
const pool = new Pool({ connectionString: DATABASE_URL, ssl: sslOption(), max: Number(process.env.DATABASE_POOL || 10) });
pool.on('error', e => console.error('[salem] database pool error:', e.message));

/* Tiny query helper: write SQL with ? placeholders, get rows back.
   undefined -> null, true/false -> 1/0 */
const toPg = sql => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
const clean = a => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
function makeDb(client) {
  const q = (sql, p) => client.query(toPg(sql), clean(p));
  return {
    all: async (sql, ...p) => (await q(sql, p)).rows,
    get: async (sql, ...p) => (await q(sql, p)).rows[0],
    run: async (sql, ...p) => { const r = await q(sql, p); return { changes: r.rowCount, rows: r.rows }; }
  };
}
const db = makeDb(pool);
db.tx = async fn => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(makeDb(client));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  min_speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 10,
  gaze_seconds DOUBLE PRECISION NOT NULL DEFAULT 3,
  face_lost_seconds DOUBLE PRECISION NOT NULL DEFAULT 8,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT DEFAULT '',
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  UNIQUE (company_id, phone)
);
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  duration_min INTEGER NOT NULL,
  note TEXT DEFAULT '',
  test_mode INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  responded_at BIGINT,
  started_at BIGINT,
  ends_at BIGINT,
  ended_at BIGINT,
  end_reason TEXT,
  last_seen_at BIGINT,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_speed DOUBLE PRECISION,
  last_state TEXT,
  face_visible INTEGER,
  sunglasses INTEGER NOT NULL DEFAULT 0,
  sunglasses_ms BIGINT NOT NULL DEFAULT 0,
  detect_mode TEXT DEFAULT 'eyes'
);
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  duration_ms BIGINT NOT NULL DEFAULT 0,
  speed_kmh DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  snapshot TEXT,
  details TEXT,
  review TEXT NOT NULL DEFAULT 'new',
  review_note TEXT DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  name TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_company ON requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_req_driver ON requests(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_ev_company ON events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ev_request ON events(request_id);
CREATE INDEX IF NOT EXISTS idx_ev_driver ON events(driver_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snap_created ON snapshots(created_at);
`;

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
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

async function init() {
  await pool.query(SCHEMA); // plain query: several statements at once
  // Platform admin
  const email = process.env.ADMIN_EMAIL || 'admin@salem.app';
  const exists = await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', email);
  if (!exists) {
    const pw = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    await db.run('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (NULL, ?, ?, ?, ?, ?)',
      'admin', process.env.ADMIN_NAME || 'Salem Admin', email, bcrypt.hashSync(pw, 10), now());
    console.log(`[salem] Admin account created: ${email}`);
  }
}

/* Lazy status maintenance: expire pending requests, close finished sessions */
async function maintain() {
  const t = now();
  await db.run("UPDATE requests SET status='expired' WHERE status='pending' AND created_at < ?", t - REQUEST_EXPIRY_MS);
  await db.run("UPDATE requests SET status='completed', ended_at=ends_at, end_reason='time_up' WHERE status='active' AND ends_at <= ?", t);
}

/* Photo retention */
async function purgeSnapshots() {
  if (!RETENTION_DAYS) return;
  const cutoff = now() - RETENTION_DAYS * 86400000;
  try {
    const r = await db.run('DELETE FROM snapshots WHERE created_at < ?', cutoff);
    await db.run('UPDATE events SET snapshot = NULL WHERE snapshot IS NOT NULL AND created_at < ?', cutoff);
    if (r.changes) console.log(`[salem] Deleted ${r.changes} photos older than ${RETENTION_DAYS} days`);
  } catch (e) { console.error('[salem] photo cleanup failed:', e.message); }
}

async function saveSnapshot(dataUrl, companyId) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5 * 1024 * 1024) return null;
  const name = `${crypto.randomUUID()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  await db.run('INSERT INTO snapshots (name, company_id, content_type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    name, companyId, 'image/' + m[1], buf, now());
  return name;
}

/* Driver safety score over the last 30 days. 100 = no confirmed/new events. */
async function driverScore(driverId) {
  const since = now() - 30 * 86400000;
  const sessions = await db.all(`SELECT started_at, COALESCE(ended_at, LEAST(?::bigint, ends_at)) AS fin FROM requests
    WHERE driver_id = ? AND started_at IS NOT NULL AND started_at > ?`, now(), driverId, since);
  const hours = sessions.reduce((s, r) => s + Math.max(0, (r.fin || r.started_at) - r.started_at), 0) / 3600000;
  const evs = await db.all(`SELECT type, COUNT(*) AS n FROM events WHERE driver_id = ? AND created_at > ? AND review != 'dismissed' GROUP BY type`, driverId, since);
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
app.set('trust proxy', 1);
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
const wrap = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (e && e.code === '22P02') return res.status(404).json({ error: 'not_found' }); // e.g. /drivers/abc
    if (e && e.code === '23505') return res.status(409).json({ error: 'already_exists' });
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  }
};

/* Health check for the host (Render pings this) */
app.get('/healthz', wrap(async (req, res) => {
  await db.get('SELECT 1 AS ok');
  res.json({ ok: true });
}));

/* ---------- Auth */
app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = parseBody(req);
  const u = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', String(email || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'bad_credentials' });
  if (u.company_id) {
    const c = await db.get('SELECT active FROM companies WHERE id = ?', u.company_id);
    if (!c || !c.active) return res.status(403).json({ error: 'company_disabled' });
  }
  setAuth(res, { id: u.id, role: u.role, company_id: u.company_id });
  res.json({ role: u.role });
}));

app.post('/api/auth/driver-login', wrap(async (req, res) => {
  const { company_code, phone, pin } = parseBody(req);
  const c = await db.get('SELECT * FROM companies WHERE code = ?', String(company_code || '').trim().toUpperCase());
  if (!c || !c.active) return res.status(401).json({ error: 'bad_credentials' });
  const d = await db.get('SELECT * FROM drivers WHERE company_id = ? AND phone = ?', c.id, normPhone(phone));
  if (!d || !d.active || !bcrypt.compareSync(String(pin || ''), d.pin_hash)) return res.status(401).json({ error: 'bad_credentials' });
  setAuth(res, { id: d.id, role: 'driver', company_id: c.id });
  res.json({ role: 'driver' });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('salem');
  res.json({ ok: true });
});

app.get('/api/me', auth(), wrap(async (req, res) => {
  const { id, role, company_id } = req.auth;
  const company = company_id ? await db.get('SELECT id, name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?', company_id) : null;
  if (role === 'driver') {
    const d = await db.get('SELECT id, name, phone, vehicle FROM drivers WHERE id = ?', id);
    if (!d) return res.status(401).json({ error: 'not_signed_in' });
    return res.json({ role, user: d, company });
  }
  const u = await db.get('SELECT id, name, email FROM users WHERE id = ?', id);
  if (!u) return res.status(401).json({ error: 'not_signed_in' });
  res.json({ role, user: u, company });
}));

/* ---------- Platform admin */
const admin = express.Router();
admin.use(auth('admin'));

admin.get('/companies', wrap(async (req, res) => {
  const rows = await db.all(`SELECT c.*,
      (SELECT COUNT(*) FROM drivers d WHERE d.company_id = c.id) AS drivers,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS supervisors,
      (SELECT COUNT(*) FROM requests r WHERE r.company_id = c.id AND r.status = 'active') AS active_sessions,
      (SELECT COUNT(*) FROM events e WHERE e.company_id = c.id AND e.created_at > ?) AS events_30d
    FROM companies c ORDER BY c.created_at DESC`, now() - 30 * 86400000);
  res.json(rows);
}));

admin.post('/companies', wrap(async (req, res) => {
  const { name, supervisor_name, supervisor_email, supervisor_password } = parseBody(req);
  if (!name || !supervisor_name || !supervisor_email || !supervisor_password) return res.status(400).json({ error: 'missing_fields' });
  if (String(supervisor_password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', String(supervisor_email).trim())) return res.status(409).json({ error: 'email_taken' });
  let code;
  do { code = makeCode(); } while (await db.get('SELECT id FROM companies WHERE code = ?', code));
  const id = await db.tx(async t => {
    const c = await t.get('INSERT INTO companies (name, code, created_at) VALUES (?, ?, ?) RETURNING id', String(name).trim(), code, now());
    await t.run('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      c.id, 'supervisor', String(supervisor_name).trim(), String(supervisor_email).trim(), bcrypt.hashSync(String(supervisor_password), 10), now());
    return c.id;
  });
  res.json({ id, code });
}));

admin.patch('/companies/:id', wrap(async (req, res) => {
  const { active, name } = parseBody(req);
  const c = await db.get('SELECT * FROM companies WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  await db.run('UPDATE companies SET active = ?, name = ? WHERE id = ?',
    active === undefined ? c.active : (active ? 1 : 0), name ? String(name).trim() : c.name, c.id);
  res.json({ ok: true });
}));

admin.get('/companies/:id/supervisors', wrap(async (req, res) => {
  res.json(await db.all('SELECT id, name, email, created_at FROM users WHERE company_id = ? ORDER BY created_at', req.params.id));
}));

admin.post('/companies/:id/supervisors', wrap(async (req, res) => {
  const { name, email, password } = parseBody(req);
  if (!name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (!await db.get('SELECT id FROM companies WHERE id = ?', req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', String(email).trim())) return res.status(409).json({ error: 'email_taken' });
  const r = await db.get('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    req.params.id, 'supervisor', String(name).trim(), String(email).trim(), bcrypt.hashSync(String(password), 10), now());
  res.json({ id: r.id });
}));

admin.delete('/supervisors/:id', wrap(async (req, res) => {
  await db.run("DELETE FROM users WHERE id = ? AND role = 'supervisor'", req.params.id);
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

sup.get('/overview', wrap(async (req, res) => {
  await maintain();
  const cid = req.auth.company_id;
  const company = await db.get('SELECT id, name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?', cid);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const sod = startOfDay.getTime();
  const live = (await db.all(`SELECT r.*, d.name AS driver_name, d.phone AS driver_phone, d.vehicle AS driver_vehicle,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count
    FROM requests r JOIN drivers d ON d.id = r.driver_id
    WHERE r.company_id = ? AND r.status IN ('active','pending') ORDER BY r.status = 'active' DESC, r.created_at DESC`, cid)).map(liveRow);
  const counts = await db.get(`SELECT
      (SELECT COUNT(*) FROM events WHERE company_id = ? AND created_at >= ?) AS events_today,
      (SELECT COUNT(*) FROM events WHERE company_id = ? AND type = 'gaze' AND created_at >= ?) AS gaze_today,
      (SELECT COUNT(*) FROM events WHERE company_id = ? AND review = 'new') AS to_review,
      (SELECT COUNT(*) FROM drivers WHERE company_id = ? AND active = 1) AS drivers`, cid, sod, cid, sod, cid, cid);
  const kpi = {
    active: live.filter(r => r.status === 'active').length,
    pending: live.filter(r => r.status === 'pending').length,
    ...counts
  };
  const recent = await db.all(`SELECT e.*, d.name AS driver_name FROM events e JOIN drivers d ON d.id = e.driver_id
    WHERE e.company_id = ? ORDER BY e.created_at DESC LIMIT 8`, cid);
  res.json({ company, kpi, live, recent, server_time: now() });
}));

sup.get('/drivers', wrap(async (req, res) => {
  await maintain();
  const rows = await db.all(`SELECT d.id, d.name, d.phone, d.vehicle, d.active, d.created_at,
      (SELECT MAX(started_at) FROM requests r WHERE r.driver_id = d.id) AS last_session,
      (SELECT status FROM requests r WHERE r.driver_id = d.id ORDER BY created_at DESC LIMIT 1) AS last_status
    FROM drivers d WHERE d.company_id = ? ORDER BY d.name`, req.auth.company_id);
  const out = [];
  for (const d of rows) out.push({ ...d, stats: await driverScore(d.id) });
  res.json(out);
}));

sup.post('/drivers', wrap(async (req, res) => {
  const { name, phone, vehicle } = parseBody(req);
  const p = normPhone(phone);
  if (!name || p.length < 7) return res.status(400).json({ error: 'missing_fields' });
  if (await db.get('SELECT id FROM drivers WHERE company_id = ? AND phone = ?', req.auth.company_id, p)) return res.status(409).json({ error: 'phone_taken' });
  const pin = makePin();
  const r = await db.get('INSERT INTO drivers (company_id, name, phone, vehicle, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    req.auth.company_id, String(name).trim(), p, String(vehicle || '').trim(), bcrypt.hashSync(pin, 10), now());
  res.json({ id: r.id, pin, phone: p });
}));

sup.post('/drivers/:id/reset-pin', wrap(async (req, res) => {
  const d = await db.get('SELECT id, phone FROM drivers WHERE id = ? AND company_id = ?', req.params.id, req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const pin = makePin();
  await db.run('UPDATE drivers SET pin_hash = ? WHERE id = ?', bcrypt.hashSync(pin, 10), d.id);
  res.json({ pin, phone: d.phone });
}));

sup.patch('/drivers/:id', wrap(async (req, res) => {
  const d = await db.get('SELECT * FROM drivers WHERE id = ? AND company_id = ?', req.params.id, req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const { active, name, vehicle } = parseBody(req);
  await db.run('UPDATE drivers SET active = ?, name = ?, vehicle = ? WHERE id = ?',
    active === undefined ? d.active : (active ? 1 : 0), name ? String(name).trim() : d.name,
    vehicle === undefined ? d.vehicle : String(vehicle).trim(), d.id);
  res.json({ ok: true });
}));

sup.post('/requests', wrap(async (req, res) => {
  await maintain();
  const { driver_id, duration_min, note, test_mode } = parseBody(req);
  const dur = Math.round(Number(duration_min));
  if (!dur || dur < 5 || dur > 720) return res.status(400).json({ error: 'bad_duration' });
  const d = await db.get('SELECT * FROM drivers WHERE id = ? AND company_id = ? AND active = 1', num(driver_id), req.auth.company_id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  const open = await db.get("SELECT id FROM requests WHERE driver_id = ? AND status IN ('pending','active')", d.id);
  if (open) return res.status(409).json({ error: 'driver_busy' });
  const r = await db.get('INSERT INTO requests (company_id, driver_id, supervisor_id, duration_min, note, test_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    req.auth.company_id, d.id, req.auth.id, dur, String(note || '').slice(0, 300), test_mode ? 1 : 0, now());
  res.json({ id: r.id });
}));

sup.post('/requests/:id/cancel', wrap(async (req, res) => {
  const r = await db.get("SELECT * FROM requests WHERE id = ? AND company_id = ? AND status IN ('pending','active')", req.params.id, req.auth.company_id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  await db.run("UPDATE requests SET status = 'cancelled', ended_at = ?, end_reason = 'supervisor' WHERE id = ?", now(), r.id);
  res.json({ ok: true });
}));

sup.get('/requests', wrap(async (req, res) => {
  await maintain();
  const { driver_id } = req.query;
  const params = [req.auth.company_id];
  let where = 'r.company_id = ?';
  if (driver_id) { where += ' AND r.driver_id = ?'; params.push(num(driver_id)); }
  const rows = await db.all(`SELECT r.*, d.name AS driver_name, u.name AS supervisor_name,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id AND e.type = 'gaze') AS gaze_count
    FROM requests r JOIN drivers d ON d.id = r.driver_id LEFT JOIN users u ON u.id = r.supervisor_id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT 200`, ...params);
  res.json(rows.map(liveRow));
}));

sup.get('/events', wrap(async (req, res) => {
  const { type, review, driver_id, request_id } = req.query;
  const params = [req.auth.company_id];
  let where = 'e.company_id = ?';
  if (type && EVENT_TYPES.includes(type)) { where += ' AND e.type = ?'; params.push(type); }
  if (review && ['new', 'confirmed', 'dismissed'].includes(review)) { where += ' AND e.review = ?'; params.push(review); }
  if (driver_id) { where += ' AND e.driver_id = ?'; params.push(num(driver_id)); }
  if (request_id) { where += ' AND e.request_id = ?'; params.push(num(request_id)); }
  const rows = await db.all(`SELECT e.*, d.name AS driver_name, d.vehicle AS driver_vehicle FROM events e JOIN drivers d ON d.id = e.driver_id
    WHERE ${where} ORDER BY e.created_at DESC LIMIT 300`, ...params);
  res.json(rows);
}));

sup.patch('/events/:id', wrap(async (req, res) => {
  const { review, review_note } = parseBody(req);
  if (!['new', 'confirmed', 'dismissed'].includes(review)) return res.status(400).json({ error: 'bad_review' });
  const r = await db.run('UPDATE events SET review = ?, review_note = ? WHERE id = ? AND company_id = ?',
    review, String(review_note || '').slice(0, 500), req.params.id, req.auth.company_id);
  if (!r.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

sup.get('/settings', wrap(async (req, res) => {
  res.json(await db.get('SELECT name, code, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?', req.auth.company_id));
}));

sup.put('/settings', wrap(async (req, res) => {
  const { min_speed_kmh, gaze_seconds, face_lost_seconds } = parseBody(req);
  const s = Math.min(60, Math.max(0, Number(min_speed_kmh)));
  const g = Math.min(10, Math.max(1, Number(gaze_seconds)));
  const f = Math.min(120, Math.max(3, Number(face_lost_seconds)));
  if (Number.isNaN(s) || Number.isNaN(g) || Number.isNaN(f)) return res.status(400).json({ error: 'bad_values' });
  await db.run('UPDATE companies SET min_speed_kmh = ?, gaze_seconds = ?, face_lost_seconds = ? WHERE id = ?', s, g, f, req.auth.company_id);
  res.json({ ok: true });
}));

sup.get('/team', wrap(async (req, res) => {
  res.json(await db.all('SELECT id, name, email, created_at FROM users WHERE company_id = ? ORDER BY created_at', req.auth.company_id));
}));

sup.post('/team', wrap(async (req, res) => {
  const { name, email, password } = parseBody(req);
  if (!name || !email || !password) return res.status(400).json({ error: 'missing_fields' });
  if (String(password).length < 8) return res.status(400).json({ error: 'weak_password' });
  if (await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', String(email).trim())) return res.status(409).json({ error: 'email_taken' });
  const r = await db.get('INSERT INTO users (company_id, role, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    req.auth.company_id, 'supervisor', String(name).trim(), String(email).trim(), bcrypt.hashSync(String(password), 10), now());
  res.json({ id: r.id });
}));

app.use('/api/sup', sup);

/* Photos: only the owning company (or platform admin) may view */
app.get('/snapshots/:file', auth('supervisor', 'admin'), wrap(async (req, res) => {
  const s = await db.get('SELECT company_id, content_type, data FROM snapshots WHERE name = ?', path.basename(req.params.file));
  if (!s) return res.status(404).end();
  if (req.auth.role !== 'admin' && s.company_id !== req.auth.company_id) return res.status(403).end();
  res.setHeader('Content-Type', s.content_type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(s.data);
}));

/* ---------- Driver */
const drv = express.Router();
drv.use(auth('driver'));

function driverRequest(req, id, statuses) {
  return db.get(`SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status IN (${statuses.map(() => '?').join(',')})`,
    num(id), req.auth.id, ...statuses);
}

drv.get('/state', wrap(async (req, res) => {
  await maintain();
  const d = await db.get('SELECT id, name, phone, vehicle, active FROM drivers WHERE id = ?', req.auth.id);
  if (!d || !d.active) return res.status(401).json({ error: 'not_signed_in' });
  const company = await db.get('SELECT name, min_speed_kmh, gaze_seconds, face_lost_seconds FROM companies WHERE id = ?', req.auth.company_id);
  const pending = await db.all(`SELECT r.id, r.duration_min, r.note, r.test_mode, r.created_at, u.name AS supervisor_name
    FROM requests r LEFT JOIN users u ON u.id = r.supervisor_id WHERE r.driver_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`, d.id);
  const active = (await db.get("SELECT id, duration_min, note, test_mode, started_at, ends_at FROM requests WHERE driver_id = ? AND status = 'active'", d.id)) || null;
  const history = await db.all(`SELECT r.id, r.status, r.duration_min, r.started_at, r.ended_at,
      (SELECT COUNT(*) FROM events e WHERE e.request_id = r.id) AS event_count
    FROM requests r WHERE r.driver_id = ? AND r.status NOT IN ('pending','active') ORDER BY r.created_at DESC LIMIT 5`, d.id);
  res.json({ driver: d, company, pending, active, history, server_time: now(), expiry_ms: REQUEST_EXPIRY_MS });
}));

drv.post('/requests/:id/accept', wrap(async (req, res) => {
  await maintain();
  const r = await driverRequest(req, req.params.id, ['pending']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const t = now();
  await db.run("UPDATE requests SET status = 'active', responded_at = ?, started_at = ?, ends_at = ?, last_seen_at = ? WHERE id = ?",
    t, t, t + r.duration_min * 60000, t, r.id);
  res.json({ ok: true, started_at: t, ends_at: t + r.duration_min * 60000 });
}));

drv.post('/requests/:id/decline', wrap(async (req, res) => {
  const r = await driverRequest(req, req.params.id, ['pending']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  await db.run("UPDATE requests SET status = 'declined', responded_at = ? WHERE id = ?", now(), r.id);
  res.json({ ok: true });
}));

drv.post('/requests/:id/end', wrap(async (req, res) => {
  const r = await driverRequest(req, req.params.id, ['active']);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const t = now();
  await db.tx(async q => {
    await q.run("UPDATE requests SET status = 'ended_early', ended_at = ?, end_reason = 'driver' WHERE id = ?", t, r.id);
    await q.run(`INSERT INTO events (request_id, company_id, driver_id, type, started_at, duration_ms, speed_kmh, lat, lng, details, created_at)
      VALUES (?, ?, ?, 'ended_early', ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.company_id, r.driver_id, t, Math.max(0, r.ends_at - t), r.last_speed, r.last_lat, r.last_lng,
      JSON.stringify({ minutes_left: Math.round((r.ends_at - t) / 60000) }), t);
  });
  res.json({ ok: true });
}));

drv.post('/heartbeat', wrap(async (req, res) => {
  await maintain();
  const b = parseBody(req);
  const r = await db.get('SELECT * FROM requests WHERE id = ? AND driver_id = ?', num(b.request_id), req.auth.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status === 'active') {
    const t = now();
    const sun = b.sunglasses ? 1 : 0;
    // Count time with sunglasses on: the gap since the last signal, if sunglasses were on then too (max 30 s per gap)
    const addSun = sun && r.sunglasses && r.last_seen_at ? Math.min(30000, Math.max(0, t - r.last_seen_at)) : 0;
    const mode = ['eyes', 'head', 'none'].includes(b.mode) ? b.mode : 'eyes';
    await db.run(`UPDATE requests SET last_seen_at = ?, last_lat = ?, last_lng = ?, last_speed = ?, last_state = ?, face_visible = ?,
        sunglasses = ?, sunglasses_ms = sunglasses_ms + ?::bigint, detect_mode = ? WHERE id = ?`,
      t, num(b.lat), num(b.lng), num(b.speed), String(b.state || '').slice(0, 20), b.face_visible ? 1 : 0, sun, addSun, mode, r.id);
  }
  res.json({ status: r.status, ends_at: r.ends_at, server_time: now() });
}));

drv.post('/events', wrap(async (req, res) => {
  const b = parseBody(req);
  if (!EVENT_TYPES.includes(b.type) || b.type === 'ended_early') return res.status(400).json({ error: 'bad_type' });
  const r = await db.get("SELECT * FROM requests WHERE id = ? AND driver_id = ? AND status IN ('active','completed','cancelled','ended_early')", num(b.request_id), req.auth.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const snap = await saveSnapshot(b.snapshot, r.company_id);
  const startedAt = num(b.started_at) || now();
  const ins = await db.get(`INSERT INTO events (request_id, company_id, driver_id, type, started_at, duration_ms, speed_kmh, lat, lng, snapshot, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    r.id, r.company_id, r.driver_id, b.type, Math.round(startedAt), Math.max(0, Math.round(num(b.duration_ms) || 0)),
    num(b.speed), num(b.lat), num(b.lng), snap, JSON.stringify(b.details || {}).slice(0, 2000), now());
  res.json({ id: ins.id });
}));

drv.patch('/events/:id', wrap(async (req, res) => {
  const b = parseBody(req);
  const ev = await db.get('SELECT * FROM events WHERE id = ? AND driver_id = ?', req.params.id, req.auth.id);
  if (!ev) return res.status(404).json({ error: 'not_found' });
  let details = {};
  try { details = JSON.parse(ev.details || '{}'); } catch (_) {}
  Object.assign(details, b.details || {});
  const snap = ev.snapshot || await saveSnapshot(b.snapshot, ev.company_id);
  await db.run('UPDATE events SET duration_ms = ?, details = ?, snapshot = ? WHERE id = ?',
    Math.max(ev.duration_ms, Math.round(num(b.duration_ms) || 0)), JSON.stringify(details).slice(0, 2000), snap, ev.id);
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

init()
  .then(() => {
    purgeSnapshots();
    setInterval(purgeSnapshots, 6 * 3600 * 1000).unref();
    app.listen(PORT, () => console.log(`[salem] Running on http://localhost:${PORT}`));
  })
  .catch(e => {
    console.error('[salem] Could not connect to the database:', e.message);
    process.exit(1);
  });
