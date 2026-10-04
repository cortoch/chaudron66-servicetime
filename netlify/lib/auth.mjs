import { scrypt as _scrypt, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSql } from './db.mjs';
import { HttpError } from './http.mjs';

const scrypt = promisify(_scrypt);

// ── Code manager : scrypt (lent volontairement) ────────────────
export async function hashSecret(secret) {
  const salt = randomBytes(16);
  const key = await scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifySecret(secret, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(secret, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(key, expected);
}

// ── PIN employé (4 chiffres) ───────────────────────────────────
// Format partagé avec la borne, qui vérifie le PIN HORS LIGNE (js/sync.js → hashPin).
// Honnêtement : 10 000 combinaisons, donc aucun hash ne protège un PIN de 4 chiffres
// contre quelqu'un qui récupère la liste. Le sel par établissement évite seulement
// les tables précalculées partagées. La vraie protection, c'est que la liste
// n'est servie qu'aux appareils enrôlés.
export const hashPin = (tenantId, pin) =>
  createHash('sha256').update(`${tenantId}:${pin}`).digest('hex');

// ── Jetons appareil (longue durée, révocables) ─────────────────
export const newDeviceToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function bearer(req) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  if (!m) throw new HttpError(401, 'Authentification requise');
  return m[1];
}

export async function requireDevice(req) {
  const token = bearer(req);
  const sql = getSql();
  const rows = await sql`
    UPDATE devices SET last_seen_at = now()
    WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL
    RETURNING id, tenant_id`;
  if (!rows.length) throw new HttpError(401, 'Appareil non autorisé ou révoqué');
  return { deviceId: rows[0].id, tenantId: rows[0].tenant_id };
}

// ── Jeton manager (12 h, signé HMAC, sans état) ────────────────
const MANAGER_TTL_S = 12 * 3600;

function secretKey() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error('TOKEN_SECRET manquant ou trop court (≥ 32 caractères)');
  return s;
}

export function signManagerToken(tenantId) {
  const payload = Buffer.from(JSON.stringify({
    t: tenantId, r: 'manager', exp: Math.floor(Date.now() / 1000) + MANAGER_TTL_S,
  })).toString('base64url');
  const sig = createHmac('sha256', secretKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function requireManager(req) {
  const token = bearer(req);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new HttpError(401, 'Jeton invalide');
  const expected = createHmac('sha256', secretKey()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Jeton invalide');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new HttpError(401, 'Jeton invalide'); }
  if (data.r !== 'manager' || !data.t) throw new HttpError(401, 'Jeton invalide');
  if (data.exp < Date.now() / 1000) throw new HttpError(401, 'Session expirée');
  return { tenantId: data.t };
}

// ── Vérification code manager avec anti force brute ────────────
// 5 échecs en 15 min → blocage de l'établissement pendant 15 min.
const MAX_FAILS = 5;

export async function checkManagerCode(slug, code) {
  const sql = getSql();
  const [tenant] = await sql`SELECT id, name, manager_hash FROM tenants WHERE slug = ${slug}`;
  // Même message que pour un mauvais code : ne pas révéler quels établissements existent.
  if (!tenant) { await verifySecret(code, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='); throw new HttpError(401, 'Identifiants incorrects'); }

  const [{ fails }] = await sql`
    SELECT count(*)::int AS fails FROM login_attempts
    WHERE tenant_id = ${tenant.id} AND ok = false AND attempted_at > now() - interval '15 minutes'`;
  if (fails >= MAX_FAILS) throw new HttpError(429, 'Trop de tentatives, réessayez dans 15 minutes');

  const ok = await verifySecret(code, tenant.manager_hash);
  await sql`INSERT INTO login_attempts (tenant_id, ok) VALUES (${tenant.id}, ${ok})`;
  if (!ok) throw new HttpError(401, 'Identifiants incorrects');
  return { tenantId: tenant.id, tenantName: tenant.name };
}
