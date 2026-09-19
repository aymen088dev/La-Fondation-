# agent.md — Guide pour agents travaillant sur ce dépôt

> **NaLandia** — serveur Minecraft Bedrock (add-on : BP scripts + RP).
> Stack : **TypeScript → esbuild → `BP/scripts/main.js`**. UI : architecture
> **« transport invisible + JSON UI à nous »** — le script envoie des données
> via l'API native `@minecraft/server-ui` (ActionForm pour les menus,
> CustomForm pour les champs) et **l'apparence vient du RP**
> (`RP/ui/server_form.json`, généré par `scripts/build_server_form.py`).
> Textures du thème : `scripts/make_ui_textures.py`.

---

## 1. L'architecture UI en 30 secondes

```
src/ui/theme.ts    ← MOTEUR (zéro JSX, zéro framework) :
                     · openTileMenu(player, titre, builder) → ActionFormData
                       (menus à liste ; pagination auto au-delà de 8 entrées)
                     · OMForm → CustomForm natif (champs : input garanti Mojang)
                     · Observables (obString/obNumber/obBool) pour le state local
src/ui/labels.ts   ← helpers purs : pageSlice, fitLabel, wrapLabel
RP/ui/server_form.json ← L'APPARENCE. Généré par scripts/build_server_form.py :
                     vanilla officiel 1.26.50 + nos modifications ciblées
                     (fenêtres élargies, titre doré, boutons om_btn 3 états,
                     focus clavier/manette). NE PAS ÉDITER À LA MAIN :
                     `bun run ui` (ou python3 scripts/build_server_form.py).
scripts/vanilla_server_form.json ← cache du fichier vanilla de référence.
RP/ui/_ui_defs.json ← déclare ui/server_form.json en PREMIÈRE entrée.
```

- **Le script n'envoie JAMAIS de texture** : il envoie du texte (titres,
  libellés, codes §). C'est le RP qui habille. Aucun framework (@bedrock-core
  supprimé en v3.1.0), aucun render pack, aucun routage par titre côté script.
- **Un seul thème signature** (or/argent) porté par le JSON UI : pas de
  theming par menu, pas de contrat d'index — c'est ce qui a causé toutes les
  régressions historiques.
- **Réessais UserBusy intégrés** : le client refuse parfois d'ouvrir un écran
  juste après la fermeture du précédent ; le moteur réessaie (jusqu'à 4 fois,
  délai croissant). Ne contourne PAS ce mécanisme dans les call sites.

## 2. La méthode (les 6 règles immuables)

1. **Ne JAMAIS éditer `RP/ui/server_form.json` à la main** — il est généré.
   Modifier `scripts/build_server_form.py` (base vanilla + modifications
   ciblées) puis régénérer. Le script valide : définitions vanilla présentes,
   héritages résolus, textures existantes, aucun doublon.
2. **Ne JAMAIS réintroduire de framework JSX ni de routage par titre** —
   trois générations de JSON UI maison (contrat d'index, routage par titre,
   @bedrock-core) ont chacune produit la même classe de bugs. Le transport
   est natif, l'apparence est dans LE fichier généré. Point.
3. **Les formulaires à champs restent natifs** — `OMForm.textField /
   slider / dropdown / toggle` (CustomForm) : la qualité d'input est garantie
   par Mojang, ne jamais la remplacer par des boutons.
4. **Bump la version RP+BP à chaque changement de JSON/textures**
   (`RP/manifest.json` + `serveur/world_*.json` + BP pour rester synchrone) :
   Bedrock cache les packs. Le RP module reste `[1,0,0]` (recette interne).
5. **Garder l'API moteur stable** — `openTileMenu` (builder
   `menu.action/data/body`), `openWindow/openWindowRaw`, `OMForm`, les
   Observables : 12 écrans s'appuient dessus sans le connaître.
6. **Vérifier avant de pousser** : `bun tsc --noEmit` + `bun test` +
   `bun run build` (le bundle doit finir dans `BP/scripts/main.js`).

## 3. Ajouter / modifier un écran

### Cas A — menu à liste (hub, admin, joueurs…)

```ts
openTileMenu(player, "Titre", (menu) => {
  menu.body("§6Ligne d'accueil\n§7details…");           // en-tête du formulaire
  menu.action("key", "§6Label", () => openAutreMenu(player)); // bouton
});
```
Au-delà de 8 entrées, la pagination automatique prend le relais
(‹ Page précédente / Page suivante › en fin de liste).

### Cas B — fiche / formulaire (création, réglages…)

```ts
openWindowRaw(player, windowTitle("Titre"), (form) => {
  form.back(() => openMenuPrecedent(player));
  form.textField("§eLabel", obString(""));
  form.button("§aValider", () => { /* … */ });
});
```

### Identité visuelle

Portée à 100 % par `RP/ui/server_form.json` (dalles `om_btn`, titre doré).
Pour changer l'apparence : éditer le générateur, régénérer, bump RP+BP.
Le moteur ne référence jamais `om_*` (garde testé).

## 4. Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Menus à l'habillage vanilla brut | RP pas rechargé / version non bumpée | bump BP+RP+`serveur/*.json`, re-copier les packs |
| Menu ne s'ouvre pas après un autre | enchaînement trop rapide (UserBusy) | le moteur réessaie déjà ; vérifier qu'on n'ouvre pas deux écrans dans le même tick |
| JSON UI cassé (écran noir, erreur de contenu) | server_form.json édité à la main / doublon de définition | régénérer via `bun run ui` — la validation refuse les doublons et les textures absentes |
| Input texte cassé | champ recodé en boutons | revenir à `OMForm.textField` |
| `bcuiv…` affiché brut | serveur_form.json absent de `ui/` ou de `_ui_defs.json` | vérifier ligne 1 de `RP/ui/_ui_defs.json` |

## 5. Commandes

```bash
bun tsc --noEmit                    # typecheck
bun test                            # tests (gardes architecture inclus)
bun run build                       # bundle esbuild -> BP/scripts/main.js
bun run ui                          # régénère RP/ui/server_form.json (python3)
python3 scripts/make_ui_textures.py # textures du thème
```
