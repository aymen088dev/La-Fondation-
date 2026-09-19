# agent.md — Guide pour agents travaillant sur ce dépôt

> **NaLandia** — serveur Minecraft Bedrock (add-on : BP scripts + RP).
> Stack : **TypeScript JSX → esbuild → `BP/scripts/main.js`** ; UI rendue par
> le framework **`@bedrock-core/ui`** (v0.11) + son **render pack CoreUI**
> vendu dans `RP/ui/core-ui/`. Formulaires à champs : API native
> `@minecraft/server-ui` (CustomForm). Textures du thème : `scripts/make_ui_textures.py`.

---

## 1. L'architecture UI en 30 secondes

```
src/ui/kit.tsx     ← KIT VISUEL : Window, TitleBar, TileButton, SidebarLayout,
                     Sheet, ScrollList… (textures om_* de l'identité)
src/ui/theme.tsx   ← MOTEUR : openTileMenu (builder menu.action/body → JSX
                     → render()) + OMForm (formulaires natifs) + Observables
src/ui/labels.ts   ← helpers purs : pageSlice, fitLabel, wrapLabel
RP/ui/core-ui/     ← RENDER PACK (vendu, NE PAS ÉDITER) : décode le protocole
                     du framework en JSON UI. Version = release du package.
```

- **Écran = fonction JSX**. Un builder `menu.action(label, onPress)` /
  `menu.body(texte)` assemble des composants du kit ; `render(<Écran/>, player)`
  affiche. Layout en **flexbox** (flexDirection, gap, padding…), **scroll
  natif** via `<Scroll>` (les listes longues scrollent — plus de pagination
  forcée), boutons à 3 états (background / backgroundHover / backgroundPressed).
- **Formulaires à champs = natifs** (`OMForm.textField/slider/dropdown/toggle`)
  : l'input texte et le tactile sont garantis par Mojang. Ne les remplace PAS
  par du JSX.
- **Hooks du framework** : `useState`, `useEffect`, `usePlayer`, `useExit`…
  (import depuis `@bedrock-core/ui`). Le state ne repeint pas l'écran en
  direct : le joueur voit le nouvel arbre à sa prochaine interaction.

## 2. La méthode (les 6 règles immuables)

1. **Ne JAMAIS éditer `RP/ui/core-ui/`** — c'est le render pack officiel du
   framework. Sa version (BP/manifest.json `761ecd37-…`) DOIT matcher la
   release du package npm (`@bedrock-core/ui@x.y.z` → pack `[1, x, y]`).
2. **Ne JAMAIS réécrire un écran en JSON UI maison** — le routage par titre
   (`#title_text = '…'`) et le contrat d'index ont causé toutes les régressions
   historiques (duplicates, doubles rendus, replis visibles). Un écran, c'est
   du JSX dans `src/`.
3. **Toute brique visuelle réutilisée 2 fois va dans `kit.tsx`** — les écrans
   assemblent, ils ne dessinent pas. Les textures om_* se posent via le kit
   uniquement.
4. **Les formulaires à champs restent natifs** — ne réinvente pas l'input
   texte en JSX : `OMForm.textField` (CustomForm natif) est le bon outil.
5. **Bump la version RP+BP à chaque changement de JSON/textures**
   (`RP/manifest.json` + `serveur/world_*.json` + BP pour rester synchrone) :
   Bedrock cache les packs. Le RP module reste `[1,0,0]` (recette interne).
6. **Vérifier avant de pousser** : `bun tsc --noEmit` + `bun test` +
   `node build.mjs` (le bundle doit finir dans `BP/scripts/main.js`).

## 3. Ajouter / modifier un écran

### Cas A — menu à liste (hub, admin, joueurs…)

```tsx
openTileMenu(player, "Titre", (menu) => {
  menu.body("§6Ligne d'accueil\n§7details…");      // plaque de droite
  menu.action("§6Label", label, () => openAutreMenu(player)); // tuile gauche
});
```
La colonne de gauche scrolle toute seule si la liste dépasse 8 entrées.

### Cas B — écran dessiné (nouveau design)

Compose les briques du kit dans un composant JSX puis `render(<MonEcran/>, player)`.
S'inspirer de `TileScreen`/`ListScreen` dans `theme.tsx`.

### Cas C — formulaire (création, réglages…)

Garder `openWindowRaw(player, "Titre", (form) => { form.textField(…); … })`.

### Textures du thème

`python3 scripts/make_ui_textures.py` régénère les PNG `RP/textures/ui/om_*`
(cuir/or). Les noter dans `kit.tsx` (constante `TEX`).

## 4. Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Écran vide/noir | render pack absent ou version ≠ package | vérifier `RP/ui/core-ui/` + dépendance BP |
| Pas de style (boutons gris « unstyled ») | textures core-ui déplacées | `RP/textures/ui/ore-styled/`, `pointer.png` |
| Menu ne s'ouvre pas après un autre | enchaînement trop rapide | le délai `runTimeout(…, 1)` du moteur gère ; vérifier qu'on ne render pas deux fois |
| Input texte cassé | champ recodé en JSX | revenir à `OMForm.textField` |
| Pack pas pris en compte en jeu | version non bumpée | bump BP+RP+`serveur/*.json` |

## 5. Commandes

```bash
bun tsc --noEmit                    # typecheck (JSX : jsx=react-jsx, import source @bedrock-core/ui)
bun test                            # tests
node build.mjs                      # bundle esbuild -> BP/scripts/main.js
python3 scripts/make_ui_textures.py # textures du thème
```
