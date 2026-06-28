# Chroniques Oubliées — Phase 3 Supabase
## Guide d'installation complet

---

## 1. CRÉER LES TABLES SUPABASE

1. Ouvrir https://supabase.com/dashboard → votre projet `vfekyuidsjnblcklamwv`
2. Aller dans **SQL Editor** → **New query**
3. Coller tout le contenu de `schema.sql` et cliquer **Run**
4. Vérifier que toutes les tables sont créées : `rooms`, `players`, `scenes`, `tokens`, `chat_messages`

> **Si erreur sur `create publication`** : aller dans Database → Replication → activer manuellement les tables.

---

## 2. STRUCTURE DES FICHIERS

Votre projet doit avoir cette structure :

```
votre-projet/
├── index.html              ← Remplacer par la version fournie
├── style.css               ← Inchangé (garder l'original)
├── script.js               ← Inchangé (garder l'original)
├── supabase-multiplayer.js ← NOUVEAU — module Supabase
└── script-patch.js         ← NOUVEAU — hooks et corrections
```

**Ne pas modifier `script.js`** — les patches sont appliqués dynamiquement.

---

## 3. DÉPLOIEMENT SUR GITHUB PAGES

```bash
# Copier les nouveaux fichiers dans votre repo GitHub
cp index.html            /chemin/vers/votre-repo/
cp supabase-multiplayer.js /chemin/vers/votre-repo/
cp script-patch.js       /chemin/vers/votre-repo/

# Pousser
git add .
git commit -m "Phase 3 Supabase multijoueur"
git push
```

GitHub Pages servira automatiquement le nouveau `index.html`.

---

## 4. FLUX D'UTILISATION

### MJ (Maître du Jeu)
1. Ouvrir le VTT → cliquer **Entrer dans la Taverne**
2. Dans le panneau droit → **Multijoueur** → **Créer une salle**
3. Remplir le nom de la partie et votre nom → **Créer la salle**
4. Un **code de 8 caractères** apparaît (ex. `HKR-4829`)
5. Partager ce code avec les joueurs

### Joueur
1. Ouvrir le VTT (sur n'importe quel appareil/navigateur)
2. Cliquer **Entrer dans la Taverne**
3. Dans le panneau gauche ou via le bouton **Rejoindre une salle**
4. Entrer le code + votre nom → **Rejoindre**
5. Vous voyez immédiatement la carte, les tokens et le chat

---

## 5. FONCTIONNALITÉS SYNCHRONISÉES

| Action | MJ | Joueur |
|--------|-----|--------|
| Voir la carte | ✅ | ✅ |
| Changer de scène | ✅ | ❌ (reçoit) |
| Créer/supprimer tokens | ✅ | ❌ |
| Déplacer son token | ✅ | ✅ (le sien uniquement) |
| Modifier PV token | ✅ | ✅ (le sien) |
| Brouillard de guerre | ✅ | ❌ (reçoit) |
| Chat | ✅ | ✅ |
| Lancer les dés | ✅ | ✅ |
| Combat / Initiative | ✅ | ❌ (reçoit) |
| Créer son personnage | N/A | ✅ |
| Assigner token joueur | ✅ | ❌ |
| Marqueurs carte | ✅ | ✅ |

---

## 6. TABLES SUPABASE — RÉFÉRENCE RAPIDE

### `rooms`
Chaque partie = une ligne. Contient l'état du fog, du combat, de la scène active.

### `players`
Un joueur par ligne, lié à sa salle. `character_data` = JSON du personnage.

### `scenes`
Les cartes/scènes de la campagne, par salle.

### `tokens`
Les pions sur la carte. `owner_player_id` = qui contrôle ce token.

### `chat_messages`
Historique du chat, limité à 300 messages par salle.

---

## 7. SUPABASE REALTIME — ARCHITECTURE

Le module utilise **deux canaux** simultanément :

**1. Broadcast (temps réel instantané)**
- `TOKEN_MOVED` → déplacement fluide (pas de délai DB)
- `SCENE_CHANGED` → changement de scène immédiat
- `FOG_UPDATED` → mise à jour brouillard
- `COMBAT_UPDATED` → combat en temps réel
- `MARKER_PLACED` → marqueurs instantanés
- `PLAYER_HEARTBEAT` → présence joueurs

**2. Postgres Changes (persistance)**
- `players` → arrivée/départ joueurs, personnages
- `tokens` → création/suppression/modification tokens
- `chat_messages` → nouveaux messages
- `rooms` → état général, scène active
- `scenes` → nouvelles scènes

---

## 8. RECONNEXION AUTOMATIQUE

Le module sauvegarde la session dans `localStorage`. Si un joueur ferme et rouvre son navigateur :
- Il retrouve automatiquement sa salle
- Il voit l'état actuel du jeu
- Son statut `is_online` repasse à `true`

Pour forcer une nouvelle session : vider le localStorage ou ouvrir en navigation privée.

---

## 9. NETTOYAGE AUTOMATIQUE (optionnel)

Pour supprimer les vieilles salles automatiquement, activer l'extension `pg_cron` dans Supabase → Extensions, puis exécuter :

```sql
SELECT cron.schedule(
  'cleanup-old-rooms',
  '0 3 * * *',
  $$ DELETE FROM public.rooms WHERE updated_at < now() - interval '24 hours'; $$
);
```

---

## 10. LIMITES ACTUELLES

- **Images de tokens** : les `data:` URLs (images locales) ne sont pas envoyées à Supabase (trop volumineuses). Chaque client doit avoir la même image localement, ou utiliser une URL externe.
- **Images de cartes** : même limitation. Utiliser des URLs d'images hébergées (Imgur, etc.) pour la synchronisation complète.
- **Sons d'ambiance** : bouton présent, fonctionnalité non implémentée.
- **Capacité** : plan gratuit Supabase = 500 Mo DB, 2 Go bandwidth, 200 connexions simultanées — largement suffisant pour un groupe de jeu.

---

## 11. DÉPANNAGE

**"Salle introuvable"**
→ Le code est incorrect ou la salle a été fermée. Vérifier dans Supabase → Table Editor → `rooms`.

**Joueurs ne voient pas les mises à jour**
→ Vérifier Supabase → Database → Replication → que les tables sont bien activées.

**Tokens ne se synchronisent pas**
→ Vérifier la console navigateur (`F12`) pour les erreurs Supabase.
→ Vérifier que le `schema.sql` a bien été exécuté (tables `tokens` présentes).

**Chat vide après reconnexion**
→ Normal : le chat se recharge depuis la DB. Si toujours vide, vérifier la table `chat_messages`.

---

## 12. SÉCURITÉ

La sécurité repose sur le **code de salle** (8 caractères, ~17 milliards de combinaisons). Les politiques RLS autorisent la clé anonyme — c'est volontaire pour éviter une authentification complexe dans un contexte de jeu privé.

Pour ajouter une vraie authentification : remplacer les policies RLS par des vérifications sur `auth.uid()` et configurer Supabase Auth.
