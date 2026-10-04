// Tests d'intégration : vrai Postgres (PGlite, en mémoire) + vrais handlers.
// Lancer : npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { setSql } from '../netlify/lib/db.mjs';
import { hashSecret, hashPin } from '../netlify/lib/auth.mjs';

process.env.TOKEN_SECRET = 'x'.repeat(40);

const db = new PGlite();
// Adaptateur : même interface que neon() (template tagué → lignes).
setSql(async (strings, ...vals) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < vals.length ? `$${i + 1}` : ''), '');
  return (await db.query(text, vals)).rows;
});

const enroll = (await import('../netlify/functions/enroll.mjs')).default;
const login = (await import('../netlify/functions/manager-login.mjs')).default;
const sync = (await import('../netlify/functions/sync.mjs')).default;
const employees = (await import('../netlify/functions/employees.mjs')).default;
const corrections = (await import('../netlify/functions/corrections.mjs')).default;
const report = (await import('../netlify/functions/report.mjs')).default;
const devices = (await import('../netlify/functions/devices.mjs')).default;

const req = (method, path, { body, token } = {}) => new Request('http://x' + path, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const call = async (fn, ...a) => { const r = await fn(req(...a)); return { status: r.status, body: await r.json() }; };

let A, B; // deux établissements
const C0 = { events: 0, employees: 0, corrections: 0 };

before(async () => {
  // gen_random_uuid() est natif depuis PG13 ; PGlite n'embarque pas pgcrypto.
  const schema = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
  await db.exec(schema);
  for (const [slug, name] of [['chaudron66', 'Le Chaudron 66'], ['autre', 'Autre Bar']]) {
    const { rows: [t] } = await db.query(
      'INSERT INTO tenants (slug, name, manager_hash) VALUES ($1,$2,$3) RETURNING id',
      [slug, name, await hashSecret('secret-' + slug)]);
    const { rows: [e] } = await db.query(
      'INSERT INTO employees (tenant_id, name, pin_hash) VALUES ($1,$2,$3) RETURNING id',
      [t.id, 'Marie ' + slug, hashPin(t.id, '1234')]);
    if (slug === 'chaudron66') A = { id: t.id, emp: e.id }; else B = { id: t.id, emp: e.id };
  }
});

test('enrôlement : mauvais code refusé, bon code donne un jeton', async () => {
  const bad = await call(enroll, 'POST', '/api/enroll', { body: { slug: 'chaudron66', code: 'mauvais-code' } });
  assert.equal(bad.status, 401);
  const unknown = await call(enroll, 'POST', '/api/enroll', { body: { slug: 'inexistant', code: 'whatever1' } });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error, bad.body.error, 'ne révèle pas si le slug existe');

  const ok = await call(enroll, 'POST', '/api/enroll', { body: { slug: 'chaudron66', code: 'secret-chaudron66', device_name: 'iPad Bages' } });
  assert.equal(ok.status, 201);
  A.token = ok.body.device_token;
  A.device = ok.body.device_id;
  const okB = await call(enroll, 'POST', '/api/enroll', { body: { slug: 'autre', code: 'secret-autre' } });
  B.token = okB.body.device_token;
});

test('sync : premier pull renvoie les employés avec le hash PIN compatible borne', async () => {
  const r = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [], cursors: C0 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.employees.length, 1);
  assert.equal(r.body.employees[0].pin_hash, hashPin(A.id, '1234'));
  assert.ok(r.body.cursors.employees > 0);
});

test('sync : push idempotent (renvoi après coupure = pas de doublon)', async () => {
  const ev = { id: randomUUID(), employee_id: A.emp, type: 'start', occurred_at: new Date().toISOString(), site: 'Bages', lat: 42.6, lng: 2.9 };
  const r1 = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [ev], cursors: C0 } });
  assert.deepEqual(r1.body.accepted, [ev.id]);
  const r2 = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [ev], cursors: C0 } });
  assert.deepEqual(r2.body.accepted, [ev.id], 'un renvoi est acquitté');
  const { rows } = await db.query('SELECT count(*)::int n FROM clock_events WHERE id=$1', [ev.id]);
  assert.equal(rows[0].n, 1);
});

test('sync : isolation — impossible de pointer pour un employé d\'un autre établissement', async () => {
  const ev = { id: randomUUID(), employee_id: B.emp, type: 'start', occurred_at: new Date().toISOString() };
  const r = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [ev], cursors: C0 } });
  assert.deepEqual(r.body.accepted, []);
  assert.equal(r.body.rejected[0].reason, 'employe_inconnu');
  // et B ne voit pas les pointages de A
  const rb = await call(sync, 'POST', '/api/sync', { token: B.token, body: { events: [], cursors: C0 } });
  assert.equal(rb.body.events.length, 0);
  assert.ok(rb.body.employees.every((e) => e.id === B.emp));
});

test('sync : validation des événements', async () => {
  const bad = [
    { id: 'pas-un-uuid', employee_id: A.emp, type: 'start', occurred_at: new Date().toISOString() },
    { id: randomUUID(), employee_id: A.emp, type: 'café', occurred_at: new Date().toISOString() },
    { id: randomUUID(), employee_id: A.emp, type: 'end', occurred_at: '2020-01-01T00:00:00Z' },
  ];
  const r = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: bad, cursors: C0 } });
  assert.deepEqual(r.body.rejected.map((x) => x.reason), ['id', 'type', 'occurred_at_ancien']);
});

test('sync : un 2e appareil voit les pointages du 1er (multi-appareil)', async () => {
  const second = await call(enroll, 'POST', '/api/enroll', { body: { slug: 'chaudron66', code: 'secret-chaudron66', device_name: 'Téléphone' } });
  const r = await call(sync, 'POST', '/api/sync', { token: second.body.device_token, body: { events: [], cursors: C0 } });
  assert.equal(r.body.events.length, 1);
  assert.equal(r.body.events[0].type, 'start');
  // curseur : un pull suivant ne renvoie que le recouvrement, rien de nouveau
  const r2 = await call(sync, 'POST', '/api/sync', { token: second.body.device_token, body: { events: [], cursors: r.body.cursors } });
  assert.deepEqual(r2.body.cursors, r.body.cursors);
});

test('manager : force brute bloquée après 5 échecs', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await call(login, 'POST', '/api/manager-login', { body: { slug: 'autre', code: 'mauvais' + i } });
    assert.equal(r.status, 401);
  }
  const blocked = await call(login, 'POST', '/api/manager-login', { body: { slug: 'autre', code: 'secret-autre' } });
  assert.equal(blocked.status, 429, 'même le bon code est refusé pendant le blocage');
});

test('manager : employés, PIN en double, suppression propagée aux bornes', async () => {
  const { body: { token } } = await call(login, 'POST', '/api/manager-login', { body: { slug: 'chaudron66', code: 'secret-chaudron66' } });
  A.mgr = token;

  assert.equal((await call(employees, 'GET', '/api/employees', { token: A.token })).status, 401, 'jeton appareil ≠ jeton manager');

  const dup = await call(employees, 'POST', '/api/employees', { token, body: { name: 'Thomas', pin: '1234' } });
  assert.equal(dup.status, 409);
  const created = await call(employees, 'POST', '/api/employees', { token, body: { name: 'Thomas', pin: '5678' } });
  assert.equal(created.status, 201);

  const before = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [], cursors: C0 } });
  const del = await call(employees, 'DELETE', `/api/employees?id=${created.body.employee.id}`, { token });
  assert.equal(del.status, 200);
  const after = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [], cursors: before.body.cursors } });
  const t = after.body.employees.find((e) => e.id === created.body.employee.id);
  assert.ok(t && t.deleted_at, 'la suppression arrive à la borne via le curseur');
});

test('manager : correction (heure française) et annulation de pointage', async () => {
  const c = await call(corrections, 'POST', '/api/corrections', { token: A.mgr, body: {
    employee_id: A.emp, work_date: '2026-10-04', field: 'start', time: '09:30', reason: 'Oubli de badge' } });
  assert.equal(c.status, 201);
  assert.equal(new Date(c.body.correction.corrected_at).toISOString(), '2026-10-04T07:30:00.000Z', 'heure d\'été : UTC+2');

  const ev = { id: randomUUID(), employee_id: A.emp, type: 'end', occurred_at: new Date().toISOString() };
  const s1 = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [ev], cursors: C0 } });
  const v = await call(corrections, 'POST', '/api/corrections', { token: A.mgr, body: { void_event_id: ev.id, reason: 'Doublon' } });
  assert.equal(v.status, 200);
  const s2 = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [], cursors: s1.body.cursors } });
  assert.ok(s2.body.events.find((e) => e.id === ev.id)?.voided_at, 'l\'annulation est propagée');

  const other = await call(corrections, 'POST', '/api/corrections', { token: A.mgr, body: { void_event_id: ev.id, reason: 'encore' } });
  assert.equal(other.status, 404);
});

test('rapport + vue des horloges suspectes', async () => {
  const future = { id: randomUUID(), employee_id: A.emp, type: 'pause_start', occurred_at: new Date(Date.now() + 3600e3).toISOString() };
  await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [future], cursors: C0 } });
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const r = await call(report, 'GET', `/api/report?from=${today}&to=${tomorrow}`, { token: A.mgr });
  assert.equal(r.status, 200);
  assert.ok(r.body.events.length >= 3);
  assert.ok(r.body.suspicious.some((s) => s.id === future.id && s.motif === 'horloge_en_avance'));
  assert.ok(r.body.events.every((e) => e.employee_id === A.emp));
});

test('révocation : un appareil révoqué ne synchronise plus', async () => {
  const del = await call(devices, 'DELETE', `/api/devices?id=${A.device}`, { token: A.mgr });
  assert.equal(del.status, 200);
  const r = await call(sync, 'POST', '/api/sync', { token: A.token, body: { events: [], cursors: C0 } });
  assert.equal(r.status, 401);
});
