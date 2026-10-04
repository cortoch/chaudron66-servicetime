// POST /api/manager-login  { slug, code }
// Ouvre une session manager de 12 h (dashboard depuis n'importe quel appareil).
import { handler, json, readJson, str } from '../lib/http.mjs';
import { checkManagerCode, signManagerToken } from '../lib/auth.mjs';

export default handler(['POST'], async (req) => {
  const body = await readJson(req, 4096);
  const slug = str(body.slug, { min: 2, max: 40, field: 'slug' }).toLowerCase();
  const code = str(body.code, { min: 6, max: 128, field: 'code' });

  const { tenantId, tenantName } = await checkManagerCode(slug, code);
  return json(200, { token: signManagerToken(tenantId), tenant_id: tenantId, tenant_name: tenantName, expires_in: 12 * 3600 });
});

export const config = { path: '/api/manager-login' };
