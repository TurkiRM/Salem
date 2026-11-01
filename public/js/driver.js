/* Salem — driver screen */
(function () {
  const S = Salem;
  const $ = s => document.querySelector(s);

  const st = {
    me: null, company: null, request: null, resume: false,
    detector: null, stream: null, wakeLock: null, geoWatch: null,
    pos: { lat: null, lng: null, speed: 0, t: 0 },
    running: false, loopId: null, hbTimer: null, tickTimer: null,
    gazeStart: null, gazeEvent: null, offScreenSince: null,
    faceLostStart: null, faceEvent: null,
    hiddenAt: null, hiddenMoving: false,
    eventCount: 0, audio: null, lastBeep: 0, serverSkew: 0, ending: false
  };

  /* ---------- Screens */
  function show(name) {
    document.querySelectorAll('[data-scr]').forEach(s => (s.hidden = s.dataset.scr !== name));
    $('#logoutBtn').hidden = !(name === 'home');
    window.scrollTo(0, 0);
  }

  /* ---------- Boot */
  async function boot() {
    S.applyI18n();
    S.onLangChange = () => { if (!$('[data-scr="home"]').hidden) loadHome(); };
    $('#logoutBtn').onclick = () => S.logout('/driver');
    $('#loginForm').addEventListener('submit', login);
    $('#cAgree').onchange = e => ($('#cStart').disabled = !e.target.checked);
    $('#cBack').onclick = () => loadHome();
    $('#cStart').onclick = startSetup;
    $('#sCancel').onclick = () => { stopAll(); loadHome(); };
    $('#aEnd').onclick = confirmEnd;
    $('#dHome').onclick = () => loadHome();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', () => { if (st.running) beaconAway(); });
    try {
      const me = await S.api('GET', '/api/me');
      if (me.role !== 'driver') { show('login'); return; }
      st.me = me;
      loadHome();
    } catch (_) { show('login'); }
  }

  async function login(e) {
    e.preventDefault();
    $('#lErr').textContent = '';
    try {
      await S.api('POST', '/api/auth/driver-login', { company_code: $('#lCode').value, phone: $('#lPhone').value, pin: $('#lPin').value });
      st.me = await S.api('GET', '/api/me');
      loadHome();
    } catch (x) { $('#lErr').textContent = S.errorText(x); }
  }

  /* ---------- Home */
  let homePoll = null;
  async function loadHome() {
    clearInterval(homePoll);
    let d;
    try { d = await S.api('GET', '/api/driver/state'); } catch (x) { if (x.status === 401) return show('login'); S.toast(S.errorText(x), 'bad'); return; }
    st.company = d.company;
    st.serverSkew = Date.now() - d.server_time;
    $('#hName').textContent = d.driver.name;
    $('#hCompany').textContent = d.company.name + (d.driver.vehicle ? ' · ' + d.driver.vehicle : '');
    $('#topSub').textContent = d.company.name;
    const box = $('#hRequests');
    if (d.active) {
      box.innerHTML = `<div class="req-card alerting"><span class="pill ok live">${S.t('st_active')}</span>
        <div class="big">${S.t('session_running')}</div><p class="muted">${S.t('session_running_hint')}</p>
        <button class="btn primary lg block" id="resumeBtn">${S.t('resume')}</button></div>`;
      $('#resumeBtn').onclick = () => { st.request = d.active; st.resume = true; openConsent(); };
    } else if (d.pending.length) {
      box.innerHTML = d.pending.map(r => `<div class="req-card alerting">
        <span class="pill warn live">${S.t('new_request')}</span>
        <div><span class="label">${S.t('watch_for')}</span><div class="big">${S.durationLabel(r.duration_min)}</div></div>
        <p class="muted">${S.t('requested_by_x', { name: S.esc(r.supervisor_name || S.t('supervisor')) })} · ${S.ago(r.created_at + st.serverSkew)}</p>
        ${r.note ? `<div class="note">${S.esc(r.note)}</div>` : ''}
        ${r.test_mode ? `<span class="faint">${S.t('test_mode_short')}</span>` : ''}
        <div class="stack"><button class="btn primary lg block" data-accept="${r.id}">${S.t('accept')}</button>
        <button class="btn block" data-decline="${r.id}">${S.t('decline')}</button></div></div>`).join('');
      box.querySelectorAll('[data-accept]').forEach(b => b.onclick = () => {
        st.request = d.pending.find(r => r.id === Number(b.dataset.accept)); st.resume = false; openConsent();
      });
      box.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => {
        try { await S.api('POST', `/api/driver/requests/${b.dataset.decline}/decline`); loadHome(); } catch (x) { S.toast(S.errorText(x), 'bad'); }
      });
      buzz([200, 100, 200]);
    } else {
      box.innerHTML = `<div class="req-card"><div class="empty" style="padding:1.2rem">${S.icons.shield}<b>${S.t('no_requests')}</b><span>${S.t('no_requests_hint')}</span></div></div>`;
    }
    $('#hHistory').innerHTML = d.history.length ? `<p class="label" style="margin-bottom:.3rem">${S.t('recent_sessions')}</p>` + d.history.map(h =>
      `<div class="hist-row"><span>${S.fmtDateTime(h.started_at || h.ended_at)} · ${S.durationLabel(h.duration_min)}</span>
       <span><span class="pill ${S.STATUS_PILL[h.status] || ''}">${S.t('st_' + h.status)}</span> ${h.event_count ? `<b class="num" style="color:var(--bad)">${h.event_count}</b>` : ''}</span></div>`).join('') : '';
    show('home');
    homePoll = setInterval(() => { if (!$('[data-scr="home"]').hidden) loadHome(); else clearInterval(homePoll); }, 15000);
  }

  function openConsent() {
    clearInterval(homePoll);
    const r = st.request;
    $('#cSummary').innerHTML = `<span><span class="label">${S.t('watch_for')}</span><br><b>${S.durationLabel(r.duration_min)}</b></span>
      <span><span class="label">${S.t('rule')}</span><br><b>${r.test_mode ? st.company.gaze_seconds + ' ' + S.t('u_sec') + ' · ' + S.t('test_mode_short') : S.t('rule_text', { s: st.company.gaze_seconds, v: st.company.min_speed_kmh })}</b></span>`;
    $('#cAgree').checked = false; $('#cStart').disabled = true; $('#cErr').textContent = '';
    show('consent');
  }

  /* ---------- Setup: permissions, model, calibration */
  async function startSetup() {
    unlockAudio();
    show('setup');
    $('#sErr').textContent = '';
    $('#sGo').hidden = true;
    setCalib('', 0);
    $('#setupHint').textContent = '';
    $('#camMsg').textContent = S.t('opening_camera');

    if (!window.isSecureContext) { $('#sErr').textContent = S.t('err_https'); return; }
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: false });
    } catch (x) { $('#sErr').textContent = S.t('err_camera'); $('#camMsg').textContent = ''; return; }
    const v = $('#video');
    v.srcObject = st.stream; $('#miniVideo').srcObject = st.stream;
    try { await v.play(); } catch (_) {}

    startGeo();

    $('#camMsg').textContent = S.t('loading_model');
    try {
      if (!st.detector) {
        const mod = await import('/js/gaze.js');
        st.detector = new mod.GazeDetector();
        await st.detector.init();
      }
    } catch (x) { console.error(x); $('#sErr').textContent = S.t('err_model'); return; }
    $('#camMsg').textContent = '';
    runCalibration();
  }

  function startGeo() {
    if (!navigator.geolocation || st.geoWatch != null) return;
    st.geoWatch = navigator.geolocation.watchPosition(p => {
      const { latitude: lat, longitude: lng, speed } = p.coords;
      let kmh = speed != null && speed >= 0 ? speed * 3.6 : null;
      if (kmh == null && st.pos.lat != null) {
        const dt = (p.timestamp - st.pos.t) / 1000;
        if (dt > 0.5) kmh = haversine(st.pos.lat, st.pos.lng, lat, lng) / dt * 3.6;
      }
      st.pos = { lat, lng, speed: kmh == null ? st.pos.speed : kmh, t: p.timestamp };
    }, err => {
      if (err.code === 1) S.toast(S.t('err_location'), 'bad');
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function haversine(a1, o1, a2, o2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const da = r(a2 - a1), dn = r(o2 - o1);
    const h = Math.sin(da / 2) ** 2 + Math.cos(r(a1)) * Math.cos(r(a2)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function setCalib(text, pct) { $('#calibText').textContent = text; $('#calibBar').style.width = pct + '%'; }

  /** Collect feature samples for `ms` while showing a progress bar. Requires a visible face. */
  function collect(ms, label) {
    return new Promise(resolve => {
      const v = $('#video'), samples = [];
      let start = null, noFaceSince = performance.now();
      const step = () => {
        const t = performance.now();
        const r = st.detector.read(v, t);
        $('#camRing').className = 'cam-ring ' + (r.face ? 'ok' : 'bad');
        if (r.face) {
          noFaceSince = null;
          if (start == null) start = t;
          samples.push(r.f);
          setCalib(label, Math.min(100, (t - start) / ms * 100));
          $('#camMsg').textContent = '';
        } else {
          if (noFaceSince == null) noFaceSince = t;
          if (t - noFaceSince > 600) $('#camMsg').textContent = S.t('face_not_found');
        }
        if (start != null && t - start >= ms) return resolve(samples);
        st.loopId = requestAnimationFrame(step);
      };
      step();
    });
  }

  async function runCalibration() {
    $('#sTitle').textContent = S.t('calib_title');
    $('#setupHint').textContent = S.t('calib_mount');
    $('#sAlt').hidden = true;
    st.detector.resetLenses();
    await countdown(S.t('calib_get_ready'), 3);
    buzz(80);
    const screen = await collect(3000, S.t('calib_look_screen'));
    buzz([80, 80, 80]);
    await countdown(S.t('calib_now_road'), 2);
    const road = await collect(3000, S.t('calib_look_road'));
    buzz([80, 80, 80]);

    // Sunglasses seen during the first two steps: eyes can't be measured, calibrate head direction only
    if (st.detector.sunglasses) {
      buzz(150);
      const res = st.detector.calibrate(screen, road, null, true);
      if (!res.ok) {
        setCalib(S.t('calib_failed'), 0);
        $('#setupHint').textContent = S.t('calib_sun_failed_hint');
        $('#sGo').textContent = S.t('try_again'); $('#sGo').hidden = false;
        $('#sGo').onclick = () => { $('#sGo').hidden = true; runCalibration(); };
        return;
      }
      setCalib(S.t('calib_ok'), 100);
      $('#setupHint').textContent = S.t('calib_sun_ok');
      $('#sGo').textContent = st.resume ? S.t('resume') : S.t('start_watch');
      $('#sGo').hidden = false;
      $('#sGo').onclick = beginSession;
      return;
    }

    // Step 3: head stays on the road, only the eyes move to the phone (the sneaky glance)
    $('#setupHint').textContent = S.t('calib_glance_hint');
    await countdown(S.t('calib_now_glance'), 3);
    const glance = await collect(3000, S.t('calib_look_glance'));
    buzz(150);
    const res = st.detector.calibrate(screen, road, glance);
    if (!res.ok) {
      setCalib(S.t('calib_failed'), 0);
      $('#setupHint').textContent = S.t('calib_failed_hint');
      $('#sGo').textContent = S.t('try_again'); $('#sGo').hidden = false;
      $('#sGo').onclick = () => { $('#sGo').hidden = true; runCalibration(); };
      return;
    }
    if (!res.glanceOk) {
      // Normal looks work, but the eyes-only glance could not be told apart from the road
      setCalib(S.t('calib_partial'), 70);
      $('#setupHint').textContent = S.t('calib_partial_hint');
      $('#sGo').textContent = S.t('try_again'); $('#sGo').hidden = false;
      $('#sGo').onclick = () => { $('#sGo').hidden = true; $('#sAlt').hidden = true; runCalibration(); };
      $('#sAlt').textContent = S.t('continue_anyway'); $('#sAlt').hidden = false;
      $('#sAlt').onclick = () => { $('#sAlt').hidden = true; beginSession(); };
      return;
    }
    setCalib(S.t('calib_ok'), 100);
    $('#setupHint').textContent = '';
    $('#sGo').textContent = st.resume ? S.t('resume') : S.t('start_watch');
    $('#sGo').hidden = false;
    $('#sGo').onclick = beginSession;
  }

  function countdown(label, secs) {
    return new Promise(resolve => {
      let n = secs;
      const tick = () => {
        setCalib(`${label} ${n}`, 0);
        if (n-- <= 0) return resolve();
        setTimeout(tick, 1000);
      };
      tick();
    });
  }

  /* ---------- Session */
  async function beginSession() {
    $('#sGo').disabled = true;
    try {
      if (!st.resume) {
        const r = await S.api('POST', `/api/driver/requests/${st.request.id}/accept`);
        st.request.started_at = r.started_at; st.request.ends_at = r.ends_at;
      }
    } catch (x) {
      $('#sGo').disabled = false;
      $('#sErr').textContent = x.code === 'not_found' ? S.t('err_request_gone') : S.errorText(x);
      return;
    }
    $('#sGo').disabled = false;
    st.eventCount = 0; st.ending = false; st.mode = null;
    $('#aCount').textContent = '0';
    $('#aTest').hidden = !st.request.test_mode;
    show('active');
    st.running = true;
    requestWakeLock();
    loop();
    st.hbTimer = setInterval(heartbeat, 10000);
    st.tickTimer = setInterval(tick, 500);
    heartbeat();
  }

  const moving = () => !!(st.request && st.request.test_mode) || (st.pos.speed || 0) >= (st.company.min_speed_kmh || 0);

  function loop() {
    if (!st.running) return;
    const v = $('#video');
    const t = performance.now();
    if (!document.hidden && st.detector) {
      const r = st.detector.read(v, t);
      evaluate(r, Date.now());
    }
    // ~15 fps is plenty and saves battery
    st.loopId = setTimeout(() => requestAnimationFrame(loop), 50);
  }

  let lastUi = '';
  function evaluate(r, now) {
    const gazeMs = (st.company.gaze_seconds || 3) * 1000;
    const isMoving = moving();
    let onScreen = false;

    // Detection mode: 'eyes' (normal), 'head' (sunglasses), 'none' (sunglasses, head can't tell)
    const mode = r.face ? st.detector.mode() : (st.mode || 'eyes');
    if (st.mode && mode !== st.mode && !st.gazeEvent) { st.gazeStart = null; st.offScreenSince = null; }
    st.mode = mode;

    if (r.face) {
      onScreen = st.detector.isOnScreen(r.f);
      if (st.faceLostStart) { closeFaceEvent(now); }
      st.faceLostStart = null;
    } else {
      if (!st.faceLostStart) st.faceLostStart = now;
      if (isMoving && !st.faceEvent && now - st.faceLostStart >= (st.company.face_lost_seconds || 8) * 1000) {
        const ev = (st.faceEvent = { id: null, start: st.faceLostStart, pending: true });
        openEvent('face_lost', st.faceLostStart, {}).then(id => { ev.id = id; ev.pending = false; });
      }
    }
    st.detector.push(now, r.face ? r.f : null, onScreen);

    // Gaze dwell with a 400 ms grace so a blink does not reset the timer
    if (onScreen && isMoving) {
      st.offScreenSince = null;
      if (!st.gazeStart) st.gazeStart = now;
    } else if (st.gazeStart) {
      if (!st.offScreenSince) st.offScreenSince = now;
      if (now - st.offScreenSince > 400) { closeGazeEvent(now); st.gazeStart = null; st.offScreenSince = null; }
    }
    const dwell = st.gazeStart ? now - st.gazeStart : 0;
    if (st.gazeStart && dwell >= gazeMs && !st.gazeEvent) {
      st.gazeEvent = { id: null, start: st.gazeStart, pending: true };
      const pat = mode === 'eyes' ? st.detector.readingPattern(now, gazeMs) : { reading: false, saccades: 0 };
      openEvent('gaze', st.gazeStart, { reading: pat.reading, saccades: pat.saccades, threshold_s: gazeMs / 1000, sunglasses: mode !== 'eyes', mode })
        .then(id => { if (st.gazeEvent) { st.gazeEvent.id = id; st.gazeEvent.pending = false; } });
    }
    if (st.gazeEvent && now - st.lastBeep > 1200) { beep(); buzz(250); st.lastBeep = now; }

    // UI
    const ring = $('#statusRing');
    let cls, big, small, pct;
    if (!isMoving) { cls = 'idle'; big = S.t('parked'); small = S.t('parked_hint'); pct = 1; }
    else if (!r.face) { cls = 'warn'; big = S.t('face_not_found'); small = S.t('face_hint'); pct = 1; }
    else if (st.gazeEvent) { cls = 'bad'; big = S.t('look_at_road'); small = S.t('recorded'); pct = 1; }
    else if (dwell > 0) { cls = 'warn'; big = S.t('eyes_on_screen'); small = S.fmtClock(Math.max(0, gazeMs - dwell)).replace(/^0:/, '') + ' ' + S.t('u_sec'); pct = 1 - dwell / gazeMs; }
    else { cls = ''; big = S.t('eyes_on_road'); small = S.t('drive_safe'); pct = 1; }
    ring.className = 'status-ring ' + cls;
    $('#ringFg').style.strokeDashoffset = String(339.3 * (1 - pct));
    const key = cls + big + small;
    if (key !== lastUi) { $('#stBig').textContent = big; $('#stSmall').textContent = small; lastUi = key; }
    $('#flash').hidden = !st.gazeEvent;
    const badge = $('#aMode');
    badge.hidden = mode === 'eyes';
    if (mode !== 'eyes') { badge.textContent = S.t(mode === 'head' ? 'mode_head_driver' : 'mode_none_driver'); badge.className = 'mode-badge ' + mode; }
    st.uiState = !isMoving ? 'parked' : !r.face ? 'no_face' : 'watching';
    st.faceVisible = r.face;
  }

  function snapshot() {
    const v = $('#video');
    if (!v.videoWidth) return null;
    const w = 480, h = Math.round(v.videoHeight / v.videoWidth * w);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, w, h);
    // Burn-in timestamp & speed so the image stands on its own as evidence
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h - 26, w, 26);
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace';
    ctx.fillText(`${new Date().toLocaleString('en-GB')}  ${Math.round(st.pos.speed || 0)} km/h  SALEM`, 8, h - 9);
    return c.toDataURL('image/jpeg', 0.72);
  }

  async function openEvent(type, startedAt, details, durationMs) {
    st.eventCount++;
    $('#aCount').textContent = String(st.eventCount);
    try {
      const r = await S.api('POST', '/api/driver/events', {
        request_id: st.request.id, type, started_at: startedAt, duration_ms: durationMs || (Date.now() - startedAt),
        speed: st.pos.speed, lat: st.pos.lat, lng: st.pos.lng, snapshot: snapshot(), details
      });
      return r.id;
    } catch (_) { return null; }
  }

  async function closeGazeEvent(now) {
    const ev = st.gazeEvent;
    st.gazeEvent = null;
    $('#flash').hidden = true;
    if (!ev) return;
    // wait briefly if the create call is still in flight
    for (let i = 0; i < 20 && ev.pending; i++) await new Promise(r => setTimeout(r, 150));
    if (!ev.id) return;
    const pat = st.mode === 'eyes' ? st.detector.readingPattern(now, Math.min(6000, now - ev.start)) : { reading: false, saccades: 0 };
    S.api('PATCH', `/api/driver/events/${ev.id}`, { duration_ms: now - ev.start, details: { reading: pat.reading, saccades: pat.saccades } }).catch(() => {});
  }

  async function closeFaceEvent(now) {
    const ev = st.faceEvent;
    st.faceEvent = null;
    if (!ev) return;
    for (let i = 0; i < 20 && ev.pending; i++) await new Promise(r => setTimeout(r, 150));
    if (ev.id) S.api('PATCH', `/api/driver/events/${ev.id}`, { duration_ms: now - ev.start }).catch(() => {});
  }

  async function heartbeat() {
    if (!st.running) return;
    try {
      const r = await S.api('POST', '/api/driver/heartbeat', {
        request_id: st.request.id, lat: st.pos.lat, lng: st.pos.lng, speed: st.pos.speed,
        state: st.uiState || 'watching', face_visible: !!st.faceVisible,
        sunglasses: st.mode === 'head' || st.mode === 'none', mode: st.mode || 'eyes'
      });
      st.serverSkew = Date.now() - r.server_time;
      if (r.ends_at) st.request.ends_at = r.ends_at;
      if (r.status !== 'active') finish(r.status);
    } catch (x) {
      if (x.status === 401) { stopAll(); show('login'); }
    }
  }

  function tick() {
    if (!st.running) return;
    $('#aSpeed').textContent = String(Math.round(st.pos.speed || 0));
    const left = st.request.ends_at - (Date.now() - st.serverSkew);
    $('#aLeft').textContent = S.fmtClock(left);
    if (left <= 0) finish('completed');
  }

  /* Leaving the page while moving = probably using another app */
  function beaconAway() {
    try {
      const body = JSON.stringify({ request_id: st.request.id, lat: st.pos.lat, lng: st.pos.lng, speed: st.pos.speed, state: 'away', face_visible: false });
      navigator.sendBeacon('/api/driver/heartbeat', new Blob([body], { type: 'application/json' }));
    } catch (_) {}
  }

  async function onVisibility() {
    if (!st.running) return;
    if (document.hidden) {
      st.hiddenAt = Date.now();
      st.hiddenMoving = moving();
      closeGazeEvent(Date.now());
      st.gazeStart = null;
      beaconAway();
      return;
    }
    // Back on the page
    const away = st.hiddenAt ? Date.now() - st.hiddenAt : 0;
    const wasMoving = st.hiddenMoving || moving();
    const startedAt = st.hiddenAt;
    st.hiddenAt = null;
    requestWakeLock();
    await ensureCamera();
    if (wasMoving && away >= 3000 && startedAt) {
      setTimeout(() => openEvent('left_screen', startedAt, { returned: true }, away), 600);
    }
    heartbeat();
  }

  async function ensureCamera() {
    const track = st.stream && st.stream.getVideoTracks()[0];
    if (track && track.readyState === 'live') return;
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      $('#video').srcObject = st.stream; $('#miniVideo').srcObject = st.stream;
      await $('#video').play().catch(() => {});
    } catch (_) {}
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) st.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }

  function confirmEnd() {
    S.modal({
      title: S.t('end_session'),
      body: `<p>${S.t('end_confirm')}</p>`,
      actions: [{ label: S.t('continue_watch'), kind: 'primary' }, {
        label: S.t('end_now'), kind: 'danger', onClick: async () => {
          try { await S.api('POST', `/api/driver/requests/${st.request.id}/end`); } catch (_) {}
          finish('ended_early');
        }
      }]
    });
  }

  function finish(status) {
    if (st.ending) return;
    st.ending = true;
    const now = Date.now();
    closeGazeEvent(now); closeFaceEvent(now);
    stopAll();
    const map = { completed: 'done_completed', cancelled: 'done_cancelled', ended_early: 'done_ended_early', expired: 'done_cancelled' };
    $('#dText').textContent = S.t(map[status] || 'done_completed', { n: st.eventCount });
    show('done');
    buzz([100, 60, 100]);
  }

  function stopAll() {
    st.running = false;
    clearTimeout(st.loopId); cancelAnimationFrame(st.loopId);
    clearInterval(st.hbTimer); clearInterval(st.tickTimer);
    if (st.stream) st.stream.getTracks().forEach(t => t.stop());
    st.stream = null;
    if (st.geoWatch != null) { navigator.geolocation.clearWatch(st.geoWatch); st.geoWatch = null; }
    if (st.wakeLock) { st.wakeLock.release().catch(() => {}); st.wakeLock = null; }
    st.gazeStart = null; st.gazeEvent = null; st.faceLostStart = null; st.faceEvent = null;
    $('#flash').hidden = true;
  }

  /* ---------- Sound & vibration */
  function unlockAudio() {
    try { st.audio = st.audio || new (window.AudioContext || window.webkitAudioContext)(); st.audio.resume(); } catch (_) {}
  }
  function beep() {
    const a = st.audio; if (!a) return;
    try {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, a.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35);
      o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.4);
    } catch (_) {}
  }
  function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }

  boot();
})();
