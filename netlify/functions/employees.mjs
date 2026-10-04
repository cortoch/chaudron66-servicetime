// /api/employees   (jeton manager)
//   GET                      → liste des employés actifs
//   POST { name, pin }       → création
//   POST { id, name?, pin? } → modification
//   DELETE ?id=…             → suppression logique (propagée aux bornes via /api/sync)
import { getSql } from '../lib/db.mjs';
import { handler, json, readJson, isUuid, str, HttpError } from '../lib/http.mjs';
import { requireManager, hashPin } from '../lib/auth.mjs';

const pinOk = (p) => typeof p === 'string' && /^\d{4}$/.test(p);

export default handler(['GET', 'POST', 'DELETE'], async (req) => {
  const { tenantId } = requireManager(req);
  const sql = getSql();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, updated_at FROM employees
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL ORDER BY name`;
    return json(200, { employees: rows });
  }

  if (req.method === 'DELETE') {
    const id = new URL(req.url).searchParams.get('id');
    if (!isUuid(id)) throw new HttpError(400, 'id invalide');
    const rows = await sql`
      UPDATE employees
      SET deleted_at = now(), updated_at = now(), seq = nextval(pg_get_serial_sequence('employees','seq'))
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      RETURNING id`;
    if (!rows.length) throw new HttpError(404, 'Employé introuvable');
    return json(200, { ok: true });
  }

  // POST
  const body = await readJson(req, 4096);
  const name = body.name != null ? str(body.name, { min: 1, max: 80, field: 'name' }) : null;
  if (body.pin != null && !pinOk(body.pin)) throw new HttpError(400, 'Le PIN doit faire 4 chiffres');
  const pinHash = body.pin != null ? hashPin(tenantId, body.pin) : null;

  // Deux employés actifs avec le même PIN rendraient la borne ambiguë.
  if (pinHash) {
    const clash = await sql`
      SELECT 1 FROM employees
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND pin_hash = ${pinHash}
        AND (${body.id ?? null}::uuid IS NULL OR id <> ${body.id ?? null}::uuid)`;
    if (clash.length) throw new HttpError(409, 'Ce PIN est déjà utilisé par un autre employé');
  }

  if (!body.id) {
    if (!name || !pinHash) throw new HttpError(400, 'name et pin requis');
    const [row] = await sql`
      INSERT INTO employees (tenant_id, name, pin_hash)
      VALUES (${tenantId}::uuid, ${name}, ${pinHash})
      RETURNING id, name, updated_at`;
    return json(201, { employee: row });
  }

  if (!isUuid(body.id)) throw new HttpError(400, 'id invalide');
  const [row] = await sql`
    UPDATE employees SET
      name = COALESCE(${name}, name),
      pin_hash = COALESCE(${pinHash}, pin_hash),
      updated_at = now(),
      seq = nextval(pg_get_serial_sequence('employees','seq'))
    WHERE id = ${body.id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
    RETURNING id, name, updated_at`;
  if (!row) throw new HttpError(404, 'Employé introuvable');
  return json(200, { employee: row });
});

export const config = { path: '/api/employees' };
