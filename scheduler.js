/* Salem — scheduled monitoring sessions
 *
 * A company creates schedules such as "all drivers, Sun–Thu, 08:00, 4 hours".
 * Every minute the server calls tick(): for each schedule whose time window is open
 * right now (in the company's time zone), it sends a monitoring request to each of
 * its drivers, once per day. The session ends at the scheduled end time even if the
 * driver accepts late, and an unanswered request expires at that end time.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN_LEFT = 5; // don't send a request when less than 5 minutes of the window remain

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}

/* Date, weekday and minutes-since-midnight at `ms` in time zone `tz` */
function localParts(tz, ms) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second)
  };
}

const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const parseDays = s => String(s || '').split(',').filter(x => x !== '').map(Number).filter(n => n >= 0 && n <= 6);

/* Is the schedule's window open right now? Returns the scheduled end time in ms, or null */
function openWindow(s, tz, nowMs) {
  const p = localParts(tz, nowMs);
  if (!parseDays(s.days).includes(p.weekday)) return null;
  const start = toMin(s.start_time), end = start + s.duration_min;
  if (p.minutes < start || p.minutes >= end - MIN_LEFT) return null;
  return { date: p.date, endMs: nowMs + ((end - p.minutes) * 60 - p.seconds) * 1000 };
}

/* Next time this schedule will send requests: { date, weekday, start_time, in_days, in_progress } */
function nextRun(s, tz, nowMs) {
  const days = parseDays(s.days);
  if (!days.length) return null;
  const start = toMin(s.start_time);
  for (let i = 0; i < 8; i++) {
    const p = localParts(tz, nowMs + i * 86400000);
    if (!days.includes(p.weekday)) continue;
    if (i === 0) {
      const nowMin = localParts(tz, nowMs).minutes;
      if (nowMin >= start + s.duration_min - MIN_LEFT) continue; // today's window is over
      return { date: p.date, weekday: p.weekday, start_time: s.start_time, in_days: 0, in_progress: nowMin >= start };
    }
    return { date: p.date, weekday: p.weekday, start_time: s.start_time, in_days: i, in_progress: false };
  }
  return null;
}

/* Send due requests. `db` has all/get/run with ? placeholders. Returns what it did (for logs/tests). */
async function tick(db, nowMs) {
  const done = [];
  const schedules = await db.all(`SELECT s.*, c.timezone FROM schedules s JOIN companies c ON c.id = s.company_id
    WHERE s.active = 1 AND c.active = 1 AND c.status = 'approved'`);
  for (const s of schedules) {
    const tz = s.timezone || 'Asia/Riyadh';
    const win = openWindow(s, tz, nowMs);
    if (!win) continue;
    const drivers = s.all_drivers
      ? await db.all('SELECT id FROM drivers WHERE company_id = ? AND active = 1', s.company_id)
      : await db.all(`SELECT d.id FROM schedule_drivers sd JOIN drivers d ON d.id = sd.driver_id
          WHERE sd.schedule_id = ? AND d.active = 1 AND d.company_id = ?`, s.id, s.company_id);
    for (const d of drivers) {
      // Claim today's run for this driver; if it already exists, it was handled earlier today
      const claim = await db.get(`INSERT INTO schedule_runs (schedule_id, driver_id, run_date, status, created_at)
        VALUES (?, ?, ?, 'sending', ?) ON CONFLICT DO NOTHING RETURNING schedule_id`, s.id, d.id, win.date, nowMs);
      if (!claim) continue;
      const open = await db.get("SELECT id FROM requests WHERE driver_id = ? AND status IN ('pending','active')", d.id);
      if (open) {
        await db.run("UPDATE schedule_runs SET status = 'busy', request_id = ? WHERE schedule_id = ? AND driver_id = ? AND run_date = ?", open.id, s.id, d.id, win.date);
        done.push({ schedule: s.id, driver: d.id, status: 'busy' });
        continue;
      }
      const r = await db.get(`INSERT INTO requests (company_id, driver_id, supervisor_id, duration_min, note, test_mode, created_at, schedule_id, scheduled_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        s.company_id, d.id, s.created_by, s.duration_min, String(s.note || s.name).slice(0, 300), s.test_mode, nowMs, s.id, win.endMs);
      await db.run("UPDATE schedule_runs SET status = 'sent', request_id = ? WHERE schedule_id = ? AND driver_id = ? AND run_date = ?", r.id, s.id, d.id, win.date);
      done.push({ schedule: s.id, driver: d.id, status: 'sent', request: r.id });
    }
  }
  return done;
}

module.exports = { tick, nextRun, localParts, validTimeZone, parseDays, WEEKDAYS };
