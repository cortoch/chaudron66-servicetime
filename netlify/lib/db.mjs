// Accès base : driver HTTP Neon (une requête = un appel HTTPS, idéal en serverless).
// `sql` s'utilise en template tagué : await sql`SELECT ... WHERE id = ${id}`
// Les valeurs interpolées sont TOUJOURS envoyées en paramètres ($1, $2…), jamais concaténées.
import { neon } from '@neondatabase/serverless';

let _sql = null;

export function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  _sql = neon(url);
  return _sql;
}

// Pour les tests : injecter un autre exécuteur compatible (même signature tagged-template).
export function setSql(fn) { _sql = fn; }

export const TZ = 'Europe/Paris';
