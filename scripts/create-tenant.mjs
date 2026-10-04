// Crée un établissement (et éventuellement ses employés).
// Usage :
//   DATABASE_URL="postgres://…" npm run tenant:create -- \
//     --slug chaudron66 --name "Le Chaudron 66" --code "<code manager ≥ 6 caractères>" \
//     --employee "Marie Martin:1234" --employee "Thomas Dupont:5678"
//
// Le code manager est haché (scrypt) avant insertion ; il n'est jamais stocké en clair.
import { parseArgs } from 'node:util';
import { neon } from '@neondatabase/serverless';
import { hashSecret, hashPin } from '../netlify/lib/auth.mjs';

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    code: { type: 'string' },
    employee: { type: 'string', multiple: true, default: [] },
  },
});

const fail = (m) => { console.error('✗ ' + m); process.exit(1); };
if (!process.env.DATABASE_URL) fail('DATABASE_URL manquant');
if (!/^[a-z0-9-]{2,40}$/.test(values.slug || '')) fail('--slug requis (a-z, 0-9, tirets)');
if (!values.name) fail('--name requis');
if (!values.code || values.code.length < 6) fail('--code requis (6 caractères minimum)');

const emps = values.employee.map((s) => {
  const i = s.lastIndexOf(':');
  const name = s.slice(0, i).trim(), pin = s.slice(i + 1);
  if (!name || !/^\d{4}$/.test(pin)) fail(`--employee "${s}" : format attendu "Nom:1234"`);
  return { name, pin };
});
if (new Set(emps.map((e) => e.pin)).size !== emps.length) fail('Deux employés ont le même PIN');

const sql = neon(process.env.DATABASE_URL);
const [t] = await sql`
  INSERT INTO tenants (slug, name, manager_hash)
  VALUES (${values.slug}, ${values.name}, ${await hashSecret(values.code)})
  RETURNING id`;

for (const e of emps) {
  await sql`INSERT INTO employees (tenant_id, name, pin_hash) VALUES (${t.id}, ${e.name}, ${hashPin(t.id, e.pin)})`;
}

console.log(`✓ Établissement « ${values.name} » créé`);
console.log(`  tenant_id : ${t.id}`);
console.log(`  slug      : ${values.slug}`);
console.log(`  employés  : ${emps.length}`);
