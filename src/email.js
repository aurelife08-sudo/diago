// Email envoyé au professionnel après chaque appel (via Resend).
const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Diago <onboarding@resend.dev>';
const BASE = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const URG = { haute: 'Urgent', moyenne: 'Normal', basse: 'Pas pressé' };

export async function sendCallEmail(client, call, quote = null) {
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
    ${quote ? `<p style="background:#f3f2ee;border-radius:14px;padding:14px;margin:14px 0 0"><b>Devis préparé :</b> ${esc(quote.number)} · ${(Number(quote.total_ttc) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € TTC — à vérifier et envoyer depuis l'onglet Devis.</p>` : ''}
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

/** Code de connexion à 6 chiffres envoyé au cabinet. Retourne true si l'email est parti. */
export async function sendLoginCode(client, code) {
  if (!client.email) return false;
  const subject = `${code} — votre code de connexion Diago`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;color:#1f2a3d">
    <p style="font-size:13px;color:#5d6879;margin:0 0 4px">Diago · ${esc(client.name)}</p>
    <h2 style="margin:0 0 14px;font-size:20px">Votre code de connexion</h2>
    <p style="font-size:34px;letter-spacing:8px;font-weight:700;background:#f3f2ee;border-radius:14px;padding:16px;text-align:center;margin:0 0 14px">${esc(code)}</p>
    <p style="color:#5d6879;font-size:14px">Ce code est valable 10 minutes. Si vous n'avez pas demandé de code, ignorez cet email : personne ne peut ouvrir votre Diago sans lui.</p>
  </div>`;
  if (!KEY) {
    console.log(`[email] (pas de clé Resend) code de connexion pour ${client.name} → ${client.email} : ${code}`);
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
    console.warn('[email] code de connexion non envoyé :', err.message);
    return false;
  }
}

/** Envoie le devis au client final. Retourne { ok } ou { ok: false, error }. */
export async function sendQuoteEmail(client, quote, settings) {
  if (!quote.customer_email) return { ok: false, error: "Pas d'adresse email pour ce client" };
  if (!KEY) return { ok: false, error: "L'envoi d'emails n'est pas encore configuré (clé Resend manquante)" };
  const co = settings.company || {};
  const name = co.legal_name || client.name;
  const link = `${BASE}/d/${quote.token}`;
  const ttc = (Number(quote.total_ttc) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:auto;color:#1f2a3d">
    <p>Bonjour${quote.customer_name ? ` ${esc(quote.customer_name)}` : ''},</p>
    <p>Suite à votre appel, voici notre devis pour vos diagnostics immobiliers${quote.address ? ` (${esc(quote.address)})` : ''}.</p>
    <p style="background:#f3f2ee;border-radius:14px;padding:14px;margin:16px 0"><b>Devis ${esc(quote.number)}</b><br>Montant : <b>${ttc} € TTC</b></p>
    <p style="margin:22px 0"><a href="${link}" style="background:#2f5e45;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">Voir et accepter le devis</a></p>
    <p>Pour toute question, répondez simplement à cet email${co.phone ? ` ou appelez le ${esc(co.phone)}` : ''}.</p>
    <p>Bien cordialement,<br>${esc(name)}</p>
  </div>`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: FROM.replace(/^[^<]*</, `${name.replace(/[<>"]/g, '')} <`), to: [quote.customer_email],
        reply_to: co.email || (client.email || '').split(',')[0].trim() || undefined,
        subject: `Votre devis ${quote.number} — ${name}`, html,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 403 && /verify a domain|testing emails/i.test(t)) {
        console.warn('[email devis] domaine d\'envoi non vérifié dans Resend');
        return { ok: false, error: "Envoi par email pas encore activé (domaine d'envoi à vérifier dans Resend)" };
      }
      throw new Error(`HTTP ${res.status} ${t.slice(0, 200)}`);
    }
    return { ok: true };
  } catch (err) {
    console.warn('[email devis] échec :', err.message);
    return { ok: false, error: "L'email n'a pas pu partir" };
  }
}
