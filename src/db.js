// Base de données Postgres : cabinets, appels, rendez-vous.
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[db] DATABASE_URL manquant : impossible de démarrer.');
  process.exit(1);
}

// Schéma dédié (permet de partager une base existante sans mélanger les tables)
const SCHEMA = (process.env.DB_SCHEMA || '').replace(/[^a-z0-9_]/gi, '');

const local = /localhost|127\.0\.0\.1|\/tmp|host=\//.test(url);
export const pool = new pg.Pool({
  connectionString: url,
  ssl: local || process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 5,
  ...(SCHEMA ? { options: `-c search_path=${SCHEMA}` } : {}),
});

// Les dates (type DATE) restent des chaînes "YYYY-MM-DD"
pg.types.setTypeParser(1082, (v) => v);

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

export async function migrate() {
  if (SCHEMA) await q(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await q(`
    CREATE TABLE IF NOT EXISTS clients (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      trade         TEXT NOT NULL DEFAULT 'Diagnostic immobilier',
      email         TEXT,
      agent_number  TEXT UNIQUE,
      token         TEXT NOT NULL UNIQUE,
      home_address  TEXT,
      home_lat      DOUBLE PRECISION,
      home_lon      DOUBLE PRECISION,
      day_start     INT NOT NULL DEFAULT 480,
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calls (
      id               SERIAL PRIMARY KEY,
      client_id        INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      provider         TEXT,
      provider_call_id TEXT UNIQUE,
      caller_name      TEXT,
      caller_number    TEXT,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_sec     INT,
      transcript       TEXT,
      recording_url    TEXT,
      summary          TEXT,
      next_action      TEXT,
      request_type     TEXT NOT NULL DEFAULT 'autre',
      urgency          TEXT NOT NULL DEFAULT 'moyenne',
      status           TEXT NOT NULL DEFAULT 'a_rappeler',
      callback_before  TEXT,
      address          TEXT,
      diagnostics      TEXT,
      is_spam          BOOLEAN NOT NULL DEFAULT FALSE,
      email_sent       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS telnyx_assistant_id TEXT;
    CREATE INDEX IF NOT EXISTS calls_client_idx ON calls (client_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS appointments (
      id            SERIAL PRIMARY KEY,
      client_id     INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      call_id       INT REFERENCES calls(id) ON DELETE SET NULL,
      day           DATE NOT NULL,
      name          TEXT NOT NULL,
      phone         TEXT,
      address       TEXT NOT NULL,
      lat           DOUBLE PRECISION,
      lon           DOUBLE PRECISION,
      diagnostics   TEXT,
      duration_min  INT NOT NULL DEFAULT 60,
      win_start     INT,
      win_end       INT,
      notes         TEXT,
      done          BOOLEAN NOT NULL DEFAULT FALSE,
      done_at       TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS appts_client_day_idx ON appointments (client_id, day);
  `);
}
