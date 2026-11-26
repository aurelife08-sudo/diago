// Connexion par appareil : le lien du cabinet dit QUEL cabinet, un code à 6 chiffres (reçu par email
// ou donné par l'équipe Diago) ouvre une session sur cet appareil. Un lien transféré ne suffit plus.
import crypto from 'node:crypto';
import { q, one } from './db.js';

const CODE_TTL_MIN = 10;          // validité d'un code
const CODE_MAX_TRIES = 5;         // essais par code
const CODES_PER_HOUR = 5;         // codes envoyés par heure et par cabinet
const RESEND_AFTER_SEC = 45;      // délai avant de redemander un code
const SESSION_DAYS = 180;         // une session inutilisée pendant 180 jours expire

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const codeHash = (clientId, code) => sha(`${clientId}:${code}`);

export async function migrateAuth() {
  await q(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          SERIAL PRIMARY KEY,
      client_id   INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      token_hash  TEXT NOT NULL UNIQUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS login_codes (
      id          SERIAL PRIMARY KEY,
      client_id   INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL,
      tries       INT NOT NULL DEFAULT 0,
      used        BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at  TIMESTAMPTZ NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS login_codes_client_idx ON login_codes (client_id, created_at DESC);
  `);
}

/** a****@gmail.com */
export const maskEmail = (e) => {
  const first = String(e || '').split(',')[0].trim();
  const [u, d] = first.split('@');
  return u && d ? `${u[0]}${'•'.repeat(Math.max(2, Math.min(6, u.length - 1)))}@${d}` : null;
};

/**
 * Crée un code de connexion. `force` (admin) ignore le délai entre deux codes.
 * Retourne { code } ou { error, status }.
 */
export async function createCode(clientId, { force = false } = {}) {
  const recent = await one(
    `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hour,
            MAX(created_at) AS last FROM login_codes WHERE client_id = $1`, [clientId]);
  if (!force) {
    if (recent.last && Date.now() - new Date(recent.last).getTime() < RESEND_AFTER_SEC * 1000) {
      return { error: 'Un code vient d\'être envoyé. Attendez un instant avant d\'en redemander un.', status: 429 };
    }
    if (recent.hour >= CODES_PER_HOUR) return { error: 'Trop de codes demandés. Réessayez dans une heure.', status: 429 };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await q('UPDATE login_codes SET used = TRUE WHERE client_id = $1 AND NOT used', [clientId]); // un seul code valable à la fois
  await q(`INSERT INTO login_codes (client_id, code_hash, expires_at) VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
    [clientId, codeHash(clientId, code), String(CODE_TTL_MIN)]);
  return { code };
}

/** Vérifie le code et ouvre une session. Retourne { session } ou { error, status }. */
export async function verifyCode(clientId, code) {
  const c = String(code || '').replace(/\D/g, '');
  const row = await one(
    `SELECT id, code_hash, tries FROM login_codes
      WHERE client_id = $1 AND NOT used AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`, [clientId]);
  if (!row) return { error: 'Code expiré. Demandez-en un nouveau.', status: 401 };
  if (row.tries >= CODE_MAX_TRIES) return { error: 'Trop d\'essais. Demandez un nouveau code.', status: 429 };
  const ok = c.length === 6 && crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(codeHash(clientId, c)));
  if (!ok) {
    const r = await one('UPDATE login_codes SET tries = tries + 1 WHERE id = $1 RETURNING tries', [row.id]);
    const left = CODE_MAX_TRIES - r.tries;
    return { error: left > 0 ? `Code incorrect (${left} essai${left > 1 ? 's' : ''} restant${left > 1 ? 's' : ''}).` : 'Trop d\'essais. Demandez un nouveau code.', status: 401 };
  }
  await q('UPDATE login_codes SET used = TRUE WHERE id = $1', [row.id]);
  const session = crypto.randomBytes(32).toString('base64url');
  await q('INSERT INTO sessions (client_id, token_hash) VALUES ($1, $2)', [clientId, sha(session)]);
  return { session };
}

/** Cabinet correspondant à une session valide (et prolonge la session). */
export async function clientFromSession(session) {
  if (!session || session.length < 20) return null;
  const s = await one(
    `UPDATE sessions SET last_seen = NOW() WHERE token_hash = $1 AND last_seen > NOW() - ($2 || ' days')::interval RETURNING client_id`,
    [sha(session), String(SESSION_DAYS)]);
  return s ? one('SELECT * FROM clients WHERE id = $1 AND active', [s.client_id]) : null;
}

/** Déconnecte tous les appareils d'un cabinet. */
export const revokeSessions = (clientId) => q('DELETE FROM sessions WHERE client_id = $1', [clientId]);
export const revokeSession = (session) => q('DELETE FROM sessions WHERE token_hash = $1', [sha(session)]);
