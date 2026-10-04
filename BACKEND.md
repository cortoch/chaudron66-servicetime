# Ylelor — backend en ligne (Neon + Netlify Functions)

## Architecture

```
iPad / téléphone ──HTTPS──▶ Netlify Functions (/api/*) ──▶ Neon Postgres (UE)
   localStorage               jetons vérifiés ici            DATABASE_URL jamais exposée
   (hors ligne d'abord)
```

- **Pointages en ajout seul** : UUID généré sur l'appareil, renvoi sans doublon, aucun conflit entre appareils.
- **Corrections et annulations** : lignes séparées, l'événement d'origine n'est jamais modifié (traçabilité).
- **Employés** : seule donnée modifiable, « dernière écriture gagne », suppression logique.
- **Horloge** : `received_at` posé par le serveur ; la vue `suspicious_events` signale horloge en avance ou synchro très tardive.

## Mise en route (une fois)

1. Créer un projet sur neon.tech, région **AWS Europe (Frankfurt)**. Copier la chaîne de connexion.
2. Appliquer le schéma :
   ```bash
   npm install
   DATABASE_URL="postgres://…" npm run db:schema
   ```
3. Créer l'établissement :
   ```bash
   DATABASE_URL="postgres://…" npm run tenant:create -- \
     --slug chaudron66 --name "Le Chaudron 66" --code "<code manager, 6 caractères min>" \
     --employee "Marie Martin:1234" --employee "Thomas Dupont:5678"
   ```
4. Dans Netlify → *Site configuration → Environment variables* :
   - `DATABASE_URL` : chaîne Neon (utiliser l'URL **pooled**)
   - `TOKEN_SECRET` : 32+ caractères aléatoires (`openssl rand -base64 48`)
5. Pousser sur GitHub : Netlify déploie les fonctions automatiquement.

## API

| Route | Auth | Rôle |
|---|---|---|
| `POST /api/enroll` | code manager | Enrôle un appareil, renvoie un jeton longue durée |
| `POST /api/manager-login` | code manager | Session manager 12 h |
| `POST /api/sync` | jeton appareil | Push des pointages + pull des changements (curseurs) |
| `GET/POST/DELETE /api/employees` | manager | Gestion des employés |
| `POST /api/corrections` | manager | Correction d'heure (`field`, `time`) ou annulation (`void_event_id`) |
| `GET /api/report?from&to` | manager | Données pour dashboard / CSV (93 j max) |
| `GET/DELETE /api/devices` | manager | Liste et révocation des appareils |

Sécurité : code manager haché scrypt, blocage 15 min après 5 échecs, jetons appareil stockés hachés et révocables, isolation par `tenant_id` dans chaque requête (testée).

## Côté client

`js/sync.js` expose `window.YlelorSync` : `enroll()`, `record()`, `flush()`, `start()`, `verifyPin()`, `employees()`, `events()`, `manager.login()`, `manager.api()`, `on(fn)`.

Limite assumée : le PIN employé (4 chiffres) est vérifié sur la borne pour fonctionner hors ligne. 10 000 combinaisons, donc aucun hachage ne le protège si la liste fuit ; elle n'est servie qu'aux appareils enrôlés.

## Tests

```bash
npm test   # Postgres en mémoire (PGlite), aucun accès réseau
```
