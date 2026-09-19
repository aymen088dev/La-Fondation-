# agent.md — Guide pour agents travaillant sur ce dépôt

> **NaLandia** — serveur Minecraft Bedrock (add-on : BP scripts + RP UI).
> Stack : TypeScript → esbuild → `BP/scripts/main.js` ; Resource Pack JSON UI
> généré par un pipeline Python. Backend = Script API officielle
> (`@minecraft/server`, `@minecraft/server-ui`), pas de framework UI tiers.

---

## 1. L'architecture UI en 30 secondes

```
src/ui/tiles.ts          ← SOURCE DE VÉRITÉ : contrat des menus à tuiles
                            (bloc @ui-contract-begin/end, du JSON pur)
        │ extrait par
        ▼
scripts/build_ui.py      ← PIPELINE : fetch vanilla Mojang + fusion non
        │                   destructive + génération des panneaux + validation
        ▼
RP/ui/server_form.json   ← PRODUIT GÉNÉRÉ (ne JAMAIS éditer à la main)
        ▼
src/ui/theme.ts          ← RUNTIME : OMForm (CustomForm) + openTileMenu
                            (ActionFormData) ; l'ordre des boutons = contrat
```

Deux flux, un seul principe : **le script envoie des formulaires natifs, le
Resource Pack habille**. Aucune mise en page ne vit des deux côtés.

- **Menus à tuiles** (`openTileMenu`) : `ActionFormData`. Le JSON UI généré
  route le titre (`#title_text = 'NaLandia » Menu'`) vers un panneau dessiné ;
  chaque tuile lit/émet l'index de collection correspondant au contrat.
- **Formulaires à champs** (`OMForm` → `CustomForm`) : le RP ne change QUE la
  variable officielle `$custom_background`. Input tactile/manette/clavier 100 %
  natif, donc jamais cassé.

---

## 2. La méthode (style EasyUIBuilder) — POURQUOI

L'historique du projet a prouvé trois fois que **remplacer un fichier vanilla
entier** par un habillage maison casse tout (formulaires vides, contrôles
`custom_form_panel`/`generated_contents` manquants, artefacts). La méthode
actuelle est :

1. **Vanilla d'abord** — `server_form.json` officiel (Mojang/bedrock-samples,
   cache dans `scripts/vanilla_cache/`) est la base ; ses 25 définitions sont
   recopiées telles quelles.
2. **Modifications ciblées** — exactement 4 points de contact :
   - `custom_form@...` : `$custom_background` (1 variable, en place) ;
   - `dynamic_button` : textures des 3 états (setdefault) ;
   - widgets `om_*` : ajoutés (jamais de remplacement de vanilla) ;
   - `long_form@...` : devient un **WRAPPEUR** `panel` 100 %×100 % dont les
     `controls` = un écran par menu OM (visible si `#title_text` matche) +
     le repli vanilla masqué. La définition vanilla est copiée INTACTE dans
     la branche de repli — jamais mutée en place (les contrôles d'un enfant
     s'additionnent à ceux du parent : muter le vanilla = double rendu).
3. **Repli vanilla** — `om_default_form@...` (copie profonde intacte du
   vanilla) est visible UNIQUEMENT si aucun titre OM ne matche (binding
   généré `(!(#title_text = 'X')) && ...`). Les formulaires des autres
   add-ons gardent leur rendu natif.
3.5. **Binding de titre = 2 bindings** : `{binding_name: "#title_text"}`
   (collecte, OBLIGATOIRE) PUIS la condition `view`. Sans la collecte, la
   propriété n'est pas résolue dans la portée et la visibilité ne s'évalue
   jamais (menus invisibles). Pattern vérifié dans les packs de production.
4. **Validation stricte** — le pipeline échoue (exit 1) si : duplicate
   `X`/`X@parent`, référence `server_form.X` non résolue, texture `om_*`
   absente sur disque.
5. **Écriture conditionnelle** — le fichier n'est réécrit que si le contenu
   diffère (pas de bump inutile).

### Commandes

```bash
python3 scripts/build_ui.py            # régénère RP/ui/server_form.json
bun tsc --noEmit                       # typecheck
bun test                               # 81 tests (dont validation du JSON)
bun run build                          # bundle esbuild -> BP/scripts/main.js
```

---

## 3. Les règles immuables (ne pas contourner)

1. **Ne JAMAIS éditer `RP/ui/server_form.json` à la main** — il est généré.
   Toute modification passe par `scripts/build_ui.py` ou par le contrat.
2. **Ne JAMAIS créer de second `long_form` / `custom_form`** (duplicate
   `X` + `X@parent`) — le jeu ne résout plus rien ; c'est LE bug historique.
3. **L'ordre des boutons EST le contrat.** Un panneau indexé lit
   `form_button_text[i]` par position : ajouter un bouton sans mettre à jour
   le contrat décale tout le menu.
4. **Sections ASCII** (`Mon clan`, pas « Mon clan » avec accent dans le
   titre routé) — le JSON UI compare les titres littéralement.
5. **Bump la version RP à chaque changement de JSON/textures** (`RP/manifest.json`
   + `serveur/world_resource_packs.json` + BP pour rester synchrone) : Bedrock
   cache les packs.
6. **Pas de framework tiers** (`@bedrock-core/ui`, etc.) : API officielle
   uniquement. L'expérience a montré que les wrappers tiers divergent des
   versions réelles du jeu.
7. **Pas de propriétés inventées en JSON UI.** `button_up` (dans un
   `button_mappings`) n'existe pas : le contrôle entier est rejeté à l'écran
   (boutons morts, labels orphelins). Ne JAMAIS ajouter une clé absente du
   vanilla ; les mappings canoniques sont `menu_select`/pressed +
   `menu_ok`/focused vers `button.form_button_click` (cf. `common.button`).
8. **Les boutons custom = type `button` canonique** (default/hover/pressed
   + `button_mappings` ci-dessus + `collection_details`). Toute autre
   construction (panneau cliquable, etc.) casse tactile/manette.

---

## 4. Ajouter / modifier un menu à tuiles

### Cas A — menu à LISTE (nombre libre d'entrées)

1. Ajoute le nom de section (ASCII, ex. `Constructions`) dans le tableau
   `generic` du contrat (`src/ui/tiles.ts`).
2. Régénère : `python3 scripts/build_ui.py` → le panneau `om_panel_*` et le
   routing sont créés automatiquement (thème or générique ; une texture
   `om_menu_constructions_bg` peut être ajoutée plus tard).
3. Côté script, appelez `openTileMenu(player, "Constructions", (menu) => { ... })`.
   Les listes longues se paginent avec `pageSlice(items, page, PANEL_TILE_CAPACITY)`.

### Cas B — menu à EMPLACEMENTS (mise en page dessinée)

1. Ajoute la section dans `indexed` du contrat avec ses clés :
   `"actions": ["...", ..., "back"]` (le `back` en DERNIER) et `"data": [...]`
   (textes transportés, ex. descriptions, `flag_id`).
2. Si le panneau a besoin d'un dessin spécifique (drapeaux, grille de cartes…),
   étends `indexed_panel()` dans `scripts/build_ui.py` — voir
   `clan_panel_decoration()` pour l'exemple du rendu conditionnel par token.
3. Régénère, puis implémente le builder côté script en respectant l'ordre.

### Cas C — fiche / formulaire à champs

Rien à déclarer : utilise `OMForm`/`openWindow`. L'habillage est global.

---

## 5. Dépannage rapide

| Symptôme | Cause probable | Fix |
|---|---|---|
| Menu avec des artefacts « en dessous » | Repli vanilla visible (binding masqué perdu) | `python3 scripts/build_ui.py`, vérifier le binding `!` du repli |
| Menu qui retombe sur le rendu vanilla | Titre ≠ contrat (accent, espace) | Comparer `tileTitleFor()` et le binding JSON |
| Tuiles qui font la mauvaise action | Ordre des boutons ≠ contrat | Compter `actions`/`data` des deux côtés |
| Formulaires à champs vides | Définitions vanilla absentes | Le test `theme.test.ts` liste les clés requises |
| Menus « ne s'ouvrent pas » | `UserBusy` du client (form successif) | Retry déjà en place (`scheduleTileForm`, 3 essais) |
| JSON modifié mais rien en jeu | Version RP pas bumpée | Bump `RP/manifest.json` + `serveur/world_resource_packs.json` |

---

## 6. Conventions du dépôt

- Commits : message court en anglais ou français, style `ui: ...` / `v2.8.0: ...`.
- Tests obligatoires avant push : `bun tsc --noEmit && bun test`.
- `done.md` : journal bilingue des itérations (une entrée par version).
- Textures : générées par `scripts/make_ui_textures.py` (Pillow), 9-slice
  déclaré dans les `.json` voisins.
- Language du code : français pour les commentaires utilisateur-facing,
  anglais accepté ; rester cohérent par fichier.
