# agent.md — Guide pour agents travaillant sur ce dépôt

> **NaLandia** — serveur Minecraft Bedrock (add-on : BP scripts + RP).
> Stack : **TypeScript JSX → esbuild → `BP/scripts/main.js`** ; UI rendue par
> le framework **`@bedrock-core/ui`** (v0.11) + son **render pack CoreUI**
> vendu dans le RP (`RP/ui/core-ui/` + `RP/ui/server_form.json`). Formulaires à champs : API native
> `@minecraft/server-ui` (CustomForm). Textures du thème : `scripts/make_ui_textures.py`.

---

## 1. L'architecture UI en 30 secondes

```
src/ui/kit.tsx     ← KIT VISUEL : compose le DESIGN SYSTEM officiel du
                     framework (@bedrock-core/ore-styled : Header, MenuRow,
                     Card, Divider + tokens). AUCUNE texture maison.
                     Briques : AppShell, SidebarLayout, NavColumn,
                     ContentCard, Sheet, SectionTitle, BodyLines.
src/ui/theme.tsx   ← MOTEUR : openTileMenu (builder menu.action/body → JSX
                     → render()) + OMForm (formulaires natifs) + Observables
src/ui/labels.ts   ← helpers purs : pageSlice, fitLabel, wrapLabel
RP/ui/server_form.json ← ROUTING du render pack (vendu, NE PAS ÉDITER).
                    Doit rester À LA RACINE de ui/ et en TÊTE de _ui_defs.json :
                    c'est le seul chemin que le jeu lit pour remplacer le
                    formulaire serveur vanilla. S'il disparaît, le jeu affiche
                    la charge utile brute `bcuiv…` au lieu de décoder l'écran.
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

1. **Ne JAMAIS éditer `RP/ui/core-ui/` ni `RP/ui/server_form.json`** — c'est le
   render pack officiel du framework, vendu tel quel dans notre RP (aucune
   dépendance pack séparée : son UUID `761ecd37-…` ne doit JAMAIS revenir dans
   les dependencies du BP). Mise à jour = remplacer les fichiers par ceux de la
   release npm (`@bedrock-core/ui@x.y.z`).
2. **Ne JAMAIS réécrire un écran en JSON UI maison** — le routage par titre
   (`#title_text = '…'`) et le contrat d'index ont causé toutes les régressions
   historiques (duplicates, doubles rendus, replis visibles). Un écran, c'est
   du JSX dans `src/`.
3. **Toute brique visuelle réutilisée 2 fois va dans `kit.tsx`** — les écrans
   assemblent, ils ne dessinent pas. L'identité visuelle = le design system
   `@bedrock-core/ore-styled` (Header, MenuRow, Card… + tokens d'espacement) :
   ne réinvente JAMAIS un bouton/carte avec des textures à la main.
   **Max 2 `<Scroll>` par écran** (pool figé du framework) — le contenu hors
   Scroll tombe dans le scroll racine implicite.
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

### Identité visuelle

Le design vient du design system `@bedrock-core/ore-styled` (Header, MenuRow,
Card, Divider, tokens) — textures `textures/ui/ore-styled/` vendues dans le RP.
Pour les écrans, passe par le kit (`kit.tsx`) : ne pose jamais de texture à la
main dans un écran.

## 4. Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Écran vide/noir ou texte `bcuiv0008s:scrolls…` affiché brut | `server_form.json` absent de `ui/` ou absent de `_ui_defs.json` | vérifier `RP/ui/server_form.json` + ligne 1 de `_ui_defs.json` + dépendance BP → RP à jour |
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
