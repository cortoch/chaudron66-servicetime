-- ════════════════════════════════════════════════════════════
--  Ylelor — schéma Postgres (Neon)
--  Principe : les pointages sont en AJOUT SEUL (append-only).
--  Chaque événement porte un UUID généré sur l'appareil ;
--  un renvoi après coupure réseau est ignoré (ON CONFLICT DO NOTHING).
--  Les corrections manager sont des lignes séparées, jamais une
--  modification de l'événement d'origine (traçabilité inspection du travail).
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ── Établissements ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name          text NOT NULL,
  manager_hash  text NOT NULL,               -- scrypt du code manager (jamais en clair)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Appareils autorisés (iPad borne, téléphone du gérant…) ──
-- Un appareil est enrôlé une fois avec le code manager ;
-- il reçoit un jeton longue durée, stocké ici sous forme de hash.
CREATE TABLE IF NOT EXISTS devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  token_hash    text NOT NULL UNIQUE,        -- sha256 du jeton
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS devices_tenant_idx ON devices(tenant_id);

-- ── Employés ────────────────────────────────────────────────
-- Seule table mutable : règle « la dernière écriture gagne » via updated_at.
-- Suppression logique (deleted_at) pour que tous les appareils l'apprennent.
CREATE TABLE IF NOT EXISTS employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  pin_hash      text NOT NULL,               -- hash du PIN 4 chiffres (vérifié sur la borne)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  seq           bigserial                    -- curseur de synchro
);
CREATE INDEX IF NOT EXISTS employees_tenant_seq_idx ON employees(tenant_id, seq);

-- ── Pointages (append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS clock_events (
  id            uuid PRIMARY KEY,            -- généré sur l'appareil (crypto.randomUUID)
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id),
  device_id     uuid REFERENCES devices(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('start','pause_start','pause_end','end')),
  occurred_at   timestamptz NOT NULL,        -- horloge de l'appareil
  received_at   timestamptz NOT NULL DEFAULT now(),  -- horloge serveur
  site          text,
  lat           double precision,
  lng           double precision,
  accuracy_m    real,
  out_of_zone   boolean NOT NULL DEFAULT false,
  voided_at     timestamptz,                 -- annulation manager (seule mutation permise)
  void_reason   text,
  seq           bigserial                    -- curseur de synchro, monotone
);
CREATE INDEX IF NOT EXISTS clock_events_tenant_seq_idx  ON clock_events(tenant_id, seq);
CREATE INDEX IF NOT EXISTS clock_events_tenant_time_idx ON clock_events(tenant_id, occurred_at);

-- ── Corrections manager (append-only) ───────────────────────
-- La dernière correction (created_at) pour (employé, jour, champ) fait foi.
CREATE TABLE IF NOT EXISTS corrections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id),
  work_date     date NOT NULL,
  field         text NOT NULL CHECK (field IN ('start','end')),
  corrected_at  timestamptz NOT NULL,
  reason        text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  seq           bigserial
);
CREATE INDEX IF NOT EXISTS corrections_tenant_seq_idx ON corrections(tenant_id, seq);

-- ── Anti force brute sur le code manager ────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  ok            boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(tenant_id, attempted_at);

-- ── Vue d'audit : pointages dont l'horloge appareil diverge ─
-- Remplace l'ancienne détection côté client : l'écart est mesuré
-- par le serveur, impossible à masquer en changeant l'heure de l'iPad.
-- Deux cas :
--  · horloge en avance  : occurred_at dans le futur par rapport au serveur → toujours suspect ;
--  · gros retard        : reçu > 12 h après → soit hors ligne prolongé, soit antidatage.
--    Le serveur ne peut pas distinguer les deux : c'est au manager de juger.
CREATE OR REPLACE VIEW suspicious_events AS
SELECT e.*,
       EXTRACT(EPOCH FROM (e.received_at - e.occurred_at))::int AS lag_s,
       CASE WHEN e.occurred_at > e.received_at + interval '2 minutes'
            THEN 'horloge_en_avance' ELSE 'synchro_tardive' END AS motif
FROM clock_events e
WHERE e.occurred_at > e.received_at + interval '2 minutes'
   OR e.received_at > e.occurred_at + interval '12 hours';
