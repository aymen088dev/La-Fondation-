# NaLandia — Add-on Minecraft Bedrock

> ⚠️ **Projet en développement** — tout est en cours de construction, rien n'est figé. Ne l'utilise pas encore sur un monde important : le schéma de données peut changer sans migration.

> **NaLandia** (anciennement « OpenMontage ») : l'add-on de serveur avec territoires/États, clans, rôles, modération, classes, métiers et une dimension minière dédiée — le tout dans **des menus dessinés en JSX** (or & argent, surbrillance au survol) et **trois familles visuelles nettement différentes** selon le menu.

**Packs actuels : 2.2.0** (Behavior Pack + Resource Pack + monde de test dans `serveur/`).

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

### 🎨 UI — menus dessinés en JSX (v20)
Les menus ne sont plus « habillés » par un JSON UI qui devine lequel est ouvert : ils sont **écrits en JSX** dans le script et **peints par notre Resource Pack**.

- **Pourquoi** : Bedrock n'expose **qu'un seul écran** pour tous les menus à boutons (`long_form`). L'ancienne approche déduisait la famille du menu en comparant son **titre** dans le JSON UI — fragile, et limitée à deux silhouettes presque identiques. C'est exactement ce qui faisait que « tous les menus ressemblaient à `/sn:menu` ».
- **Comment** : le runtime [`@bedrock-core/ui`](https://github.com/bedrock-core/ui) construit un arbre JSX, le **sérialise** dans la chaîne que porte un formulaire vanilla, et le **render pack** (décodeur JSON UI, embarqué dans `RP/ui/core-ui/`) le décode et le peint. La mise en page devient donc **du ressort du script** (`src/ui/theme.tsx`), pas du JSON UI.
- **Trois silhouettes réellement distinctes**, choisies par notre propre code (`designForSection`, `src/ui/sheets.ts`) :
  - **`console`** — hub, admin, base de données, modération, rôles, joueurs, modules : **barre de titre or** avec la flèche retour + colonne de **tuiles fines** ;
  - **`cards`** — Classes, Métiers, Le Monde, Mines, États : **grand bandeau doré** + **grandes cartes empilées** (36 px, texte 1,3×, fond **vert émeraude**) ;
  - **`parchment`** — Clan, Mon clan, Membres, Membre, Inviter, Drapeau, Créer/Dissoudre un clan, Mes infos : bandeau doré + panneau de texte sur fond **bleu nuit à filet argent**, tuiles Ore UI propres ;
  - **`fields`** — formulaires à champs (`<Form>` natif : champs texte, sliders, dropdowns, toggles).
- **Flèche retour** : vraie pastille-flèche blanche en **haut à gauche du bandeau** (surbrillance au survol) — plus jamais un bouton de la liste. Dans un formulaire à champs, le retour est un bouton « ← Retour » du formulaire (un modal refuse les boutons classiques).
- **Textures** générées par script : `bun run textures` (aucune dépendance externe, PNG écrits par la stdlib Python). Les cadres, cartes et fonds déclarent leur **nineslice** (`om_btn.json`, `om_card.json`…) pour ne pas être étirés.
- **Actionbar / titres** : toujours notre `ui/hud_screen.json`.

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
| `@bedrock-core/ui` 0.11.0 | Moteur UI JSX : l'arbre de composants est sérialisé dans un formulaire vanilla puis décodé par le render pack (menus, `<Form>` à champs, scroll, flex) |
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
│   ├── ui/                  #   server_form.json + core-ui/ = décodeur du render pack ; hud_screen.json (actionbar)
│   ├── texts/               #   (aucun : le pack ne ship pas de .lang)
│   └── textures/ui/         #   cadres, tuiles, cartes, flèche retour, fonds (générés) + textures Ore UI du render pack
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
│   ├── ui/                  # Moteur de menus JSX (theme.tsx) + contrat de style testable (sheets.ts)
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

**Tests : 79 tests unitaires** (DB + migrations, territoires, permissions, modération, classes, générateur de mine, **contrat d'habillage ↔ moteur** : render pack déclaré, toolchain JSX, familles distinctes, textures et nineslice).

## Installer l'add-on en jeu

1. Copie `BP/` dans `development_behavior_packs/` et `RP/` dans `development_resource_packs/`
2. Active **les deux packs** dans les paramètres du monde (le BP dépend du RP, il l'active automatiquement)
3. **Quitte et relance le monde** (les commandes `/sn:*` s'enregistrent au démarrage)
4. Vérifie `/sn:menu` ; si l'UI n'a pas changé, **bump la version du RP** (`RP/manifest.json`) et recharge : Bedrock met les packs en cache

> ℹ️ Le **render pack** qui peint les menus est embarqué dans `RP/ui/core-ui/` : il n'y a **rien de plus à installer** que le Resource Pack habituel. Si les menus s'affichent mais **sans habillage** (ou vides), c'est que le RP n'est pas activé — ou qu'il est resté en cache.

## Base de données et compatibilité

Le schéma DB est maintenant en **v4**. La migration ajoute automatiquement la bio des clans aux mondes existants sans supprimer ni réinitialiser les collections précédentes. Les sauvegardes restent gérées par les Dynamic Properties Bedrock et l'autosave.

## Roadmap (idées en vrac)

- [ ] Bonus de classe concrets (dégâts, potions, vitesse) branchés sur le niveau
- [ ] Métiers jouables (récolte → récompenses) et économie (monnaie en DB)
- [ ] Dons / récompenses attribuables aux joueurs (menu dédié)
- [ ] Extension de territoire hors du carré 3×3 autour du fondateur
- [ ] À définir avec la suite du projet
