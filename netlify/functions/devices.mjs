// /api/devices   (jeton manager)
//   GET            → appareils enrôlés (dernier contact)
//   DELETE ?id=…   → révoque un appareil (iPad perdu, téléphone d'un ancien gérant…)
import { getSql } from '../lib/db.mjs';
import { handler, json, isUuid, HttpError } from '../lib/http.mjs';
import { requireManager } from '../lib/auth.mjs';

export default handler(['GET', 'DELETE'], async (req) => {
  const { tenantId } = requireManager(req);
  const sql = getSql();

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT id, name, created_at, last_seen_at, revoked_at FROM devices
      WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC`;
    return json(200, { devices: rows });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!isUuid(id)) throw new HttpError(400, 'id invalide');
  const rows = await sql`
    UPDATE devices SET revoked_at = now()
    WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND revoked_at IS NULL
    RETURNING id`;
  if (!rows.length) throw new HttpError(404, 'Appareil introuvable ou déjà révoqué');
  return json(200, { ok: true });
});

export const config = { path: '/api/devices' };
