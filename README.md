# NaLandia — Add-on Minecraft Bedrock

> ⚠️ **Projet en développement** — tout est en cours de construction, rien n'est figé. Ne l'utilise pas encore sur un monde important : le schéma de données peut changer sans migration.

> **NaLandia** (anciennement « OpenMontage ») : l'add-on de serveur avec territoires/États, clans, rôles, modération, classes, métiers et une dimension minière dédiée — avec des menus robustes basés sur les formulaires officiels Bedrock.

**Packs actuels : 3.0.3** (Behavior Pack + Resource Pack + monde de test dans `serveur/`).

## C'est quoi ce repo ?

Un add-on complet en TypeScript : toolchain de build, base de données persistante, modules de gameplay (territoires, permissions, modération, classes, métiers, mines) et un **thème or/argent** porté par le Resource Pack, avec des **menus à tuiles JSON UI** (Clan, Classes) là où un formulaire natif ne suffit pas.

## Ce qu'il y a déjà

### 🗄️ Base de données JSON locale (le cœur du projet)
Persistée dans le monde via les Dynamic Properties Bedrock :

- **Collections de documents** JSON (`territories`, `roles`, `members`, `players_index`, `sanctions`, `classes`, `jobs`…) avec CRUD complet (`insert`, `findOne`, `find`, `update`, `upsert`, `remove`, `count`, `clear`)
- **Migrations de schéma** v1→v3 (renommages, `playerId` stable, perms par rôle) testées
- **Dirty tracking** + **autosave** toutes les 5 s (uniquement si les données ont changé)
- **Découpage en morceaux** pour contourner la limite des 32 767 caractères par propriété
- **Aucun message technique dans le chat** : tout passe par la console (filtrable en jeu via `/scriptevent log:*`)
- Menu admin `/sn:db menu` : navigation par sections, édition des champs, vidage, sauvegarde forcée

### 🚩 Territoires, États & clans
- `/sn:create` — fonde un État/clan sur le chunk courant (nom + drapeau) ; extension **carré 3×3** autour du fondateur
- `/sn:info` — liste cliquable de tous les États + fiche détaillée (« parchemin »)
- `/sn:clan` — **Mon clan** : bio éditable, emplacement réservé à la future banque, drapeau en tête, revendication, membres (invitation, rangs officier/membre, exclusion), quitter/dissoudre
- `/sn:invite`, `/sn:kick`, `/sn:promote`, `/sn:demote`, `/sn:leave`, `/sn:unclaim`, `/sn:disband`, `/sn:flag <couleur|blason>`
- Drapeaux personnalisés : 10 couleurs + 8 blasons importables (`RP/textures/ui/flags/1.png` … `8.png`)
- **Protection totale** : casse/pose, coffres, objets, entités, explosions, PvP (avec légitime défense)

### 👑 Rôles & permissions
- Rôles en DB (nom, couleur, préfixe, niveau 0–100+), rôle **[Joueur]** attribué automatiquement, `[Modo]` pré-créé, Admin intouchable
- **Permissions fines** additives (`territories.create`, `mod.ban`, `chat.color`…) : un rôle peut tout à fait être autorisé à bannir à niveau 0 ; op vanilla = bypass
- Chat custom `[grade] nom > message`, nameTags colorés, menus `/sn:roles` et `/sn:admin` (rôles / joueurs / modules)
- La **couleur de rôle** est décidée par les admins : le joueur ne choisit plus la couleur de son rôle

### 🔨 Modération
`/sn:ban`, `/sn:unban`, `/sn:mute`, `/sn:unmute`, `/sn:warn`, `/sn:history`, `/sn:mod`, `/sn:ckick` — bans/mutes actifs consultables, application automatique à la connexion.

### 🎭 Classes & métiers
- **Classes** `/sn:classes` : trois voies (Guerrier, Mage, Archer), choix **définitif** avec confirmation solennelle, niveau + barre d'XP, réinitialisation admin (`/sn:db` ou fiche joueur)
- **Métiers** `/sn:jobs` : atelier distinct des classes, disciplines multiples, progression XP, actions de parcours et classement préparés
- **Quêtes** `/sn:quests` : journal persistant connecté aux classes, mines, clans et métiers, avec récompenses récupérables
- Menu **Modules** `/sn:modules` : activer/désactiver chaque module à chaud

### ⛏️ Mines & monde
- Dimension dédiée `nalania:mines` : **bloc de pierre plein** (70 couches entre deux lits de bedrock), minerais plus riches qu'en surface mais **équilibrés par bandes de profondeur** (charbon/fer partout, cuivre dessous, or/redstone en bas, lapis/émeraude/diamant dans les 14 derniers blocs) — le joueur creuse ses propres galeries
- Génération par `fillBlocks` + garde `isChunkLoaded`, file **1 chunk/tick**, poche de spawn éclairée et arrivée sécurisée, **secours anti-chute**
- **Night vision sans particules**, ré-appliquée toutes les 30 s dans la mine et retirée au retour
- `/sn:monde` — menu « Le Monde » (Monde normal / Mine) ; **le retour au monde normal te ramène à ta dernière position** mémorisée

### UI — transport invisible + JSON UI à nous (un seul thème)

**1. Menus (`openTileMenu` → `ActionFormData`)** — le script envoie des libellés via l'API native `@minecraft/server-ui` : c'est le **transport invisible** (données + clics, jamais visible). L'**apparence** vient de `RP/ui/server_form.json`, **généré** par `scripts/build_server_form.py` depuis la base vanilla officielle de Mojang (1.26.50) avec nos modifications ciblées : fenêtres élargies, titre doré, boutons re-texturés avec les dalles or `om_btn` (3 états), navigation clavier/manette. Fini les frameworks JSX, les render packs et le routage par titre : **un seul fichier, un seul thème signature**.
   - Au-delà de 8 entrées, les longues listes basculent en **pagination automatique** (‹ Page précédente / Page suivante ›) ;
   - Les réessais intégrés (UserBusy) garantissent l'ouverture des menus enchaînés.

**2. Formulaires natifs (`OMForm` → `CustomForm`)** — champs texte, curseurs, listes déroulantes et fiches de lecture : input natif garanti par Mojang (tactile, manette, clavier), soumis avec le même habillage or.

L'identité visuelle vit dans le JSON UI généré : le moteur (`src/ui/theme.ts`) n'envoie **jamais** de texture, le RP habille tout. Pour changer l'apparence : éditer le générateur, `bun run ui`, bumper RP+BP. Voir **`agent.md`** pour la méthode complète et le dépannage.

- **Gameplay** : bandeau et carte visuelle pour Classes, Métiers, Monde, Mines, États et Quêtes.
- **Fiches** : panneau et texture de contenu pour Clan, Mon clan, Membres, Drapeau et Mes infos.
- **Gestion** : bandeau de gestion pour le hub, l'administration et les outils de modération.
- Les tuiles sont de vrais boutons natifs (`button.form_button_click`) dessinés par l'image du pack : le tactile, la manette et le clavier continuent de fonctionner normalement.
- Chaque texte porte une BOÎTE de taille fixe (`size` explicite) : une étiquette Bedrock centre son texte verticalement dans sa boîte, donc une boîte en `"default"` laissait le texte flotter et déborder.
- Les callbacks ferment explicitement l'écran avant chaque navigation afin d'éviter les menus fantômes ou réapparitions.
- `RP/ui/hud_screen.json` reste dédié à l'actionbar et aux titres ; `RP/ui/server_form.json` ne touche QUE les formulaires à tuiles (repérés par leur titre exact) et laisse passer tous les autres. Aucun curseur, aucun HUD de saisie, aucune texture de pointeur n'est injectée.

## Commandes en jeu

| Commande | Rôle |
|---|---|
| `/sn:menu` | Menu principal (hub) |
| `/sn:admin` | Panneau admin (rôles, joueurs, modules) |
| `/sn:db` | Base de données (menu, stats, list, show, save) |
| `/sn:create`, `/sn:info`, `/sn:clan` | États / clans |
| `/sn:claim`, `/sn:unclaim`, `/sn:invite`, `/sn:kick`, `/sn:promote`, `/sn:demote`, `/sn:leave`, `/sn:disband`, `/sn:flag` | Gestion de clan |
| `/sn:roles`, `/sn:mod`, `/sn:ban`, `/sn:unban`, `/sn:mute`, `/sn:unmute`, `/sn:warn`, `/sn:history`, `/sn:ckick` | Permissions & modération |
| `/sn:classes`, `/sn:jobs` | Progression |
| `/sn:mine`, `/sn:monde` | Dimension minière et choix de monde |
| `/sn:modules`, `/sn:setflag` | Modules, drapeau |

## Stack technique

| Outil | Rôle |
|---|---|
| TypeScript 5 + esbuild | Code source → bundle unique `BP/scripts/main.js` |
| `@minecraft/server` 2.11.0-beta (1.26.50) | API script (commandes, events, protections, dimensions) |
| `@minecraft/server-ui` 2.3.0-beta | Transport UI natif (menus ActionForm + formulaires CustomForm) |
| `@bedrock-oss/bedrock-boost` | Logger filtrable en jeu, Timings, ColorJSON |
| Bun | Tests (`bun test`) et scripts |
| Python 3 (stdlib) | Génération des textures du Resource Pack |

## Structure

```
├── BP/                      # Behavior Pack (ce que charge Minecraft)
│   ├── manifest.json
│   ├── dimensions/          #   Dimension « nalania:mines »
│   └── scripts/main.js      #   ← généré par le build, NE PAS éditer
├── RP/                      # Resource Pack (JSON UI + textures)
│   ├── manifest.json
│   ├── ui/                  #   hud_screen.json + server_form.json (généré) + _ui_defs.json
│   ├── texts/               #   langues du render pack
│   └── textures/ui/         #   cadres, tuiles, cartes (générés) + textures du render pack
├── src/                     # Code source TypeScript
│   ├── main.ts              # Point d'entrée (branchement de tout)
│   ├── db/                  # Base JSON locale (CRUD, migrations, autosave, menu admin)
│   ├── territories/         # États/clans, protection, annonces HUD
│   ├── permissions/         # Rôles, permissions fines, chat, nameTags, menus
│   ├── moderation/          # Sanctions (ban/mute/warn), menus, application
│   ├── classes/             # Voies, XP, menu de choix
│   ├── jobs/                # Métiers (bases)
│   ├── mines/               # Dimension minière (générateur déterministe) + menus Monde/Mines
│   ├── modules/             # Activation/désactivation à chaud
│   ├── ui/                  # Moteur UI : transport natif (theme.ts), helpers (labels.ts)
│   ├── players.ts           # Index joueurs (id stable, sessions, grades)
│   └── lib/                 # Loggers
├── serveur/                 # Monde de test (packs activés)
├── scripts/                 # build_server_form.py (JSON UI) + make_ui_textures.py
├── build.mjs                # Script de build (esbuild)
└── tsconfig.json
```

## Démarrer

```bash
bun install         # installer les dépendances
bun run build       # compiler src/ → BP/scripts/main.js
bun run watch       # recompiler à chaque modification (dev)
bun run test        # lancer les tests
bun run typecheck   # vérifier les types
bun run textures    # régénérer les textures du Resource Pack
```

**Tests : 74 tests unitaires** (DB + migrations, territoires, permissions, modération, classes, générateur de mine, adaptateur natif, contrat des menus à tuiles et déclaration JSON UI).

## Installer l'add-on en jeu

1. Copie `BP/` dans `development_behavior_packs/` et `RP/` dans `development_resource_packs/`
2. Active **les deux packs** dans les paramètres du monde (le BP dépend du RP, il l'active automatiquement)
3. **Quitte et relance le monde** (les commandes `/sn:*` s'enregistrent au démarrage)
4. Vérifie `/sn:menu` ; si l'UI n'a pas changé, **bump la version du RP** (`RP/manifest.json`) et recharge : Bedrock met les packs en cache

> ℹ️ Le RP doit être activé et à jour : sans lui, les menus à tuiles (Clan, Classes) perdent leur panneau dessiné et les formulaires natifs leurs images. Si un menu ne s'affiche pas, vérifie d'abord la version Bedrock, le RP actif et la présence de `BP/scripts/main.js`.

## Base de données et compatibilité

Le schéma DB est maintenant en **v4**. La migration ajoute automatiquement la bio des clans aux mondes existants sans supprimer ni réinitialiser les collections précédentes. Les sauvegardes restent gérées par les Dynamic Properties Bedrock et l'autosave.

## Roadmap (idées en vrac)

- [ ] Bonus de classe concrets (dégâts, potions, vitesse) branchés sur le niveau
- [ ] Métiers jouables (récolte → récompenses) et économie (monnaie en DB)
- [ ] Dons / récompenses attribuables aux joueurs (menu dédié)
- [ ] Extension de territoire hors du carré 3×3 autour du fondateur
- [ ] À définir avec la suite du projet
