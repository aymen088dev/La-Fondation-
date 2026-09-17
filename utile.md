# 🧰 utile.md — Outils GitHub pour le projet serveur NaLandia

> Veille d'outils GitHub susceptibles de servir au projet. Étoiles indicatives (sept. 2026).

## ⭐ Déjà utilisés dans ce repo

| Outil | Type | Usage |
|---|---|---|
| **[Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples)** | officiel | Fichiers vanilla de référence (JSON UI, resource packs). Notre `RP/ui/hud_screen.json` est construit dessus par `scripts/build_rp_hud.py` |

## 🛠️ Toolchain & build

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| **[Bedrock-OSS/regolith](https://github.com/Bedrock-OSS/regolith)** | 107 | Pipeline de compilation d'add-ons (filtres, watch mode). Le jour où le build dépasse `esbuild` + 2 scripts Python, c'est la brique standard de l'écosystème |
| [AbbottMc/TenonScaffold](https://github.com/AbbottMc/TenonScaffold) | 8 | Scaffold de projet Script API (structure + build) — référence d'organisation |
| [skreneah/bedon](https://github.com/skreneah/bedon) | 1 | CLI d'outils add-on, à surveiller |

## 📚 Script API : libs & utilitaires

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| **[Bedrock-OSS/bedrock-boost](https://github.com/Bedrock-OSS/bedrock-boost)** | 28 | ✅ **INTÉGRÉ (v2.2.0, mise à jour la veille de l'intégration)** — org officielle Bedrock-OSS (regolith). Utilisé pour : `Logger` (niveaux filtrables en jeu via `/scriptevent log:level` et `log:filter`), `Timings` (perf worldLoad), `ColorJSON` (JSON colorisé dans `/sn:db show`). Vec3, cache dimensions, schedulers dispo pour la suite. Runtime : `@minecraft/server` uniquement |
|---|---|---|
| [IMvampireXD/Script-API-Utilities](https://github.com/IMvampireXD/Script-API-Utilities) | 10 | Fonctions prêtes pour scripts Bedrock (inventaire, blocs, entités) — **actif (janv. 2026), licence MIT**. Pas sur npm : fichiers .js à copier dans le projet. Bonne source d'helpers à vendor si besoin (ex : saveInventory/loadInventory via Dynamic Properties, comme notre DB) |
| [TaranGauri/GalactiXDB](https://github.com/TaranGauri/GalactiXDB) | 3 | Système de DB en Script API — **directement comparable à notre JsonDatabase** : bon miroir pour nos choix (découpage, autosave) |
| [AmethystJs/AmethystJs](https://github.com/AmethystJs/AmethystJs) | 4 | ❌ **ÉCARTÉ (testé)** : repo mort depuis août 2023, cible Minecraft 1.20.10 (API `@minecraft/server` 1.x — incompatible avec nos breaking changes 2.x). ⚠️ Piège : le package **npm `amethystjs` est un AUTRE projet** (framework Discord.js v14) — ne pas installer |
| [CAIMEOX/pure_bedrock](https://github.com/CAIMEOX/pure_bedrock) | 5 | Bindings PureScript — curieux mais montre des patterns typés avancés |

## 🖥️ Héberger un vrai serveur (quand l'add-on deviendra un serveur)

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| **[EndstoneMC/endstone](https://github.com/EndstoneMC/endstone)** | 734 | Serveur Bedrock avec API plugins façon Paper — la voie « sérieuse » si NaLandia devient un vrai serveur. Port WorldEdit dispo (BubbaXM/endstone-worldedit) |
| [PieMC-Dev/PieMC](https://github.com/PieMC-Dev/PieMC) | 106 | Serveur Bedrock en Python, très actif, bonne porte d'entrée si tu préfères scripter en Python |
| [KoshakMineDEV/Lumi](https://github.com/KoshakMineDEV/Lumi) | 82 | Serveur haute perf, à surveiller |
| [bedrock-crustaceans/chorus](https://github.com/bedrock-crustaceans/chorus) | 72 | Serveur en Rust — perf max, équipe réduite |
| [8Crafter-Studios/Bedrock-World-Editor](https://github.com/8Crafter-Studios/Bedrock-World-Editor) | 73 | Éditeur NBT/LevelDB de mondes — utile pour inspecter/réparer la DB Dynamic Properties en dehors du jeu |

## 🖱️ API UI pour add-ons (Script API Bedrock)

> Veille du 17 sept. 2026. Notre `OMForm` (wrapper DDUI CustomForm) reste la base ; ces projets servent de référence, d'inspiration ou d'extension.

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| **[XxVoidicxX/mcbe-ui-codex](https://github.com/XxVoidicxX/mcbe-ui-codex)** | réf | 🏆 **À garder sous la main** : référence VÉRIFIÉE — 600+ chemins de textures vanilla avec aperçus PNG, référence Script API 2.x avec 20+ pièges documentés, et un **guide JSON UI de reskin des forms serveur** (boutons custom nineslice, hover/pressed…). Docs MIT. Utilisable comme contexte dev/AI |
| **[Sprixvy/Chest-Form](https://github.com/Sprixvy/Chest-Form)** | 1 | **ChestFormData** : rend une form comme un coffre (27/54 slots, lore, durabilité, glint enchant) — style « serveurs Java » sans entités. JS + RP JSON UI inclus. Idéal si un jour on veut une boutique/menu inventaire |
| [wisp-ts/forms-plus](https://github.com/wisp-ts/forms-plus) | 0 | Wrapper **typé** de `@minecraft/server-ui` (TS, à jour avr. 2026) — même philosophie que notre `OMForm`, bon miroir pour comparer les approches |
| [forestJAVASCRIPT/better-forms](https://github.com/forestJAVASCRIPT/better-forms) | 0 | Lib de wrappers pour les forms `server-ui` (TS) |
| [markeev/bedrock-tile-menu](https://github.com/markeev/bedrock-tile-menu) | 1 | Menus en **tuiles image** par-dessus les Forms standard (RP JSON UI, sans mods client). Côté logiciel serveur (PocketMine/Nukkit) mais la technique RP est transposable à un add-on |
| [Refaltor77/EasyUIBuilder](https://github.com/Refaltor77/EasyUIBuilder) | 110 | Outil visuel pour générer du JSON UI de forms plus vite |
| [8Crafter-Studios/Ore-UI-Types](https://github.com/8Crafter-Studios/Ore-UI-Types) | 2 | Types TS de l'environnement de script **Ore UI** (la nouvelle UI client de Mojang, actif sept. 2026) — pas encore pilotable par add-on, mais à surveiller de près |

❌ **LeviInterface (leoweyr)** écarté : « UI queues » pour **LeviLamina** (plugin C++ serveur), pas pour les add-ons Script API.

## 🎨 JSON UI / UI custom

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| [w1zardz/bedrock-json-ui-editor](https://github.com/w1zardz/bedrock-json-ui-editor) | 9 | Éditeur visuel drag & drop de JSON UI (mobile-friendly) |
| [cd-cm-pro/minecraft-bedrock-json-ui-examples](https://github.com/cd-cm-pro/minecraft-bedrock-json-ui-examples) | 1 | Galerie d'exemples de JSON UI |
| [joeskeen/bedrock-json-ui-data-helper](https://github.com/joeskeen/bedrock-json-ui-data-helper) | 0 | Passer des données script → JSON UI (si un jour on veut des écrans dynamiques) |

## 💡 Comment lire ce fichier
- Les ⭐ étoiles sont un indicateur d'activité, pas de qualité.
- Avant d'intégrer un outil : vérifier sa licence et sa compatibilité Minecraft **1.26.50** / API bêta 2.11.
- Priorité personnelle suggérée : **regolith** (si la toolchain grossit), **Bedrock-World-Editor** (debug DB), **endstone** (étape serveur).
