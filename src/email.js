// Email envoyé au professionnel après chaque appel (via Resend).
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Diago <onboarding@resend.dev>';
const BASE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const URG = { haute: 'Urgent', moyenne: 'Normal', basse: 'Pas pressé' };

export async function sendCallEmail(client, call) {
  if (!client.email) return false;
  const who = call.caller_name || call.caller_number || 'Numéro masqué';
  const subject = `${call.urgency === 'haute' ? '🔴 Urgent — ' : ''}Nouvel appel : ${who}`;
  const link = BASE ? `${BASE}/?t=${client.token}#call-${call.id}` : '';
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#1f2a3d">
    <p style="font-size:13px;color:#5d6879;margin:0 0 4px">Diago · ${esc(client.name)}</p>
    <h2 style="margin:0 0 14px;font-size:20px">${esc(who)}</h2>
    <p style="background:#f3f2ee;border-radius:14px;padding:14px;margin:0 0 10px">${esc(call.summary)}</p>
    <p style="background:rgba(47,94,69,.1);color:#2f5e45;border-radius:14px;padding:14px;margin:0 0 14px"><b>À faire :</b> ${esc(call.next_action)}</p>
    <table style="font-size:14px;color:#5d6879;border-spacing:0 4px">
      <tr><td style="padding-right:14px">Numéro</td><td style="color:#1f2a3d">${esc(call.caller_number || '—')}</td></tr>
      <tr><td>Urgence</td><td style="color:#1f2a3d">${URG[call.urgency] || '—'}</td></tr>
      ${call.callback_before ? `<tr><td>Rappeler</td><td style="color:#1f2a3d">${esc(call.callback_before)}</td></tr>` : ''}
      ${call.address ? `<tr><td>Lieu</td><td style="color:#1f2a3d">${esc(call.address)}</td></tr>` : ''}
      ${call.diagnostics ? `<tr><td>Diagnostics</td><td style="color:#1f2a3d">${esc(call.diagnostics)}</td></tr>` : ''}
    </table>
    ${link ? `<p style="margin:20px 0"><a href="${link}" style="background:#2f5e45;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">Ouvrir dans Diago</a></p>` : ''}
  </div>`;

  if (!KEY) {
    console.log(`[email] (pas de clé Resend) → ${client.email} : ${subject}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: client.email.split(',').map((s) => s.trim()), subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return true;
  } catch (err) {
    console.warn('[email] échec :', err.message);
    return false;
  }
}
