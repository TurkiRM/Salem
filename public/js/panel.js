/* Salem — supervisor panel */
(function () {
  const S = Salem;
  const $ = s => document.querySelector(s);
  const state = { me: null, company: null, view: 'overview', drivers: [], timer: null, overview: null };

  /* ---------- Boot */
  async function boot() {
    S.applyI18n();
    try {
      state.me = await S.api('GET', '/api/me');
      if (state.me.role !== 'supervisor') return location.replace(state.me.role === 'admin' ? '/admin' : '/');
    } catch (_) { return location.replace('/'); }
    state.company = state.me.company;
    $('#companyName').textContent = state.company.name;
    $('#meName').textContent = state.me.user.name;
    $('#meEmail').textContent = state.me.user.email;
    $('#logoutBtn').onclick = () => S.logout('/');
    $('#menuBtn').onclick = () => $('#rail').classList.toggle('open');
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-action]');
      if (!a) return;
      const act = a.dataset.action;
      if (act === 'new-request') openRequestModal(a.dataset.driver ? Number(a.dataset.driver) : null);
      if (act === 'new-driver') openDriverModal();
      if (act === 'new-sup') openSupModal();
    });
    S.onLangChange = () => render();
    buildFilters();
    window.addEventListener('hashchange', route);
    await loadDrivers();
    route();
  }

  function route() {
    const v = (location.hash || '#overview').slice(1);
    state.view = ['overview', 'alerts', 'drivers', 'history', 'settings'].includes(v) ? v : 'overview';
    document.querySelectorAll('[data-page]').forEach(p => (p.hidden = p.dataset.page !== state.view));
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === state.view));
    $('#rail').classList.remove('open');
    clearInterval(state.timer);
    render();
    if (state.view === 'overview') state.timer = setInterval(loadOverview, 5000);
    if (state.view === 'alerts') state.timer = setInterval(loadAlerts, 15000);
  }

  function render() {
    if (state.view === 'overview') loadOverview();
    if (state.view === 'alerts') { buildFilters(); loadAlerts(); }
    if (state.view === 'drivers') loadDrivers().then(renderDrivers);
    if (state.view === 'history') loadHistory();
    if (state.view === 'settings') loadSettings();
  }

  async function loadDrivers() {
    try { state.drivers = await S.api('GET', '/api/sup/drivers'); } catch (_) {}
    return state.drivers;
  }

  /* ---------- Overview */
  async function loadOverview() {
    let d;
    try { d = await S.api('GET', '/api/sup/overview'); } catch (e) { if (e.status === 401) location.replace('/'); return; }
    state.overview = d;
    const k = d.kpi;
    const rc = $('#reviewCount');
    rc.hidden = !k.to_review; rc.textContent = k.to_review;
    $('#kpis').innerHTML = [
      ['kpi_active', k.active, ''],
      ['kpi_pending', k.pending, k.pending ? 'attn' : ''],
      ['kpi_gaze_today', k.gaze_today, k.gaze_today ? 'alert' : ''],
      ['kpi_events_today', k.events_today, ''],
      ['kpi_to_review', k.to_review, k.to_review ? 'attn' : ''],
      ['kpi_drivers', k.drivers, '']
    ].map(([key, v, cls]) => `<div class="kpi ${cls}"><span class="label">${S.t(key)}</span><span class="v">${v}</span></div>`).join('');
    $('#lastUpdate').textContent = S.t('updated_at', { t: S.fmtTime(Date.now()) });

    const skew = Date.now() - d.server_time;
    if (!d.live.length) {
      $('#liveList').innerHTML = `<div class="empty">${S.icons.live}<b>${S.t('no_live')}</b><span>${S.t('no_live_hint')}</span>
        <button class="btn primary" data-action="new-request">${S.t('send_request')}</button></div>`;
    } else {
      $('#liveList').innerHTML = `<div class="live-grid">${d.live.map(r => liveCard(r, skew)).join('')}</div>`;
      $('#liveList').querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => cancelRequest(Number(b.dataset.cancel)));
      $('#liveList').querySelectorAll('[data-session]').forEach(b => b.onclick = () => openSession(Number(b.dataset.session)));
    }
    $('#recentList').innerHTML = d.recent.length ? d.recent.map(e => eventRow(e, true)).join('') :
      `<div class="empty">${S.icons.shield}<span>${S.t('no_events')}</span></div>`;
    bindEventRows($('#recentList'), d.recent);
  }

  function liveCard(r, skew) {
    const t = Date.now() - skew;
    if (r.status === 'pending') {
      return `<div class="live-card s-pending">
        <div class="top"><div class="who"><b>${S.esc(r.driver_name)}</b><span class="faint">${S.esc(r.driver_vehicle || r.driver_phone)}</span></div>
        <span class="pill warn">${S.t('st_pending')}</span></div>
        <p class="muted">${S.t('waiting_driver', { d: S.durationLabel(r.duration_min) })}</p>
        <div class="row" style="justify-content:space-between"><span class="faint">${S.t('sent')} ${S.ago(r.created_at)}</span>
        <button class="btn sm danger" data-cancel="${r.id}">${S.t('cancel')}</button></div></div>`;
    }
    const total = r.ends_at - r.started_at, done = Math.min(1, Math.max(0, (t - r.started_at) / total));
    const lost = r.connection === 'lost';
    const stateKey = lost ? 'conn_lost' : ({ watching: 'ds_watching', calibrating: 'ds_calibrating', no_face: 'ds_no_face', away: 'ds_away', parked: 'ds_parked' }[r.last_state] || 'ds_watching');
    const pill = lost ? 'bad' : r.last_state === 'no_face' || r.last_state === 'away' ? 'warn' : 'ok';
    const speed = r.last_speed != null ? Math.round(r.last_speed) : '—';
    return `<div class="live-card ${lost ? 's-lost' : 's-live'}">
      <div class="top"><div class="who"><b>${S.esc(r.driver_name)}</b><span class="faint">${S.esc(r.driver_vehicle || r.driver_phone)}</span></div>
      <span class="pill ${pill} ${lost ? '' : 'live'}">${S.t(stateKey)}</span></div>
      ${!lost && r.sunglasses ? `<div class="sun-note ${r.detect_mode === 'none' ? 'limited' : ''}">${S.t(r.detect_mode === 'none' ? 'mode_none_sup' : 'mode_head_sup')}</div>` : ''}
      <div class="meta">
        <div><span class="label">${S.t('speed')}</span><span class="v">${speed}<small class="faint"> ${S.t('kmh')}</small></span></div>
        <div><span class="label">${S.t('alerts')}</span><span class="v" style="color:${r.event_count ? 'var(--bad)' : 'inherit'}">${r.event_count}</span></div>
        <div><span class="label">${S.t('remaining')}</span><span class="v">${S.fmtClock(r.ends_at - t)}</span></div>
      </div>
      <div class="bar"><i style="width:${(done * 100).toFixed(1)}%"></i></div>
      <div class="row" style="justify-content:space-between">
        <span class="faint">${S.t('last_signal')} ${S.ago(r.last_seen_at)}${r.test_mode ? ' · ' + S.t('test_mode_short') : ''}</span>
        <span class="row" style="gap:.4rem">
          ${S.mapLink(r.last_lat, r.last_lng) ? `<a class="btn sm" target="_blank" rel="noopener" href="${S.mapLink(r.last_lat, r.last_lng)}">${S.t('map')}</a>` : ''}
          <button class="btn sm" data-session="${r.id}">${S.t('details')}</button>
          <button class="btn sm danger" data-cancel="${r.id}">${S.t('stop')}</button>
        </span>
      </div></div>`;
  }

  async function cancelRequest(id) {
    const m = S.modal({
      title: S.t('confirm_stop_title'),
      body: `<p>${S.t('confirm_stop_body')}</p>`,
      actions: [{ label: S.t('back') }, {
        label: S.t('stop'), kind: 'danger', onClick: async () => {
          try { await S.api('POST', `/api/sup/requests/${id}/cancel`); S.toast(S.t('stopped')); render(); }
          catch (e) { S.toast(S.errorText(e), 'bad'); }
        }
      }]
    });
    return m;
  }

  /* ---------- Events */
  function eventRow(e, compact) {
    const meta = S.EVENT_META[e.type] || { pill: '', icon: 'alert' };
    let det = {};
    try { det = JSON.parse(e.details || '{}'); } catch (_) {}
    const thumb = e.snapshot ? `<img src="/snapshots/${S.esc(e.snapshot)}" alt="" loading="lazy">` : S.icons[meta.icon];
    const map = S.mapLink(e.lat, e.lng);
    const reviewPill = e.review === 'confirmed' ? `<span class="pill bad">${S.t('rv_confirmed')}</span>` :
      e.review === 'dismissed' ? `<span class="pill">${S.t('rv_dismissed')}</span>` : `<span class="pill warn">${S.t('rv_new')}</span>`;
    const facts = [
      `<span>${S.fmtDateTime(e.started_at)}</span>`,
      e.duration_ms ? `<span>${S.t('lasted')} <b class="num">${S.fmtDur(e.duration_ms)}</b></span>` : '',
      e.speed_kmh != null ? `<span>${S.t('speed')} <b class="num">${Math.round(e.speed_kmh)}</b> ${S.t('kmh')}</span>` : '',
      det.reading ? `<span class="pill bad" style="font-size:.72rem">${S.t('reading_pattern')}</span>` : '',
      det.sunglasses ? `<span class="pill info" style="font-size:.72rem">${S.t('tag_sunglasses')}</span>` : '',
      map ? `<a href="${map}" target="_blank" rel="noopener">${S.t('map')}</a>` : ''
    ].join('');
    return `<div class="ev ${compact ? 'compact' : ''}" data-ev="${e.id}">
      <button class="thumb" data-zoom="${e.id}" aria-label="${S.t('view_photo')}">${thumb}</button>
      <div class="body">
        <div class="title"><b>${S.esc(e.driver_name)}</b><span class="pill ${meta.pill}">${S.t('ev_' + e.type)}</span>${compact ? '' : reviewPill}</div>
        <div class="facts">${facts}</div>
        ${e.review_note ? `<div class="faint">${S.esc(e.review_note)}</div>` : ''}
      </div>
      ${compact ? '' : `<div class="acts">
        <button class="btn sm ${e.review === 'confirmed' ? 'primary' : ''}" data-review="confirmed" data-id="${e.id}">${S.t('confirm')}</button>
        <button class="btn sm" data-review="dismissed" data-id="${e.id}">${S.t('dismiss')}</button>
      </div>`}
    </div>`;
  }

  function bindEventRows(root, list) {
    root.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => openEvent(list.find(e => e.id === Number(b.dataset.zoom))));
    root.querySelectorAll('[data-review]').forEach(b => b.onclick = async () => {
      try {
        await S.api('PATCH', `/api/sup/events/${b.dataset.id}`, { review: b.dataset.review });
        S.toast(S.t('saved'));
        loadAlerts();
      } catch (e) { S.toast(S.errorText(e), 'bad'); }
    });
  }

  function openEvent(e) {
    if (!e) return;
    let det = {};
    try { det = JSON.parse(e.details || '{}'); } catch (_) {}
    const map = S.mapLink(e.lat, e.lng);
    const rows = [
      [S.t('driver'), S.esc(e.driver_name) + (e.driver_vehicle ? ' · ' + S.esc(e.driver_vehicle) : '')],
      [S.t('type'), S.t('ev_' + e.type)],
      [S.t('time'), S.fmtDateTime(e.started_at)],
      [S.t('lasted'), e.duration_ms ? S.fmtDur(e.duration_ms) : '—'],
      [S.t('speed'), e.speed_kmh != null ? Math.round(e.speed_kmh) + ' ' + S.t('kmh') : '—'],
      [S.t('location'), map ? `<a href="${map}" target="_blank" rel="noopener">${Number(e.lat).toFixed(5)}, ${Number(e.lng).toFixed(5)}</a>` : '—'],
      e.type === 'gaze' ? [S.t('detected_by'), det.sunglasses ? S.t('by_head') : S.t('by_eyes')] : null,
      det.reading != null && !det.sunglasses ? [S.t('eye_pattern'), det.reading ? S.t('reading_pattern') + ` (${det.saccades || 0} ${S.t('saccades')})` : S.t('steady_look')] : null,
      det.minutes_left != null ? [S.t('minutes_left'), det.minutes_left] : null
    ].filter(Boolean);
    const body = `<div class="lightbox">${e.snapshot ? `<img src="/snapshots/${S.esc(e.snapshot)}" alt="">` : `<div class="empty">${S.icons[(S.EVENT_META[e.type] || {}).icon || 'alert']}<span>${S.t('no_photo')}</span></div>`}</div>
      <div class="table-wrap"><table><tbody>${rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td>${v}</td></tr>`).join('')}</tbody></table></div>
      <label class="field"><span>${S.t('review_note')}</span><textarea id="rvNote" rows="2">${S.esc(e.review_note || '')}</textarea></label>`;
    S.modal({
      title: S.t('ev_' + e.type), body, wide: true,
      actions: [
        { label: S.t('dismiss'), onClick: () => review('dismissed') },
        { label: S.t('confirm'), kind: 'primary', onClick: () => review('confirmed') }
      ]
    });
    async function review(rv) {
      try {
        await S.api('PATCH', `/api/sup/events/${e.id}`, { review: rv, review_note: document.getElementById('rvNote').value });
        S.toast(S.t('saved')); render();
      } catch (x) { S.toast(S.errorText(x), 'bad'); return true; }
    }
  }

  function buildFilters() {
    const keep = id => document.getElementById(id).value;
    const ft = keep('fType'), fr = keep('fReview'), fd = keep('fDriver');
    $('#fType').innerHTML = `<option value="">${S.t('all_types')}</option>` + ['gaze', 'left_screen', 'face_lost', 'ended_early'].map(k => `<option value="${k}">${S.t('ev_' + k)}</option>`).join('');
    $('#fReview').innerHTML = `<option value="">${S.t('all_reviews')}</option>` + ['new', 'confirmed', 'dismissed'].map(k => `<option value="${k}">${S.t('rv_' + k)}</option>`).join('');
    $('#fDriver').innerHTML = `<option value="">${S.t('all_drivers')}</option>` + state.drivers.map(d => `<option value="${d.id}">${S.esc(d.name)}</option>`).join('');
    $('#fType').value = ft; $('#fReview').value = fr; $('#fDriver').value = fd;
    ['fType', 'fReview', 'fDriver'].forEach(id => document.getElementById(id).onchange = loadAlerts);
  }

  async function loadAlerts() {
    const q = new URLSearchParams();
    if ($('#fType').value) q.set('type', $('#fType').value);
    if ($('#fReview').value) q.set('review', $('#fReview').value);
    if ($('#fDriver').value) q.set('driver_id', $('#fDriver').value);
    let list = [];
    try { list = await S.api('GET', '/api/sup/events?' + q); } catch (_) {}
    $('#alertList').innerHTML = list.length ? list.map(e => eventRow(e, false)).join('') :
      `<div class="empty">${S.icons.shield}<b>${S.t('no_events')}</b><span>${S.t('no_events_hint')}</span></div>`;
    bindEventRows($('#alertList'), list);
  }

  /* ---------- Drivers */
  function renderDrivers() {
    const list = state.drivers;
    if (!list.length) {
      $('#driverTable').innerHTML = `<div class="empty">${S.icons.users}<b>${S.t('no_drivers')}</b><span>${S.t('no_drivers_hint')}</span>
        <button class="btn primary" data-action="new-driver">${S.t('add_driver')}</button></div>`;
      return;
    }
    $('#driverTable').innerHTML = `<table><thead><tr>
      <th>${S.t('driver')}</th><th>${S.t('score')}</th><th>${S.t('hours_watched')}</th><th>${S.t('ev_gaze')}</th><th>${S.t('ev_left_screen')}</th><th>${S.t('last_session')}</th><th></th>
      </tr></thead><tbody>${list.map(d => `<tr style="${d.active ? '' : 'opacity:.55'}">
        <td><b>${S.esc(d.name)}</b><span class="sub mono" dir="ltr" style="text-align:start">${S.esc(d.phone)}</span>${d.vehicle ? `<span class="sub">${S.esc(d.vehicle)}</span>` : ''}</td>
        <td><span class="score ${S.scoreClass(d.stats.score)}">${d.stats.score == null ? '—' : d.stats.score}</span></td>
        <td class="num">${d.stats.hours}</td>
        <td class="num">${d.stats.counts.gaze}</td>
        <td class="num">${d.stats.counts.left_screen}</td>
        <td>${d.last_session ? S.ago(d.last_session) : '—'}${d.last_status ? `<span class="sub">${S.t('st_' + d.last_status)}</span>` : ''}</td>
        <td><div class="row" style="gap:.4rem;flex-wrap:nowrap">
          ${d.active ? `<button class="btn sm primary" data-action="new-request" data-driver="${d.id}">${S.t('send_request')}</button>` : ''}
          <button class="btn sm" data-pin="${d.id}">${S.t('reset_pin')}</button>
          <button class="btn sm ghost" data-toggle="${d.id}" data-active="${d.active}">${d.active ? S.t('disable') : S.t('enable')}</button>
        </div></td></tr>`).join('')}</tbody></table>`;
    $('#driverTable').querySelectorAll('[data-pin]').forEach(b => b.onclick = async () => {
      try { const r = await S.api('POST', `/api/sup/drivers/${b.dataset.pin}/reset-pin`); showCredentials(state.drivers.find(x => x.id === Number(b.dataset.pin)).name, r.phone, r.pin); }
      catch (e) { S.toast(S.errorText(e), 'bad'); }
    });
    $('#driverTable').querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      try { await S.api('PATCH', `/api/sup/drivers/${b.dataset.toggle}`, { active: b.dataset.active !== '1' }); await loadDrivers(); renderDrivers(); }
      catch (e) { S.toast(S.errorText(e), 'bad'); }
    });
  }

  function openDriverModal() {
    S.modal({
      title: S.t('add_driver'),
      body: `<form class="form" onsubmit="return false">
        <label class="field"><span>${S.t('full_name')}</span><input id="dName" autocomplete="off"></label>
        <label class="field"><span>${S.t('phone')}</span><input id="dPhone" type="tel" dir="ltr" placeholder="05XXXXXXXX"></label>
        <label class="field"><span>${S.t('vehicle')}</span><input id="dVehicle" placeholder="${S.t('vehicle_ph')}"></label>
        <div class="error-msg" id="dErr"></div></form>`,
      actions: [{ label: S.t('cancel') }, {
        label: S.t('add'), kind: 'primary', onClick: async () => {
          try {
            const name = $('#dName').value.trim();
            const r = await S.api('POST', '/api/sup/drivers', { name, phone: $('#dPhone').value, vehicle: $('#dVehicle').value });
            await loadDrivers(); renderDrivers();
            setTimeout(() => showCredentials(name, r.phone, r.pin), 50);
          } catch (e) { $('#dErr').textContent = S.errorText(e); return true; }
        }
      }]
    });
  }

  function showCredentials(name, phone, pin) {
    const link = location.origin + '/driver';
    const msg = S.t('cred_message', { name, link, code: state.company.code, phone, pin });
    S.modal({
      title: S.t('driver_credentials'),
      body: `<p class="muted">${S.t('cred_once')}</p>
        <div class="secret">
          <div class="kv"><span>${S.t('driver_link')}</span><span class="mono" dir="ltr">${S.esc(link)}</span></div>
          <div class="kv"><span>${S.t('company_code')}</span><b>${S.esc(state.company.code)}</b></div>
          <div class="kv"><span>${S.t('phone')}</span><b dir="ltr">${S.esc(phone)}</b></div>
          <div class="kv"><span>${S.t('pin')}</span><b>${S.esc(pin)}</b></div>
        </div>
        <textarea id="credMsg" rows="5" readonly>${S.esc(msg)}</textarea>`,
      actions: [
        { label: S.t('copy_message'), onClick: async () => { await S.copy(msg); return true; } },
        { label: S.t('done'), kind: 'primary' }
      ]
    });
  }

  /* ---------- Send request */
  function openRequestModal(driverId) {
    const active = state.drivers.filter(d => d.active);
    if (!active.length) { S.toast(S.t('add_driver_first'), 'bad'); location.hash = '#drivers'; return; }
    const durations = [30, 60, 120, 240];
    const body = document.createElement('div');
    body.className = 'form';
    body.innerHTML = `
      <label class="field"><span>${S.t('driver')}</span><select id="rDriver">${active.map(d => `<option value="${d.id}">${S.esc(d.name)}${d.vehicle ? ' — ' + S.esc(d.vehicle) : ''}</option>`).join('')}</select></label>
      <div class="field"><span>${S.t('watch_for')}</span>
        <div class="chips" id="rChips">${durations.map((m, i) => `<button type="button" class="chip" data-min="${m}" aria-pressed="${i === 0}">${S.durationLabel(m)}</button>`).join('')}
        <button type="button" class="chip" data-min="custom" aria-pressed="false">${S.t('custom')}</button></div>
        <input id="rCustom" type="number" min="5" max="720" step="5" dir="ltr" placeholder="${S.t('minutes')}" hidden>
      </div>
      <label class="field"><span>${S.t('note_to_driver')}</span><input id="rNote" maxlength="300" placeholder="${S.t('note_ph')}"></label>
      <label class="check"><input type="checkbox" id="rTest"><span><b>${S.t('test_mode')}</b><br><span class="faint">${S.t('test_mode_hint')}</span></span></label>
      <div class="error-msg" id="rErr"></div>`;
    let minutes = 30;
    body.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      body.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', 'false'));
      c.setAttribute('aria-pressed', 'true');
      const custom = c.dataset.min === 'custom';
      body.querySelector('#rCustom').hidden = !custom;
      minutes = custom ? null : Number(c.dataset.min);
      if (custom) body.querySelector('#rCustom').focus();
    });
    S.modal({
      title: S.t('send_request'), body,
      actions: [{ label: S.t('cancel') }, {
        label: S.t('send'), kind: 'primary', onClick: async () => {
          const dur = minutes || Number(body.querySelector('#rCustom').value);
          try {
            await S.api('POST', '/api/sup/requests', { driver_id: Number(body.querySelector('#rDriver').value), duration_min: dur, note: body.querySelector('#rNote').value, test_mode: body.querySelector('#rTest').checked });
            S.toast(S.t('request_sent'));
            if (location.hash !== '#overview') location.hash = '#overview'; else loadOverview();
          } catch (e) { body.querySelector('#rErr').textContent = S.errorText(e); return true; }
        }
      }]
    });
    if (driverId) body.querySelector('#rDriver').value = driverId;
  }

  /* ---------- Session detail */
  async function openSession(id) {
    let evs = [];
    try { evs = await S.api('GET', '/api/sup/events?request_id=' + id); } catch (_) {}
    const r = (state.overview && state.overview.live.find(x => x.id === id)) || {};
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p class="muted">${S.esc(r.driver_name || '')} · ${S.t('started')} ${S.fmtTime(r.started_at)} · ${S.t('ends')} ${S.fmtTime(r.ends_at)}</p>
      <div class="ev-list panel">${evs.length ? evs.map(e => eventRow(e, true)).join('') : `<div class="empty">${S.icons.shield}<span>${S.t('no_events_session')}</span></div>`}</div>`;
    S.modal({ title: S.t('session_details'), body: wrap, wide: true });
    bindEventRows(wrap, evs);
  }

  /* ---------- History */
  async function loadHistory() {
    let list = [];
    try { list = await S.api('GET', '/api/sup/requests'); } catch (_) {}
    if (!list.length) { $('#historyTable').innerHTML = `<div class="empty">${S.icons.history}<span>${S.t('no_history')}</span></div>`; return; }
    $('#historyTable').innerHTML = `<table><thead><tr><th>${S.t('driver')}</th><th>${S.t('status')}</th><th>${S.t('duration')}</th><th>${S.t('started')}</th><th>${S.t('ev_gaze')}</th><th>${S.t('alerts')}</th><th>${S.t('requested_by')}</th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td><b>${S.esc(r.driver_name)}</b>${r.test_mode ? `<span class="sub">${S.t('test_mode_short')}</span>` : ''}</td>
        <td><span class="pill ${S.STATUS_PILL[r.status] || ''}">${S.t('st_' + r.status)}</span></td>
        <td>${S.durationLabel(r.duration_min)}${r.sunglasses_ms >= 60000 ? `<span class="sub">${S.t('sun_minutes', { n: Math.round(r.sunglasses_ms / 60000) })}</span>` : ''}</td>
        <td>${r.started_at ? S.fmtDateTime(r.started_at) : `<span class="faint">${S.t('sent')} ${S.fmtDateTime(r.created_at)}</span>`}</td>
        <td class="num">${r.gaze_count}</td>
        <td class="num">${r.event_count ? `<button class="btn sm" data-hs="${r.id}">${r.event_count}</button>` : 0}</td>
        <td>${S.esc(r.supervisor_name || '—')}</td></tr>`).join('')}</tbody></table>`;
    $('#historyTable').querySelectorAll('[data-hs]').forEach(b => b.onclick = async () => {
      const r = list.find(x => x.id === Number(b.dataset.hs));
      state.overview = state.overview || { live: [] };
      if (!state.overview.live.find(x => x.id === r.id)) state.overview.live.push(r);
      openSession(r.id);
    });
  }

  /* ---------- Settings */
  async function loadSettings() {
    try {
      const s = await S.api('GET', '/api/sup/settings');
      $('#sGaze').value = s.gaze_seconds; $('#sSpeed').value = s.min_speed_kmh; $('#sFace').value = s.face_lost_seconds;
      $('#sCode').textContent = s.code; $('#sLink').textContent = location.origin + '/driver';
    } catch (_) {}
    $('#settingsForm').onsubmit = async e => {
      e.preventDefault();
      try { await S.api('PUT', '/api/sup/settings', { gaze_seconds: Number($('#sGaze').value), min_speed_kmh: Number($('#sSpeed').value), face_lost_seconds: Number($('#sFace').value) }); S.toast(S.t('saved')); }
      catch (x) { S.toast(S.errorText(x), 'bad'); }
    };
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      const err = $('#pwErr');
      err.textContent = '';
      if ($('#pwNew').value !== $('#pwConfirm').value) { err.textContent = S.t('err_password_mismatch'); return; }
      try {
        await S.api('POST', '/api/auth/change-password', { current_password: $('#pwCurrent').value, new_password: $('#pwNew').value });
        $('#pwForm').reset();
        S.toast(S.t('password_updated'));
      } catch (x) { err.textContent = S.errorText(x); }
    };
    let team = [];
    try { team = await S.api('GET', '/api/sup/team'); } catch (_) {}
    $('#teamTable').innerHTML = `<table><thead><tr><th>${S.t('full_name')}</th><th>${S.t('email')}</th><th>${S.t('added')}</th></tr></thead>
      <tbody>${team.map(u => `<tr><td>${S.esc(u.name)}</td><td dir="ltr" style="text-align:start">${S.esc(u.email)}</td><td>${S.fmtDate(u.created_at)}</td></tr>`).join('')}</tbody></table>`;
  }

  function openSupModal() {
    S.modal({
      title: S.t('add_supervisor'),
      body: `<form class="form" onsubmit="return false">
        <label class="field"><span>${S.t('full_name')}</span><input id="uName"></label>
        <label class="field"><span>${S.t('email')}</span><input id="uEmail" type="email" dir="ltr"></label>
        <label class="field"><span>${S.t('password')}</span><input id="uPass" type="text" dir="ltr" placeholder="${S.t('min8')}"></label>
        <div class="error-msg" id="uErr"></div></form>`,
      actions: [{ label: S.t('cancel') }, {
        label: S.t('add'), kind: 'primary', onClick: async () => {
          try { await S.api('POST', '/api/sup/team', { name: $('#uName').value, email: $('#uEmail').value, password: $('#uPass').value }); S.toast(S.t('saved')); loadSettings(); }
          catch (e) { $('#uErr').textContent = S.errorText(e); return true; }
        }
      }]
    });
  }

  boot();
})();
