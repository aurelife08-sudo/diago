// Agent n°2 : lit la transcription et range l'appel (résumé, urgence, action, RDV).
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';

const TYPES = ['devis', 'rendez_vous', 'urgence', 'information', 'suivi', 'autre'];
const URG = ['haute', 'moyenne', 'basse'];

const SYSTEM = `Tu ranges les appels reçus par l'agent téléphonique d'un professionnel (souvent un cabinet de diagnostic immobilier, parfois un artisan).
Lis la transcription et réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{
 "caller_name": "nom de l'appelant tel qu'il l'a dit, sinon null",
 "callback_number": "numéro de rappel donné à l'oral, en chiffres (ex: 0637123456), sinon null",
 "summary": "résumé en 1 ou 2 phrases, en français, ce que veut la personne",
 "next_action": "ce que le professionnel doit faire, en une phrase à l'impératif",
 "request_type": "devis | rendez_vous | urgence | information | suivi | autre",
 "urgency": "haute | moyenne | basse",
 "callback_before": "créneau de rappel souhaité en quelques mots (ex: avant 18h, demain matin) sinon null",
 "address": "adresse ou ville du bien si elle est donnée, sinon null",
 "diagnostics": ["liste des diagnostics demandés parmi DPE, Amiante, Plomb, Électricité, Gaz, Termites, Carrez, Boutin, ERP, Audit énergétique ; vide si aucun"],
 "email": "adresse email donnée à l'oral, reconstituée (arobase → @, point → ., tiret → -), en minuscules, sinon null",
 "property_type": "appartement | maison | local | autre, sinon null",
 "surface_m2": "surface du bien en m² (nombre), sinon null",
 "build_year": "année de construction approximative (nombre) : avant 1949 → 1940, années 70 → 1975, après 2000 → 2005 ; sinon null",
 "transaction": "vente | location | travaux | autre, sinon null",
 "is_spam": false
}
Urgence haute : vente/signature/location imminente (sous une semaine), problème bloquant, client très pressé. Basse : simple question sans délai.
is_spam vaut true pour démarchage commercial, robot ou erreur de numéro.`;

if (!KEY) console.warn('[ai] ANTHROPIC_API_KEY absente : tri par règles simples (résumés moins bons).');

async function askClaude(evt, text) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Numéro appelant : ${evt.fromNumber || 'inconnu'}\nRésumé fourni par la plateforme (souvent en anglais, à ne pas recopier) : ${evt.providerSummary || 'aucun'}\n\nTranscription :\n${text.slice(0, 12000)}` }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  const raw = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').replace(/```(?:json)?/g, '');
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`réponse sans JSON (stop_reason=${data.stop_reason}) : ${raw.slice(0, 200) || '(vide)'}`);
  return JSON.parse(raw.slice(start, end + 1));
}

export async function classify(evt) {
  const text = (evt.transcript || '').trim();
  if (KEY && text) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return clean(await askClaude(evt, text), evt);
      } catch (err) {
        console.warn(`[ai] tri IA impossible (essai ${attempt}/2) :`, err.message);
      }
    }
  }
  return rules(evt);
}

function clean(j, evt) {
  const diag = Array.isArray(j.diagnostics) ? j.diagnostics.filter(Boolean).map(String).slice(0, 10) : [];
  return {
    caller_name: j.caller_name || evt.callerName || null,
    callback_number: phoneFrom(j.callback_number) || spokenNumber(evt.transcript),
    summary: String(j.summary || evt.providerSummary || 'Appel reçu.').slice(0, 600),
    next_action: String(j.next_action || 'Rappeler le client.').slice(0, 300),
    request_type: TYPES.includes(j.request_type) ? j.request_type : 'autre',
    urgency: URG.includes(j.urgency) ? j.urgency : 'moyenne',
    callback_before: j.callback_before || null,
    address: j.address || null,
    diagnostics: diag.join(', ') || null,
    ...property(j, evt),
    is_spam: j.is_spam === true,
  };
}

// ---------- Infos du bien et email (pour le devis) ----------
const PTYPES = ['appartement', 'maison', 'local', 'autre'];
const TRANS = ['vente', 'location', 'travaux', 'autre'];
function property(j, evt) {
  const r = propertyRules(evt);
  const surf = Number(String(j.surface_m2 ?? '').replace(',', '.'));
  const year = Number(j.build_year);
  const email = String(j.email || '').trim().toLowerCase().replace(/\s+/g, '');
  return {
    email: /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? email : r.email,
    property_type: PTYPES.includes(j.property_type) ? j.property_type : r.property_type,
    surface_m2: surf > 5 && surf < 5000 ? Math.round(surf) : r.surface_m2,
    build_year: year >= 1500 && year <= 2100 ? Math.round(year) : r.build_year,
    transaction: TRANS.includes(j.transaction) ? j.transaction : r.transaction,
  };
}
export function propertyRules(evt) {
  const said = String(evt.transcript || '').split('\n').filter((l) => /^\s*(user|client|caller)\s*:/i.test(l)).map((l) => l.replace(/^[^:]+:\s*/, '')).join(' ');
  const t = said.toLowerCase();
  const surf = /(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|mètres? carrés?|metres? carres?|m\b)/.exec(t);
  let year = /\b(1[5-9]\d\d|20[0-2]\d)\b/.exec(t)?.[1];
  if (!year && /avant (?:19)?49|ancien|vieux|xixe|19e/.test(t)) year = 1940;
  const em = /([a-z0-9._%+-]+)\s*(?:@|arobase|at)\s*([a-z0-9-]+)\s*(?:\.|point|dot)\s*([a-z]{2,})/.exec(t.replace(/\s+(point|tiret)\s+/g, (m, w) => (w === 'point' ? '.' : '-')).replace(/\s+arobase\s+/g, '@'));
  return {
    email: em ? `${em[1]}@${em[2]}.${em[3]}` : null,
    property_type: /appartement|studio|\bt[1-6]\b|\bf[1-6]\b/.test(t) ? 'appartement' : /maison|villa|chalet|pavillon|ferme/.test(t) ? 'maison' : /local|bureau|commerce|boutique/.test(t) ? 'local' : null,
    surface_m2: surf ? Math.round(Number(surf[1].replace(',', '.'))) : null,
    build_year: year ? Number(year) : null,
    transaction: /\bvend|vente|compromis|acheteur/.test(t) ? 'vente' : /\bloue|location|locataire|bail/.test(t) ? 'location' : /travaux|rénov|renov|démoli|demoli/.test(t) ? 'travaux' : null,
  };
}

// Sans clé IA : quelques règles pour que l'app reste utilisable.
function rules(evt) {
  const t = `${evt.transcript || ''} ${evt.providerSummary || ''}`.toLowerCase();
  const has = (...w) => w.some((x) => t.includes(x));
  const type = has('urgent', 'fuite', 'panne') ? 'urgence'
    : has('devis', 'tarif', 'prix', 'combien') ? 'devis'
    : has('rendez-vous', 'rdv', 'passer', 'visite') ? 'rendez_vous'
    : has('rapport', 'dossier', 'suivi') ? 'suivi'
    : has('?', 'est-ce que', 'savoir') ? 'information' : 'autre';
  const urgency = has('urgent', 'compromis', 'signature', 'demain', 'cette semaine', 'vite') ? 'haute'
    : type === 'information' ? 'basse' : 'moyenne';
  const DIAGS = { dpe: 'DPE', amiante: 'Amiante', plomb: 'Plomb', 'électricité': 'Électricité', electricite: 'Électricité', gaz: 'Gaz', termite: 'Termites', carrez: 'Carrez', boutin: 'Boutin' };
  const diagnostics = [...new Set(Object.entries(DIAGS).filter(([k]) => t.includes(k)).map(([, v]) => v))].join(', ') || null;
  const userLines = (evt.transcript || '').split('\n').filter((l) => /^\s*(user|client|caller)\s*:/i.test(l)).map((l) => l.replace(/^[^:]+:\s*/, ''));
  const said = userLines.join(' ').replace(/\s+/g, ' ').trim();
  const summary = said ? `L'appelant a dit : « ${said.slice(0, 260)}${said.length > 260 ? '…' : ''} »` : 'Appel reçu, pas de transcription.';
  const name = /(?:[Cc]'est|[Jj]e suis|[Jj]e m'appelle|[Ii]ci)\s+((?:[Mm]adame|[Mm]onsieur|Mme|M\.)\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'-]+|[A-ZÀ-Ý][a-zà-ÿ'-]+\s+[A-ZÀ-Ý][a-zà-ÿ'-]+)/.exec(said);
  return {
    caller_name: evt.callerName || (name ? name[1].replace(/^(\w)/, (c) => c.toUpperCase()) : null),
    callback_number: spokenNumber(evt.transcript),
    summary,
    next_action: type === 'devis' ? 'Envoyer un devis.' : type === 'rendez_vous' ? 'Rappeler pour fixer le rendez-vous.' : 'Rappeler le client.',
    request_type: type,
    urgency,
    callback_before: null,
    address: null,
    diagnostics,
    ...propertyRules(evt),
    is_spam: false,
  };
}

// ---------- Numéro de rappel dit à l'oral ----------
function phoneFrom(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (/^0[1-9]\d{8}$/.test(d)) return d;
  if (/^33[1-9]\d{8}$/.test(d)) return '0' + d.slice(2);
  return null;
}

const UNITS = { zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16 };
const TENS = { vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };

/** « zéro six trente-sept 12 quatre-vingt-dix-neuf … » → 06371299… (cherche un numéro français dans ce qu'a dit l'appelant). */
export function spokenNumber(transcript) {
  const said = String(transcript || '').split('\n').filter((l) => /^\s*(user|client|caller)\s*:/i.test(l)).map((l) => l.replace(/^[^:]+:\s*/, '')).join(' ');
  const direct = /(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/.exec(said);
  if (direct) return phoneFrom(direct[0]);
  const words = said.toLowerCase().replace(/[-,.]/g, ' ').split(/\s+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w)) { out += w; continue; }
    if (w === 'quatre' && /^vingts?$/.test(words[i + 1] || '')) {
      let v = 80; i++;
      const n = words[i + 1];
      if (n in UNITS && UNITS[n] <= 16) { v += UNITS[n]; i++; if (n === 'dix' && words[i + 1] in UNITS && UNITS[words[i + 1]] < 10) { v += UNITS[words[i + 1]]; i++; } }
      out += String(v).padStart(2, '0'); continue;
    }
    if (w in TENS) {
      let v = TENS[w];
      let n = words[i + 1];
      if (n === 'et') { i++; n = words[i + 1]; }
      if (n in UNITS && (v === 60 ? UNITS[n] <= 16 : UNITS[n] < 10)) { v += UNITS[n]; i++; if (v === 70 && words[i + 1] in UNITS && UNITS[words[i + 1]] < 10) { v += UNITS[words[i + 1]]; i++; } }
      out += String(v).padStart(2, '0'); continue;
    }
    if (w in UNITS) {
      const v = UNITS[w];
      const n = words[i + 1];
      if (v === 10 && n in UNITS && UNITS[n] >= 7 && UNITS[n] <= 9) { out += String(10 + UNITS[n]); i++; continue; }
      out += v >= 10 ? String(v) : String(v);
      continue;
    }
    if (out.length >= 10) break;
    if (!['le', 'au', 'mon', 'numéro', 'c\'est', 'est', 'sur', 'à', 'joindre', 'rappeler', 'me', 'pouvez', 'vous'].includes(w)) out = out.length >= 10 ? out : '';
  }
  const m = /0[1-9]\d{8}/.exec(out);
  return m ? m[0] : null;
}
