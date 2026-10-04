// GET /api/report?from=YYYY-MM-DD&to=YYYY-MM-DD   (jeton manager)
// Données brutes pour le dashboard et l'export CSV, sur 93 jours maximum.
// Les bornes de dates sont interprétées en heure française.
import { getSql, TZ } from '../lib/db.mjs';
import { handler, json, isDate, HttpError } from '../lib/http.mjs';
import { requireManager } from '../lib/auth.mjs';

export default handler(['GET'], async (req) => {
  const { tenantId } = requireManager(req);
  const q = new URL(req.url).searchParams;
  const from = q.get('from'), to = q.get('to');
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from et to requis (YYYY-MM-DD)');
  const span = (Date.parse(to) - Date.parse(from)) / 86400e3;
  if (span < 0 || span > 93) throw new HttpError(400, 'Période invalide (93 jours max)');

  const sql = getSql();
  const [employees, events, corrections, suspicious] = await Promise.all([
    sql`SELECT id, name, deleted_at FROM employees WHERE tenant_id = ${tenantId}::uuid ORDER BY name`,
    sql`SELECT id, employee_id, device_id, type, occurred_at, received_at, site, lat, lng, accuracy_m,
               out_of_zone, voided_at, void_reason,
               (occurred_at AT TIME ZONE ${TZ})::date::text AS work_date
        FROM clock_events
        WHERE tenant_id = ${tenantId}::uuid
          AND occurred_at >= (${from}::date::timestamp AT TIME ZONE ${TZ})
          AND occurred_at <  ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})
        ORDER BY occurred_at`,
    sql`SELECT DISTINCT ON (employee_id, work_date, field)
               id, employee_id, work_date::text AS work_date, field, corrected_at, reason, created_at
        FROM corrections
        WHERE tenant_id = ${tenantId}::uuid AND work_date BETWEEN ${from}::date AND ${to}::date
        ORDER BY employee_id, work_date, field, created_at DESC`,
    sql`SELECT id, motif, lag_s FROM suspicious_events
        WHERE tenant_id = ${tenantId}::uuid
          AND occurred_at >= (${from}::date::timestamp AT TIME ZONE ${TZ})
          AND occurred_at <  ((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})`,
  ]);

  return json(200, { from, to, employees, events, corrections, suspicious });
});

export const config = { path: '/api/report' };
