/* ════════════════════════════════════════════════════════════
 *  Ylelor — synchronisation borne ⇄ serveur (Neon via Netlify Functions)
 *
 *  Principe « hors ligne d'abord » :
 *   1. un pointage est écrit IMMÉDIATEMENT en local (l'employé n'attend jamais le réseau) ;
 *   2. il part dans une file d'attente (outbox) ;
 *   3. la file est vidée dès que possible : après chaque pointage, au retour
 *      du réseau, au réveil de l'app, et toutes les 60 s.
 *
 *  Chaque pointage porte un UUID généré ici : un renvoi est sans effet côté serveur.
 *  Usage : <script src="js/sync.js"></script> puis window.YlelorSync.*
 * ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = '/api';
  const P = 'ylelor_';
  const RETENTION_DAYS = 35;
  const listeners = new Set();
  let flushing = null;
  let timer = null;

  // ── Stockage local ─────────────────────────────────────────
  const get = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { console.warn('localStorage plein ?', e); } };

  const device = () => get('device', null); // { device_id, device_token, tenant_id, tenant_name }
  const emit = (type, detail) => listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.error(e); } });

  function mergeById(key, rows) {
    if (!rows.length) return;
    const map = new Map(get(key, []).map((r) => [r.id, r]));
    for (const r of rows) map.set(r.id, { ...map.get(r.id), ...r });
    set(key, [...map.values()]);
  }

  function purgeOld() {
    const limit = Date.now() - RETENTION_DAYS * 86400e3;
    set('events', get('events', []).filter((e) => Date.parse(e.occurred_at) >= limit));
    const d = new Date(limit).toISOString().slice(0, 10);
    set('corrections', get('corrections', []).filter((c) => c.work_date >= d));
  }

  // ── PIN : même format que le serveur (sha256 de "tenant_id:pin") ──
  async function hashPin(tenantId, pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${tenantId}:${pin}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyPin(pin) {
    const d = device();
    if (!d) return null;
    const h = await hashPin(d.tenant_id, pin);
    return get('employees', []).find((e) => !e.deleted_at && e.pin_hash === h) || null;
  }

  // ── Réseau ─────────────────────────────────────────────────
  async function call(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  // ── Enrôlement (une fois par appareil, avec le code manager) ──
  async function enroll(slug, code, deviceName) {
    const d = await call('/enroll', { method: 'POST', body: { slug, code, device_name: deviceName } });
    set('device', d);
    set('cursors', { events: 0, employees: 0, corrections: 0 });
    emit('enrolled', d);
    await flush();
    return d;
  }

  function forget() {
    ['device', 'cursors', 'outbox', 'events', 'employees', 'corrections'].forEach((k) => localStorage.removeItem(P + k));
    emit('change', {});
  }

  // ── Pointage ───────────────────────────────────────────────
  // ev = { employee_id, type, site?, lat?, lng?, accuracy_m?, out_of_zone? }
  function record(ev) {
    const full = { ...ev, id: crypto.randomUUID(), occurred_at: new Date().toISOString() };
    set('outbox', [...get('outbox', []), full]);
    mergeById('events', [{ ...full, pending: true }]);
    emit('change', { events: [full] });
    flush(); // sans await : l'interface ne bloque pas
    return full;
  }

  // ── Synchronisation ────────────────────────────────────────
  function flush() {
    if (flushing) return flushing;           // une seule synchro à la fois
    flushing = (async () => {
      const d = device();
      if (!d || !navigator.onLine) return { ok: false, reason: d ? 'offline' : 'not_enrolled' };
      try {
        let more = true, guard = 0;
        while (more && guard++ < 20) {
          const batch = get('outbox', []).slice(0, 500);
          const res = await call('/sync', {
            method: 'POST', token: d.device_token,
            body: { events: batch, cursors: get('cursors', { events: 0, employees: 0, corrections: 0 }) },
          });

          // Retirer de la file ce que le serveur a traité (accepté ou rejeté définitivement).
          const done = new Set([...res.accepted, ...res.rejected.map((r) => r.id)]);
          set('outbox', get('outbox', []).filter((e) => !done.has(e.id)));
          if (res.rejected.length) { console.warn('Pointages rejetés', res.rejected); emit('rejected', res.rejected); }

          mergeById('employees', res.employees);
          mergeById('events', [...res.events.map((e) => ({ ...e, pending: false })),
                               ...get('events', []).filter((e) => res.accepted.includes(e.id)).map((e) => ({ id: e.id, pending: false }))]);
          mergeById('corrections', res.corrections);
          set('cursors', res.cursors);

          // Écart d'horloge : mesuré à chaque synchro, utile pour alerter le manager.
          set('clockSkewMs', Date.now() - Date.parse(res.server_time));

          more = res.more || get('outbox', []).length > 0 && batch.length === 500;
        }
        purgeOld();
        set('lastSync', new Date().toISOString());
        emit('change', {});
        emit('synced', { pending: get('outbox', []).length });
        return { ok: true };
      } catch (e) {
        if (e.status === 401) { emit('revoked', e); return { ok: false, reason: 'revoked' }; }
        emit('error', e);
        return { ok: false, reason: e.message };
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  // ── Sessions manager (dashboard, n'importe quel appareil) ──
  async function managerLogin(slug, code) {
    const r = await call('/manager-login', { method: 'POST', body: { slug, code } });
    sessionStorage.setItem(P + 'mgr', JSON.stringify({ token: r.token, exp: Date.now() + r.expires_in * 1000 }));
    return r;
  }
  function mgrToken() {
    try { const s = JSON.parse(sessionStorage.getItem(P + 'mgr')); return s && s.exp > Date.now() ? s.token : null; } catch { return null; }
  }
  const manager = {
    login: managerLogin,
    logout: () => sessionStorage.removeItem(P + 'mgr'),
    isLogged: () => !!mgrToken(),
    api: (path, opts = {}) => call(path, { ...opts, token: mgrToken() }),
  };

  // ── Démarrage automatique ──────────────────────────────────
  function start() {
    if (timer) return;
    window.addEventListener('online', () => flush());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
    timer = setInterval(flush, 60000);
    flush();
  }

  window.YlelorSync = {
    enroll, forget, record, flush, start, verifyPin, hashPin, manager,
    isEnrolled: () => !!device(),
    device,
    employees: () => get('employees', []).filter((e) => !e.deleted_at),
    events: () => get('events', []).filter((e) => !e.voided_at),
    corrections: () => get('corrections', []),
    pendingCount: () => get('outbox', []).length,
    lastSync: () => get('lastSync', null),
    clockSkewMs: () => get('clockSkewMs', 0),
    on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
