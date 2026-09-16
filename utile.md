# 🧰 utile.md — Outils GitHub pour le projet serveur OpenMontage

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
| [IMvampireXD/Script-API-Utilities](https://github.com/IMvampireXD/Script-API-Utilities) | 10 | Fonctions prêtes pour scripts Bedrock (inventaire, blocs, entités) — **actif (janv. 2026), licence MIT**. Pas sur npm : fichiers .js à copier dans le projet. Bonne source d'helpers à vendor si besoin (ex : saveInventory/loadInventory via Dynamic Properties, comme notre DB) |
| [TaranGauri/GalactiXDB](https://github.com/TaranGauri/GalactiXDB) | 3 | Système de DB en Script API — **directement comparable à notre JsonDatabase** : bon miroir pour nos choix (découpage, autosave) |
| [AmethystJs/AmethystJs](https://github.com/AmethystJs/AmethystJs) | 4 | ❌ **ÉCARTÉ (testé)** : repo mort depuis août 2023, cible Minecraft 1.20.10 (API `@minecraft/server` 1.x — incompatible avec nos breaking changes 2.x). ⚠️ Piège : le package **npm `amethystjs` est un AUTRE projet** (framework Discord.js v14) — ne pas installer |
| [CAIMEOX/pure_bedrock](https://github.com/CAIMEOX/pure_bedrock) | 5 | Bindings PureScript — curieux mais montre des patterns typés avancés |

## 🖥️ Héberger un vrai serveur (quand l'add-on deviendra un serveur)

| Outil | ⭐ | Pourquoi ça peut servir |
|---|---|---|
| **[EndstoneMC/endstone](https://github.com/EndstoneMC/endstone)** | 734 | Serveur Bedrock avec API plugins façon Paper — la voie « sérieuse » si OpenMontage devient un vrai serveur. Port WorldEdit dispo (BubbaXM/endstone-worldedit) |
| [PieMC-Dev/PieMC](https://github.com/PieMC-Dev/PieMC) | 106 | Serveur Bedrock en Python, très actif, bonne porte d'entrée si tu préfères scripter en Python |
| [KoshakMineDEV/Lumi](https://github.com/KoshakMineDEV/Lumi) | 82 | Serveur haute perf, à surveiller |
| [bedrock-crustaceans/chorus](https://github.com/bedrock-crustaceans/chorus) | 72 | Serveur en Rust — perf max, équipe réduite |
| [8Crafter-Studios/Bedrock-World-Editor](https://github.com/8Crafter-Studios/Bedrock-World-Editor) | 73 | Éditeur NBT/LevelDB de mondes — utile pour inspecter/réparer la DB Dynamic Properties en dehors du jeu |

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
