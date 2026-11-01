/* One-time import: copy companies, supervisors, drivers, requests, violations and photos
 * from the old SQLite version of Salem (data/salem.db + data/snapshots) into Postgres.
 *
 *   npm run import-sqlite                 (uses ./data)
 *   npm run import-sqlite -- D:\old\data  (another folder)
 *
 * Needs DATABASE_URL in .env. Start the new server once first so the tables exist.
 * Stops without changing anything if the Postgres database already has companies.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');

const dir = path.resolve(process.argv[2] || './data');
const file = path.join(dir, 'salem.db');
if (!fs.existsSync(file)) { console.error('Not found:', file); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set in .env'); process.exit(1); }

let host = '';
try { host = new URL(process.env.DATABASE_URL).hostname; } catch (_) {}
const ssl = process.env.DATABASE_SSL === 'false' ? false : process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false }
  : (!host || host === 'localhost' || host === '127.0.0.1' || !host.includes('.')) ? false : { rejectUnauthorized: false };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
const lite = new DatabaseSync(file, { readOnly: true });

// Tables in dependency order. Only columns present in BOTH databases are copied.
const TABLES = ['companies', 'users', 'drivers', 'requests', 'events'];

(async () => {
  const client = await pool.connect();
  try {
    const has = await client.query("SELECT to_regclass('public.companies') AS t");
    if (!has.rows[0].t) throw new Error('Tables not found. Start the new Salem server once, then run this again.');
    const existing = await client.query('SELECT COUNT(*)::int AS n FROM companies');
    if (existing.rows[0].n > 0) throw new Error('Postgres already has companies. Import only into an empty database.');

    await client.query('BEGIN');
    // The admin account is created by the server on first start; the old one (same email) replaces it.
    await client.query("DELETE FROM users WHERE role = 'admin'");

    for (const t of TABLES) {
      const liteCols = lite.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      const pgCols = (await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [t])).rows.map(r => r.column_name);
      const cols = liteCols.filter(c => pgCols.includes(c));
      const rows = lite.prepare(`SELECT ${cols.join(', ')} FROM ${t} ORDER BY id`).all();
      const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`;
      for (const r of rows) await client.query(sql, cols.map(c => r[c]));
      // keep new ids after the imported ones
      await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`);
      console.log(`${t}: ${rows.length}`);
    }

    // Photos: files in data/snapshots -> snapshots table
    const snapDir = path.join(dir, 'snapshots');
    let photos = 0;
    const evs = lite.prepare('SELECT snapshot, company_id, created_at FROM events WHERE snapshot IS NOT NULL').all();
    for (const e of evs) {
      const p = path.join(snapDir, e.snapshot);
      if (!fs.existsSync(p)) continue;
      const ext = path.extname(p).slice(1).toLowerCase();
      const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
      await client.query('INSERT INTO snapshots (name, company_id, content_type, data, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [e.snapshot, e.company_id, type, fs.readFileSync(p), e.created_at]);
      photos++;
    }
    console.log(`photos: ${photos}`);

    await client.query('COMMIT');
    console.log('Import finished. Restart the Salem server.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import stopped, nothing was changed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
