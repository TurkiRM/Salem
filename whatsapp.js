/* Salem — WhatsApp messages through Meta's WhatsApp Cloud API
 *
 * Messages Salem starts itself (like a reminder) must use a message template that
 * Meta has approved. The template text is in the README; its four variables are:
 *   {{1}} driver name   {{2}} schedule name   {{3}} start time   {{4}} link to the driver page
 *
 * Settings (.env):
 *   WHATSAPP_TOKEN            permanent access token (System User token from Meta Business settings)
 *   WHATSAPP_PHONE_NUMBER_ID  the "Phone number ID" shown in WhatsApp Manager / the API setup page
 *   WHATSAPP_TEMPLATE         approved template name   (default: salem_session_reminder)
 *   WHATSAPP_TEMPLATE_LANG    template language code   (default: ar)
 *   WHATSAPP_DEFAULT_COUNTRY  country code for local numbers like 05xxxxxxxx (default: 966)
 *   WHATSAPP_API_VERSION      Graph API version        (default: v22.0)
 */

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TEMPLATE = process.env.WHATSAPP_TEMPLATE || 'salem_session_reminder';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';
const COUNTRY = String(process.env.WHATSAPP_DEFAULT_COUNTRY || '966').replace(/\D/g, '');
const VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0';
const BASE = (process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, ''); // override only for testing

function status() {
  return { enabled: !!(TOKEN && PHONE_ID), template: TEMPLATE, language: LANG, country: COUNTRY };
}

/* 0551112233 -> 966551112233, +966 55 111 2233 -> 966551112233, 00966… -> 966… */
function toInternational(phone) {
  let p = String(phone || '').trim();
  const plus = p.startsWith('+');
  p = p.replace(/\D/g, '');
  if (!p) return null;
  if (plus) return p;
  if (p.startsWith('00')) return p.slice(2);
  if (p.startsWith(COUNTRY)) return p;
  if (p.startsWith('0')) return COUNTRY + p.slice(1);
  if (COUNTRY === '966' && p.length === 9 && p.startsWith('5')) return COUNTRY + p;
  return p;
}

/* Template variables can't contain new lines, tabs or more than 4 spaces in a row */
const clean = v => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 300) || '-';

/* Send the approved template. Returns { id } on success; throws with Meta's error message on failure. */
async function sendTemplate(phone, params, opts = {}) {
  if (!TOKEN || !PHONE_ID) throw new Error('not_configured');
  const to = toInternational(phone);
  if (!to || to.length < 8) throw new Error('bad_phone');
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: opts.template || TEMPLATE,
      language: { code: opts.language || LANG },
      components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: clean(t) })) }]
    }
  };
  const res = await fetch(`${BASE}/${VERSION}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const e = data && data.error;
    const msg = e ? `${e.message}${e.error_data && e.error_data.details ? ' — ' + e.error_data.details : ''} (code ${e.code})` : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { id: data && data.messages && data.messages[0] && data.messages[0].id, to };
}

module.exports = { status, sendTemplate, toInternational };
