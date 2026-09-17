# NaLandia — Add-on Minecraft Bedrock

> ⚠️ **Projet en développement** — tout est en cours de construction, rien n'est figé. Ne l'utilise pas encore sur un monde important : le schéma de données peut changer sans migration.

> **NaLandia** (anciennement « OpenMontage ») : l'add-on de serveur avec territoires, rôles, modération, classes et métiers — le tout dans une UI noir & or/argent avec surbrillance au survol.

## C'est quoi ce repo ?

La **base** de l'add-on : une toolchain TypeScript complète + un système de données persistantes, sur lesquels toutes les futures features vont s'appuyer.

## Ce qu'il y a déjà

### 🗄️ Base de données JSON locale (le cœur du projet)
Base de données maison, persistée dans le monde via les Dynamic Properties Bedrock :

- **Collections de documents** JSON (`territories`, `players`, ...) avec CRUD complet (`insert`, `findOne`, `find`, `update`, `upsert`, `delete`, `count`, `clear`, `drop`)
- **Dirty tracking** : les sauvegardes n'écrivent que si les données ont changé
- **Autosave** en jeu toutes les 5 s (si nécessaire)
- **Découpage en morceaux** pour contourner la limite Bedrock des 32 767 caractères par propriété
- **14 tests unitaires** (adaptateur mémoire hors du jeu)

### 🚩 Territoires par chunks
- `/sn:create` — revendique le chunk où tu es (menu : nom + couleur de drapeau)
- `/sn:info` — liste cliquable de tous les territoires + fiche détaillée
- `/sn:setflag <couleur>` — change la couleur de son drapeau
- **Protection totale** : casse/pose de blocs, coffres, usage d'objets, PvP, créatures et explosions — seuls le propriétaire (et les créatifs) passent

### 🛠️ Outils admin
- `/sn:db stats|list|show|save` — consultation de la base (réservé aux opérateurs)

## Stack technique

| Outil | Rôle |
|---|---|
| TypeScript 5 + esbuild | Code source → bundle unique `BP/scripts/main.js` |
| `@minecraft/server` 2.9.0 | API script stable (commandes custom, events, protection) |
| `@minecraft/server-ui` 2.1.0 | Menus in-game |
| Bun | Exécution des tests et scripts |
| Bun test | Tests unitaires (DB et logique territoires) |

## Structure

```
├── BP/                      # Behavior Pack (ce que charge Minecraft)
│   ├── manifest.json
│   └── scripts/main.js      # ← généré par le build, NE PAS éditer
├── src/                     # Code source TypeScript
│   ├── main.ts              # Point d'entrée (branchement de tout)
│   ├── db/                  # La base de données JSON locale
│   │   ├── database.ts      #   JsonDatabase (CRUD, dirty tracking)
│   │   ├── storage.ts       #   Adaptateurs mémoire + découpage
│   │   ├── bedrock-storage.ts # Persistance Dynamic Properties
│   │   └── autosave.ts      #   Sauvegarde automatique
│   ├── territories/         # Système de territoires
│   │   ├── manager.ts       #   Logique métier (chunks, permissions)
│   │   ├── commands.ts      #   /sn:create, /sn:info, /sn:db...
│   │   ├── ui.ts            #   Menus server-ui
│   │   └── protection.ts    #   Protection des chunks
│   └── players.ts           # Tracking des joueurs
├── build.mjs                # Script de build (esbuild)
└── tsconfig.json
```

## Démarrer

```bash
bun install        # installer les dépendances
bun run build      # compiler src/ → BP/scripts/main.js
bun run watch      # recompiler à chaque modification (dev)
bun run test       # lancer les tests
bun run typecheck  # vérifier les types
```

## Installer l'add-on en jeu

1. Copie le dossier `BP/` dans `development_behavior_packs/`
2. Active le pack dans les **Paramètres du monde → Packs de comportements**
3. **Quitte et relance le monde** (les commandes `/sn:*` s'enregistrent au démarrage)
4. Teste `/sn:create` — le titre « NaLandia ✔ » au spawn confirme que le script tourne

## Roadmap (idées en vrac)

- [ ] `/sn:claim` — étendre son territoire (la base `addChunk()` existe déjà)
- [ ] Membres de territoire (permissions par joueur)
- [ ] Économie (monnaie en DB)
- [ ] À définir avec la suite du projet
