// POST /api/sync   (jeton appareil)
// Un seul aller-retour pour tout : la borne pousse ses pointages en attente
// et récupère ce qui a changé depuis ses curseurs (autres appareils, manager).
//
// Requête :
//   { events: [{ id, employee_id, type, occurred_at, site?, lat?, lng?, accuracy_m?, out_of_zone? }],
//     cursors: { events: 0, employees: 0, corrections: 0 } }
// Réponse :
//   { accepted: [ids], rejected: [{id, reason}], server_time,
//     employees: [...], events: [...], corrections: [...],
//     cursors: {...}, more: bool }
//
// Idempotent : renvoyer deux fois le même événement ne crée pas de doublon.
// La borne retire de sa file d'attente tout ce qui est dans accepted OU rejected.
import { getSql } from '../lib/db.mjs';
import { handler, json, readJson, isUuid, isIsoTs, HttpError } from '../lib/http.mjs';
import { requireDevice } from '../lib/auth.mjs';

const TYPES = new Set(['start', 'pause_start', 'pause_end', 'end']);
const MAX_PUSH = 500;
const PAGE = 1000;
const DAY = 86400e3;

function validate(ev, now) {
  if (!ev || typeof ev !== 'object') return 'format';
  if (!isUuid(ev.id)) return 'id';
  if (!isUuid(ev.employee_id)) return 'employee_id';
  if (!TYPES.has(ev.type)) return 'type';
  if (!isIsoTs(ev.occurred_at)) return 'occurred_at';
  const t = Date.parse(ev.occurred_at);
  if (t > now + DAY) return 'occurred_at_futur';      // horloge délirante
  if (t < now - 40 * DAY) return 'occurred_at_ancien'; // au-delà de la rétention borne
  for (const k of ['lat', 'lng', 'accuracy_m']) {
    if (ev[k] != null && !Number.isFinite(ev[k])) return k;
  }
  if (ev.site != null && (typeof ev.site !== 'string' || ev.site.length > 60)) return 'site';
  return null;
}

const cur = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
// Recouvrement volontaire : un numéro de séquence est attribué à l'insertion mais
// visible au commit ; deux synchros simultanées peuvent donc se « doubler ».
// On relit les 100 dernières lignes déjà vues ; la borne fusionne par id, sans doublon.
const OVERLAP = 100;
const from = (v) => Math.max(0, cur(v) - OVERLAP);

export default handler(['POST'], async (req) => {
  const { tenantId, deviceId } = await requireDevice(req);
  const body = await readJson(req);
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length > MAX_PUSH) throw new HttpError(413, `Maximum ${MAX_PUSH} événements par synchro`);
  const cursors = body.cursors || {};
  const sql = getSql();
  const now = Date.now();

  // ── 1. Push ────────────────────────────────────────────────
  const rejected = [];
  const valid = [];
  for (const ev of events) {
    const reason = validate(ev, now);
    if (reason) rejected.push({ id: ev?.id ?? null, reason });
    else valid.push({
      id: ev.id, employee_id: ev.employee_id, type: ev.type, occurred_at: ev.occurred_at,
      site: ev.site ?? null, lat: ev.lat ?? null, lng: ev.lng ?? null,
      accuracy_m: ev.accuracy_m ?? null, out_of_zone: !!ev.out_of_zone,
    });
  }

  let accepted = [];
  if (valid.length) {
    // Une seule requête. La jointure sur employees garantit qu'un appareil
    // ne peut pas pointer pour un employé d'un autre établissement.
    await sql`
      INSERT INTO clock_events (id, tenant_id, employee_id, device_id, type, occurred_at, site, lat, lng, accuracy_m, out_of_zone)
      SELECT r.id, ${tenantId}::uuid, r.employee_id, ${deviceId}::uuid, r.type, r.occurred_at, r.site, r.lat, r.lng, r.accuracy_m, r.out_of_zone
      FROM jsonb_to_recordset(${JSON.stringify(valid)}::jsonb) AS r(
        id uuid, employee_id uuid, type text, occurred_at timestamptz, site text,
        lat double precision, lng double precision, accuracy_m real, out_of_zone boolean)
      JOIN employees e ON e.id = r.employee_id AND e.tenant_id = ${tenantId}::uuid
      ON CONFLICT (id) DO NOTHING`;

    // Accusé de réception = tout ce qui est en base pour CET établissement
    // (nouveaux + déjà reçus lors d'une synchro précédente interrompue).
    const ids = valid.map((v) => v.id);
    const stored = await sql`
      SELECT id FROM clock_events WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])`;
    const ok = new Set(stored.map((r) => r.id));
    accepted = ids.filter((id) => ok.has(id));
    // Pas en base = employé inconnu de cet établissement, ou UUID déjà pris par un autre tenant.
    for (const id of ids) if (!ok.has(id)) rejected.push({ id, reason: 'employe_inconnu' });
  }

  // ── 2. Pull ────────────────────────────────────────────────
  const [emps, evs, corrs] = await Promise.all([
    sql`SELECT id, name, pin_hash, updated_at, deleted_at, seq
        FROM employees WHERE tenant_id = ${tenantId}::uuid AND seq > ${from(cursors.employees)}
        ORDER BY seq LIMIT ${PAGE}`,
    sql`SELECT id, employee_id, device_id, type, occurred_at, received_at, site, out_of_zone, voided_at, void_reason, seq
        FROM clock_events
        WHERE tenant_id = ${tenantId}::uuid AND seq > ${from(cursors.events)}
          AND occurred_at > now() - interval '35 days'
        ORDER BY seq LIMIT ${PAGE}`,
    sql`SELECT id, employee_id, work_date::text AS work_date, field, corrected_at, reason, created_at, seq
        FROM corrections
        WHERE tenant_id = ${tenantId}::uuid AND seq > ${from(cursors.corrections)}
          AND work_date > (now() - interval '35 days')::date
        ORDER BY seq LIMIT ${PAGE}`,
  ]);

  const last = (rows, prev) => Math.max(cur(prev), rows.length ? Number(rows[rows.length - 1].seq) : 0);
  const strip = (rows) => rows.map(({ seq, ...r }) => r);

  return json(200, {
    accepted,
    rejected,
    server_time: new Date().toISOString(),
    employees: strip(emps),
    events: strip(evs),
    corrections: strip(corrs),
    cursors: {
      employees: last(emps, cursors.employees),
      events: last(evs, cursors.events),
      corrections: last(corrs, cursors.corrections),
    },
    more: emps.length === PAGE || evs.length === PAGE || corrs.length === PAGE,
  });
});

export const config = { path: '/api/sync' };
