# ✅ DONE.md — État d'avancement d'OpenMontage

> Dernière mise à jour : **v4** — dossier `serveur/` prêt pour BDS (`world_behavior_packs.json` + `world_resource_packs.json`).
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

---

## 🧱 Fondations

### Base de données locale (TypeScript + JSON) — `src/db/`
- [x] `JsonDatabase` : collections de documents, CRUD complet (`insert`, `upsert`, **`update`**, `find`, `findOne`, `remove`)
- [x] **Migrations de schéma (v3)** : `src/db/migrations.ts` — v1→v2 (renommage `role_members`→`members`, conversion `players`→`players_index`, enrichissement territoires) puis v2→v3 (perms rôles, playerId sur sanctions/grades, grade sur players_index) — testées (10 tests dédiés)
- [x] **Permissions fines (v3)** : catalogue `PERMS` (`src/permissions/perms.ts`) — `territories.create`, `mod.panel/kick/ban/mute/warn/history`, `chat.color/prefix`. Sémantique **additive** : perms par défaut du niveau UNION perms explicites du rôle (un rôle niveau 0 peut être autorisé à bannir). Commandes et GUI gated par permission, op vanilla = bypass
- [x] **Constantes DB centralisées** (`src/db/collections.ts`) : noms de collections + libellés + ordre d'affichage, source unique partagée par tous les managers et le menu DB
- [x] **`db.markDirty()` public** : les mutations en place (role.data.x = y) lèvent maintenant le flag — bug de perte de persistance corrigé (couleurs/prefixes/drapeaux édités étaient perdus au redémarrage) + test de régression
- [x] **Index joueurs `players_index`** : identité stable par **Player.id Bedrock** (le xuid n'existe pas dans l'API 2.11), résolution pseudo↔id, promotion auto des entrées migrées au join, compteur de sessions, grade copié (`src/players.ts`)
- [x] **Territoires v2** : `ownerId` (id Bedrock stable) + `ownerName` + **membres** (member/officer) — le propriétaire ET ses membres peuvent construire ; les protections et le PvP utilisent les IDs
- [x] **Menu DB `/sn:db menu`** (admin) : navigation par sections (joueurs, territoires, rôles, grades, bans, mutes, warns, modules…), vue document avec **édition des champs texte/nombre**, vidage de section, sauvegarde forcée — tout persisté
- [x] Persistance **Dynamic Properties** du monde (stockage Bedrock natif, `src/db/bedrock-storage.ts`)
- [x] **Dirty tracking** : on ne sauvegarde que si des données ont changé
- [x] **Autosave** toutes les 5 s (`src/db/autosave.ts`), sûr en early execution
- [x] **Découpage** : les gros payloads sont fragmentés automatiquement (limite de taille des Dynamic Properties)
- [x] Chargement **post-worldLoad uniquement** (le `getDynamicProperty` est interdit en early execution — bug corrigé, voir Historique)
- [x] **Garde anti-écrasement** (régression) : `save()` refuse d'écrire tant que la base n'est pas chargée — un join avant le worldLoad ne peut plus vider la DB stockée
- [x] **Base vide = valide** : un monde neuf (0 territoire) donne une base vide **prête à l'emploi** (`loaded = true` immédiat) — « DB non chargée » ne se produit plus que si la base est réellement illisible
- [x] Commandes admin `/sn:db` (menu, stats, list, show, save)

### Scripts & toolchain
- [x] TypeScript strict compilé en **un seul bundle** `BP/scripts/main.js` (esbuild) — c'est normal qu'il n'y ait qu'un .js dans BP/scripts
- [x] Manifest BP en TypeScript-compat (API **`@minecraft/server` 2.11.0-beta** = Minecraft **1.26.50**, expérimentation Beta APIs requise)
- [x] **Lib `@bedrock-oss/bedrock-boost` intégrée** (v2.2.0, org Bedrock-OSS, à jour) : `Logger` par module (niveaux filtrables **en jeu** : `/scriptevent log:level <0-5>`, `/scriptevent log:filter <tags>`), `Timings` (mesure du chargement monde), `ColorJSON` (JSON colorisé dans `/sn:db show`). Vec3/cache/schedulers disponibles pour la suite
- [x] 33/33 tests unitaires (bun test) : DB, migrations v1→v3, chunks, territoires, sanctions, permissions fines

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
- [x] **Chat custom** : format `[grade] nom > message` — `[Admin]`/`[Modo]`/`[Joueur]` selon le rôle, pseudo coloré, séparateur `>` gris. Sans rôle : pseudo blanc + message gris clair ; avec rôle : couleur du rôle + message blanc. Mute géré dans le pipeline unique (bug du double subscriber corrigé)
- [x] **Rôle [Joueur] par défaut** : attribué automatiquement à chaque nouveau joueur (gris foncé §8, niveau 0) — personne n'est « sans rôle » ; `[Modo]` (bleu, niv. 60) pré-créé aussi
- [x] **Menus 100% DDUI (CustomForm)** : tous les menus (hub, territoires, rôles, joueurs, modération, modules, DB) utilisent la nouvelle API Data-Driven UI — boutons à **callbacks directs** (plus d'indexation fragile), headers, dividers, toggles réactifs, sliders et dropdowns à valeur explicite
- [x] **Menu Joueurs à 2 onglets** : 🟢 en ligne (connectés maintenant) + 📜 hors ligne (index DB avec sessions et dernière vue) — les deux gèrent rôle/prefix/couleur pareil
- [x] **BP dépend du RP** (`BP/manifest.json` → uuid RP) : activer le BP auto-active le RP dans le monde
- [x] `/sn:roles` : personnalisation (tous) + gestion complète (admins)
- [x] `/sn:admin` : menu central → Rôles / Joueurs / Modules

## 🧩 Gestionnaire de modules — `src/modules/`
- [x] Toggle on/off **persisté en DB** pour chaque module (territoires, modération)
- [x] Quand un module est off : ses commandes répondent "désactivé" et ses effets (protection...) se coupent
- [x] Accessible via `/sn:admin` → Modules

---

## 🔨 Module Modération — `src/moderation/`
- [x] `/sn:mod` : GUI de modération (stats, bans/mutes actifs cliquables, sanction rapide, historiques)
- [x] `/sn:kick <joueur> <raison>` · `/sn:ban <joueur> [durée_min] <raison>` (0 = permanent) · `/sn:unban` · `/sn:mute <joueur> <durée_min> [raison]` · `/sn:unmute` · `/sn:warn <joueur> <raison>` · `/sn:history <joueur>` — chaque action gated par sa permission fine (`mod.ban`, `mod.mute`...)
- [x] **playerId Bedrock stocké** sur bans/mutes/warns/grades (résolu en ligne au moment de la sanction, ou au join pour les offline) — robuste aux changements de pseudo
- [x] Bans réappliqués au join (message de motif), temporaires auto-levés
- [x] Mutes : messages interceptés dans le chat custom + rappel du temps restant
- [x] 5 collections DB (`bans`, `mutes`, `warns`, infractions, journal) + purges auto

---

## 🎨 UI / Resource Pack — `RP/`
- [x] Thème GUI partagé (`src/ui/theme.ts`) : titres unifiés `OM »`, **43 icônes toutes vérifiées** contre `Mojang/bedrock-samples` (6 chemins morts corrigés — un chemin invalide = icône silencieusement absente)
- [x] Helper `openWindow` (DDUI `CustomForm`, bêta server-ui 2.3) : la nouvelle API de menus réactifs — boutons à callbacks directs, **images depuis notre Resource Pack** (`image(src, pack)`), bindings observables. Migration progressive des menus prévue
- [x] **Limite API documentée** : un script ne peut PAS ouvrir un écran JSON UI arbitraire (le JSON UI est rendu par le RP, l'ouverture via script n'existe pas) — `CustomForm` est l'évolution officielle
- [x] **Hub central `/sn:menu`** : porte d'entrée de tout, n'affiche que ce à quoi ton rôle donne droit
- [x] **JSON UI réel** : `RP/ui/hud_screen.json` **PARTIEL** qui redéfinit les 2 éléments ciblés (`hud_actionbar_text`, `hud_title_text`) copiés du vanilla + retouches (fond `om_actionbar_bg`)
  - **Méthode des packs établis** (vérifiée sur Canopy et OriginsPE) : redéclarer un élément vanilla **par son nom exact** dans un `ui/*.json` référencé par `_ui_defs.json` — le moteur fusionne par nom. Pas de copie des 118 Ko, pas de patch par recherche-remplace (la texture ciblée apparaissait 5 fois → mauvaise occurrence patchée = « aucune UI visible »)
  - Généré par `scripts/build_rp_hud.py` (extraction automatique du vanilla + retouches + validation)
- [x] Script reproductible **`scripts/build_rp_hud.py`** : retélécharge le vanilla, applique les patchs, valide — à relancer après chaque mise à jour Minecraft
- [x] Textures placeholder (temporaires) générées sans dépendance par **`scripts/make_placeholder_pngs.py`** : 10 bandeaux colorés + fond d'actionbar + pack_icon — à remplacer plus tard par de vrais visuels (mêmes noms de fichiers)
- [x] Resource Pack séparé (manifest resources + pack_icon), à activer **en plus** du BP dans le monde

---

## 🌍 Déploiement serveur — `serveur/`
- [x] **`serveur/world_behavior_packs.json`** : active le BP OpenMontage (`2915bab9-50f2-442e-a17a-4c8e9cd688fb` v1.0.0) sur le monde
- [x] **`serveur/world_resource_packs.json`** : active le RP OpenMontage UI (`33ca6e1c-4f30-46ae-8b56-1510382e3f61` v1.0.0)
- [x] **`serveur/README.md`** : guide d'installation BDS pas à pas (copie des packs, fusion des tableaux si le monde a déjà des packs, vérifications en jeu, rappel des commandes `/scriptevent sn:*`)
- [x] Le BP dépend du RP (manifest dependencies) : activer le BP via le monde suffit, le RP est chargé avec lui
- ⚠️ Rappel : après toute modif TS, `bun run build` puis re-copier `BP/` sur le serveur

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
6. **DB « non chargée » / 0 territoire** : `load()` sur base inexistante ne posait pas `loaded` (monde neuf = tout mort) et `save()` pouvait écraser la DB stockée avec du vide avant le worldLoad. Corrigé + tests de régression.
7. **JSON UI invisible** : le patch par remplacement de texte tapait la 1re occurrence d'une texture présente 5 fois (pas celle de l'actionbar). Remplacé par la méthode partielle des packs établis (Canopy/OriginsPE).
8. **Icônes invisibles dans les menus** : 6 chemins d'icônes n'existaient pas dans le vanilla (`icon_missing_item`, `icon_save`, `banner_base`, `shield_base`, `golden_helmet`, `door_acacia_upper`, `bell`, `anvil`, `barrier`, `fire_charge` en items...). Corrigés et **tous vérifiés automatiquement** contre l'arborescence officielle.
