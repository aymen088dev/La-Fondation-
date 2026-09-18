# 🌍 Dossier `serveur/` — Installation sur ton serveur Bedrock

Ce dossier contient **uniquement les fichiers de monde** qui activent NaLandia automatiquement
sur un serveur Bedrock Dedicated (BDS). Tu n'as **rien à toucher** dans le monde via `/behaviorpack list` :
le BP (et le RP qu'il appelle) se chargent dès le démarrage.

---

## 🚀 Installation étape par étape

### 1. Récupérer les packs

À la racine du repo, tu as :

| Dossier | Contenu |
|---|---|
| `BP/` | Behavior Pack NaLandia (scripts compilés `BP/scripts/main.js`) |
| `RP/` | Resource Pack NaLandia UI (JSON UI + textures) |

### 2. Copier les packs dans ton serveur

```
<serveur>/behavior_packs/NaLandiaBP/     ← tout le contenu de BP/
<serveur>/resource_packs/NaLandiaRP/     ← tout le contenu de RP/
```

> Les noms de dossiers sont libres ; seuls les UUID des manifests comptent.

### 3. Activer les packs dans le monde

Copie les **deux fichiers JSON** de ce dossier `serveur/` dans le dossier du monde :

```
<serveur>/worlds/<Monde>/world_behavior_packs.json    ← depuis serveur/world_behavior_packs.json
<serveur>/worlds/<Monde>/world_resource_packs.json    ← depuis serveur/world_resource_packs.json
```

Contenu actuel :

- `world_behavior_packs.json` → BP `2915bab9-50f2-442e-a17a-4c8e9cd688fb` v2.4.0
- `world_resource_packs.json` → RP `33ca6e1c-4f30-46ae-8b56-1510382e3f61` v2.4.0

## ⚠️ Mise à jour des packs (cache Bedrock)
Bedrock identifie un pack par **uuid + version** : si tu remplaces les fichiers sans incrémenter la version des manifests, le jeu garde **l'ancien pack en cache** (menus visuellement inchangés, textures manquantes).

À chaque modification de RP ou BP :
1. Incrémente `version` dans `BP/manifest.json` ET `RP/manifest.json` (ex : 2.3.0 → 2.4.0)
2. Reporte exactement la même version dans `serveur/world_behavior_packs.json` et `serveur/world_resource_packs.json`
3. Re-copie `BP/`, `RP/` et les 2 JSON de `serveur/` sur ton serveur

## 🆘 Dépannage rapide
- **Un menu ne s'ouvre pas** (RP pas à jour côté client) : `/scriptevent sn:ui off` → tous les menus s'ouvrent sans images (mode compatibilité). `sn:ui on` pour réactiver une fois le RP à jour.

> ⚠️ Si le monde a **déjà** des packs actifs, fusionne les tableaux JSON au lieu d'écraser
> (un pack déjà présent doit rester dans la liste).

### 4. Démarrer le serveur

```bash
./bedrock_server
```

Au démarrage, tu dois voir le pack chargé :

```
[INFO] Loaded BehaviorPack: NaLandia BP
[INFO] Loaded ResourcePack: NaLandia UI
```

Le BP dépend du RP (déclaré dans `BP/manifest.json` → dependencies) :
**activer le BP suffit**, le RP est chargé avec lui.

---

## ✅ Vérifications en jeu

1. `/sn:menu` → le hub NaLandia s'ouvre
2. `/scriptevent log:level 4` → logs détaillés du chargement DB
3. La DB se charge **après le worldLoad** (garde anti-écrasement) — un message s'affiche en cas de problème

## 🎮 Rappel commandes

| Commande | Rôle |
|---|---|
| `/sn:menu` | Hub central (filtre selon permissions) |
| `/sn:db menu` | Menu DB admin (joueurs, territoires, rôles, sanctions…) |
| `/sn:admin` | Menu admin (rôles / joueurs / modules) |
| `/sn:create` | Créer un territoire |
| `/scriptevent log:level <0-5>` | Niveau de logs |

> Sur un serveur BDS les joueurs tapent `/scriptevent` directement dans le chat.

## 🔧 Si tu modifies le code (TypeScript)

Recompiler avant de redéployer `BP/scripts/main.js` :

```bash
bun install
bun run build      # → BP/scripts/main.js
bun test           # tests unitaires
```

Puis re-copie `BP/` vers `<serveur>/behavior_packs/NaLandiaBP/`.

---

## 📝 Notes

- Minecraft **1.26.50** requis (Beta APIs activées par le BP via `min_engine_version`).
- Les **Dynamic Properties** du monde stockent la DB — ne supprime pas le fichier `db/` du monde.
- Le RP contient désormais une couche JSON UI légère : elle place les fonds gameplay, fiches et gestion derrière les formulaires natifs sans intercepter les clics. Les textures restent remplaçables dans `RP/textures/` en conservant les mêmes noms.
