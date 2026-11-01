/* Salem — email notifications
 *
 * Two ways to send, chosen from .env:
 *   1. Resend (https://resend.com) — RESEND_API_KEY. Works on hosts that block email ports (e.g. Render free).
 *   2. SMTP (Gmail, Outlook, Zoho, your host…) — SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 * If neither is set, emails are skipped and only logged; everything else keeps working.
 *
 * Every email is written in Arabic first, then English.
 */
const nodemailer = require('nodemailer');

const FROM = process.env.EMAIL_FROM || '';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const SMTP_HOST = process.env.SMTP_HOST || '';

let transport = null;
if (!RESEND_KEY && SMTP_HOST) {
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || (port === 465)) === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
  });
}

function provider() {
  if (RESEND_KEY) return 'resend';
  if (transport) return 'smtp';
  return null;
}

function status() {
  return { enabled: !!provider() && !!FROM, provider: provider(), from: FROM || null };
}

async function send({ to, subject, html, text, replyTo }) {
  const p = provider();
  if (!p || !FROM) {
    console.log(`[salem] email skipped (not configured): "${subject}" -> ${to}`);
    return { sent: false, reason: 'not_configured' };
  }
  if (p === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text, reply_to: replyTo || undefined })
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return { sent: true };
  }
  await transport.sendMail({ from: FROM, to, subject, html, text, replyTo });
  return { sent: true };
}

/* Send without making the visitor wait; failures are logged, never shown to them */
function sendLater(msg) {
  send(msg).catch(e => console.error(`[salem] email failed ("${msg.subject}" -> ${msg.to}):`, e.message));
}

/* ---------- Templates */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ ar, en }) {
  const block = (b, dir) => `
    <div dir="${dir}" style="text-align:${dir === 'rtl' ? 'right' : 'left'};padding:24px 28px;${dir === 'ltr' ? 'border-top:1px solid #e3e8e5;' : ''}">
      <h1 style="margin:0 0 12px;font-size:20px;color:#15211d">${b.title}</h1>
      ${b.body}
      ${b.button ? `<p style="margin:20px 0 4px"><a href="${esc(b.button.url)}" style="display:inline-block;background:#0b6b4f;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">${b.button.label}</a></p>` : ''}
    </div>`;
  return `<!doctype html><html><body style="margin:0;background:#eef1ef;font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.6;color:#15211d">
  <div style="max-width:560px;margin:0 auto;padding:24px 12px">
    <div style="background:#10201b;color:#ffffff;padding:16px 28px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">سالم · Salem</div>
    <div style="background:#ffffff;border-radius:0 0 12px 12px;overflow:hidden">${block(ar, 'rtl')}${block(en, 'ltr')}</div>
    <p style="text-align:center;color:#7d8a85;font-size:12px;margin-top:14px">Salem — العين على الطريق · Eyes on the road</p>
  </div></body></html>`;
}

function table(rows, dir) {
  return `<table dir="${dir}" style="border-collapse:collapse;width:100%;margin:8px 0">${rows.filter(r => r[1]).map(([k, v]) =>
    `<tr><td style="padding:6px 0;color:#7d8a85;width:42%;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${ltr(v)}</td></tr>`).join('')}</table>`;
}

/* Wrap URLs, emails and numbers so Arabic (right-to-left) text doesn't flip them */
function ltr(v) {
  const str = String(v);
  return /^(<a |[\w.+-]+@|[+\d\s]+$|<span style="font-family:monospace)/.test(str) ? `<span dir="ltr" style="unicode-bidi:embed">${str}</span>` : str;
}

function textOf(lines) { return lines.filter(Boolean).join('\n'); }

const T = {
  /* To the platform admin: a company registered */
  adminNewRegistration(c, appUrl) {
    const url = `${appUrl}/admin#requests`;
    const rowsAr = [['الشركة', esc(c.name)], ['السجل التجاري', esc(c.cr_number)], ['المدينة', esc(c.city)], ['عدد السائقين', esc(c.fleet_size)],
      ['المسؤول', esc(c.contact_name)], ['البريد', esc(c.contact_email)], ['الجوال', esc(c.contact_phone)], ['ملاحظات', esc(c.reg_note)]];
    const rowsEn = [['Company', esc(c.name)], ['CR number', esc(c.cr_number)], ['City', esc(c.city)], ['Drivers', esc(c.fleet_size)],
      ['Contact', esc(c.contact_name)], ['Email', esc(c.contact_email)], ['Phone', esc(c.contact_phone)], ['Notes', esc(c.reg_note)]];
    return {
      subject: `طلب تسجيل جديد: ${c.name} | New registration`,
      html: layout({
        ar: { title: 'طلب تسجيل شركة جديد', body: `<p>سجّلت شركة جديدة في سالم وتنتظر موافقتك.</p>${table(rowsAr, 'rtl')}`, button: { url, label: 'مراجعة الطلب' } },
        en: { title: 'New company registration', body: `<p>A new company registered on Salem and is waiting for your approval.</p>${table(rowsEn, 'ltr')}`, button: { url, label: 'Review request' } }
      }),
      text: textOf(['طلب تسجيل شركة جديد / New company registration', '', c.name, c.cr_number && 'CR: ' + c.cr_number, 'City: ' + c.city,
        c.fleet_size && 'Drivers: ' + c.fleet_size, 'Contact: ' + c.contact_name, c.contact_email, c.contact_phone, c.reg_note, '', url])
    };
  },

  /* To the company: request received */
  companyReceived(c, appUrl) {
    return {
      subject: 'استلمنا طلب تسجيل شركتك في سالم | We received your registration',
      html: layout({
        ar: { title: `أهلاً ${esc(c.contact_name)}`, body: `<p>استلمنا طلب تسجيل <b>${esc(c.name)}</b> في سالم. سيراجع فريقنا البيانات، وسنرسل لك رسالة عند تفعيل الحساب.</p>` },
        en: { title: `Hello ${esc(c.contact_name)}`, body: `<p>We received the registration for <b>${esc(c.name)}</b> on Salem. Our team will review it and email you when the account is activated.</p>` }
      }),
      text: textOf([`أهلاً ${c.contact_name}`, `استلمنا طلب تسجيل ${c.name} في سالم. سنرسل لك رسالة عند تفعيل الحساب.`, '',
        `Hello ${c.contact_name}`, `We received the registration for ${c.name} on Salem. We'll email you when the account is activated.`, '', appUrl])
    };
  },

  /* To the company: approved */
  companyApproved(c, appUrl, note) {
    const login = `${appUrl}/`, driver = `${appUrl}/driver`;
    const rowsAr = [['رابط الدخول', `<a href="${esc(login)}">${esc(login)}</a>`], ['البريد', esc(c.contact_email)], ['رمز الشركة', `<span style="font-family:monospace;font-size:17px;letter-spacing:2px">${esc(c.code)}</span>`], ['رابط السائقين', `<a href="${esc(driver)}">${esc(driver)}</a>`]];
    const rowsEn = [['Sign in', `<a href="${esc(login)}">${esc(login)}</a>`], ['Email', esc(c.contact_email)], ['Company code', `<span style="font-family:monospace;font-size:17px;letter-spacing:2px">${esc(c.code)}</span>`], ['Driver link', `<a href="${esc(driver)}">${esc(driver)}</a>`]];
    return {
      subject: `تم تفعيل حساب ${c.name} في سالم | Your Salem account is active`,
      html: layout({
        ar: { title: 'تم تفعيل حسابك', body: `<p>تمت الموافقة على تسجيل <b>${esc(c.name)}</b>. ادخل بالبريد وكلمة المرور التي اخترتها، ثم أضف سائقيك وأرسل لهم رمز الشركة.</p>${table(rowsAr, 'rtl')}${note ? `<p style="color:#4c5a55">${esc(note)}</p>` : ''}`, button: { url: login, label: 'الدخول إلى سالم' } },
        en: { title: 'Your account is active', body: `<p><b>${esc(c.name)}</b> has been approved. Sign in with the email and password you chose, then add your drivers and send them the company code.</p>${table(rowsEn, 'ltr')}`, button: { url: login, label: 'Sign in to Salem' } }
      }),
      text: textOf([`تم تفعيل حساب ${c.name} في سالم.`, `الدخول: ${login}`, `رمز الشركة: ${c.code}`, `رابط السائقين: ${driver}`, note, '',
        `${c.name} is now active on Salem.`, `Sign in: ${login}`, `Company code: ${c.code}`, `Driver link: ${driver}`])
    };
  },

  /* To the company: rejected */
  companyRejected(c, appUrl, note) {
    return {
      subject: `بخصوص طلب تسجيل ${c.name} في سالم | About your Salem registration`,
      html: layout({
        ar: { title: 'لم تتم الموافقة على الطلب', body: `<p>نعتذر، لم تتم الموافقة على طلب تسجيل <b>${esc(c.name)}</b> حالياً.</p>${note ? `<p><b>السبب:</b> ${esc(note)}</p>` : ''}<p>يمكنك الرد على هذه الرسالة للاستفسار.</p>` },
        en: { title: 'Registration not approved', body: `<p>Sorry, the registration for <b>${esc(c.name)}</b> was not approved at this time.</p>${note ? `<p><b>Reason:</b> ${esc(note)}</p>` : ''}<p>You can reply to this email with any questions.</p>` }
      }),
      text: textOf([`لم تتم الموافقة على طلب تسجيل ${c.name}.`, note && `السبب: ${note}`, '', `The registration for ${c.name} was not approved.`, note && `Reason: ${note}`])
    };
  },

  /* Test message from the admin dashboard */
  test(appUrl) {
    return {
      subject: 'رسالة تجربة من سالم | Salem test email',
      html: layout({
        ar: { title: 'إعداد البريد يعمل', body: '<p>هذه رسالة تجربة من لوحة إدارة سالم. إشعارات التسجيل والقبول ستصل بهذا الشكل.</p>', button: { url: `${appUrl}/admin`, label: 'لوحة الإدارة' } },
        en: { title: 'Email is set up', body: '<p>This is a test message from the Salem admin dashboard. Registration and approval emails will look like this.</p>' }
      }),
      text: 'إعداد البريد يعمل / Email is set up'
    };
  }
};

module.exports = { send, sendLater, status, T };
