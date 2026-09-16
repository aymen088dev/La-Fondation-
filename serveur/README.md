# 🌍 Dossier `serveur/` — Installation sur ton serveur Bedrock

Ce dossier contient **uniquement les fichiers de monde** qui activent OpenMontage automatiquement
sur un serveur Bedrock Dedicated (BDS). Tu n'as **rien à toucher** dans le monde via `/behaviorpack list` :
le BP (et le RP qu'il appelle) se chargent dès le démarrage.

---

## 🚀 Installation étape par étape

### 1. Récupérer les packs

À la racine du repo, tu as :

| Dossier | Contenu |
|---|---|
| `BP/` | Behavior Pack OpenMontage (scripts compilés `BP/scripts/main.js`) |
| `RP/` | Resource Pack OpenMontage UI (JSON UI + textures) |

### 2. Copier les packs dans ton serveur

```
<serveur>/behavior_packs/OpenMontageBP/     ← tout le contenu de BP/
<serveur>/resource_packs/OpenMontageRP/     ← tout le contenu de RP/
```

> Les noms de dossiers sont libres ; seuls les UUID des manifests comptent.

### 3. Activer les packs dans le monde

Copie les **deux fichiers JSON** de ce dossier `serveur/` dans le dossier du monde :

```
<serveur>/worlds/<Monde>/world_behavior_packs.json    ← depuis serveur/world_behavior_packs.json
<serveur>/worlds/<Monde>/world_resource_packs.json    ← depuis serveur/world_resource_packs.json
```

Contenu actuel :

- `world_behavior_packs.json` → BP `2915bab9-50f2-442e-a17a-4c8e9cd688fb` v1.0.0
- `world_resource_packs.json` → RP `33ca6e1c-4f30-46ae-8b56-1510382e3f61` v1.0.0

> ⚠️ Si le monde a **déjà** des packs actifs, fusionne les tableaux JSON au lieu d'écraser
> (un pack déjà présent doit rester dans la liste).

### 4. Démarrer le serveur

```bash
./bedrock_server
```

Au démarrage, tu dois voir le pack chargé :

```
[INFO] Loaded BehaviorPack: OpenMontage BP
[INFO] Loaded ResourcePack: OpenMontage UI
```

Le BP dépend du RP (déclaré dans `BP/manifest.json` → dependencies) :
**activer le BP suffit**, le RP est chargé avec lui.

---

## ✅ Vérifications en jeu

1. `/scriptevent sn:menu` → le hub OpenMontage s'ouvre (DDUI)
2. `/scriptevent log:level 4` → logs détaillés du chargement DB
3. La DB se charge **après le worldLoad** (garde anti-écrasement) — un message s'affiche en cas de problème

## 🎮 Rappel commandes

| Commande | Rôle |
|---|---|
| `/scriptevent sn:menu` | Hub central (filtre selon permissions) |
| `/scriptevent sn:db menu` | Menu DB admin (joueurs, territoires, rôles, sanctions…) |
| `/scriptevent sn:admin` | Menu admin (rôles / joueurs / modules) |
| `/scriptevent sn:create` | Créer un territoire |
| `/scriptevent log:level <0-5>` | Niveau de logs |

> Sur un serveur BDS les joueurs tapent `/scriptevent` directement dans le chat.

## 🔧 Si tu modifies le code (TypeScript)

Recompiler avant de redéployer `BP/scripts/main.js` :

```bash
bun install
bun run build      # → BP/scripts/main.js
bun test           # 33 tests
```

Puis re-copie `BP/` vers `<serveur>/behavior_packs/OpenMontageBP/`.

---

## 📝 Notes

- Minecraft **1.26.50** requis (Beta APIs activées par le BP via `min_engine_version`).
- Les **Dynamic Properties** du monde stockent la DB — ne supprime pas le fichier `db/` du monde.
- Textures du RP actuellement **placeholder** (visuels temporaires) : remplace les PNG
  dans `RP/textures/` par tes visuels définitifs (mêmes noms de fichiers).
