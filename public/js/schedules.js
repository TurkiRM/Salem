/* Salem — scheduled monitoring sessions (supervisor panel) */
(function () {
  const S = Salem;
  const $ = s => document.querySelector(s);
  // Saudi work week order: Sunday first
  const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6];
  let data = { timezone: 'Asia/Riyadh', schedules: [] };
  let drivers = [];

  const dayName = (d, short) => S.t((short ? 'dshort_' : 'day_') + d);
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  function daysLabel(days) {
    const set = days.slice().sort().join(',');
    if (set === '0,1,2,3,4') return S.t('days_sun_thu');
    if (set === '0,1,2,3,4,5,6') return S.t('days_every');
    if (set === '0,1,2,3,4,6') return S.t('days_sat_thu');
    return DAY_ORDER.filter(d => days.includes(d)).map(d => dayName(d, true)).join('، ');
  }

  function nextLabel(n) {
    if (!n) return '—';
    if (n.in_progress) return S.t('next_now');
    if (n.in_days === 0) return S.t('next_today', { t: n.start_time });
    if (n.in_days === 1) return S.t('next_tomorrow', { t: n.start_time });
    return S.t('next_day', { d: dayName(n.weekday), t: n.start_time });
  }

  /* One line per driver for today: what happened with the scheduled request */
  function runLine(r) {
    let key, cls;
    if (r.status === 'busy') { key = 'run_busy'; cls = 'warn'; }
    else if (r.status === 'sending') { key = 'run_sending'; cls = ''; }
    else if (r.request_status === 'pending') { key = 'run_pending'; cls = 'warn'; }
    else if (r.request_status === 'active') { key = 'run_active'; cls = 'ok'; }
    else if (r.request_status === 'completed') { key = 'run_completed'; cls = 'ok'; }
    else if (r.request_status === 'declined') { key = 'run_declined'; cls = 'bad'; }
    else if (r.request_status === 'expired') { key = 'run_expired'; cls = 'bad'; }
    else if (r.request_status === 'ended_early') { key = 'run_ended_early'; cls = 'bad'; }
    else if (r.request_status === 'cancelled') { key = 'run_cancelled'; cls = ''; }
    else { key = 'run_sent'; cls = ''; }
    return `<div class="run"><span>${S.esc(r.driver_name)}</span><span class="pill ${cls}">${S.t(key)}</span></div>`;
  }

  async function load() {
    try {
      [data, drivers] = await Promise.all([S.api('GET', '/api/sup/schedules'), S.api('GET', '/api/sup/drivers')]);
    } catch (e) { if (e.status === 401) location.replace('/'); return; }
    render();
  }

  function render() {
    const box = $('#schedList');
    if (!data.schedules.length) {
      box.innerHTML = `<div class="panel"><div class="empty">${S.icons.clock}<b>${S.t('no_schedules')}</b><span>${S.t('no_schedules_hint')}</span>
        <button class="btn primary" data-action="new-schedule">${S.t('new_schedule')}</button></div></div>`;
      return;
    }
    const byId = Object.fromEntries(drivers.map(d => [d.id, d]));
    box.innerHTML = `<div class="sched-grid">${data.schedules.map(s => {
      const end = fromMin(toMin(s.start_time) + s.duration_min);
      const who = s.all_drivers ? S.t('all_drivers_sched', { n: drivers.filter(d => d.active).length })
        : s.driver_ids.map(id => byId[id] ? S.esc(byId[id].name) : '').filter(Boolean).join('، ');
      return `<div class="sched-card ${s.active ? '' : 'paused'}">
        <div class="top">
          <div class="who"><b>${S.esc(s.name)}</b><span class="faint">${S.esc(daysLabel(s.days))}</span></div>
          ${s.active ? (s.next_run && s.next_run.in_progress ? `<span class="pill ok live">${S.t('next_now')}</span>` : `<span class="pill ok">${S.t('sched_on')}</span>`) : `<span class="pill">${S.t('sched_paused')}</span>`}
        </div>
        <div class="time"><span class="num">${s.start_time}</span><span class="faint">→</span><span class="num">${end}</span><span class="faint">· ${S.durationLabel(s.duration_min)}</span></div>
        <div class="days">${DAY_ORDER.map(d => `<span class="d ${s.days.includes(d) ? 'on' : ''}" title="${dayName(d)}">${dayName(d, true)}</span>`).join('')}</div>
        <dl class="kv-list">
          <dt>${S.t('sched_drivers')}</dt><dd>${who || '—'}</dd>
          <dt>${S.t('sched_next')}</dt><dd>${s.active ? nextLabel(s.next_run) : '—'}</dd>
          ${s.today_runs && s.today_runs.length ? `<dt>${S.t('sched_today')}</dt><dd><div class="runs">${s.today_runs.map(runLine).join('')}</div></dd>` : ''}
          ${s.note ? `<dt>${S.t('note_to_driver')}</dt><dd>${S.esc(s.note)}</dd>` : ''}
        </dl>
        ${s.test_mode ? `<span class="faint">${S.t('test_mode_short')}</span>` : ''}
        <div class="row" style="gap:.4rem;justify-content:flex-end">
          <button class="btn sm ghost danger" data-del="${s.id}">${S.t('remove')}</button>
          <button class="btn sm" data-pause="${s.id}" data-on="${s.active}">${s.active ? S.t('pause') : S.t('resume_sched')}</button>
          <button class="btn sm primary" data-edit="${s.id}">${S.t('edit')}</button>
        </div>
      </div>`;
    }).join('')}</div>
    <p class="faint" style="margin-top:.8rem">${S.t('sched_tz_note', { tz: data.timezone })}${data.local_time ? ' ' + S.t('sched_now_is', { t: String(Math.floor(data.local_time.minutes / 60)).padStart(2, '0') + ':' + String(data.local_time.minutes % 60).padStart(2, '0') }) : ''}</p>`;
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(data.schedules.find(s => s.id === Number(b.dataset.edit))));
    box.querySelectorAll('[data-pause]').forEach(b => b.onclick = async () => {
      try { await S.api('PATCH', '/api/sup/schedules/' + b.dataset.pause, { active: b.dataset.on !== '1' }); load(); }
      catch (e) { S.toast(S.errorText(e), 'bad'); }
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const s = data.schedules.find(x => x.id === Number(b.dataset.del));
      S.modal({
        title: S.t('delete_schedule'),
        body: `<p>${S.t('delete_schedule_body', { name: S.esc(s.name) })}</p>`,
        actions: [{ label: S.t('back') }, {
          label: S.t('remove'), kind: 'danger', onClick: async () => {
            try { await S.api('DELETE', '/api/sup/schedules/' + s.id); S.toast(S.t('saved')); load(); }
            catch (e) { S.toast(S.errorText(e), 'bad'); }
          }
        }]
      });
    });
  }

  async function openEditor(s) {
    if (!drivers.length) { try { drivers = await S.api('GET', '/api/sup/drivers'); } catch (_) {} }
    const active = drivers.filter(d => d.active);
    if (!active.length) { S.toast(S.t('add_driver_first'), 'bad'); location.hash = '#drivers'; return; }
    const edit = !!s;
    const v = s ? { ...s } : { name: '', days: [0, 1, 2, 3, 4], start_time: '08:00', duration_min: 240, all_drivers: 1, driver_ids: [], note: '', test_mode: 0 };
    const durations = [30, 60, 120, 240, 480];
    const body = document.createElement('div');
    body.className = 'form';
    body.innerHTML = `
      <label class="field"><span>${S.t('sched_name')}</span><input id="scName" maxlength="80" placeholder="${S.t('sched_name_ph')}"></label>
      <div class="field"><span>${S.t('sched_days')}</span>
        <div class="chips" id="scDays">${DAY_ORDER.map(d => `<button type="button" class="chip" data-day="${d}" aria-pressed="${v.days.includes(d)}">${dayName(d, true)}</button>`).join('')}</div>
        <div class="row" style="gap:.4rem"><button type="button" class="btn sm ghost" data-preset="0,1,2,3,4">${S.t('days_sun_thu')}</button><button type="button" class="btn sm ghost" data-preset="0,1,2,3,4,6">${S.t('days_sat_thu')}</button><button type="button" class="btn sm ghost" data-preset="0,1,2,3,4,5,6">${S.t('days_every')}</button></div>
      </div>
      <label class="field"><span>${S.t('sched_start')}</span><input id="scStart" type="time" dir="ltr" style="max-width:180px"></label>
      <div class="field"><span>${S.t('watch_for')}</span>
        <div class="chips" id="scDur">${durations.map(m => `<button type="button" class="chip" data-min="${m}" aria-pressed="${v.duration_min === m}">${S.durationLabel(m)}</button>`).join('')}
          <button type="button" class="chip" data-min="custom" aria-pressed="${!durations.includes(v.duration_min)}">${S.t('custom')}</button></div>
        <input id="scDurCustom" type="number" min="5" max="720" step="5" dir="ltr" placeholder="${S.t('minutes')}" ${durations.includes(v.duration_min) ? 'hidden' : ''}>
        <span class="faint" id="scEnds"></span>
      </div>
      <div class="field"><span>${S.t('sched_drivers')}</span>
        <label class="check"><input type="radio" name="scWho" value="all" ${v.all_drivers ? 'checked' : ''}><span>${S.t('sched_all')}<br><span class="faint">${S.t('sched_all_hint')}</span></span></label>
        <label class="check"><input type="radio" name="scWho" value="some" ${v.all_drivers ? '' : 'checked'}><span>${S.t('sched_some')}</span></label>
        <div class="driver-pick" id="scPick" ${v.all_drivers ? 'hidden' : ''}>${active.map(d => `<label class="check"><input type="checkbox" value="${d.id}" ${v.driver_ids.includes(d.id) ? 'checked' : ''}><span>${S.esc(d.name)}${d.vehicle ? ` <span class="faint">· ${S.esc(d.vehicle)}</span>` : ''}</span></label>`).join('')}</div>
      </div>
      <label class="field"><span>${S.t('note_to_driver')}</span><input id="scNote" maxlength="300" placeholder="${S.t('note_ph')}"></label>
      <label class="check"><input type="checkbox" id="scTest" ${v.test_mode ? 'checked' : ''}><span><b>${S.t('test_mode')}</b><br><span class="faint">${S.t('test_mode_hint')}</span></span></label>
      <div class="error-msg" id="scErr"></div>`;
    body.querySelector('#scName').value = v.name;
    body.querySelector('#scStart').value = v.start_time;
    body.querySelector('#scNote').value = v.note || '';
    if (!durations.includes(v.duration_min)) body.querySelector('#scDurCustom').value = v.duration_min;

    let minutes = durations.includes(v.duration_min) ? v.duration_min : null;
    const showEnd = () => {
      const st = body.querySelector('#scStart').value;
      const dur = minutes || Number(body.querySelector('#scDurCustom').value);
      body.querySelector('#scEnds').textContent = st && dur ? S.t('sched_ends_at', { t: fromMin(toMin(st) + dur) }) : '';
    };
    body.querySelectorAll('[data-day]').forEach(c => c.onclick = () => c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')));
    body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const set = b.dataset.preset.split(',');
      body.querySelectorAll('[data-day]').forEach(c => c.setAttribute('aria-pressed', String(set.includes(c.dataset.day))));
    });
    body.querySelectorAll('#scDur .chip').forEach(c => c.onclick = () => {
      body.querySelectorAll('#scDur .chip').forEach(x => x.setAttribute('aria-pressed', 'false'));
      c.setAttribute('aria-pressed', 'true');
      const custom = c.dataset.min === 'custom';
      body.querySelector('#scDurCustom').hidden = !custom;
      minutes = custom ? null : Number(c.dataset.min);
      if (custom) body.querySelector('#scDurCustom').focus();
      showEnd();
    });
    body.querySelector('#scStart').oninput = showEnd;
    body.querySelector('#scDurCustom').oninput = showEnd;
    body.querySelectorAll('[name="scWho"]').forEach(r => r.onchange = () => { body.querySelector('#scPick').hidden = body.querySelector('[name="scWho"]:checked').value === 'all'; });
    showEnd();

    S.modal({
      title: edit ? S.t('edit_schedule') : S.t('new_schedule'), body,
      actions: [{ label: S.t('cancel') }, {
        label: S.t('save'), kind: 'primary', onClick: async () => {
          const payload = {
            name: body.querySelector('#scName').value,
            days: [...body.querySelectorAll('[data-day][aria-pressed="true"]')].map(c => Number(c.dataset.day)),
            start_time: body.querySelector('#scStart').value,
            duration_min: minutes || Number(body.querySelector('#scDurCustom').value),
            all_drivers: body.querySelector('[name="scWho"]:checked').value === 'all',
            driver_ids: [...body.querySelectorAll('#scPick input:checked')].map(i => Number(i.value)),
            note: body.querySelector('#scNote').value,
            test_mode: body.querySelector('#scTest').checked
          };
          try {
            if (edit) await S.api('PUT', '/api/sup/schedules/' + s.id, payload);
            else await S.api('POST', '/api/sup/schedules', payload);
            S.toast(S.t('schedule_saved'));
            if (location.hash !== '#schedules') location.hash = '#schedules'; else load();
          } catch (e) { body.querySelector('#scErr').textContent = S.errorText(e); return true; }
        }
      }]
    });
  }

  setInterval(() => { if (location.hash === '#schedules' && !document.querySelector('.modal-back')) load(); }, 30000);

  S.Schedules = { load, openEditor };
})();
