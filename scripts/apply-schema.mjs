// Applique db/schema.sql sur la base Neon pointée par DATABASE_URL.
// Usage : DATABASE_URL="postgres://…" npm run db:schema
// Le schéma est idempotent (IF NOT EXISTS) : relançable sans risque.
import { readFile } from 'node:fs/promises';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL manquant'); process.exit(1); }

const sqlText = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const pool = new Pool({ connectionString: url });
try {
  await pool.query(sqlText);
  console.log('✓ Schéma appliqué');
} finally {
  await pool.end();
}
