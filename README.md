# NaLandia — Add-on Minecraft Bedrock

> ⚠️ **Projet en développement** — tout est en cours de construction, rien n'est figé. Ne l'utilise pas encore sur un monde important : le schéma de données peut changer sans migration.

> **NaLandia** (anciennement « OpenMontage ») : l'add-on de serveur avec territoires/États, clans, rôles, modération, classes, métiers et une dimension minière dédiée — le tout dans une UI noir & or/argent avec surbrillance au survol.

**Packs actuels : 1.9.5** (Behavior Pack + Resource Pack + monde de test dans `serveur/`).

## C'est quoi ce repo ?

Un add-on complet en TypeScript : toolchain de build, base de données persistante, modules de gameplay (territoires, permissions, modération, classes, métiers, mines) et un **reskin JSON UI complet** (Resource Pack) qui habille tous les menus.

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
- `/sn:clan` — **Mon clan** : revendiquer, membres (invitation, rangs officier/membre, exclusion), drapeau, quitter/dissoudre
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
- **Métiers** `/sn:jobs` : bases posées (manager + menu + fiche) pour la suite
- Menu **Modules** `/sn:modules` : activer/désactiver chaque module à chaud

### ⛏️ Mines & monde
- Dimension dédiée `nalania:mines` : **bloc de pierre plein** (70 couches entre deux lits de bedrock), minerais plus riches qu'en surface mais **équilibrés par bandes de profondeur** (charbon/fer partout, cuivre dessous, or/redstone en bas, lapis/émeraude/diamant dans les 14 derniers blocs) — le joueur creuse ses propres galeries
- Génération par `fillBlocks` + garde `isChunkLoaded`, file **1 chunk/tick**, poche de spawn éclairée et arrivée sécurisée, **secours anti-chute**
- **Night vision sans particules**, ré-appliquée toutes les 30 s dans la mine et retirée au retour
- `/sn:monde` — menu « Le Monde » (Monde normal / Mine) ; **le retour au monde normal te ramène à ta dernière position** mémorisée

### 🎨 UI — Resource Pack (JSON UI)
- **Plusieurs fichiers UI** : `ui/om_base.json` (socle : boutons 3 états, panneaux, flèche retour), `ui/server_form.json` (menus à boutons), `ui/om_sheets.json` (**famille « fiches »**), `ui/om_forms.json` (formulaires à champs), `ui/hud_screen.json` (actionbar/titres)
- **Deux mises en page complètement différentes** (choisies par le titre du formulaire, seul canal lisible côté JSON UI — Bedrock ne partage qu'un seul écran pour tous les menus à boutons) :
  - **menus hub/admin et sous-menus** : colonne de **tuiles fines** à gauche + grand panneau de texte à droite, panneaux argentés, fond cuir à cadre or ;
  - **menus de contenu** (Classes, États/Clans, Le Monde, Mines, Métiers, Mes infos) : **bandeau de texte en haut** puis **grandes cartes dorées empilées** en bas (barre d'accent dorée, texte plus grand, surbrillance marquée), fond **vert émeraude à double filet or/argent** — un look et une silhouette sans rapport avec les menus du hub ;
  - **formulaires à champs** (/sn:create, sanctions…) : grand cadre **bleu nuit** (variante « cartes »)
- **Flèche retour en vraie icône** blanche en haut à gauche (pastille à liseré doré, surbrillance au survol) au lieu d'un bouton de liste
- Textures générées par script : `bun run textures` (aucune dépendance externe, PNG écrits par la stdlib Python)

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
| `@minecraft/server-ui` 2.3.0-beta | Formulaires in-game (ActionForm / ModalForm) |
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
│   ├── ui/                  #   om_base / server_form / om_sheets / om_forms / hud_screen
│   └── textures/ui/         #   cadres, tuiles, flèche retour, fonds (générés)
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
│   ├── ui/                  # Moteur de formulaires (theme.ts) + contrat de style (sheets.ts)
│   ├── players.ts           # Index joueurs (id stable, sessions, grades)
│   └── lib/                 # Loggers
├── serveur/                 # Monde de test (packs activés)
├── scripts/                 # make_ui_textures.py
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

**Tests : 71 tests unitaires** (DB + migrations, territoires, permissions, modération, classes, générateur de mine, contrat JSON UI ↔ moteur).

## Installer l'add-on en jeu

1. Copie `BP/` dans `development_behavior_packs/` et `RP/` dans `development_resource_packs/`
2. Active **les deux packs** dans les paramètres du monde (le BP dépend du RP, il l'active automatiquement)
3. **Quitte et relance le monde** (les commandes `/sn:*` s'enregistrent au démarrage)
4. Vérifie `/sn:menu` ; si l'UI n'a pas changé, **bump la version du RP** (`RP/manifest.json`) et recharge : Bedrock met les packs en cache

## Roadmap (idées en vrac)

- [ ] Bonus de classe concrets (dégâts, potions, vitesse) branchés sur le niveau
- [ ] Métiers jouables (récolte → récompenses) et économie (monnaie en DB)
- [ ] Dons / récompenses attribuables aux joueurs (menu dédié)
- [ ] Extension de territoire hors du carré 3×3 autour du fondateur
- [ ] À définir avec la suite du projet
