// Prise de rendez-vous par l'agent téléphonique : créneaux libres + réservation.
// Les rendez-vous pris par l'agent vont directement dans la tournée du jour, marqués « à confirmer ».
import { one, all } from './db.js';
import { geocode } from './geo.js';
import { normNumber } from './providers.js';

// Durées sur place (mêmes valeurs que l'appli)
const DIAG_MIN = { DPE: 45, Amiante: 45, Plomb: 30, 'Électricité': 30, Gaz: 30, Termites: 20, Carrez: 15, Boutin: 15, ERP: 5, 'Audit énergétique': 90 };
const ALIASES = [
  [/dpe|performance/i, 'DPE'], [/amiante/i, 'Amiante'], [/plomb|crep/i, 'Plomb'], [/[ée]lectri/i, 'Électricité'],
  [/gaz/i, 'Gaz'], [/termite/i, 'Termites'], [/carrez/i, 'Carrez'], [/boutin/i, 'Boutin'], [/\berp\b|risque/i, 'ERP'], [/audit/i, 'Audit énergétique'],
];

// Horaires de travail (minutes depuis minuit), du lundi au vendredi
const BLOCKS = { matin: [510, 720], 'apres-midi': [810, 1080] }; // 8h30-12h00, 13h30-18h00
const STEP = 30;        // créneaux toutes les 30 min
const TRAVEL = 30;      // marge de route entre deux rendez-vous
const MAX_PER_DAY = 6;  // rendez-vous max par jour
const HORIZON = 15;     // jours cherchés

export function parseDiags(v) {
  const list = Array.isArray(v) ? v.join(',') : String(v || '');
  return [...new Set(ALIASES.filter(([re]) => re.test(list)).map(([, d]) => d))];
}
export function durationFor(diags) {
  const t = diags.reduce((s, d) => s + (DIAG_MIN[d] ?? 30), 0) || 60;
  return Math.min(240, Math.max(30, Math.ceil(t / 15) * 15));
}

// ---------- Dates à l'heure de Paris ----------
function parisToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
const hm = (m) => `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
export function slotLabel(day, min) {
  const d = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${d.replace(/ 1 /, ' 1er ')} à ${hm(min)}`;
}
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « 2026-12-01 », « mardi », « demain », « la semaine prochaine » → premier jour à chercher. */
function startDay(pref) {
  const today = parisToday();
  const p = String(pref || '').toLowerCase().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(p) && p > today) return { day: p, only: true };
  if (/apr[eè]s-demain/.test(p)) return { day: addDays(today, 2), only: true };
  if (/demain/.test(p)) return { day: addDays(today, 1), only: true };
  if (/semaine prochaine/.test(p)) { let d = addDays(today, 1); while (weekday(d) !== 1) d = addDays(d, 1); return { day: d, only: false }; }
  const j = JOURS.findIndex((x) => p.includes(x));
  if (j >= 0) { let d = addDays(today, 1); while (weekday(d) !== j) d = addDays(d, 1); return { day: d, only: true }; }
  return { day: addDays(today, 1), only: false };
}
function periodOf(pref) {
  const p = String(pref || '').toLowerCase();
  if (/matin/.test(p)) return ['matin'];
  if (/apr[eè]s|aprem|soir/.test(p)) return ['apres-midi'];
  return ['matin', 'apres-midi'];
}

async function busyOf(clientId, day) {
  const appts = await all('SELECT win_start, duration_min FROM appointments WHERE client_id = $1 AND day = $2', [clientId, day]);
  return {
    count: appts.length,
    intervals: appts.filter((a) => a.win_start != null).map((a) => [a.win_start - TRAVEL, a.win_start + a.duration_min + TRAVEL]),
  };
}
const fits = (start, dur, intervals) => intervals.every(([a, b]) => start + dur <= a || start >= b);

/** Créneaux libres : au plus un par demi-journée, pour proposer du choix. */
export async function findSlots(client, { diagnostics, jour, moment, nombre = 3 } = {}) {
  const dur = durationFor(parseDiags(diagnostics));
  const { day: first, only } = startDay(jour);
  const periods = periodOf(moment);
  const out = [];
  for (let i = 0; i < HORIZON && out.length < nombre; i++) {
    const day = addDays(first, i);
    if (only && i > 0 && out.length) break; // jour précis demandé : on ne cherche plus loin que si rien n'est libre
    if (weekday(day) === 0 || weekday(day) === 6) continue;
    const busy = await busyOf(client.id, day);
    if (busy.count >= MAX_PER_DAY) continue;
    for (const p of periods) {
      const [a, b] = BLOCKS[p];
      for (let t = a; t + dur <= b; t += STEP) {
        if (fits(t, dur, busy.intervals)) { out.push({ creneau: `${day} ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, texte: slotLabel(day, t) }); break; }
      }
      if (out.length >= nombre) break;
    }
  }
  return { duree_minutes: dur, creneaux: out };
}

/** Réserve un créneau proposé. Revérifie qu'il est toujours libre. */
export async function bookSlot(client, b) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(b.creneau || ''));
  if (!m) return { ok: false, raison: 'Créneau invalide. Utilise exactement une valeur « creneau » renvoyée par creneaux_disponibles.' };
  const [, day] = m;
  const start = Number(m[2]) * 60 + Number(m[3]);
  const inHours = Object.values(BLOCKS).some(([a, z]) => start >= a && start < z);
  if (day <= parisToday() || weekday(day) === 0 || weekday(day) === 6 || !inHours) {
    return { ok: false, raison: 'Ce créneau est en dehors des horaires du cabinet.', ...(await findSlots(client, b)) };
  }
  const name = String(b.nom || '').trim();
  const address = String(b.adresse || '').trim();
  if (!name || !address) return { ok: false, raison: 'Il manque le nom ou l\'adresse du bien : demande-les avant de réserver.' };

  const diags = parseDiags(b.diagnostics);
  const dur = durationFor(diags);
  const busy = await busyOf(client.id, day);
  if (busy.count >= MAX_PER_DAY || !fits(start, dur, busy.intervals)) {
    return { ok: false, raison: 'Ce créneau vient d\'être pris.', ...(await findSlots(client, { ...b, jour: day })) };
  }
  const [g] = await geocode(address, 1, client.home_lat != null ? { lat: client.home_lat, lon: client.home_lon } : null).catch(() => []);
  const notes = ['Rendez-vous pris par l\'agent téléphonique : à confirmer.', b.notes ? String(b.notes).slice(0, 600) : ''].filter(Boolean).join(' ');
  const row = await one(
    `INSERT INTO appointments (client_id, day, name, phone, address, lat, lon, diagnostics, duration_min, win_start, win_end, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11) RETURNING id`,
    [client.id, day, name.slice(0, 120), normNumber(b.telephone) || null, (g?.label ?? address).slice(0, 300), g?.lat ?? null, g?.lon ?? null,
      diags.join(', ') || null, dur, start, notes],
  );
  console.log(`[rdv] ${row.id} pris par l'agent pour ${client.name} : ${day} ${hm(start)}`);
  return { ok: true, confirmation: `Rendez-vous noté ${slotLabel(day, start)}, à ${g?.label ?? address}. Le diagnostiqueur le confirmera.` };
}

/** Relie à l'appel les rendez-vous que l'agent vient de prendre (même numéro, dernières 2 heures). */
export async function linkAgentAppointments(clientId, call) {
  if (!call?.caller_number) return 0;
  const rows = await all(
    `UPDATE appointments SET call_id = $3 WHERE client_id = $1 AND call_id IS NULL AND phone = $2
       AND created_at > NOW() - INTERVAL '2 hours' AND notes LIKE 'Rendez-vous pris par l''agent%' RETURNING id`,
    [clientId, call.caller_number, call.id]);
  if (rows.length) await one(`UPDATE calls SET status = 'rdv_pris' WHERE id = $1 RETURNING id`, [call.id]);
  return rows.length;
}
