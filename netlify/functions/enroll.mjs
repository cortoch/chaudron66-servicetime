// POST /api/enroll  { slug, code, device_name }
// Enrôle un appareil (iPad borne, téléphone…) avec le code manager.
// Renvoie un jeton appareil à stocker localement ; il n'est affiché qu'une fois.
import { getSql } from '../lib/db.mjs';
import { handler, json, readJson, str } from '../lib/http.mjs';
import { checkManagerCode, newDeviceToken, sha256 } from '../lib/auth.mjs';

export default handler(['POST'], async (req) => {
  const body = await readJson(req, 4096);
  const slug = str(body.slug, { min: 2, max: 40, field: 'slug' }).toLowerCase();
  const code = str(body.code, { min: 6, max: 128, field: 'code' });
  const name = str(body.device_name ?? 'Appareil', { min: 1, max: 60, field: 'device_name' });

  const { tenantId, tenantName } = await checkManagerCode(slug, code);

  const token = newDeviceToken();
  const sql = getSql();
  const [dev] = await sql`
    INSERT INTO devices (tenant_id, name, token_hash)
    VALUES (${tenantId}, ${name}, ${sha256(token)})
    RETURNING id`;

  return json(201, { device_id: dev.id, device_token: token, tenant_id: tenantId, tenant_name: tenantName });
});

export const config = { path: '/api/enroll' };
