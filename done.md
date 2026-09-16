# ✅ DONE.md — État d'avancement d'OpenMontage

> Dernière mise à jour : grosse mise à jour DB (v2) — index joueurs par ID, territoires multi-membres, menu DB complet.
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

---

## 🧱 Fondations

### Base de données locale (TypeScript + JSON) — `src/db/`
- [x] `JsonDatabase` : collections de documents, CRUD complet (`insert`, `upsert`, **`update`**, `find`, `findOne`, `remove`)
- [x] **Migrations de schéma (v2)** : `src/db/migrations.ts` — renommage `role_members`→`members`, conversion `players`→`players_index`, enrichissement territoires (testées, 5 tests dédiés)
- [x] **Index joueurs `players_index`** : identité stable par **Player.id Bedrock** (le xuid n'existe pas dans l'API 2.11), résolution pseudo↔id, promotion auto des entrées migrées au join, compteur de sessions, grade copié (`src/players.ts`)
- [x] **Territoires v2** : `ownerId` (id Bedrock stable) + `ownerName` + **membres** (member/officer) — le propriétaire ET ses membres peuvent construire ; les protections et le PvP utilisent les IDs
- [x] **Menu DB `/sn:db menu`** (admin) : navigation par sections (joueurs, territoires, rôles, grades, bans, mutes, warns, modules…), vue document avec **édition des champs texte/nombre**, vidage de section, sauvegarde forcée — tout persisté
- [x] Persistance **Dynamic Properties** du monde (stockage Bedrock natif, `src/db/bedrock-storage.ts`)
- [x] **Dirty tracking** : on ne sauvegarde que si des données ont changé
- [x] **Autosave** toutes les 5 s (`src/db/autosave.ts`), sûr en early execution
- [x] **Découpage** : les gros payloads sont fragmentés automatiquement (limite de taille des Dynamic Properties)
- [x] Chargement **post-worldLoad uniquement** (le `getDynamicProperty` est interdit en early execution — bug corrigé, voir Historique)
- [x] Commandes admin `/sn:db` (menu, stats, list, show, save)

### Scripts & toolchain
- [x] TypeScript strict compilé en **un seul bundle** `BP/scripts/main.js` (esbuild) — c'est normal qu'il n'y ait qu'un .js dans BP/scripts
- [x] Manifest BP en TypeScript-compat (API **`@minecraft/server` 2.11.0-beta** = Minecraft **1.26.50**, expérimentation Beta APIs requise)
- [x] 25/25 tests unitaires (bun test) : DB, migrations v1→v2, chunks, territoires, sanctions

---

## 🚩 Module Territoires — `src/territories/`
- [x] `/sn:create` : menu (nom + couleur de drapeau) → conquiert le chunk courant
- [x] `/sn:info` : liste de tous les territoires + fiche détaillée cliquable
- [x] Protection totale du chunk : casse ❌, pose ❌ (rollback), interactions ❌, objets ❌, entités ❌, explosions filtrées
- [x] **PvP** : le propriétaire peut frapper quiconque est chez lui ; légitime défense autorisée depuis son propre territoire ; les visiteurs entre eux ne peuvent pas se taper dans un territoire
- [x] **Bandeau d'entrée/sortie** : `⚑ Nom — territoire de X` dans l'actionbar (custom JSON UI)
- [x] `/sn:setflag <couleur>` : changer la couleur de son drapeau
- [x] 1 territoire max/joueur, nom unique 3–24 caractères, limite 64 chunks
- [x] Persistance DB complète (collections `territories`), togglable via le gestionnaire de modules

---

## 👑 Permissions & rôles — `src/permissions/`
- [x] Rôles persistés en DB : nom, couleur (12), prefix, **niveau hiérarchique** (0–100+)
- [x] Par joueur : rôle attribué + prefix perso + couleur perso (prioritaires sur le rôle)
- [x] Bootstrap : le premier opérateur vanilla devient Admin (niveau 100)
- [x] Rôle Admin intouchable (suppression interdite)
- [x] **NameTags** colorés au-dessus des têtes, rafraîchis en continu
- [x] **Chat custom** : format `[Joueur] > message` — crochets et chevron gris, pseudo coloré au rôle/prefix perso (via `chatSend` bêta, mute inclus)
- [x] `/sn:roles` : personnalisation (tous) + gestion complète (admins)
- [x] `/sn:admin` : menu central → Rôles / Joueurs / Modules

## 🧩 Gestionnaire de modules — `src/modules/`
- [x] Toggle on/off **persisté en DB** pour chaque module (territoires, modération)
- [x] Quand un module est off : ses commandes répondent "désactivé" et ses effets (protection...) se coupent
- [x] Accessible via `/sn:admin` → Modules

---

## 🔨 Module Modération — `src/moderation/`
- [x] `/sn:mod` : GUI de modération (stats, bans/mutes actifs cliquables, sanction rapide, historiques)
- [x] `/sn:kick <joueur> <raison>` · `/sn:ban <joueur> [durée_min] <raison>` (0 = permanent) · `/sn:unban` · `/sn:mute <joueur> <durée_min> [raison]` · `/sn:unmute` · `/sn:warn <joueur> <raison>` · `/sn:history <joueur>`
- [x] Bans réappliqués au join (message de motif), temporaires auto-levés
- [x] Mutes : messages interceptés dans le chat custom + rappel du temps restant
- [x] 5 collections DB (`bans`, `mutes`, `warns`, infractions, journal) + purges auto

---

## 🎨 UI / Resource Pack — `RP/`
- [x] Thème GUI partagé (`src/ui/theme.ts`) : titres unifiés `OpenMontage »`, icônes vanilla sur les boutons
- [x] **Hub central `/sn:menu`** : porte d'entrée de tout, n'affiche que ce à quoi ton rôle donne droit
- [x] **JSON UI réel** : `RP/ui/hud_screen.json` = le fichier HUD vanilla officiel de Mojang (`Mojang/bedrock-samples`) + 3 retouches (fond `om_actionbar_bg` derrière l'actionbar et les titles)
  - Leçon apprise : surcharger le fichier HUD **entier** (les éléments ajoutés dans un fichier séparé ne sont jamais instanciés par le HUD)
- [x] Script reproductible **`scripts/build_rp_hud.py`** : retélécharge le vanilla, applique les patchs, valide — à relancer après chaque mise à jour Minecraft
- [x] Textures placeholder (temporaires) générées sans dépendance par **`scripts/make_placeholder_pngs.py`** : 10 bandeaux colorés + fond d'actionbar + pack_icon — à remplacer plus tard par de vrais visuels (mêmes noms de fichiers)
- [x] Resource Pack séparé (manifest resources + pack_icon), à activer **en plus** du BP dans le monde

---

## 🧰 Veille outils
- [x] `utile.md` : outils GitHub classés (toolchain, Script API, serveurs, JSON UI) — déjà utilisés vs à évaluer

---

## 🗺️ Roadmap (proposée, non commencée)
- **Phase 2 modération (suite)** : logs de grief (qui a cassé quoi + rollback), config globale GUI
- **Phase 1 socle** : économie (`/sn:money`, `/sn:pay`), homes & TP (`/sn:sethome`, `/sn:tpa`...), stats joueurs (`/sn:top`)
- **Phase 3 gameplay** : boutique, kits & récompenses quotidiennes, quêtes, classements temps réel
- **Qualité** : cooldowns génériques, pagination des menus, i18n FR/EN

---

## 📜 Historique des corrections marquantes
1. **Early execution** : `getDynamicProperty` interdit avant `worldLoad` → crash au chargement du pack. Corrigé (DB lue au worldLoad/fallback spawn).
2. **Formulaire de création** : `formValues` indexait aussi header/label → "nom entre 3 et 24 caractères" à tort. Corrigé (lecture par type).
3. **Chat** : `chatSend` absent de la stable 2.9.0 (uniquement doc) → migration vers la bêta 2.11.0 (Minecraft 1.26.50), où il existe bel et bien.
4. **JSON UI** : les éléments custom dans un fichier séparé ne sont pas instanciés par le HUD → remplacement du `hud_screen.json` entier (méthode officielle des packs UI).
5. **Identité joueurs** : pas de `xuid` dans l'API bêta 2.11 → identité stable par `Player.id` + migration des anciennes entrées (clés `name:<pseudo>` promues automatiquement au join).
