# Ylelor

Application de pointage SaaS pour établissements (restaurants, bars, commerces).  
Remplace les feuilles de présence papier par un système horodaté, photographié et anti-triche.

## Fonctionnalités

- 📸 Photo silencieuse à chaque pointage (début, pause, fin)
- 📍 Détection GPS automatique du site
- 🔒 Code PIN par employé, accès manager protégé
- ☁️ Synchronisation Supabase (offline-first)
- 🏢 Multi-tenant : un seul code base, plusieurs établissements clients
- 📊 Tableau de bord temps réel (`dashboard.html`)
- 📤 Export CSV

## Stack

- Frontend : HTML/CSS/JS vanilla (PWA, compatible iPhone/iPad Safari)
- Backend : Supabase (PostgreSQL + Storage)
- Hébergement : Netlify (HTTPS requis pour GPS et caméra)

## Premier client

**Le Chaudron 66** — pub, sites Bages et Cabestany (Pyrénées-Orientales, France)

## Structure

```
index.html          ← App pointeuse (employés + manager)
dashboard.html      ← Tableau de bord manager
config/
  lechaudron66.json ← Config du client Le Chaudron 66
CLAUDE.md           ← Documentation technique complète
```

---

*Développé avec Claude (Anthropic)*
