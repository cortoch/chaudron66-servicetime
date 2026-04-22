# ylelor — Le Chaudron 66
## Documentation projet · Mise à jour : avril 2026

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
- **Suppression automatique après 31 jours** (via purge au démarrage)

---

## 🗑️ Politique de rétention des données

| Donnée | iPhone (local) | Supabase |
|---|---|---|
| Pointages (heures, pauses) | Purgés après 31 jours | **Conservés indéfiniment** |
| Photos | Purgées après 31 jours | **Supprimées après 31 jours** |
| Employés | Toujours présents | Synchronisés à la demande |

La purge est exécutée automatiquement à chaque démarrage de l'app.

---

## ✅ Ce qui est fait

### Fonctionnalités core
- [x] Écran de verrouillage avec code PIN par employé (4 chiffres)
- [x] Accès manager par maintien du bouton `0` (3 secondes) + code PIN
- [x] Détection GPS automatique avec identification du site (Bages / Cabestany)
- [x] Timeout GPS de 5 secondes — si pas de fix, pointage autorisé quand même
- [x] Alerte visuelle si hors zone GPS (signalé au manager mais non bloquant)
- [x] Prise de photo obligatoire à chaque pointage
- [x] Photo avec watermark lisible et proportionnel à la résolution :
  - Trait doré en haut du bandeau
  - Site en orange gras (18px scalé)
  - Date + heure en blanc gras (20px scalé) — très visible
  - Nom de l'employé (17px scalé)
  - Coordonnées GPS en monospace (14px scalé)
- [x] Compression JPEG à 75% (bon compromis qualité/taille)
- [x] Timeline des événements du jour par employé
- [x] Actions : Début de service, Pause, Reprise, Fin de service
- [x] Pauses multiples — un employé peut faire plusieurs pauses dans la journée
- [x] Horloge temps réel en haut de page

### Manager
- [x] Tableau des pointages du jour avec filtres par site
- [x] Historique consultable par date
- [x] Gestion des employés (ajout, suppression, PIN)
- [x] Correction des horodatages avec validation chronologique complète :
  - Fin ne peut pas être avant le début
  - Début ne peut pas être après la première pause existante
  - Fin ne peut pas être avant la dernière pause existante
  - Gère correctement les pauses multiples
  - Message d'erreur précis avec les heures en conflit
- [x] Suppression complète d'une entrée (avec confirmation)
- [x] Colonne Pauses affiche le nombre ET la durée totale cumulée (`2× (0h45)`)
- [x] Export CSV (jour / mois)

### Stockage & synchronisation
- [x] Photos uploadées vers Supabase Storage au moment du pointage
- [x] Fallback base64 local si hors ligne au moment du pointage
- [x] Synchronisation des pointages vers Supabase (auto à chaque pointage + manuelle)
- [x] Synchronisation des employés vers Supabase (manuelle)
- [x] Chargement des données Supabase au démarrage de l'app (sync bidirectionnelle)
- [x] Purge automatique au démarrage :
  - Photos Supabase supprimées après 31 jours
  - Pointages Supabase conservés indéfiniment
  - Données locales iPhone purgées après 31 jours

### Sécurité & conformité
- [x] Détection de manipulation d'horloge (comparaison heure locale vs serveur Supabase)
  - Alerte ⚠️ "Heure suspecte" visible dans le tableau manager si écart > 2 min
  - Détail au survol : heure locale, heure serveur, écart en minutes
  - Non bloquant — signalement uniquement
  - Flag `timeTamper` stocké dans l'événement Supabase
- [x] Alerte pause obligatoire (Code du travail – Art. L3121-16)
  - Affiché sur l'écran employé si > 6h travaillées sans aucune pause
  - Rafraîchissement automatique toutes les minutes

### Interface & UX — Design system Ylelor (avril 2026)
- [x] **Refonte visuelle complète** selon le brand system Ylelor :
  - Palette marine (`#050c18` → `#1a2d4d`) + accent orange `#D97757`
  - Typographie : Space Grotesk (display) + Geist Mono (données/horloge)
  - Logo Y monogramme SVG inline (squircle marine, branches blanches, dot orange + halo)
  - Couleurs sémantiques OKLCH : cyan (succès), amber (pause/warning), coral (erreur/danger)
- [x] Écran lock : grosse horloge mono + date en uppercase (style borne iPad)
- [x] Numpad : touches rectangulaires arrondies (12px) remplacent les cercles
- [x] Accès manager invisible — aucun indice affiché
  - Maintien 0 (3 s) → mode manager **sur le même écran**, fond bleu marine distinct
  - Points PIN passent en cyan, carte GPS masquée, texte `CODE MANAGER`
  - ← vide = annulation du mode manager
  - Tableau de bord manager avec fond bleu marine cohérent
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
- [x] Logo Ylelor Y monogramme intégré (SVG inline, sans dépendance réseau)

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
  - ⚠️ Pause obligatoire dépassée > 6h sans aucune pause
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

## 🐛 Bugs corrigés

- Bug syntaxe JS dans `syncNow` (backtick/apostrophe mélangés) → cassait l'horloge et le GPS
- Clé Supabase incorrecte (publishable au lieu de anon) → photos non uploadées
- Logo absent dans `dashboard.html`
- GPS : timeout renforcé pour éviter les blocages sur Safari iOS en `file://`
- Pauses multiples : validation chronologique dans `saveEdit` ne prenait que la première pause
- Pauses multiples : colonne "Pauses" n'affichait que le nombre, pas la durée totale
- Purge : suppression des pointages Supabase retirée (historique conservé indéfiniment)
- Mode manager : numpad apparaissait sur un écran séparé à une position différente → désormais in-place sur l'écran lock
- `confirmMgr()` référençait des éléments DOM supprimés (`mgr-gate`, `md0–md3`) → remplacée par routing dans `confirmLock()`
