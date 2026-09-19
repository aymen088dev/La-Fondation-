# NaLandia — Add-on Minecraft Bedrock

> ⚠️ **Projet en développement** — tout est en cours de construction, rien n'est figé. Ne l'utilise pas encore sur un monde important : le schéma de données peut changer sans migration.

> **NaLandia** (anciennement « OpenMontage ») : l'add-on de serveur avec territoires/États, clans, rôles, modération, classes, métiers et une dimension minière dédiée — avec des menus robustes basés sur les formulaires officiels Bedrock.

**Packs actuels : 2.7.0** (Behavior Pack + Resource Pack + monde de test dans `serveur/`).

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

### UI — deux moteurs, un seul thème

**1. Formulaires natifs (`CustomForm`)** — champs texte, curseurs, listes déroulantes et fiches de lecture. C'est le moteur par défaut : tactile, manette et clavier natifs, aucun framework communautaire.

**2. Menus à tuiles (`ActionFormData` + JSON UI)** — le script envoie un formulaire à boutons NUMÉROTÉS, et `RP/ui/server_form.json` remplace le rendu `long_form` par un panneau dessiné à la main, SANS le cadre gris vanilla :
   - **Classes** : trois cartes verticales, une par voie, de la couleur de la classe (nom en haut de carte, texte borné) ;
   - **Mon clan** : banque en haut à gauche, drapeau en haut à droite, bio au centre, actions en bas ;
   - **Menu / Administration** : même géométrie (colonne de tuiles à gauche, panneau d'état à droite) ;
   - **Nations** : liste paginée des États (3 par page) + fonder / fermer ;
   - **Mes infos** : fiche du joueur à droite, actions à gauche ;
   - **Le Monde** : destinations et repères à gauche, état du joueur à droite.

Les **formulaires à champs** (créations, sanctions, réglages…) gardent les champs natifs mais héritent du **même habillage or & argent** : `custom_form` est réécrit dans le JSON UI, donc plus aucun cadre gris Mojang nulle part.

> ⚠️ **Titres sans accent** : le JSON UI route par comparaison littérale du titre (`NaLandia » Nations`). Un titre accentué était routé vers rien du tout (menu rendu en cadre vanilla) — c'est le test `tiles.test.ts` qui garde cette règle.
   - **Menu (hub) et Administration** : même fenêtre or, six tuiles en colonne à gauche et état dans le panneau de droite.

L'ordre des boutons est un contrat partagé (`src/ui/tiles.ts` ↔ `RP/ui/server_form.json`) vérifié par les tests : un index qui se décale, une texture manquante ou un titre mal filtré fait échouer la suite de tests.

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
│   ├── ui/                  #   hud_screen.json + server_form.json (menus à tuiles)
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
│   ├── ui/                  # Adaptateur des formulaires natifs (theme.ts) + contrat de navigation (sheets.ts)
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
