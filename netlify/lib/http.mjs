export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

export async function readJson(req, maxBytes = 512 * 1024) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Requête trop volumineuse');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'JSON invalide'); }
}

// Enveloppe commune : méthode autorisée, gestion d'erreurs, jamais de détail SQL renvoyé au client.
export function handler(methods, fn) {
  return async (req, context) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (!methods.includes(req.method)) return json(405, { error: 'Méthode non autorisée' });
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: 'Erreur serveur' });
    }
  };
}

// ── Validation légère (pas de dépendance) ──
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));
export const isIsoTs = (v) => typeof v === 'string' && v.length <= 40 && !isNaN(Date.parse(v));

export function str(v, { min = 0, max = 200, field = 'champ' } = {}) {
  if (typeof v !== 'string') throw new HttpError(400, `${field} manquant`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${field} invalide`);
  return s;
}
