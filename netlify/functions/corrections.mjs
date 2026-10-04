// /api/corrections   (jeton manager)
//   POST { employee_id, work_date: 'YYYY-MM-DD', field: 'start'|'end', time: 'HH:MM', reason }
//     → ajoute une correction (l'événement d'origine reste intact)
//   POST { void_event_id, reason }
//     → annule un pointage (seule modification permise sur clock_events)
import { getSql, TZ } from '../lib/db.mjs';
import { handler, json, readJson, isUuid, isDate, str, HttpError } from '../lib/http.mjs';
import { requireManager } from '../lib/auth.mjs';

export default handler(['POST'], async (req) => {
  const { tenantId } = requireManager(req);
  const body = await readJson(req, 4096);
  const reason = str(body.reason, { min: 3, max: 500, field: 'motif' });
  const sql = getSql();

  if (body.void_event_id != null) {
    if (!isUuid(body.void_event_id)) throw new HttpError(400, 'void_event_id invalide');
    const rows = await sql`
      UPDATE clock_events
      SET voided_at = now(), void_reason = ${reason},
          seq = nextval(pg_get_serial_sequence('clock_events','seq'))
      WHERE id = ${body.void_event_id}::uuid AND tenant_id = ${tenantId}::uuid AND voided_at IS NULL
      RETURNING id`;
    if (!rows.length) throw new HttpError(404, 'Pointage introuvable ou déjà annulé');
    return json(200, { ok: true });
  }

  if (!isUuid(body.employee_id)) throw new HttpError(400, 'employee_id invalide');
  if (!isDate(body.work_date)) throw new HttpError(400, 'work_date invalide');
  if (!['start', 'end'].includes(body.field)) throw new HttpError(400, 'field invalide');
  if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw new HttpError(400, 'time invalide (HH:MM)');

  // L'heure saisie est une heure locale française ; conversion faite par Postgres (gère l'heure d'été).
  const [row] = await sql`
    INSERT INTO corrections (tenant_id, employee_id, work_date, field, corrected_at, reason)
    SELECT ${tenantId}::uuid, e.id, ${body.work_date}::date, ${body.field},
           ((${body.work_date}::date + ${body.time}::time) AT TIME ZONE ${TZ}), ${reason}
    FROM employees e WHERE e.id = ${body.employee_id}::uuid AND e.tenant_id = ${tenantId}::uuid
    RETURNING id, corrected_at`;
  if (!row) throw new HttpError(404, 'Employé introuvable');
  return json(201, { correction: row });
});

export const config = { path: '/api/corrections' };
