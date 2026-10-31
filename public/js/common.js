/* Salem — shared helpers for every page */
(function () {
  const S = (window.Salem = window.Salem || {});

  /* ---------- API */
  S.api = async function (method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      const err = new Error('network');
      err.code = 'network';
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'error');
      err.code = (data && data.error) || 'error';
      err.status = res.status;
      throw err;
    }
    return data;
  };

  S.errorText = function (e) {
    const key = 'err_' + (e && e.code ? e.code : 'error');
    const msg = S.t(key);
    return msg === key ? S.t('err_error') : msg;
  };

  /* ---------- Escaping & formatting */
  S.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const locale = () => (S.lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB');
  S.fmtTime = ts => ts ? new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '—';
  S.fmtDateTime = ts => ts ? new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  S.fmtDate = ts => ts ? new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  S.fmtDur = function (ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' ' + S.t('u_sec');
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ':' + String(r).padStart(2, '0') + ' ' + S.t('u_min');
    const h = Math.floor(m / 60);
    return h + ':' + String(m % 60).padStart(2, '0') + ' ' + S.t('u_hr');
  };
  S.fmtClock = function (ms) {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
  };
  S.ago = function (ts) {
    if (!ts) return '—';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return S.t('just_now');
    if (s < 60) return S.t('ago_s', { n: s });
    if (s < 3600) return S.t('ago_m', { n: Math.round(s / 60) });
    if (s < 86400) return S.t('ago_h', { n: Math.round(s / 3600) });
    return S.fmtDate(ts);
  };
  S.mapLink = (lat, lng) => (lat != null && lng != null) ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  S.durationLabel = function (min) {
    if (min < 60) return min + ' ' + S.t('u_min');
    const h = min / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + ' ' + (h === 1 ? S.t('u_hour1') : S.t('u_hours'));
  };

  /* ---------- Toast */
  S.toast = function (msg, kind) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  };

  /* ---------- Modal */
  S.modal = function ({ title, body, actions = [], wide = false, onClose }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <header><h2></h2><button class="btn ghost sm" data-close aria-label="${S.esc(S.t('close'))}">✕</button></header>
      <div class="content"></div>
      ${actions.length ? '<footer></footer>' : ''}
    </div>`;
    back.querySelector('h2').textContent = title;
    const content = back.querySelector('.content');
    if (typeof body === 'string') content.innerHTML = body; else if (body) content.appendChild(body);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    const footer = back.querySelector('footer');
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.addEventListener('click', async () => {
        if (!a.onClick) return close();
        b.disabled = true;
        try { const keep = await a.onClick({ close, el: back, button: b }); if (keep !== true) close(); }
        finally { b.disabled = false; }
      });
      footer.appendChild(b);
    });
    document.body.appendChild(back);
    const first = back.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return { el: back, close };
  };

  S.copy = async function (text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      S.toast(S.t('copied'));
    } catch (_) {
      const r = document.createRange();
      if (btn && btn.previousElementSibling) { r.selectNodeContents(btn.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); }
    }
  };

  S.logout = async function (to) {
    try { await S.api('POST', '/api/auth/logout'); } catch (_) {}
    location.href = to || '/';
  };

  /* ---------- Icons (inline SVG, stroke = currentColor) */
  const ico = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  S.icons = {
    logo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.2 4.5 6v5.6c0 4.3 3.1 8.2 7.5 9.2 4.4-1 7.5-4.9 7.5-9.2V6L12 3.2Z" fill="#36b487" fill-opacity=".25" stroke="#e8f6ef" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.6 12.2l2.4 2.4 4.5-4.8" stroke="#e8f6ef" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    live: ico('<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/>'),
    alert: ico('<path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
    users: ico('<path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/>'),
    history: ico('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    settings: ico('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    building: ico('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>'),
    eye: ico('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    exit: ico('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/><path d="M14 9.5 10 13.5M10 9.5l4 4"/>'),
    face: ico('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M3 3l18 18"/>'),
    stop: ico('<circle cx="12" cy="12" r="9"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
    pin: ico('<path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>'),
    speed: ico('<path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/>'),
    clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    send: ico('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>'),
    plus: ico('<path d="M12 5v14M5 12h14"/>'),
    menu: ico('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    globe: ico('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    camera: ico('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="13" r="3.5"/>'),
    check: ico('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
    shield: ico('<path d="M12 3 4.5 6v5.6c0 4.3 3.1 8.2 7.5 9.2 4.4-1 7.5-4.9 7.5-9.2V6L12 3Z"/>')
  };

  S.EVENT_META = {
    gaze: { pill: 'bad', icon: 'eye' },
    left_screen: { pill: 'warn', icon: 'exit' },
    face_lost: { pill: 'info', icon: 'face' },
    ended_early: { pill: 'warn', icon: 'stop' }
  };
  S.STATUS_PILL = { pending: 'warn', active: 'ok', completed: '', declined: 'bad', expired: '', cancelled: '', ended_early: 'bad' };

  S.scoreClass = s => s == null ? 'none' : s >= 85 ? 'good' : s >= 60 ? 'mid' : 'low';
})();
