# ServiceTime — Le Chaudron 66
## Documentation projet · Mise à jour : mars 2026

---

## 🗂️ Vue d'ensemble

Application de pointage web pour les employés du Chaudron 66 (sites Bages et Cabestany).
Fichier HTML unique, hébergé sur Netlify, données stockées sur Supabase.

---

## 🏗️ Architecture

| Composant | Technologie | Rôle |
|---|---|---|
| App pointeuse | `index.html` (HTML/CSS/JS) | Interface employés et manager |
| Tableau de bord | `dashboard.html` | Suivi temps réel depuis n'importe quel appareil |
| Hébergement | Netlify (via GitHub) | HTTPS, déploiement automatique |
| Base de données | Supabase (PostgreSQL) | Stockage pointages et employés |
| Stockage photos | Supabase Storage (bucket `photos`) | Photos de pointage |

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

## 🗄️ Supabase — Tables créées

### `records`
Stocke les pointages (heures, pauses, GPS, photos).
```sql
id text PRIMARY KEY
emp_id text
emp_name text
site text
date text
events jsonb        -- tableau des événements (start, pause_start, pause_end, end)
correction_log jsonb
updated_at timestamptz
```

### `employees`
Stocke les employés et leurs PIN hashés.
```sql
id text PRIMARY KEY
name text
pin text            -- hashé côté client
created_at timestamptz
```

### Bucket Storage : `photos`
- Bucket privé (non public)
- Policy `allow-all` : SELECT + INSERT pour le rôle `public`
- Les photos sont accessibles via URL signée (1h) générée à la demande

---

## ✅ Ce qui est fait

### Fonctionnalités core
- [x] Écran de verrouillage avec code PIN par employé (4 chiffres)
- [x] Accès manager par maintien du bouton `0` (3 secondes) + code PIN
- [x] Détection GPS automatique avec identification du site (Bages / Cabestany)
- [x] Timeout GPS de 5 secondes — si pas de fix, pointage autorisé quand même
- [x] Alerte visuelle si hors zone GPS (signalé au manager mais non bloquant)
- [x] Prise de photo obligatoire à chaque pointage
- [x] Photo avec watermark horodaté (nom, site, GPS, date/heure)
- [x] Timeline des événements du jour par employé
- [x] Actions : Début de service, Pause, Reprise, Fin de service
- [x] Horloge temps réel en haut de page

### Manager
- [x] Tableau des pointages du jour avec filtres par site
- [x] Historique consultable par date
- [x] Gestion des employés (ajout, suppression, PIN)
- [x] Correction des horodatages avec validation chronologique :
  - Fin ne peut pas être avant le début
  - Début ne peut pas être après une pause existante
  - Message d'erreur précis avec les heures en conflit
- [x] Suppression complète d'une entrée (avec confirmation)
- [x] Export CSV (jour / mois)

### Stockage & synchronisation
- [x] Photos uploadées vers Supabase Storage au moment du pointage
- [x] Fallback base64 local si hors ligne au moment du pointage
- [x] Synchronisation des pointages vers Supabase (auto à chaque pointage + manuelle)
- [x] Synchronisation des employés vers Supabase (manuelle)
- [x] Chargement des données Supabase au démarrage de l'app (sync bidirectionnelle)
- [x] Purge automatique des données locales > 31 jours

### Sécurité & conformité
- [x] Détection de manipulation d'horloge (comparaison heure locale vs serveur Supabase)
  - Alerte ⚠️ "Heure suspecte" visible dans le tableau manager si écart > 2 min
  - Détail au survol : heure locale, heure serveur, écart en minutes
  - Non bloquant — signalement uniquement
- [x] Alerte pause obligatoire (Code du travail – Art. L3121-16)
  - Affiché sur l'écran employé si > 6h travaillées sans pause
  - Rafraîchissement automatique toutes les minutes

### Interface & UX
- [x] Design dark mode avec couleurs identitaires Chaudron 66
- [x] Vrai logo du Chaudron intégré en base64 (fonctionne sans réseau)
- [x] Compatible iPhone/iPad (Safari, ajout écran d'accueil)
- [x] Meta tags PWA (plein écran, status bar)
- [x] Indicateur de connectivité (point vert/rouge)
- [x] Toasts de confirmation/erreur
- [x] Animations de transition entre écrans

### Tableau de bord web (`dashboard.html`)
- [x] Stats temps réel : présents, par site, mois
- [x] Filtres par date et par site
- [x] Photos cliquables (URL signée Supabase à la demande)
- [x] Export CSV depuis le tableau
- [x] Actualisation automatique toutes les minutes
- [x] Vrai logo du Chaudron intégré

---

## 🔲 Ce qui reste à faire

### Notifications (priorité haute)
- [ ] **Compte Resend** à créer (resend.com — gratuit jusqu'à 3000 emails/mois)
- [ ] **Compte Brevo ou Twilio** pour les SMS
- [ ] **Supabase Edge Function** à créer pour envoyer les alertes sans exposer les clés dans le code
- [ ] Emails automatiques au manager pour :
  - Arrivée / départ de chaque employé
  - ⚠️ Heure suspecte (triche potentielle)
  - ⚠️ Pointage hors zone GPS
  - ⚠️ Pause obligatoire dépassée > 6h
- [ ] SMS pour les alertes critiques uniquement (heure suspecte + hors zone)

### À discuter / décider
- [ ] Domaine personnalisé pour Netlify (ex: `pointeuse.lechaudron66.fr`) ?
- [ ] Protection par mot de passe du `dashboard.html` (actuellement accessible à tous) ?
- [ ] Export photos depuis le dashboard (ZIP téléchargeable) ?
- [ ] Rapport hebdomadaire automatique par email au manager ?

---

## 📁 Fichiers GitHub

```
chaudron66-servicetime/
├── index.html       ← App pointeuse (employés + manager)
├── dashboard.html   ← Tableau de bord web manager
└── CLAUDE.md        ← Ce fichier
```

---

## 🚀 Déploiement

1. Modifier `index.html` ou `dashboard.html`
2. Uploader sur GitHub → dépôt `chaudron66-servicetime`
3. Netlify détecte le changement et redéploie automatiquement (~30s)

---

## 🐛 Bugs corrigés en cours de session

- Bug syntaxe JS dans `syncNow` (backtick/apostrophe mélangés) → cassait l'horloge et le GPS
- Clé Supabase incorrecte (publishable au lieu de anon) → photos non uploadées
- Logo absent dans `dashboard.html`
- GPS : timeout renforcé pour éviter les blocages sur Safari iOS en `file://`
