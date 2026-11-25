// Devis : tarifs du cabinet, devis préparé automatiquement après chaque appel, page client.
import crypto from 'node:crypto';
import { one, all } from './db.js';
import { parseDiags } from './booking.js';

export const DIAG_LIST = ['DPE', 'Amiante', 'Plomb', 'Électricité', 'Gaz', 'Termites', 'Carrez', 'Boutin', 'ERP', 'Audit énergétique'];
const LABEL = {
  DPE: 'Diagnostic de performance énergétique (DPE)',
  Amiante: 'Repérage amiante',
  Plomb: 'Constat de risque d\'exposition au plomb (CREP)',
  'Électricité': 'Diagnostic électricité',
  Gaz: 'Diagnostic gaz',
  Termites: 'État relatif à la présence de termites',
  Carrez: 'Mesurage loi Carrez',
  Boutin: 'Mesurage surface habitable (loi Boutin)',
  ERP: 'État des risques et pollutions (ERP)',
  'Audit énergétique': 'Audit énergétique',
};

// Tarifs d'exemple (HT) tant que le cabinet n'a pas saisi les siens
export const DEFAULT_SETTINGS = {
  configured: false,
  prices: {
    DPE: { appartement: 110, maison: 140 }, Amiante: { appartement: 90, maison: 120 }, Plomb: { appartement: 90, maison: 120 },
    'Électricité': { appartement: 80, maison: 100 }, Gaz: { appartement: 80, maison: 100 }, Termites: { appartement: 70, maison: 90 },
    Carrez: { appartement: 50, maison: 70 }, Boutin: { appartement: 50, maison: 70 }, ERP: { appartement: 20, maison: 20 },
    'Audit énergétique': { appartement: 450, maison: 650 },
  },
  pack_min: 3, pack_pct: 15,           // remise dès 3 diagnostics
  large_m2: 150, large_pct: 20,        // majoration grande surface
  travel_fee: 0, tva_rate: 20, validity_days: 30,
  company: { legal_name: '', siret: '', address: '', phone: '', email: '', mentions: '' },
};

export function settingsOf(client) {
  const s = client.quote_settings || {};
  const prices = {};
  for (const d of DIAG_LIST) prices[d] = { ...DEFAULT_SETTINGS.prices[d], ...(s.prices?.[d] || {}) };
  return { ...DEFAULT_SETTINGS, ...s, prices, company: { ...DEFAULT_SETTINGS.company, ...(s.company || {}) } };
}

export function cleanSettings(b, prev) {
  const num = (v, d, min = 0, max = 100000) => { if (v === undefined || v === null || String(v).trim() === '') return d; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : d; };
  const cur = settingsOf({ quote_settings: prev });
  const prices = {};
  for (const d of DIAG_LIST) prices[d] = { appartement: num(b.prices?.[d]?.appartement, cur.prices[d].appartement), maison: num(b.prices?.[d]?.maison, cur.prices[d].maison) };
  const str = (v, d, n = 300) => (v === undefined ? d : String(v || '').trim().slice(0, n));
  const c = b.company || {};
  return {
    configured: true, prices,
    pack_min: num(b.pack_min, cur.pack_min, 0, 10), pack_pct: num(b.pack_pct, cur.pack_pct, 0, 90),
    large_m2: num(b.large_m2, cur.large_m2, 0, 10000), large_pct: num(b.large_pct, cur.large_pct, 0, 300),
    travel_fee: num(b.travel_fee, cur.travel_fee), tva_rate: num(b.tva_rate, cur.tva_rate, 0, 30), validity_days: num(b.validity_days, cur.validity_days, 1, 365),
    company: {
      legal_name: str(c.legal_name, cur.company.legal_name, 120), siret: str(c.siret, cur.company.siret, 30), address: str(c.address, cur.company.address),
      phone: str(c.phone, cur.company.phone, 30), email: str(c.email, cur.company.email, 120), mentions: str(c.mentions, cur.company.mentions, 1000),
    },
  };
}

/**
 * Diagnostics à prévoir. Si le client les a cités, on les garde ; sinon on déduit la liste habituelle
 * (vente ou location) d'après le type de bien et l'année : à confirmer par le diagnostiqueur.
 */
export function guessDiagnostics({ diagnostics, transaction, property_type, build_year }) {
  const said = parseDiags(diagnostics);
  if (said.length) return { list: said, guessed: false };
  if (transaction !== 'vente' && transaction !== 'location') return { list: [], guessed: true };
  const y = Number(build_year) || null;
  const list = ['DPE', 'ERP'];
  if (!y || y < 2011) list.push('Électricité');
  if (!y || y < 1949) list.push('Plomb');
  if (transaction === 'vente') {
    if (!y || y < 1997) list.push('Amiante');
    if (property_type === 'appartement') list.push('Carrez');
  } else list.push('Boutin');
  return { list: DIAG_LIST.filter((d) => list.includes(d)), guessed: true };
}

/** Lignes de devis calculées avec les tarifs du cabinet. */
export function buildLines(settings, { diags, property_type, surface_m2 }) {
  const kind = property_type === 'maison' ? 'maison' : 'appartement';
  const big = Number(surface_m2) > settings.large_m2 && settings.large_pct > 0 ? 1 + settings.large_pct / 100 : 1;
  const lines = diags.map((d) => ({ label: LABEL[d] || d, qty: 1, unit_ht: Math.round((settings.prices[d]?.[kind] ?? 0) * (d === 'ERP' ? 1 : big) * 100) / 100 }));
  if (settings.travel_fee > 0) lines.push({ label: 'Frais de déplacement', qty: 1, unit_ht: settings.travel_fee });
  return lines;
}

export function cleanLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.slice(0, 40).map((l) => ({
    label: String(l.label || '').trim().slice(0, 200),
    qty: Math.max(0, Math.min(999, Number(l.qty) || 0)),
    unit_ht: Math.max(-100000, Math.min(100000, Math.round((Number(String(l.unit_ht).replace(',', '.')) || 0) * 100) / 100)),
  })).filter((l) => l.label);
}

export function totals(q) {
  const sub = (q.lines || []).reduce((s, l) => s + l.qty * l.unit_ht, 0);
  const discount = Math.round(sub * (Number(q.discount_pct) || 0)) / 100;
  const ht = Math.round((sub - discount) * 100) / 100;
  const tva = Math.round(ht * (Number(q.tva_rate) || 0)) / 100;
  return { sub: Math.round(sub * 100) / 100, discount, ht, tva, ttc: Math.round((ht + tva) * 100) / 100 };
}

async function nextNumber(clientId) {
  const year = new Date().getFullYear();
  const r = await one(`SELECT COALESCE(MAX(SUBSTRING(number FROM '-(\\d+)$')::int), 0) AS n FROM quotes WHERE client_id = $1 AND number LIKE $2`, [clientId, `D${year}-%`]);
  return `D${year}-${String((r?.n || 0) + 1).padStart(4, '0')}`;
}
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const QUOTE_FIELDS = `id, call_id, number, token, status, source, customer_name, customer_email, customer_phone, address, property_type,
  surface_m2, build_year, transaction, diagnostics, guessed, lines, discount_pct, tva_rate, notes, total_ht, total_ttc, valid_until,
  sent_at, accepted_at, refused_at, created_at, updated_at`;

/** Enregistre un devis (création ou mise à jour). */
export async function saveQuote(client, data, id = null) {
  const s = settingsOf(client);
  const lines = cleanLines(data.lines);
  const discount_pct = Math.max(0, Math.min(100, Number(data.discount_pct) || 0));
  const tva_rate = Math.max(0, Math.min(30, data.tva_rate == null || data.tva_rate === '' ? s.tva_rate : Number(data.tva_rate)));
  const t = totals({ lines, discount_pct, tva_rate });
  const v = [
    String(data.customer_name || '').trim().slice(0, 120) || null, String(data.customer_email || '').trim().toLowerCase().slice(0, 160) || null,
    data.customer_phone ? String(data.customer_phone).slice(0, 30) : null, String(data.address || '').trim().slice(0, 300) || null,
    ['appartement', 'maison', 'local', 'autre'].includes(data.property_type) ? data.property_type : null,
    Number(data.surface_m2) > 0 ? Math.round(Number(data.surface_m2)) : null, Number(data.build_year) > 1000 ? Math.round(Number(data.build_year)) : null,
    ['vente', 'location', 'travaux', 'autre'].includes(data.transaction) ? data.transaction : null,
    Array.isArray(data.diagnostics) ? data.diagnostics.join(', ') : data.diagnostics || null,
    JSON.stringify(lines), discount_pct, tva_rate, data.notes ? String(data.notes).slice(0, 2000) : null, t.ht, t.ttc,
  ];
  if (id) {
    return one(`UPDATE quotes SET customer_name=$3, customer_email=$4, customer_phone=$5, address=$6, property_type=$7, surface_m2=$8, build_year=$9,
        transaction=$10, diagnostics=$11, lines=$12, discount_pct=$13, tva_rate=$14, notes=$15, total_ht=$16, total_ttc=$17, guessed=FALSE, updated_at=NOW()
      WHERE id=$1 AND client_id=$2 RETURNING ${QUOTE_FIELDS}`, [id, client.id, ...v]);
  }
  return one(`INSERT INTO quotes (client_id, call_id, number, token, status, source, customer_name, customer_email, customer_phone, address, property_type,
      surface_m2, build_year, transaction, diagnostics, lines, discount_pct, tva_rate, notes, total_ht, total_ttc, valid_until, guessed)
    VALUES ($1,$2,$3,$4,'a_valider',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING ${QUOTE_FIELDS}`,
  [client.id, data.call_id || null, await nextNumber(client.id), crypto.randomBytes(16).toString('base64url'), data.source || 'manuel', ...v,
    addDays(s.validity_days), !!data.guessed]);
}

/** Après un appel : prépare un devis si la demande concerne des diagnostics. */
export async function quoteFromCall(client, call, ai) {
  if (!call || call.is_spam) return null;
  if (await one('SELECT 1 FROM quotes WHERE call_id = $1', [call.id])) return null;
  const g = guessDiagnostics(ai);
  const wanted = ['devis', 'rendez_vous', 'urgence'].includes(ai.request_type) || g.list.length > 0;
  if (!wanted || !g.list.length) return null;
  const s = settingsOf(client);
  const lines = buildLines(s, { diags: g.list, property_type: ai.property_type, surface_m2: ai.surface_m2 });
  const notes = g.guessed
    ? 'Liste des diagnostics établie d\'après les informations données au téléphone, à confirmer avec le diagnostiqueur.'
    : null;
  return saveQuote(client, {
    call_id: call.id, source: 'agent', guessed: g.guessed,
    customer_name: ai.caller_name, customer_email: ai.email, customer_phone: call.caller_number, address: ai.address,
    property_type: ai.property_type, surface_m2: ai.surface_m2, build_year: ai.build_year, transaction: ai.transaction,
    diagnostics: g.list, lines, discount_pct: g.list.length >= s.pack_min && s.pack_pct ? s.pack_pct : 0, tva_rate: s.tva_rate, notes,
  });
}

export async function listQuotes(clientId) {
  return all(`SELECT ${QUOTE_FIELDS} FROM quotes WHERE client_id = $1 ORDER BY (status = 'a_valider') DESC, created_at DESC LIMIT 300`, [clientId]);
}

// ---------- Page du devis (vue par le client final) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const eur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '');
const tel = (n) => { const m = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(n || ''); return m ? `0${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : n || ''; };
const TYPE_FR = { appartement: 'Appartement', maison: 'Maison', local: 'Local', autre: 'Bien' };
const TR_FR = { vente: 'vente', location: 'location', travaux: 'travaux', autre: '' };

export function quotePage(client, qt, { justAccepted = false } = {}) {
  const s = settingsOf(client), co = s.company, t = totals(qt);
  const name = co.legal_name || client.name;
  const bien = [TYPE_FR[qt.property_type], qt.surface_m2 ? `${qt.surface_m2} m²` : '', qt.build_year ? `construit vers ${qt.build_year}` : '', qt.transaction && TR_FR[qt.transaction] ? `pour ${TR_FR[qt.transaction]}` : ''].filter(Boolean).join(' · ');
  const state = qt.status === 'accepte' ? `<div class="ok">Devis accepté le ${frDate(qt.accepted_at)}. Merci, ${esc(name)} vous recontacte pour fixer le rendez-vous.</div>`
    : qt.status === 'refuse' ? '<div class="ko">Ce devis n\'est plus valable.</div>'
    : qt.status === 'apercu' ? '<div class="note noprint">Aperçu : le client verra ici un bouton « Accepter le devis ».</div>'
    : qt.valid_until && new Date(qt.valid_until + 'T23:59:59') < new Date() ? '<div class="ko">Ce devis a expiré. Contactez le cabinet pour un nouveau devis.</div>'
    : `<form method="post" action="/d/${esc(qt.token)}/accepter" class="noprint"><button class="btn">Accepter le devis</button></form>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Devis ${esc(qt.number)} · ${esc(name)}</title>
<style>
:root{--ink:#1f2a3d;--muted:#5d6879;--line:#e6e3dc;--accent:#2f5e45}
*{box-sizing:border-box}body{margin:0;background:#f3f2ee;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
.page{max-width:780px;margin:24px auto;background:#fff;border-radius:22px;padding:clamp(20px,5vw,44px);box-shadow:0 10px 30px -12px rgba(0,0,0,.15)}
.head{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:18px}
h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}.muted{color:var(--muted);font-size:13.5px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.parties b{display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:2px}
table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:top}td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.tot{margin-left:auto;width:min(320px,100%);margin-top:14px}.tot div{display:flex;justify-content:space-between;padding:4px 6px}.tot .big{font-size:20px;font-weight:700;border-top:2px solid var(--ink);margin-top:6px;padding-top:10px}
.note{background:#f6f4ef;border-radius:14px;padding:12px 14px;margin-top:18px;font-size:14px;color:var(--muted)}
.btn{display:block;width:100%;margin-top:22px;height:50px;border:0;border-radius:999px;background:linear-gradient(180deg,#356a4e,#2b573f);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.ok,.ko{margin-top:22px;padding:14px 16px;border-radius:14px;font-weight:600}.ok{background:rgba(47,94,69,.1);color:var(--accent)}.ko{background:rgba(217,75,97,.1);color:#b23a4e}
.print{background:none;border:0;color:var(--accent);font-weight:600;cursor:pointer;margin-top:10px;font-size:14px}
.foot{margin-top:26px;font-size:12px;color:var(--muted);white-space:pre-line}
@media(max-width:560px){.parties{grid-template-columns:1fr}th.u,td.u{display:none}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;border-radius:0}.noprint{display:none}}
</style></head><body><main class="page">
${justAccepted ? '<div class="ok" style="margin:0 0 18px">Merci, votre accord a bien été transmis au cabinet.</div>' : ''}
<div class="head"><div><h1>${esc(name)}</h1><div class="muted">${[co.address, co.phone, co.email].filter(Boolean).map(esc).join('<br>')}${co.siret ? `<br>SIRET ${esc(co.siret)}` : ''}</div></div>
<div style="text-align:right"><h1>Devis</h1><div class="muted">N° ${esc(qt.number)}<br>Du ${frDate(qt.created_at)}${qt.valid_until ? `<br>Valable jusqu'au ${frDate(qt.valid_until)}` : ''}</div></div></div>
<div class="parties"><div><b>Client</b>${esc(qt.customer_name || '—')}${qt.customer_email ? `<br>${esc(qt.customer_email)}` : ''}${qt.customer_phone ? `<br>${esc(tel(qt.customer_phone))}` : ''}</div>
<div><b>Bien</b>${esc(qt.address || '—')}${bien ? `<br><span class="muted">${esc(bien)}</span>` : ''}</div></div>
<table><thead><tr><th>Désignation</th><th class="n u">Qté</th><th class="n u">Prix HT</th><th class="n">Total HT</th></tr></thead><tbody>
${(qt.lines || []).map((l) => `<tr><td>${esc(l.label)}</td><td class="n u">${l.qty}</td><td class="n u">${eur(l.unit_ht)}</td><td class="n">${eur(l.qty * l.unit_ht)}</td></tr>`).join('')}
</tbody></table>
<div class="tot">${t.discount ? `<div><span>Sous-total HT</span><span>${eur(t.sub)}</span></div><div><span>Remise ${Number(qt.discount_pct)} %</span><span>− ${eur(t.discount)}</span></div>` : ''}
<div><span>Total HT</span><span>${eur(t.ht)}</span></div><div><span>TVA ${Number(qt.tva_rate)} %</span><span>${eur(t.tva)}</span></div>
<div class="big"><span>Total TTC</span><span>${eur(t.ttc)}</span></div></div>
${qt.notes ? `<div class="note">${esc(qt.notes)}</div>` : ''}
${state}
<button class="print noprint" onclick="window.print()">Imprimer ou enregistrer en PDF</button>
${co.mentions ? `<div class="foot">${esc(co.mentions)}</div>` : ''}
</main></body></html>`;
}
