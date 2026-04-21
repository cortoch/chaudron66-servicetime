# Ylelor — Documentation projet
## Mise à jour : avril 2026

---

## 🗂️ Vue d'ensemble

**Ylelor** est une application SaaS de pointage web, vendable à tout établissement (restaurants, bars, commerces).  
Chaque client dispose de sa propre configuration (logo, couleurs, sites GPS) isolée par `tenant_id` dans une infrastructure Supabase partagée.

Le premier client est **Le Chaudron 66** (pub, sites Bages et Cabestany, Pyrénées-Orientales).

---

## 🏗️ Architecture

| Composant | Technologie | Rôle |
|---|---|---|
| App pointeuse | `index.html` (HTML/CSS/JS) | Interface employés + manager, configurable par tenant |
| Tableau de bord | `dashboard.html` | Suivi temps réel, filtré par tenant |
| Config client | `config/{slug}.json` | Paramètres de référence de chaque établissement |
| Hébergement | Netlify (via GitHub) | HTTPS, déploiement automatique |
| Base de données | Supabase (PostgreSQL) | Pointages, employés, tenants |
| Stockage photos | Supabase Storage (bucket `photos`) | Photos organisées par `{tenant_id}/` |

---

## 🔑 Credentials & config

| Clé | Valeur |
|---|---|
| Supabase URL | `https://sxgxslkhzulivdbtwmuy.supabase.co` |
| Supabase anon key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4Z3hzbGtoenVsaXZkYnR3bXV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjkzOTIsImV4cCI6MjA4OTYwNTM5Mn0.YhMpHRGSx5JSlNb3Jouf4CBzbQ_2AUxQALzFzA8iUVs` |
| Code manager défaut | `1966` (modifiable dans l'app) |
| Code employé Marie Martin | `1234` |
| Code employé Thomas Dupont | `5678` |

---

## 🏢 Tenants

| Client | tenant_id | Slug |
|---|---|---|
| Le Chaudron 66 | `a1b2c3d4-0001-0001-0001-chaudron6601` | `chaudron66` |

### Ajouter un client
1. Insérer dans Supabase : `INSERT INTO tenants (id, name, slug) VALUES ('uuid', 'Nom', 'slug');`
2. Copier `index.html`, modifier le bloc `TENANT_CFG` (TENANT_ID, company_name, couleurs, logo, sites GPS)
3. Déployer sur un Netlify séparé ou sous-domaine

---

## 🗄️ Supabase — Schéma

### `tenants`
```sql
id   text PRIMARY KEY
name text NOT NULL
slug text UNIQUE
```

### `records`
```sql
id             text PRIMARY KEY
tenant_id      text REFERENCES tenants(id)
emp_id         text
emp_name       text
site           text
date           text
events         jsonb
correction_log jsonb
updated_at     timestamptz
```

### `employees`
```sql
id         text PRIMARY KEY
tenant_id  text REFERENCES tenants(id)
name       text
pin        text        -- hashé côté client
created_at timestamptz
```

### Bucket Storage : `photos`
- Bucket privé, policy `allow-all` : SELECT + INSERT (rôle `public`)
- Fichiers : `{tenant_id}/{emp_id}_{date}_{type}.jpg`
- Suppression automatique après 31 jours

---

## ⚙️ Config tenant dans `index.html`

Le bloc `TENANT_CFG` en haut du JS contient tout ce qu'un client peut personnaliser :

```js
const TENANT_CFG = {
  tenant_id:           'a1b2c3d4-0001-0001-0001-chaudron6601',
  company_name:        'Le Chaudron 66',
  primary_color:       '#c8913a',
  primary_color_light: '#e8b86d',
  logo_base64:         '',   // data:image/png;base64,... ou vide pour SVG
  logo_svg:            `...`,
  sites: [
    { id, name, label, lat, lng, radius_m, badge_class },
  ],
};
```

`applyTenantConfig()` est appelée au boot : injecte couleurs CSS, logo, nom et sites GPS.

---

## 🗑️ Politique de rétention

| Donnée | Local (iPhone) | Supabase |
|---|---|---|
| Pointages | Purgés après 31 jours | Conservés indéfiniment |
| Photos | Purgées après 31 jours | Supprimées après 31 jours |
| Employés | Toujours présents | Synchronisés à la demande |

---

## ✅ Fonctionnalités implémentées

### Core
- [x] Code PIN 4 chiffres par employé
- [x] Accès manager : maintien bouton `0` (3s) + code PIN
- [x] GPS automatique (Haversine, rayon 150m), timeout 5s
- [x] Photo silencieuse à chaque pointage + watermark
- [x] Timeline employé, pauses multiples, horloge temps réel

### Manager
- [x] Tableau du jour, historique, gestion employés
- [x] Correction horodatages avec validation chronologique
- [x] Suppression entrée avec confirmation
- [x] Export CSV (jour / mois)

### Stockage & sync
- [x] Upload photos Supabase Storage au pointage
- [x] Fallback base64 local si hors ligne
- [x] Sync auto à chaque pointage + sync manuelle
- [x] Pull depuis Supabase au démarrage
- [x] Purge locale + cloud à 31 jours
- [x] localStorage préfixé `ylelor_{tenant_id}_`

### Multi-tenant
- [x] Table `tenants`, colonne `tenant_id` sur `records` et `employees`
- [x] Toutes les requêtes filtrées par `tenant_id`
- [x] Photos dans `{tenant_id}/` dans le bucket
- [x] `TENANT_CFG` + `applyTenantConfig()` pour personnalisation complète

### Sécurité & conformité
- [x] Détection manipulation horloge (écart > 2 min vs Supabase)
- [x] Alerte pause légale (Art. L3121-16, > 6h sans pause)
- [x] PIN hashés côté client

### Dashboard
- [x] Stats temps réel, filtres date/site, photos signées, export CSV
- [x] Actualisation auto toutes les minutes, filtrage par `tenant_id`

---

## 🔲 À faire

### Notifications
- [ ] Supabase Edge Function + Resend (email) + Brevo/Twilio (SMS)
- [ ] Alertes : arrivée/départ, heure suspecte, hors zone, pause > 6h

### Produit
- [ ] Domaine Netlify personnalisé (ex: `pointeuse.lechaudron66.fr`)
- [ ] Protection dashboard par mot de passe
- [ ] Export photos ZIP depuis le dashboard
- [ ] Rapport hebdomadaire email
- [ ] Interface onboarding nouveau client (sans toucher au code)
- [ ] Renommer le dépôt GitHub `ylelor` (ou `ylelor-app`)

---

## 📁 Structure du dépôt

```
chaudron66-servicetime/
├── index.html              ← App Ylelor (employés + manager)
├── dashboard.html          ← Tableau de bord web
├── config/
│   └── lechaudron66.json   ← Config de référence Le Chaudron 66
├── CLAUDE.md               ← Cette documentation
└── README.md               ← Présentation publique
```

---

## 🚀 Déploiement

1. Modifier `index.html` ou `dashboard.html`
2. Push sur GitHub → `chaudron66-servicetime`
3. Netlify redéploie automatiquement (~30s)

---

## 🐛 Historique corrections

- Bug syntaxe JS `syncNow` (backtick/apostrophe) → horloge et GPS cassés
- Clé Supabase publishable au lieu de anon → photos non uploadées
- Logo absent dans `dashboard.html`
- GPS : timeout JS forcé 5s (Safari iOS ignore le paramètre natif)
- Pauses multiples : validation chronologique `saveEdit` incomplète
- Pauses multiples : colonne durée manquante
- Purge pointages Supabase retirée (historique conservé indéfiniment)
- **Avril 2026** : renommage ServiceTime → Ylelor
- **Avril 2026** : architecture multi-tenant (tenant_id, TENANT_CFG, applyTenantConfig)
