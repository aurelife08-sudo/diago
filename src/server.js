// Diago — serveur : webhooks de l'agent vocal, API de l'app, admin.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, one, all, migrate } from './db.js';
import { fromVapi, fromRetell, fromGeneric, normNumber } from './providers.js';
import { fromTelnyx, listFinishedConversations } from './telnyx.js';
import { classify } from './ai.js';
import { sendCallEmail } from './email.js';
import { geocode, planDay } from './geo.js';

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY || '';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { if (req.url.startsWith('/webhooks/')) req.rawBody = buf; } }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: '5m' }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- Accès ----------
async function requireClient(req, res, next) {
  try {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.query.t;
    const client = token && (await one('SELECT * FROM clients WHERE token = $1 AND active', [token]));
    if (!client) return res.status(401).json({ error: 'Lien invalide ou expiré' });
    req.client = client;
    next();
  } catch (e) { next(e); }
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY || !safeEq(req.get('x-admin-key') || '', ADMIN_KEY)) return res.status(401).json({ error: 'Clé admin invalide' });
  next();
}
// Signature Ed25519 de Telnyx (clé publique du portail : Account → Keys & Credentials → Public Key)
function telnyxSignatureOk(req) {
  if (!TELNYX_PUBLIC_KEY || !req.rawBody) return false;
  const sig = req.get('telnyx-signature-ed25519');
  const ts = req.get('telnyx-timestamp');
  if (!sig || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const raw = Buffer.from(TELNYX_PUBLIC_KEY, 'base64');
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(`${ts}|`), req.rawBody]), key, Buffer.from(sig, 'base64'));
  } catch { return false; }
}
function webhookOk(req) {
  if (telnyxSignatureOk(req)) return true;
  if (!WEBHOOK_SECRET) return true;
  const given = req.get('x-webhook-secret') || req.get('x-vapi-secret') || req.query.secret || '';
  return safeEq(given, WEBHOOK_SECRET);
}

// ---------- Webhooks des plateformes vocales ----------
// webhook → format commun → agent n°2 (tri IA) → base → email

/** Trouve le cabinet d'un appel : numéro de l'agent, jeton dans l'URL, assistant Telnyx, ou appel déjà reçu. */
async function findClient(evt, token) {
  const to = normNumber(evt.toNumber);
  if (to) { const c = await one('SELECT * FROM clients WHERE agent_number = $1 AND active', [to]); if (c) return c; }
  if (token) { const c = await one('SELECT * FROM clients WHERE token = $1 AND active', [token]); if (c) return c; }
  if (evt.assistantId) { const c = await one('SELECT * FROM clients WHERE telnyx_assistant_id = $1 AND active', [evt.assistantId]); if (c) return c; }
  // Un 2e événement du même appel (ex. Telnyx call.analyzed, numéros masqués) retrouve son cabinet par l'appel déjà reçu
  const known = evt.providerCallId ? await one('SELECT client_id FROM calls WHERE provider_call_id = $1', [evt.providerCallId]) : null;
  return known ? one('SELECT * FROM clients WHERE id = $1 AND active', [known.client_id]) : null;
}

/** Vérifie les doublons. Retourne { duplicate, id } ou null si l'appel est à enregistrer. */
async function dedupe(evt) {
  if (!evt.providerCallId) return null;
  const prev = await one('SELECT id, transcript, recording_url FROM calls WHERE provider_call_id = $1', [evt.providerCallId]);
  if (!prev) return null;
  if ((prev.transcript || '').length >= (evt.transcript || '').length) {
    if (evt.recordingUrl && !prev.recording_url) await q('UPDATE calls SET recording_url = $2 WHERE id = $1', [prev.id, evt.recordingUrl]);
    return { duplicate: true, id: prev.id };
  }
  await q('DELETE FROM calls WHERE id = $1', [prev.id]); // version plus complète du même appel
  return null;
}

/** Tri IA + enregistrement + email. */
async function storeCall(evt, client) {
  const ai = await classify(evt);
  const call = await one(
    `INSERT INTO calls (client_id, provider, provider_call_id, caller_name, caller_number, started_at, duration_sec,
       transcript, recording_url, summary, next_action, request_type, urgency, callback_before, address, diagnostics, is_spam, status)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (provider_call_id) DO NOTHING RETURNING *`,
    [client.id, evt.provider, evt.providerCallId, ai.caller_name, normNumber(evt.fromNumber) || normNumber(ai.callback_number), evt.startedAt, evt.durationSec,
      evt.transcript, evt.recordingUrl, ai.summary, ai.next_action, ai.request_type, ai.urgency, ai.callback_before,
      ai.address, ai.diagnostics, ai.is_spam, ai.is_spam ? 'termine' : 'a_rappeler'],
  );
  if (call && !call.is_spam && (await sendCallEmail(client, call))) await q('UPDATE calls SET email_sent = TRUE WHERE id = $1', [call.id]);
  console.log(`[appel] ${call?.id ?? '(doublon)'} rangé pour ${client.name} (${ai.urgency})`);
  return call;
}

function ingest(parse) {
  return wrap(async (req, res) => {
    if (!webhookOk(req)) return res.status(401).json({ error: 'Secret invalide' });
    const evt = await parse(req.body);
    if (!evt) return res.json({ ignored: true });

    const client = await findClient(evt, req.query.client);
    if (!client) {
      console.warn('[webhook] aucun cabinet pour le numéro', evt.toNumber, evt.assistantId || '');
      return res.status(404).json({ error: 'Aucun cabinet pour ce numéro' });
    }
    const dup = await dedupe(evt);
    if (dup) return res.json(dup);
    res.json({ ok: true }); // on répond vite à la plateforme, le tri se fait ensuite
    try { await storeCall(evt, client); } catch (err) { console.error('[webhook] erreur de traitement :', err); }
  });
}

// Telnyx : Diago va aussi chercher lui-même les appels terminés (au cas où un webhook n'arrive pas).
let lastSync = 0, syncing = null;
async function syncTelnyx() {
  if (!process.env.TELNYX_API_KEY) return { skipped: true };
  if (syncing) return syncing;
  syncing = (async () => {
    let added = 0;
    try {
      const convs = await listFinishedConversations();
      if (!convs.length) return { added };
      const ids = convs.map((c) => c.id);
      const have = new Set((await all('SELECT provider_call_id FROM calls WHERE provider_call_id = ANY($1)', [ids])).map((r) => r.provider_call_id));
      for (const conv of convs.filter((c) => !have.has(c.id))) {
        try {
          const evt = await fromTelnyx({ conversation_id: conv.id, assistant_id: conv.metadata?.assistant_id });
          if (!evt || !evt.transcript) continue;
          const client = await findClient(evt);
          if (!client) { console.warn('[telnyx] conversation sans cabinet :', conv.id, evt.toNumber, evt.assistantId); continue; }
          if (await dedupe(evt)) continue;
          if (await storeCall(evt, client)) added++;
        } catch (err) { console.error('[telnyx] conversation', conv.id, ':', err.message); }
      }
    } catch (err) {
      console.error('[telnyx] synchronisation impossible :', err.message);
    } finally { lastSync = Date.now(); }
    if (added) console.log(`[telnyx] ${added} appel(s) récupéré(s)`);
    return { added };
  })();
  try { return await syncing; } finally { syncing = null; }
}

app.post('/webhooks/vapi', ingest(fromVapi));
app.post('/webhooks/retell', ingest(fromRetell));
app.post('/webhooks/generic', ingest(fromGeneric));
app.post('/webhooks/telnyx', ingest(fromTelnyx));

// ---------- API de l'app ----------
const api = express.Router();
api.use(requireClient);
const pub = (c) => ({ id: c.id, name: c.name, trade: c.trade, email: c.email, agent_number: c.agent_number, home_address: c.home_address, has_home: c.home_lat != null, day_start: c.day_start });

api.get('/me', (req, res) => res.json(pub(req.client)));
api.patch('/me', wrap(async (req, res) => {
  const { email, home_address, day_start } = req.body || {};
  const c = req.client;
  let lat = c.home_lat, lon = c.home_lon, addr = c.home_address;
  if (typeof home_address === 'string' && home_address.trim() && home_address !== c.home_address) {
    const [g] = await geocode(home_address, 1);
    if (!g) return res.status(422).json({ error: 'Adresse introuvable' });
    addr = g.label; lat = g.lat; lon = g.lon;
  }
  const ds = Number.isInteger(day_start) && day_start >= 300 && day_start <= 720 ? day_start : c.day_start;
  const row = await one('UPDATE clients SET email = $2, home_address = $3, home_lat = $4, home_lon = $5, day_start = $6 WHERE id = $1 RETURNING *',
    [c.id, typeof email === 'string' ? email.trim() || null : c.email, addr, lat, lon, ds]);
  res.json(pub(row));
}));

api.get('/calls', wrap(async (req, res) => {
  if (Date.now() - lastSync > 20000) await Promise.race([syncTelnyx(), new Promise((r) => setTimeout(r, 8000))]);
  res.json(await all(
    `SELECT id, caller_name, caller_number, started_at, duration_sec, summary, next_action, request_type, urgency, status,
            callback_before, address, diagnostics, is_spam
       FROM calls WHERE client_id = $1 AND NOT is_spam
      ORDER BY (status = 'a_rappeler') DESC,
               CASE urgency WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END,
               started_at DESC
      LIMIT 300`, [req.client.id]));
}));
api.get('/calls/:id', wrap(async (req, res) => {
  const c = await one('SELECT * FROM calls WHERE id = $1 AND client_id = $2', [Number(req.params.id), req.client.id]);
  if (!c) return res.status(404).json({ error: 'Appel introuvable' });
  res.json(c);
}));
api.patch('/calls/:id', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!['a_rappeler', 'rappele', 'rdv_pris', 'termine'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  const r = await one('UPDATE calls SET status = $3 WHERE id = $1 AND client_id = $2 RETURNING id, status', [Number(req.params.id), req.client.id, status]);
  if (!r) return res.status(404).json({ error: 'Appel introuvable' });
  res.json(r);
}));
api.get('/stats', wrap(async (req, res) => {
  const r = await one(
    `SELECT COUNT(*) FILTER (WHERE status = 'a_rappeler')::int AS a_rappeler,
            COUNT(*) FILTER (WHERE status = 'a_rappeler' AND urgency = 'haute')::int AS urgents,
            COUNT(*) FILTER (WHERE (started_at AT TIME ZONE 'Europe/Paris')::date = (NOW() AT TIME ZONE 'Europe/Paris')::date)::int AS aujourdhui
       FROM calls WHERE client_id = $1 AND NOT is_spam`, [req.client.id]);
  res.json(r);
}));

// Adresses
api.get('/geocode', wrap(async (req, res) => res.json(await geocode(String(req.query.q || ''), 5))));

// Rendez-vous
const APPT_FIELDS = 'id, call_id, day, name, phone, address, lat, lon, diagnostics, duration_min, win_start, win_end, notes, done, done_at, created_at';
const minOrNull = (v) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.min(1439, Math.round(Number(v)))));

async function apptValues(body, existing = {}) {
  const b = { ...existing, ...body };
  if (!isDay(String(b.day))) throw Object.assign(new Error('Date invalide'), { status: 400 });
  if (!String(b.name || '').trim() || !String(b.address || '').trim()) throw Object.assign(new Error('Nom et adresse obligatoires'), { status: 400 });
  let { lat, lon, address } = b;
  if (body.address !== undefined && (body.lat == null || body.lon == null) && (body.address !== existing.address || existing.lat == null)) {
    const [g] = await geocode(String(b.address), 1);
    lat = g?.lat ?? null; lon = g?.lon ?? null; address = g?.label ?? String(b.address).trim();
  }
  const diag = Array.isArray(b.diagnostics) ? b.diagnostics.join(', ') : (b.diagnostics || null);
  return [String(b.day), String(b.name).trim().slice(0, 120), b.phone ? normNumber(b.phone) : null, String(address).trim().slice(0, 300),
    lat != null ? Number(lat) : null, lon != null ? Number(lon) : null, diag,
    Math.max(10, Math.min(600, Math.round(Number(b.duration_min) || 60))), minOrNull(b.win_start), minOrNull(b.win_end),
    b.notes ? String(b.notes).slice(0, 1000) : null];
}

api.get('/appointments', wrap(async (req, res) => {
  const day = isDay(req.query.day) ? req.query.day : today();
  res.json(await all(`SELECT ${APPT_FIELDS} FROM appointments WHERE client_id = $1 AND day = $2 ORDER BY created_at`, [req.client.id, day]));
}));
api.post('/appointments', wrap(async (req, res) => {
  const v = await apptValues(req.body || {});
  const callId = req.body?.call_id ? Number(req.body.call_id) : null;
  if (callId && !(await one('SELECT 1 FROM calls WHERE id = $1 AND client_id = $2', [callId, req.client.id]))) return res.status(400).json({ error: 'Appel inconnu' });
  const row = await one(
    `INSERT INTO appointments (client_id, call_id, day, name, phone, address, lat, lon, diagnostics, duration_min, win_start, win_end, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${APPT_FIELDS}`, [req.client.id, callId, ...v]);
  if (callId) await q(`UPDATE calls SET status = 'rdv_pris' WHERE id = $1 AND client_id = $2`, [callId, req.client.id]);
  res.status(201).json(row);
}));
api.patch('/appointments/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const cur = await one(`SELECT ${APPT_FIELDS} FROM appointments WHERE id = $1 AND client_id = $2`, [id, req.client.id]);
  if (!cur) return res.status(404).json({ error: 'Rendez-vous introuvable' });
  const body = req.body || {};
  if (Object.keys(body).length === 1 && 'done' in body) {
    const row = await one(`UPDATE appointments SET done = $2, done_at = CASE WHEN $2 THEN NOW() ELSE NULL END WHERE id = $1 RETURNING ${APPT_FIELDS}`, [id, !!body.done]);
    return res.json(row);
  }
  const v = await apptValues(body, cur);
  const row = await one(
    `UPDATE appointments SET day=$2, name=$3, phone=$4, address=$5, lat=$6, lon=$7, diagnostics=$8, duration_min=$9, win_start=$10, win_end=$11, notes=$12
      WHERE id = $1 RETURNING ${APPT_FIELDS}`, [id, ...v]);
  res.json(row);
}));
api.delete('/appointments/:id', wrap(async (req, res) => {
  await q('DELETE FROM appointments WHERE id = $1 AND client_id = $2', [Number(req.params.id), req.client.id]);
  res.json({ ok: true });
}));

// Tournée du jour
api.get('/route', wrap(async (req, res) => {
  const c = req.client;
  const day = isDay(req.query.day) ? req.query.day : today();
  const start = minOrNull(req.query.start) ?? c.day_start;
  const appts = await all(`SELECT ${APPT_FIELDS} FROM appointments WHERE client_id = $1 AND day = $2 ORDER BY created_at`, [c.id, day]);
  if (c.home_lat == null) return res.json({ day, start, needs_home: true, appointments: appts });
  const home = { lat: c.home_lat, lon: c.home_lon, address: c.home_address };
  const plan = await planDay(home, appts, start);
  res.json({ day, start, home, appointments: appts, plan });
}));

app.use('/api', api);

// ---------- Admin ----------
const admin = express.Router();
admin.use(requireAdmin);
admin.get('/clients', wrap(async (req, res) => {
  res.json(await all(`SELECT c.*, (SELECT COUNT(*)::int FROM calls WHERE client_id = c.id) AS calls,
    (SELECT MAX(started_at) FROM calls WHERE client_id = c.id) AS last_call FROM clients c ORDER BY c.created_at DESC`));
}));
admin.post('/clients', wrap(async (req, res) => {
  const { name, trade, email, agent_number, home_address } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Nom obligatoire' });
  const num = normNumber(agent_number);
  if (num && (await one('SELECT 1 FROM clients WHERE agent_number = $1', [num]))) return res.status(409).json({ error: 'Ce numéro est déjà attribué' });
  let lat = null, lon = null, addr = home_address?.trim() || null;
  if (addr) { const [g] = await geocode(addr, 1); if (g) { lat = g.lat; lon = g.lon; addr = g.label; } }
  const token = crypto.randomBytes(18).toString('base64url');
  const row = await one(
    `INSERT INTO clients (name, trade, email, agent_number, token, home_address, home_lat, home_lon)
     VALUES ($1, COALESCE(NULLIF($2,''), 'Diagnostic immobilier'), $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name.trim(), trade || '', email?.trim() || null, num, token, addr, lat, lon]);
  res.status(201).json(row);
}));
admin.patch('/clients/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const cur = await one('SELECT * FROM clients WHERE id = $1', [Number(req.params.id)]);
  if (!cur) return res.status(404).json({ error: 'Cabinet introuvable' });
  const num = b.agent_number !== undefined ? normNumber(b.agent_number) : cur.agent_number;
  if (num && num !== cur.agent_number && (await one('SELECT 1 FROM clients WHERE agent_number = $1', [num]))) return res.status(409).json({ error: 'Ce numéro est déjà attribué' });
  const token = b.new_link ? crypto.randomBytes(18).toString('base64url') : cur.token;
  const row = await one(
    `UPDATE clients SET name = $2, email = $3, agent_number = $4, active = $5, token = $6, trade = $7, telnyx_assistant_id = $8 WHERE id = $1 RETURNING *`,
    [cur.id, b.name?.trim() || cur.name, b.email !== undefined ? b.email?.trim() || null : cur.email, num,
      b.active !== undefined ? !!b.active : cur.active, token, b.trade?.trim() || cur.trade,
      b.telnyx_assistant_id !== undefined ? String(b.telnyx_assistant_id || '').trim() || null : cur.telnyx_assistant_id]);
  res.json(row);
}));
// Appel de test, pour vérifier le circuit sans téléphone
admin.post('/clients/:id/test-call', wrap(async (req, res) => {
  const c = await one('SELECT * FROM clients WHERE id = $1', [Number(req.params.id)]);
  if (!c) return res.status(404).json({ error: 'Cabinet introuvable' });
  const evt = {
    provider: 'test', providerCallId: `test-${crypto.randomUUID()}`, toNumber: c.agent_number, fromNumber: '+33612345678', callerName: null,
    startedAt: new Date().toISOString(), durationSec: 72, recordingUrl: null, providerSummary: null,
    transcript: `AI: Bonjour, vous êtes bien chez ${c.name}, je prends votre message.\nUser: Bonjour, c'est Madame Martin. Je vends mon appartement à Annecy, le compromis est jeudi et il me manque le DPE et le diagnostic électricité.\nAI: C'est noté. Quelle est l'adresse du bien ?\nUser: 12 avenue de Genève à Annecy.\nAI: Quand peut-on vous rappeler ?\nUser: Avant 18h si possible, c'est urgent.`,
  };
  const ai = await classify(evt);
  const call = await one(
    `INSERT INTO calls (client_id, provider, provider_call_id, caller_name, caller_number, duration_sec, transcript, summary, next_action,
       request_type, urgency, callback_before, address, diagnostics) VALUES ($1,'test',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.id, evt.providerCallId, ai.caller_name, evt.fromNumber, evt.durationSec, evt.transcript, ai.summary, ai.next_action,
      ai.request_type, ai.urgency, ai.callback_before, ai.address, ai.diagnostics]);
  const sent = await sendCallEmail(c, call);
  res.json({ call, email_sent: sent });
}));
admin.post('/telnyx/sync', wrap(async (req, res) => res.json(await syncTelnyx())));
app.use('/admin/api', admin);

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

await migrate();
app.listen(PORT, () => console.log(`Diago prêt sur le port ${PORT}`));
const POLL = Math.max(30, Number(process.env.TELNYX_POLL_SECONDS) || 60) * 1000;
if (process.env.TELNYX_API_KEY) { setTimeout(syncTelnyx, 5000); setInterval(syncTelnyx, POLL).unref(); }
