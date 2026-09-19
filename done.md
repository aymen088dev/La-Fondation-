# ✅ DONE.md — État d'avancement de NaLandia (ex-OpenMontage)

> Dernière mise à jour : **v3.1.1 — Habillage JSON UI finalisé : fenêtre or/argent `om_window` à la place du cadre blanc vanilla, scrollbar dorée, fiches sans glyphes ASCII.** — v3.1.0 : refonte UI « transport invisible + JSON UI à nous ».
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

---

## 🆕 v3.1.1 — Fini le cadre blanc, fiches sobres (sept. 2026)

**La demande** : « enlève le cadre blanc, designe toutes les UI, refais les fiches (bannières ASCII), nations sans glyphes ».

- [x] **Cadre blanc supprimé** : le fond clair des écrans venait de `dialog_background_hollow_3` (la texture vanilla héritée de `common_dialogs.main_panel_no_buttons`). Le générateur branche maintenant `$custom_background` sur `server_form.om_window_background` — notre fenêtre sombre à double filet or/argent (`om_window`) sur TOUTES les UI (menus ActionForm ET fiches CustomForm).
- [x] **Scrollbar dorée** : génération de `ScrollRail.png` / `ScrollHandle.png` (piste sombre + curseur or à liseré clair). Présents dans le RP, ces noms de fichier vanilla remplacent automatiquement les textures gris froid de Mojang dans tous nos formulaires.
- [x] **Fiches sans glyphes** : les bannières `=====` des fiches Classe et Clan sont remplacées par un en-tête sobre (nom en couleur, gras). Le séparateur `·` est remplacé par `—` ou `,` partout (nations, DB, joueurs, règles de nom).
- [x] Nations : libellés de tuiles élargis (30 caractères) avec format lisible « Nom — Chef (N chunks) ».

### ✔️ Vérifié
Typecheck OK · **74/74 tests** · bundle recompilé · packs **3.1.1** (BP, RP, `serveur/*.json`).

---

## 🆕 v3.1.0 — Transport invisible + JSON UI à nous (sept. 2026)

**La décision** : « Utiliser JSON UI + Script API sans utiliser server-ui » s'est révélée techniquement impossible (aucun pont JSON UI → script n'existe : pas de script_event sur boutons, pas de bindings alimentables par un BP, et les écrans natifs interactifs non-formulaires n'ont aucune API d'ouverture). Architecture retenue à la place — celle des packs de production : **le transport natif `@minecraft/server-ui` porte les données et les clics (jamais visible), le RP habille 100 % de l'apparence** via `server_form.json`.

- [x] **Générateur `scripts/build_server_form.py`** (méthode vanilla-first) : la base est le `server_form.json` officiel de Mojang 1.26.50 (caché dans `scripts/vanilla_server_form.json`), on n'applique QUE des modifications ciblées — fenêtres élargies (430×252), titre doré, boutons vanilla re-texturés avec nos dalles `om_btn` (3 états), contrôle `om_focus_button` (navigation clavier/manette), submit des formulaires sur le même habillage. Validation stricte (exit 1) : définitions vanilla présentes, héritages internes résolus, textures existantes, zéro doublon. **Bug corrigé au passage** : le `namespace: server_form` était retiré du fichier généré (JSON UI invalide) — désormais réécrit en première clé.
- [x] **Moteur `src/ui/theme.ts` réécrit sans framework** (plus de JSX/kit/render) : `openTileMenu` → `ActionFormData` avec pagination automatique au-delà de 8 entrées ; `OMForm` → `CustomForm` natif inchangé ; réessais UserBusy (4 tentatives) des deux côtés ; API publique 100 % conservée — les 12 écrans du serveur n'ont pas changé une ligne.
- [x] **Supprimé** : `@bedrock-core/ui` (dépendance), `src/ui/kit.tsx`, `src/ui/theme.tsx`, `RP/ui/core-ui/` (26 fichiers), les 190 textures ore-styled/config du framework, `jsx`/`jsxImportSource` de tsconfig et build.mjs.
- [x] **`_ui_defs.json` réécrit** : une seule entrée, `ui/server_form.json` en tête.
- [x] **Tests réécrits comme gardes d'architecture** (14) : zéro framework dans le code, transport natif utilisé, définitions vanilla présentes dans le JSON généré, textures `om_btn` vendues, aucune trace CoreUI, câblage BP → RP correct, versions BP/RP synchrones.
- [x] `agent.md` réécrit pour la nouvelle architecture.

### ✔️ Vérifié
Typecheck OK · **74/74 tests** · bundle recompilé · packs **3.1.0** (BP, RP, `serveur/*.json`).

**En jeu** : re-copier `BP/`, `RP/` + les 2 JSON de `serveur/` — l'habillage or/argent est désormais porté par le JSON UI généré (menus et fiches uniformes, inputs natifs garantis).

---

## 🆕 v3.0.4 — Réponses des commandes `/sn:*` retraitées (sept. 2026)

**La demande** : « Regarde sur les réponses des commandes, retraite tout ça. » Audit complet des trois fichiers de commandes (`src/territories/commands.ts`, `src/permissions/commands.ts`, `src/moderation/commands.ts`) et uniformisation.

- [x] **BUG `/sn:invite` corrigé** : la variable `sent` était positionnée DANS `system.run` (tick suivant) mais lue AVANT son exécution — le statut renvoyé au jeu était toujours `Success` même quand l'invitation échouait. Le message au joueur (qui détaille l'erreur) fait désormais foi.
- [x] **Préfixes et couleurs homogènes** : chaque réponse au joueur porte son préfixe de module (`[Clans]`, `[Mines]`, `[DB]`, `[Modération]`…) avec une couleur cohérente (§a succès, §c erreur, §e info). Fini les réponses brutes sans préfixe (« Réservé aux joueurs. », « Le module États est désactivé. ») mélangées aux réponses préfixées.
- [x] **Erreurs = statut Failure** : tous les refus de garde (non-joueur, module désactivé, module indisponible) renvoient maintenant un Failure avec message — Bedrock les affiche en rouge, comme les vraies erreurs de commande.
- [x] **`/sn:info` et `/sn:setflag` vérifient désormais le module « États »** (comme les autres commandes de clan) au lieu d'agir module désactivé.
- [x] **`/sn:db menu` réservé aux joueurs** : la source est vérifiée avant d'ouvrir le menu (l'ancien code castait la source en Player sans vérifier — crash potentiel si la commande partait de la console).
- [x] **Mutations de DB différées** : `/sn:setflag` écrivait dans la DB directement dans le callback de commande (contexte où l'accès aux dynamic properties est restreint) ; toutes les mutations (`setflag`, invite, leave, promote/demote, ckick, claim/unclaim) lèvent `db.markDirty()` dans le `system.run` — plus aucune perte de persistance possible.
- [x] **Usage de `/sn:db` colorisé** : messages d'aide (`Usage :`, liste des actions) préfixés `[DB]` et mis en forme.
- [x] Modération : déjà propre (préfixes `[Modération]` systématiques) — seulement les gardes factorisées conservées.

### ✔️ Vérifié
Typecheck OK · **70/70 tests** · bundle recompilé (465 ko) · packs **3.0.4** (BP, RP, `serveur/*.json`).

---

## 🆕 v3.0.0 — Un vrai framework UI : `@bedrock-core/ui` (sept. 2026)

**Décision** : après trois générations de JSON UI maison (routing par titre, contrat d'index, pipeline de génération), chaque itération révélait une nouvelle classe de bugs (duplicates vanilla, doubles rendus, propriétés invalides). **Tout le moteur maison est supprimé** au profit du framework communautaire `@bedrock-core/ui` v0.11 :

- **Menus en JSX** (syntaxe React) : layout libre **flexbox**, **scroll natif** des listes longues (plus de pagination forcée), boutons 3 états aux textures or du serveur, hooks (`useState`, `usePlayer`, `useExit`) — le rendu est décodé côté client par le **render pack CoreUI** vendu dans `RP/ui/core-ui/` et déclaré comme dépendance dans `BP/manifest.json`.
- **Kit visuel** (`src/ui/kit.tsx`) : Window (cuir/or `om_window`), TitleBar (bandeau), TileButton (3 états `om_card`), SidebarLayout (colonne nav scrollable + plaque de contenu), Sheet, ScrollList — l'identité NaLandia concentrée en un seul fichier.
- **Moteur** (`src/ui/theme.tsx`) : `openTileMenu` garde son API builder (`menu.action/data/body`) — les 12 écrans existants n'ont pas changé une ligne ; `OMForm` reste **natif** (CustomForm : input texte/slider/dropdown garantis).
- **Supprimé** : `scripts/build_ui.py` (pipeline), le contrat `@ui-contract` de `tiles.ts`, le `server_form.json` généré, `vanilla_cache/`, `sheets.ts` déjà parti. Les helpers purs survivent dans `src/ui/labels.ts` (compat `tiles.ts` = réexport).
- **Compat** : si le render pack manque, le framework affiche son habillage « unstyled » — tout reste lisible et cliquable (dégradation gracieuse, comme avant).

### Vérifié
Typecheck OK · **69/69 tests** (dont render pack vendu complet, dépendance BP, textures du kit) · bundle recompilé (462 ko, JSX inclus) · packs **3.0.0** · `agent.md` réécrit pour le framework.

**En jeu** : copier `BP/`, `RP/` + les 2 JSON de `serveur/` (le render pack est DANS le RP désormais — plus de .mcpack séparé à installer).

---

## 🆕 v2.8.1 — Double rendu et boutons morts : les deux dernières causes, réparées (sept. 2026)

**Symptômes (capture joueur)** : `[UI][error] Unknown property [button_up]` sur `om_list_tile/om_lt_click` · cartes « Guerrier » éparpillées (labels sans bouton) · dialogue gris vanilla qui se dessine sous nos panneaux.

### Cause 1 — `button_up` n'existe pas
Un `button_mappings` ne connaît que `from_button_id`, `to_button_id`, `mapping_type` (+ `ignore`). `button_up: true` était inventé → le contrôle `om_lt_click` ENTIER était rejeté (erreur au log) : plus de zone cliquable, seuls les labels restaient. Corrigé : mapping canonique vanilla (`menu_select`/pressed + `menu_ok`/focused → `button.form_button_click`), copié de `common.button` (ui_common.json officiel).

### Cause 2 — le repli vanilla ne se masquait pas (double rendu)
Deux sous-causes, toutes deux réparées :
1. **Muter le vanilla en place = fusion** : en JSON UI, les contrôles d'un enfant s'additionnent à ceux du parent. Ajouter nos panneaux dans `long_form@...` laissait son contenu original (dialogue gris) actif. Désormais `long_form` est un **wrappeur** `panel` neuf à deux branches EXCLUSIVES : nos écrans (visibles si le titre matche) + la copie vanilla intacte (visible si AUCUN titre ne matche) — pattern exact des packs de production.
2. **Collecte manquante** : une condition `view` sur `#title_text` doit être précédée de `{binding_name: "#title_text"}` (collecte) sans quoi la propriété n'est pas résolue dans la portée. Ajouté sur TOUTES les branches (nos écrans + repli).

### Vérifié
Typecheck OK · 81/81 tests (test de routage renforcé : wrappeur sans variable vanilla, repli masqué, collecte présente) · JSON régénéré (51 définitions) · packs **2.8.1**.

---

## 🆕 v2.8.0 — Reconstruire l'UI sur des bases saines : pipeline + contrat + doc (sept. 2026)

**Contexte** : après la récupération de la v2.7.0, le JSON UI était à nouveau en cause (formulaires vides, repli vanilla qui se dessinait sous les panneaux OM). Décision : **repartir de zéro** avec la méthode éprouvée des générateurs communautaires (EasyUIBuilder) — vanilla d'abord, modifications ciblées, validation stricte.

### Le pipeline (`scripts/build_ui.py`)
- **Fetch vanilla officiel** (Mojang/bedrock-samples) mis en cache dans `scripts/vanilla_cache/` — la base est TOUJOURS le vrai fichier Mojang, jamais un habillage partiel.
- **4 points de contact** et rien d'autre : `$custom_background` de `custom_form` (en place, pas de duplicate), textures des 3 états de `dynamic_button`, widgets `om_*` ajoutés, routing de `long_form` (vanilla muté en place).
- **Repli vanilla** (`om_default_form`) : copie profonde intacte, visible UNIQUEMENT si aucun titre OM ne matche — binding généré `(!(#title_text = 'X')) && ...`. Fini le formulaire vanilla qui se dessinait SOUS nos panneaux (artefacts « en bas des menus »).
- **Validation stricte** (exit 1) : duplicate `X`/`X@parent` (LE bug historique, désormais impossible), référence `server_form.X` non résolue, texture `om_*` absente.
- **Écriture conditionnelle** : le fichier n'est réécrit que s'il change.

### Le contrat unique (`src/ui/tiles.ts`)
- Bloc `@ui-contract-begin/end` : du JSON pur, extrait DIRECTEMENT par le pipeline — **aucune table dupliquée** entre TS et Python.
- `indexed` (menus dessinés : Classes, Mon clan, Menu, Administration, Nations, Mes infos, Le Monde) et `generic` (14 listes à factory).
- Titre préfixe `NaLandia » `, helpers `pageSlice`/`fitLabel`/`wrapLabel` conservés.

### Le moteur (`src/ui/theme.ts`)
- Réécrit : un seul flux `openTileMenu` (l'ordre des boutons = contrat, mapping clé→index automatique) + `OMForm` (CustomForm habillé) ; la couche `sheets.ts` (3 familles de design, specs de textures) est SUPPRIMÉE — l'habillage est dans le JSON généré.
- Retry `UserBusy` conservé (menus qui « ne s'ouvraient jamais »).

### Drapeau du clan
- Le rendu des 11 drapeaux (textures `om_flag_*`, visibles par token `FLAG:<couleur>` sur le bouton data `flag_id`) est généré par le pipeline (`clan_panel_decoration`), index dérivé du contrat.

### Documentation
- **`agent.md`** : architecture, méthode, règles immuables, comment ajouter un menu, dépannage — pour tout agent (ou humain) qui reprend le projet.

### ✔️ Vérifié
Typecheck OK · **81/81 tests** (dont validation du JSON généré : duplicates interdits, vanilla présent, repli masqué, contrat↔JSON en accord) · bundle recompilé · packs **2.8.0** (BP, RP, `serveur/*.json`, README)

---

## 🆕 v2.7.1 — Grande analyse post-récupération : la vraie cause de tout, réparée (sept. 2026)

**La demande** : « rien n'est à jour ou presque », « le tactile et manette ne marchent pas à l'endroit où il faut », « y a des trucs chelou en bas dans certains menus », « les boutons sont trop petits pour le texte », « certains menus n'ont pas leur UI et ça c'est grave », « le système de classe est tout cassé », « ajoute l'UI quêtes / mon clan / les UIs intermédiaires / progression de classe », « répare la DB », « fais une grosse analyse ».

**Le diagnostic (l'analyse complète)** : en voulant reskinner le serveur, `RP/ui/server_form.json` avait **écrasé TOUT le fichier vanilla** — or le jeu y pioche **24 définitions de base** que nos formulaires appellent : `custom_form_panel` (le panneau scrollable des formulaires à champs), `generated_contents` (la fabrique qui rend chaque composant), les widgets `custom_toggle`/`custom_slider`/`custom_dropdown`/`custom_input`, `dynamic_button`, et l'écran racine `third_party_server_screen`. Sans elles :
- les formulaires à champs (créer un clan, sanctions, réglages, fiches…) s'ouvraient **avec un contenu manquant** → « des trucs chelou en bas », écrans « intermédiaires » sans UI ;
- la fabrique vanilla ne connaît pas les types `button`/`image` de l'API bêta → **les boutons des formulaires ne se rendaient pas** ;
- les fiches de classe et de progression (écrans CustomForm) héritaient du même rendu cassé → « le système de classe est tout cassé » (le moteur de classe, lui, n'avait aucun bug).

- [x] **Fusion vanilla + habillage** : `server_form.json` reconstruit = **24 définitions vanilla officielles (1.26.50, miroir Mojang) réinjectées** + nos 19 définitions `om_*` et nos overrides `long_form`/`custom_form` par-dessus. Résultat : **44 définitions**, chaque référence résout. Le contenu des formulaires revient, l'habillage or & argent reste.
- [x] **Boutons des formulaires à champs rendus** : la fabrique `generated_contents` ne connaît que label/toggle/slider/dropdown/input/header/divider — les boutons `CustomForm` (choisir une voie, fonder, valider…) n'apparaissaient pas. Mappés vers le gabarit vanilla `dynamic_button` (texte + zone icône + barres de chargement), sur la collection `form_buttons` comme le fait Mojang pour ActionForm.
- [x] **Boutons trop petits pour le texte** : les tuiles des listes à thème ont une largeur fixe — les libellés longs (« Aym3n9585 — 12 sess. · vu à 18:42 ») débordaient. Double fix : colonnes élargies 150→180 px (fenêtres 300→330) **et** troncature automatique (`fitLabel`, 32 caractères visibles) appliquée **dans le moteur** à toute liste générique — plus aucun menu ne peut déborder, même ceux à venir.
- [x] **DB réparée pour de vrai** : l'application ne lisait que les interrupteurs (les textes étaient jugés « non relisibles » — fausse note : les Observables bêta sont des références vivantes). Textes, nombres (avec virgule acceptée) et booléens s'appliquent désormais réellement, changements détectés champ par champ.
- [x] **Slider réparé** : le moteur forçait un pas de 1 — les curseurs à pas fin (durée de sanction par 15 min, niveau de rôle par 5) restaient bloqués.
- [x] **Tactile/manette** : nos tuiles utilisent les mappings standards `button.menu_select`/`button.menu_ok` (identiques aux formulaires Mojang) — c'est le **contenu manquant** des formulaires (ci-dessus) qui faisait croire à un problème d'input ; la fusion le corrige.
- [x] **UI quêtes / mon clan / fiches intermédiaires / progression de classe** : tous servis par la même réparation — ils passaient par `custom_form_panel`/`generated_contents`, absents du pack. Aucun menu n'est plus « sans son UI ».

## 🆕 v2.7.0 — Nations réparé, plus aucun cadre gris, tuiles partout où c'était demandé (sept. 2026)

**La demande** : « le menu nation ne s'ouvre pas / ultra buggé, pas le design demandé », « on ne peut pas scroller », « les options ne sont pas à gauche comme je veux », « dans Classe mets le titre plus haut (tout en haut des cartes), le nom des classes en haut des cartes, le texte sans dépasser la limite », « enlève ce cadre blanc chelou », « tous les autres menus avec leur propre design ».

- [x] **CAUSE RACINE du menu Nations (« États ») trouvée — et elle est générale** : le JSON UI ne connaît un menu que par son **titre**, comparé **littéralement** (`(#title_text = 'NaLandia » Nations')`). Or la section s'appelait « États », **avec un accent** : le titre réel ne matchait ni le panneau Nations ni l'exclusion du panneau de secours → le menu **retombait entièrement sur le rendu vanilla** (cadre gris Mojang + liste de boutons centrée). D'où, en jeu, à la fois « pas de design », « options pas à gauche » et « cadre blanc chelou ». La section s'appelle désormais **`Nations`** (ASCII, et c'est le mot déjà employé par le serveur) et **un test interdit tout accent dans un titre à tuiles** : ce bug ne peut plus revenir silencieusement.
- [x] **Plus AUCUN cadre gris Mojang nulle part** : `custom_form` (les formulaires à champs : créations, sanctions, réglages…) est réécrit dans `RP/ui/server_form.json` et hérite d'un fond `om_dialog_bg` (notre fenêtre or & argent) au lieu du `dialog_background_hollow_3` gris clair de Mojang, avec titre **or**. Le formulaire de secours (`om_default_form`, utilisé si un titre n'est pas reconnu — y compris par un autre add-on) reçoit le **même habillage** : un routage raté reste dans notre thème au lieu d'afficher un panneau blanc. Garde-fou de test : le fond vanilla `common.dialog_background_opaque` ne doit plus apparaître dans le fichier.
- [x] **Menus convertis en tuiles supplémentaires** (chacun avec son panneau) : **Nations** (liste paginée des États, 3 par page, pagination précédent/suivant, fondation contextuelle), **Mes infos** (fiche du joueur à droite, actions à gauche), **Le Monde** (destinations + repères à gauche : monde normal, mine, strates, position, aide). Le contrat d'index vit dans `src/ui/tiles.ts`, partagé avec le JSON UI.
- [x] **« Le Monde » était déclaré mais jamais ouvert** : le panneau existait dans le JSON et le contrat était juste, mais `openWorldMenu` ouvrait encore un formulaire natif. Détecté par un **nouveau test** qui vérifie que **chaque section à tuiles est réellement ouverte par un script** (`openTileMenu(..., "Section")`) — ce genre d'écart entre le RP et le script ne peut plus passer.
- [x] **Options réellement « à gauche »** : la colonne de tuiles garde son ancrage à gauche et les libellés sont désormais **alignés à gauche** (variable `$align` du contrôle `om_action_bar`, surchargeable menu par menu) au lieu d'être centrés dans la colonne.
- [x] **Plus aucun chevauchement** : les listes défilantes des panneaux Nations / Mes infos / Le Monde passaient sous la barre du bas (6 lignes de 25 px + la barre à 192 px sur une fenêtre de 216 px). Lignes ramenées à **24 px** : les 6 tuiles + la barre tiennent désormais dans le cadre.
- [x] **Menu Classes remis au propre** (demande explicite) : le **nom de la voie est en haut de la carte** (au lieu d'être au milieu), chaque carte fait **92 × 108** avec sa description **dans** la carte, sous le nom ; les textes sont **bornés à la source** (`wrapLabel` : 2 lignes de 22 caractères, `fitLabel` : coupe propre avec « … ») donc plus rien ne dépasse de la boîte — la description passe de 92 × 66 / police 0,8 à **92 × 50 / police 0,72**, la plaque de texte et la barre de retour ont été repositionnées en conséquence.
- [x] **Toutes les tuiles sont bornées** : les libellés des Nations (nom + chef + chunks) sont coupés à la source à 26 caractères visibles — un nom de clan long ne déborde plus de sa tuile.
- [x] **Ouverture fiabilisée** (le « le menu ne s'ouvre jamais ») : `OMForm` réessaie d'ouvrir un formulaire à champs quand le client répond **UserBusy** (le client termine de fermer le menu à tuiles juste avant) — 5 tentatives espacées au lieu d'un abandon silencieux.
- [x] **Tests** : **76/76** — 3 gardes ajoutées (titres ASCII, chaque section réellement ouverte par un script, habillage des formulaires à champs) et les contrôles existants (index de collection, textures, drapeaux, ni curseur ni contrôle tactile maison) continuent de passer.
- [x] Packs **2.7.0** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock. Typecheck + tests OK.
- [ ] **Reste à faire** (prochaine étape) : passer les derniers sous-menus à tuiles — Membres, fiche de membre, Drapeau, Bio, Inviter, Dissoudre, Modération, Rôles, Joueurs, Modules, DB, Classes (fiches), Métiers, Quêtes. Ils ont déjà l'habillage or & argent (plus de cadre gris), mais gardent la liste de boutons native.

---

## 🆕 v20.1 — Verdict du framework maîtrisé : clics qui durent (sept. 2026)

**La demande** : « parfois les boutons se cliquent mais le menu se réalise rien ne se passe et le menu revient » + croix de fermeture + slider à gauche + glyphes.

- [x] **CAUSE RACINE du « le menu revient » enfin trouvée dans le runtime `@bedrock-core/ui`** : après un clic, `runInteractiveCallback` décide — `cleanup` (démontage) **seulement si une fibre appelle `exit()`** (`useExit` → `fiber.shouldRender = false`), sinon il **RE-PRÉSENTE le formulaire**. Nos callbacks ne faisaient que résoudre la promesse → le menu clignotait puis revenait (surtout visible après une téléportation / un message). **Fix moteur** : action de bouton, croix de fermeture, flèche retour, submit et cancel du modal appellent désormais `exit()` DANS la transaction interactive du clic — l'écran se démonte vraiment.
- [x] **Double curseur expérimental retiré** (`gamepad_cursor_under` layer -20 dans `server_form.json`) : deux boutons curseur plein écran superposés = course entre eux pour les clics — remis au pattern vanilla à UN seul curseur.
- [x] **`always_handle_pointer: true` sur le socle des boutons** (`core-ui/components/button.json`) : les clics pointeur sont résolus contre l'élément SURVOLÉ, plus contre le focus moteur (fini « je clique une tuile, c'est sa voisine qui réagit / rien ne se passe »).
- [x] **CROIX DE FERMETURE (X) en haut à droite du bandeau** : bouton 22×22 aux textures Ore UI `close/background{,_hover,_pressed}` existantes — clique = `exit()`, l'écran se ferme net.
- [x] **BARRE DE DÉFILEMENT remise à GAUCHE** (`core-ui/screens/scroll.json` : ancrage `right_middle` → `left_middle`) — la piste et le curseur suivent.
- [x] **Glyphes chelous nettoyés** : `⬥` retiré des boutons du Monde (le sanitiseur moteur filtre en plus ■ ≡ ⬥ ✦ à la source), chevrons `›` codés en dur remplacés par un marqueur graphique doré (barre 3×55 %) dans les tuiles cartes/parchemin — plus aucun caractère exotique affiché.
- [x] Enchaînement sous-menus : le clic lance l'action ET démonte l'écran ; la navigation retour rouvre proprement (fini le clignotement de re-présentation).
- [x] Typecheck ✅ · **76/76 tests** ✅ · build ✅ (le bundle embarque `useExit`). Packs **2.1.0** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock.

---

## 🆕 v20 — Menus repartis de zéro sur `@bedrock-core/ui` (sept. 2026)

**La demande** : « repartir de zéro sur TOUS les menus », avec le repo `bedrock-core/ui` comme référence, parce que les menus continuaient de se ressembler malgré les tentatives précédentes.

- [x] **Cause racine enfin traitée à la source** : Bedrock n'expose **qu'un seul écran** (`long_form`) pour TOUS les menus à boutons. Les versions précédentes tentaient de deviner la famille du menu en comparant son **titre** dans le JSON UI puis de la router vers deux mises en page — d'où l'impression tenace que « rien ne change », et une limite dure à deux silhouettes très proches. Avec `@bedrock-core/ui`, **l'arbre JSX du script est sérialisé dans la chaîne du formulaire** et un **render pack** le décode : la mise en page appartient enfin au script.
- [x] **Nouveau moteur `src/ui/theme.tsx`** : l'API publique (`OMForm` + `openWindow`/`openWindowRaw` + observables) est **conservée à l'identique**, donc les 15 menus du projet n'ont pas eu à être réécrits — seul le moteur change de backend (vanilla `ActionFormData`/`ModalFormData` bruts → arbre JSX). Le `<Form>` natif remplace le `ModalFormData` pour les menus à champs (champs texte, sliders, dropdowns, toggles).
- [x] **TROIS familles visuelles réellement distinctes** (plus une quatrième pour les formulaires), choisies par notre code via `designForSection` (`src/ui/sheets.ts`) :
  - **`console`** (hub, admin, DB, modération, rôles, joueurs, modules) — barre de titre or + **tuiles fines** (22 px), fond cuir orné ;
  - **`cards`** (Classes, Métiers, Le Monde, Mines, États) — **grand bandeau doré** + **grandes cartes** (36 px, texte 1,3×, titre 1,6×), fond **vert émeraude** ;
  - **`parchment`** (Clan, Mon clan, Membres, Membre, Inviter, Drapeau, Créer/Dissoudre un clan, Mes infos) — bandeau doré + panneau de texte, fond **bleu nuit**, **tuiles Ore UI propres** ;
  - **`fields`** — formulaires à champs, panneau bleu nuit + champs natifs.
- [x] **Flèche retour = vraie pastille-flèche blanche en haut à gauche du bandeau** (22 px, état survol) — plus jamais un bouton de la liste. Dans un formulaire à champs, le retour devient un bouton « ← Retour » du formulaire : **un arbre modal refuse les boutons classiques**, et le build lève sinon « a modal tree may contain only Form.* controls ».
- [x] **Render pack fusionné dans notre Resource Pack** (`RP/ui/core-ui/**`, `textures/ui/{pointer,unstyled,ore-styled,bedrock_core}`) : **un seul pack à activer**, comme avant. L'ancien JSON UI maison (`om_base`, `om_sheets`, `om_forms`, `server_form`) est **supprimé** — deux définitions concurrentes du même écran casseraient tout.
- [x] **`_ui_defs.json` réécrit** : il déclare le décodeur (`ui/server_form.json` + `core-ui/**`) **et** notre `hud_screen.json` (actionbar/titres conservée).
- [x] **Toolchain** : `tsconfig.json` passe en `"jsx": "react-jsx"` + `jsxImportSource: "@bedrock-core/ui"` et inclut `src/**/*.tsx` ; esbuild compile le JSX sans configuration supplémentaire.
- [x] **Nineslice déclaré** pour nos cadres/cartes (`RP/textures/ui/om_*.json`) : sans ce fichier jumeau, une bordure or est **étirée** au lieu d'être une bordure — les valeurs reprennent celles de l'ancien JSON UI (10 px boutons/cartes, 8 px panneaux, 12 px fonds, 8/6 px bandeau).
- [x] **Tests réécrits (76/76)** : `src/ui/theme.test.ts` ne teste plus une chaîne de titres JSON UI mais le **nouveau contrat** — render pack présent et déclaré au bon emplacement (protocole `bcuiv0008`), `_ui_defs.json` == fichiers sur disque, **plus aucun fichier UI maison concurrent**, toolchain JSX configurée, dépendance déclarée, **familles disjointes et habillages réellement différents** (fonds, tuiles et métriques distincts), **chaque texture citée existe**, et les **nineslice sont cohérents**. Le test a d'ailleurs attrapé une vraie erreur pendant le chantier (deux familles partageaient la même tuile).
- [x] Packs **2.0.0** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock. Build + typecheck OK.

> ⚠️ **Non vérifiable hors du jeu** : l'affichage réel (ressenti des trois silhouettes, tailles, débordements) doit être constaté en jeu. Si tout s'affiche **sans habillage**, le Resource Pack n'est pas activé (ou reste en cache).

---

## 🆕 v19.5 — Deux mises en page radicalement différentes (sept. 2026)
- [x] **Demande « changement total par rapport à /sn:menu et admin » traitée pour de bon** : les menus de contenu ne partagent plus NI la géométrie NI les tuiles des menus hub/admin. Deux mises en page complètes, choisies par le titre du formulaire (seul canal lisible : Bedrock partage un unique écran pour tous les menus à boutons) :
  - **`console_layout`** (hub, admin, modération, rôles, joueurs, DB, modules + sous-menus) : inchangé — **colonne de tuiles fines (32 px) à gauche** + grand panneau de texte à droite, panneaux argentés, fond cuir à cadre or ;
  - **`sheet_layout`** (Classes, fiche de voie, Ma voie, Confirmer, États, fiche de clan, Mon clan, Membres, fiche de membre, Inviter, Drapeau, Dissoudre/Créer un clan, Le Monde, Mines, Métiers, Mes infos) : silhouette **inversée** — **BANDEAU DE TEXTE EN HAUT** (panneau doré pleine largeur) puis **GRANDES CARTES EMPILÉES EN BAS** (42 px, cadre or + **barre d'accent dorée** sur le bord gauche, texte plus grand), fond **vert émeraude à double filet or/argent**.
- [x] **Trois textures de cartes dédiées** (`om_card` / `om_card_hover` / `om_card_press`) : dalles vert charbon à cadre or, marge de 2 px entre les cartes, barre d'accent de 4 px, **surbrillance dorée marquée au survol** — rien à voir avec les tuiles fines. Contrôle d'entrée dédié : `om_card_button` (héritage de `om_text_button`, mêmes 3 états).
- [x] **Contrôle d'entrée séparé par famille** : `dynamic_button` (tuile fine, colonne latérale) et `dynamic_card` (grande carte, liste verticale). Le bouton retour suit la famille : pastille-flèche 26 px dans la colonne, 30 px dans le bandeau de cartes — discriminant par **ICÔNE** dans les deux cas (le libellé `#form_button_text` n'est jamais renommé).
- [x] **Répartition pensée pour 3 cartes visibles** : bandeau de texte 38 % (défilable) + bandeau de cartes 62 % (défilable) — les catalogues de 3 voies tiennent à l'écran.
- [x] **Tests** : **71/71** — la chaîne de titres est vérifiée dans ses **3 copies** (fond + les deux mises en page), les deux mises en page et leurs contrôles d'entrée sont assertés, les textures de cartes aussi, plus la garde anti-régression sur le binding du libellé.
- [x] Packs **1.9.5** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock. Build + typecheck OK.

---

## 🆕 v19.4 — Fix menus cassés (libellés vides) + flèche par icône (sept. 2026)
- [x] **BUG CRITIQUE v19.3 (tuiles de boutons vides dans TOUS les menus) — cause racine trouvée dans la source vanilla** : j'avais renommé le binding du libellé (`binding_name_override: "#om_label"` sur `#form_button_text`) pour détecter le bouton retour. Or **un `binding_name_override` CONSOMME le nom du binding** : `$button_text: "#form_button_text"` ne résolvait plus rien → libellés vides partout, et l'effet secondaire faisait basculer les mauvaises entrées en flèche. **Le vanilla ne renomme JAMAIS ce binding** (vérifié dans `ui/server_form.json` officiel).
- [x] **Discriminant du bouton retour = l'ICÔNE**, structure vanilla exacte : `dynamic_button` expose maintenant deux emplacements par entrée — `back_slot` (visible si `#form_button_texture` est renseigné, garde officielle `(not ((#texture = '') or (#texture = 'loading')))`) et `button_slot` (son complément exact). Le bouton retour étant le SEUL à recevoir une icône (`om_btn_back`), il est le seul rendu en **pastille-flèche sans tuile** ; tous les autres restent des tuiles pleine largeur avec leur texte. Les bindings d'icône vivent sur des **panneaux enveloppes** (comme le `panel_name` vanilla), donc hors du scope des boutons : aucun risque pour le libellé.
- [x] **Garde-fou de test ajouté** : le test refuse désormais tout `binding_name_override` sur `#form_button_text` dans `server_form.json` (analyse récursive des bindings, pas une simple recherche de texte) et exige exactement deux bindings d'icône (`#form_button_texture` → `#texture`). → ce bug précis ne peut plus revenir.
- [x] **`om_button_icon` supprimé** : devenu inutile (et risqué) maintenant que la pastille retour est un emplacement à part.
- [x] **Confirmé visuellement en jeu** : la variante « FICHES » s'applique bien (cadre **émeraude** à double filet or/argent + panneaux à liseré doré) sur `/sn:monde`, donc le routage par titre fonctionne ; les menus hub/admin gardent leur cuir à cadre or.
- [x] Packs **1.9.4** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock. Build + typecheck + **70/70 tests**.

---

## 🆕 v19.3 — Familles de menus, flèche-icône, cadre élargi (sept. 2026)
- [x] **CAUSE RACINE du « les menus n'ont pas changé » (enfin) traitée** : Bedrock n'expose **qu'un seul écran** pour TOUS les menus à boutons (`long_form`) — le JSON UI ne peut donc pas savoir quel menu est ouvert… sauf par son **TITRE**, seul canal que le script contrôle et que le JSON UI peut comparer. Nouveau fichier `ui/om_sheets.json` (namespace `om_sheets`) : deux sélecteurs (fond du grand cadre + panneau déroulant) qui basculent sur la variante **VERT ÉMERAUDE À DOUBLE FILET OR/ARGENT** quand le titre est reconnu. Les menus **hub/admin/modération/rôles/joueurs/DB/modules** gardent leur cuir sombre à cadre or.
- [x] **Menus « fiches » désormais visuellement distincts** (Classes, fiche de voie, Ma voie, Confirmer, États, fiche de clan, Mon clan, Membres du clan, fiche de membre, Inviter, Drapeau, Dissoudre/Créer un clan, Le Monde, Mines, Métiers, Mes infos) : nouveau fond `om_sheet_bg.png` (corps émeraude, bande OR large + joint sombre + filet ARGENT) et nouveau panneau `om_sheet_pane.png` (liseré **doré** au lieu d'argenté).
- [x] **Titres FIXES pour les fiches à nom variable** (`Classe`, `Ma voie`, `Clan`, `Membre`) : le nom (voie, État, pseudo) était dans le titre, ce qui rendait le menu impossible à reconnaître — il est déjà en grand dans la bannière de la fiche.
- [x] **Garde-fou anti-régression** : `SHEET_SECTIONS` (module pur `src/ui/sheets.ts`, ré-exporté par `theme.ts`) est la **source de vérité** du contrat, et le nouveau test `src/ui/theme.test.ts` vérifie **12 points** : JSON UI tous valides, déclarés dans `_ui_defs.json`, héritages `@ns.controle` et variables de contrôle sans référence cassée, textures `om_*` présentes, **synchro exacte de la liste des titres** (les deux sélecteurs), marqueur du bouton retour. → impossible de re-livrer le bug « tous les menus identiques » sans casser les tests.
- [x] **FLÈCHE RETOUR = VRAIE ICÔNE en haut à gauche** (plus jamais un bouton de liste) : le moteur envoie un label **marqueur invisible** (`§r`) + l'icône `om_btn_back` ; `server_form.dynamic_button` reconnaît le marqueur, **désactive la tuile large** et n'affiche qu'une **pastille 26×26 à liseré doré avec flèche blanche**, allumée au survol (2 textures `om_btn_back` / `om_btn_back_hover` générées). Filet de sécurité : l'icône native du formulaire est aussi transmise, donc la flèche reste visible même si le marqueur n'était pas reconnu.
- [x] **CADRE ÉLARGI + textes décollés du filet argent** (demande « agrandis le cadre, le texte touche le cadre argent ») : `long_form` 340×200 → **420×240**, sidebar 114 → 128 px, fenêtres de contenu rentrées de **8 px sur les côtés / 7 px en haut-bas** (et 6 px de marge autour des panneaux), formulaires 260×210 → **300×240** avec les mêmes marges. Plus aucun texte ne touche le cadre.
- [x] **Nettoyage** : double flèche supprimée dans la confirmation de classe (une seule icône de retour + le bouton de choix), icônes `om_n_*` jamais branchées **supprimées** du script de textures et du RP, manifeste RP mis à jour.
- [x] **Filet de sécurité de la flèche** : `om_button_icon` (socle) réaffiche la flèche dans la tuile si le marqueur n'était pas reconnu — et **uniquement** pour le chemin de texture exact du moteur, donc jamais de texture manquante affichée sur les autres boutons.
- [x] **Documentation** : `README.md` réécrit (modules réels, packs BP+RP, deux familles d'UI, commandes, tests, installation avec le bump de version obligatoire) et `done.md` mis à jour.
- [x] Packs **1.9.3** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock. Build + typecheck + **69/69 tests**.

---

## 🆕 v19.2 — JSON UI splitté + génération de la mine réparée (sept. 2026)
- [x] **JSON UI en PLUSIEURS FICHIERS** (demande « un fichier par menu » — Bedrock n'expose pas un écran par menu mais un par TYPE de formulaire ; le split est donc fait par type, avec un fond différent par fichier) :
  - `ui/om_base.json` — socle partagé (boutons 3 états, panneaux, fonds) ;
  - `ui/server_form.json` — **menus à boutons** (hub, admin, États…) : grand cadre **cuir sombre à cadre OR** ;
  - `ui/om_forms.json` — **formulaires à champs** (/sn:create, sanctions, rôles…) : grand cadre **bleu nuit à filet argent + or** (variante « cartes ») — différence immédiatement visible ;
  - les trois sont déclarés dans `_ui_defs.json`, les contrôles héritent du socle (namespace `om_base`), texture nouvelle `om_cards_bg.png`.
- [x] **CAUSE RACINE de la mauvaise génération de la mine trouvée** : la génération était programmée **avant** la téléportation, mais **seul un joueur présent dans la dimension charge les chunks** — la file bouclait sur des chunks jamais chargés (l'arrivée « différée » ne venait jamais, la mine semblait ne pas se générer). Désormais : **téléportation immédiate** (elle force le chargement), puis la plateforme se pose autour du joueur en ~2 s, avec **résistance + fire resistance 10 s** en attendant, night vision sans particules ré-appliquée toutes les 30 s, secours anti-chute en filet.
- [x] Vérifications : héritages inter-fichiers résolus (aucune référence cassée), 4 fichiers JSON valides, build + typecheck + **57/57 tests**.
- Packs **1.9.2** (BP, RP, serveur) — bump obligatoire pour invalider le cache Bedrock.

---

## 🆕 v19.1 — Mine solide + navigation affinée (sept. 2026)
- [x] **Plus de salles ni de galeries pré-creusées** : la mine est un **BLOC DE PIERRE PLEIN** (70 couches, y 2→71, entre deux lits de bedrock). Le joueur **creuse ses propres galeries à la pioche**, comme un vrai minage souterrain. Seule exception : la **poche de spawn** (plateforme éclairée r=8, à cheval sur les 4 chunks de l'origine, arrivée différée jusqu'à ce qu'elle soit prête).
- [x] **Night vision SANS particules** : appliquée avec `showParticles: false` (fallback sans option si le runtime le refuse) et **ré-appliquée toutes les 30 s** tant que le joueur reste dans la mine — jamais aveugle, jamais d'effet visible. Retirée au retour dans le monde normal.
- [x] **Bouton retour remplacé par une flèche « ← » BLANCHE** en haut à gauche de chaque fiche (nouvelle méthode moteur `form.back(cb)`) : Classes, Le Monde, Mines, fiche État, Mon clan, Membres, fiche membre, Drapeau. Les confirmations gardent leur bouton « Annuler » (annulation ≠ navigation).
- [x] **Design affiné** : carte du menu « Le Monde » avec repère « tu es ici » (✦), bandeaux ▓ des cartes Monde/Mine, intro des États contextuelle, header Membres aligné ; nettoyage à la source des derniers glyphes ■/≡ (les six menus concernés).
- [x] **Audit complet** : plus aucun libellé « Retour » oublié, aucune commande dupliquée, aucun bouton multi-ligne, plus aucune mention obsolète de l'ancienne génération ; menu « Monde » du hub relié à sa flèche de retour.
- [x] **Tests** : 57/57 (plan sans salles/galeries vérifié : `ChunkPlan = { cx, cz, veins }`).
- Packs **1.9.1** (BP, RP, serveur).

---

## 🆕 v19 — La vraie mine + menus différenciés (sept. 2026)
- [x] **Mine réécrite de fond en comble** (la v18 générait des « tunnels de 2 blocs » avec ~600 minerais/chunk) :
  - monde **ENTIÈREMENT en pierre** (70 couches, y 2→71, entre deux lits de bedrock) — ambiance souterraine permanente ;
  - **galeries croisées** traversantes de 6 blocs de haut (marche + tête, continuité garantie entre chunks) ;
  - **2-3 grandes salles par chunk** (8-13 de large, 5-8 de haut) avec piliers de soutien, lanternes et contours bruchés organiques ;
  - minerais **plus riches qu'en surface mais ÉQUILIBRÉS** (~150 blocs/chunk, testé) répartis par **bandes de profondeur** : charbon/fer partout, cuivre en dessous, or/redstone tout en bas, lapis/émeraude/diamant dans les 14 derniers blocs ;
  - veines ne perçant JAMAIS une salle ou une galerie (peintes uniquement dans la pierre).
- [x] **Génération par `fillBlocks`** (API native, rapide) + **garde `isChunkLoaded`** : un chunk n'est généré que s'il est chargé, sinon la tâche est REJOUÉE (fini les chunks « à moitié faits » marqués comme terminés) ; file anti-lag **1 chunk/tick**, arrêt propre si tout échoue, relance par l'entretien.
- [x] **Arrivée SÉCURISÉE** : la téléportation n'a lieu que quand la **plateforme du spawn est prête** (disque r=8 à cheval sur les 4 chunks de l'origine, deepslate poli, muret, lanternes) — plus jamais de chute dans le vide (message « Préparation de la mine… » en attendant).
- [x] **`/sn:monde` — « Le Monde »** : menu de choix avec DESIGN DIFFÉRENCIÉ (« portes du monde », deux cartes vertes/bleu acier) ; **le retour au monde normal téléporte à ta DERNIÈRE position** mémorisée (dynamic property) ; `/sn:mine` reste le raccourci aller/retour.
- [x] **Design différencié des menus** (hub/admin inchangés) : Classes = fiches « voies » à bannière (bandeaux couleur, **nom en beau texte blanc**), fiches État/clan = « parchemin » à bannière + lignes en annuaire, Mes infos = fiche perso avec ligne Dons (prête pour la future fonctionnalité).
- [x] **Bouton « Retour au menu » des Mines réparé** : rouvre réellement le hub (callback `back`) au lieu d'afficher un message ; entretien mines enregistré dès le boot (plus de dépendance à l'ordre worldLoad/fallback).
- [x] **Tests** : 58/58 — nouveau lot pour la mine (déterminisme du plan, salles intérieures et hautes, galeries continues 6 blocs, budget minerais 100-200/chunk, bandes de profondeur, diamants tout en bas, veines bornées au chunk, clipBox, muret du spawn).
- Packs **1.9.0** (BP, RP, serveur).

---

## 🆕 v18 — Mines, nation, drapeaux, classes (sept. 2026)

## 🆕 v18 — Mines, nation, drapeaux, classes (sept. 2026)
- [x] **Dimension custom « nalania:mines »** (`BP/dimensions/nalania_mines.json`, schéma officiel 1.26.50 : générateur *void*, 384 blocs de haut) remplie par le module Mines : plateforme d'arrivée en deepslate poli avec lanternes et barrières, galeries croisées + salle centrale, poches creusées, **minerais ×3 à ×5 par rapport à la surface** (charbon, fer, cuivre, or, redstone, lapis, émeraude, diamant), torchères
- [x] **`/sn:mine`** : téléportation aller (mémorise le point de retour + night vision 90 s) / retour à la position d'entrée ; génération **déterministe** (graine `sn:seed <n>` via /scriptevent), file **1 étape/tick** (anti-lag), retry automatique si les chunks n'étaient pas chargés, **secours anti-chute** dans le vide ; entrée « Mines » dans le hub (menu de présentation) ; module « Mines » activable/désactivable dans /sn:modules
- [x] **Commandes de nation complètes** : `/sn:unclaim` (libère le chunk courant, jamais le fondateur), `/sn:invite <joueur>` (en ligne), `/sn:leave`, `/sn:promote <membre>` (officier), `/sn:demote <membre>`, `/sn:kick <membre>`, `/sn:disband` (confirmation via menu), `/sn:flag` (menu drapeau) — toutes avec les gardes chef/officier et des messages d'erreur clairs
- [x] **Drapeaux personnalisés** : le menu Drapeau propose les 10 couleurs **+ 8 blasons importables** (`flag:1` … `flag:8`) ; il suffit de déposer `1.png` … `8.png` dans **`RP/textures/ui/flags/`** (README sur place, 64×64 conseillé) et de bumper le RP ; le choix est stocké en DB (`color: "flag:<n>"`)
- [x] **Menu Classes redesigné** : catalogue en **cartes couleur** (nom blanc, bandeau `━━━` de la couleur de la classe, **points forts/faiblesses**), confirmation « Je confirme — Guerrier », carte de SA classe avec niveau + barre d'XP + traits
- [x] **Reset de classe partout** : bouton admin dans le menu Classes, **nouvelle action « Réinitialiser une classe » dans /sn:db menu** (dropdown des joueurs classés) et **dans la fiche joueur** du menu Joueurs
- [x] **ZÉRO message technique dans le chat** : la vraie source trouvée — le Logger bedrock-boost envoie **par défaut chaque log dans le chat** (`OutputType.Chat`) ; la config de sortie est maintenant nettoyée au boot (console uniquement) ; en plus `/sn:db stats/list/show/save` n'émettent plus rien dans le chat
- [x] API : `MinesManager` (toggle/enter/exit/ensureChunk/maintenance/fallRescue/isUsable), `TerritoryManager.removeChunk`, `resetClassOf(db, joueur)` ; **49/49 tests** (nouveaux : déterminisme du générateur, limite 3×3)
- [x] Packs bumpés **1.7.2 → 1.8.0**. Build + typecheck + JSON UI validés

---

> v17.2 (sept. 2026) : **SYSTÈME DE CLANS / ÉTATS + COINS NETS**. **FIX « carrés chelous »** : onglets à 45° aux coins des textures (les perles/arabesques rendaient en crochets étirés). **`/sn:create` = « Créer un clan »** (chunk fondateur) ; **extension carré 3×3** autour du fondateur ; **section « États »** dans /sn:menu avec « Tu es ici : <clan> » ; **menu « Mon clan »** (`/sn:clan`) : revendiquer, membres (invitation, rangs, exclusion), drapeau, quitter/dissoudre ; renommage global « Territoires » → « États/Clans » (messages `[Clans]`, hub, admin, modules, HUD).

---

> v17.1 (sept. 2026) : **FIX « CRÉATION IMPOSSIBLE » + POLISH OR & ARGENT**. **Fix /sn:create (« nom entre 3 et 24 »)** : cause racine = décalage de lecture des `formValues` (un élément non-interactif décalait les index, le nom lisait un nombre → jamais enregistré) ; la lecture est maintenant validée **par type** à chaque position puis par pioche. **Titre des menus en OR** : le reskin propage `$title_text_color` (la variable que lit `standard_title_label` — l'ancien `$title_panel` n'était pas consommé par `main_panel_no_buttons`). **Icônes retirées des boutons** (« ça fait brouillon ») : tuile unique pleine largeur, textures mortes supprimées. **Puces ■/≡ retirées** de tous les libellés (sanitiseur central `plain()` au niveau moteur). **Plus aucun retour DB dans le chat** (menu /sn:db → console uniquement). **Surbrillance dorée marquée** (liseré lumineux + cœur ample sur la tuile hover) et **fioritures** : arabesques or aux 4 coins du grand cadre, perles argent sur les panneaux internes. **Nineslice des boutons branché** (`om_btn_image` → `$button_image`) : bords or uniformes quelle que soit la largeur. Packs en **1.7.1**.
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

---

## 🆕 v17.1 — Fix création + polish (sept. 2026)
- [x] **FIX « Création de territoire impossible »** : la lecture des réponses de formulaires est validée **par type** (string→textField, number→slider/dropdown, boolean→toggle) — plus aucun champ lu à un index décalé ; fallback par pioche si le runtime décale encore
- [x] **FIX titre gris** : `$title_text_color` or propagée aux héritages `main_panel_no_buttons` (méthode vanilla, vérifiée dans `ui_template_dialogs.json`)
- [x] **Icônes retirées** : `dynamic_button` = tuile pleine largeur, 38 références d'icônes supprimées des menus, textures `om_ic_*`/`om_hero_*` supprimées du RP
- [x] **Puces ■/≡ nettoyées** : `plain()` retire les glyphes et les marqueurs internes sur tous les textes de menus (hub, territoires, modération, classes, jobs, modules, DB, admin, joueurs)
- [x] **Retours DB silencieux** : le menu /sn:db n'envoie plus rien dans le chat (sauvegarde, vidage, édition → console)
- [x] **Surbrillance dorée marquée** : tuile hover avec liseré lumineux interne + cœur doré ample ; boutons avec nineslice (`om_btn_image`)
- [x] **Fioritures or/argent** : arabesques aux coins du grand cadre `om_ornate_bg`, perles argent + touche or sur les panneaux internes `om_content_bg`
- [x] **/sn:create : infos du chunk visibles** dans le modal (le moteur rend le `body()` en label en mode champs — il était silencieusement ignoré)
- [x] Packs bumpés **1.7.0 → 1.7.1** (cache Bedrock). Build + typecheck + 43/43 tests + JSON UI validé

---

> v17 (sept. 2026) : **THÈME OR & ARGENT + FIX « TEXTE INVISIBLE »**. **Le renommage est officiel : OpenMontage → NaLandia** (packs, messages, pack_icon). **Cause racine du « texte qui n'apparaît pas sur les boutons » identifiée et corrigée** : le template vanilla l'impose (« Per design buttons are single line text only ») — tout `\n` dans un label de bouton écrase le rendu ; le moteur aplatit désormais tous les labels en une ligne, et tous les menus ont été nettoyés. **2e cause** : la couleur vanilla des titres (`$title_text_color` = gris 0.3) et des boutons light est invisible sur nos panneaux sombres → le reskin définit ses propres couleurs **or**. **Design global** : boutons « tuile » charbon à cadre or avec **SURBRILLANCE dorée au survol/pressage** (3 états, via les variables officielles `$default/hover/pressed_button_texture` de `light_text_button`), panneaux internes (sidebar, body, champs) à **liseré argenté**, grands cadres ornés or+argent, filets or/argent dans les bandeaux et l'actionbar. **Couleur de rôle** : le joueur ne choisit plus sa couleur (ni via le hub, ni via `/sn:roles`, ni dans la fiche joueur) — elle vient du rôle, modifiable par un admin. **Dossier Leaf retiré** (l'archive `LeafV4.2.4.mcaddon.zip` ne servait à rien). **Chat nettoyé** : plus aucun message technique/DB dans le chat (tout en logs console) ; l'accueil au spawn tient en une ligne. **Fix /sn:create** (template literal cassé qui glissait la dimension dans le champ position), **fix `toLocaleDateString`** (Intl absent de QuickJS → `formatDate`). Packs en **1.7.0** (bump indispensable : cache Bedrock).
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

---

## v17 — Thème or & argent, fixes UI (sept. 2026)
- [x] **Renommage OpenMontage → NaLandia** : manifests BP/RP, pack_icon, messages en jeu (`[NaLandia]`), loggers, commandes, README/serveur/utile.md. Le nom interne de la DB passe à `nalania` (aucune migration nécessaire : la re-détection se fait au premier chargement)
- [x] **Archive Leaf supprimée** (`LeafV4.2.4.mcaddon.zip`) : le framework Leaf n'était qu'un objet d'étude, rien ne l'utilise
- [x] **FIX « texte des boutons invisible » (cause racine)** : les labels de boutons multi-lignes (`nom\n§7sous-titre`) cassent le rendu — le template vanilla dit « Per design buttons are single line text only ». `OMForm.button` aplatit tout en une ligne ; tous les menus mis au propre (`role.data.name\n…` → `… — …`)
- [x] **FIX titres invisibles** : le titre des forms héritait de `$title_text_color` vanilla (gris 0.3 sur fond noir). Le reskin définit son propre label de titre **couleur or** avec ombre
- [x] **Boutons 3 états or/argent** : nouvelles tuiles `om_btn` / `om_btn_hover` / `om_btn_press` (charbon, cadre or, cœur doré lumineux au survol), branchées via les variables **officielles** `$default_button_texture`/`$hover_button_texture`/`$pressed_button_texture` + couleurs de texte de `common_buttons.light_text_button` — texte clair lisible, doré au survol, blanc au clic
- [x] **Panneaux internes argentés** : la sidebar, le panneau body et la zone des champs (custom form) ont un fond propre à liseré **argent** (`om_content_bg`), injecté via la variable officielle `$scroll_background_image_control` de `common.scrolling_panel` (vérifiée dans le vanilla `ui_common.json`)
- [x] **Cadres ornés or + argent** : le grand fond `om_ornate_bg` gagne un filet argent interne ; les héros (256×48) passent au bandeau noir à filet or (haut) / argent (bas) avec losange or central ; l'actionbar reçoit ses filets or/argent ; header-band `om_header_band` à double filet
- [x] **Icônes re-régénérées** : 26 icônes, tuiles charbon à cadre or, `scroll` retirée du catalogue (jamais utilisée)
- [x] **Choix de couleur retiré pour les joueurs** : plus de « Couleur de mon nom » dans le hub ni dans la fiche joueur ; `/sn:roles` (non-admin) affiche simplement ton rôle. La couleur vient du **rôle** (admin : modifiable via le menu Rôles)
- [x] **Plus aucun message DB/technique dans le chat** : welcome en 1 ligne, tout le reste (état DB, heartbeat, diagnostic) passe en logs console filtrables
- [x] **Fix /sn:create** : template literal cassé (la dimension s'écrivait dans la ligne « Position »)
- [x] **Fix `toLocaleDateString`** (hub « Mes infos ») : Intl n'existe pas dans QuickJS → `formatDate()` maison
- [x] JSON UI `server_form.json` restructuré : mêmes factories/bindings que le vanilla, + `om_title`, `om_text_button`, `om_scroll_pane` (fond argenté) — validé JSON, builds et 43/43 tests

---

## 🧱 Fondations

### Base de données locale (TypeScript + JSON) — `src/db/`
- [x] `JsonDatabase` : collections de documents, CRUD complet (`insert`, `upsert`, **`update`**, `find`, `findOne`, `remove`)
- [x] **Migrations de schéma (v3)** : `src/db/migrations.ts` — v1→v2 (renommage `role_members`→`members`, conversion `players`→`players_index`, enrichissement territoires) puis v2→v3 (perms rôles, playerId sur sanctions/grades, grade sur players_index) — testées (10 tests dédiés)
- [x] **Permissions fines (v3)** : catalogue `PERMS` (`src/permissions/perms.ts`) — `territories.create`, `mod.panel/kick/ban/mute/warn/history`, `chat.color/prefix`. Sémantique **additive** : perms par défaut du niveau UNION perms explicites du rôle (un rôle niveau 0 peut être autorisé à bannir). Commandes et GUI gated par permission, op vanilla = bypass
- [x] **Constantes DB centralisées** (`src/db/collections.ts`) : noms de collections + libellés + ordre d'affichage, source unique partagée par tous les managers et le menu DB
- [x] **`db.markDirty()` public** : les mutations en place (role.data.x = y) lèvent maintenant le flag — bug de perte de persistance corrigé (couleurs/prefixes/drapeaux édités étaient perdus au redémarrage) + test de régression
- [x] **Index joueurs `players_index`** : identité stable par **Player.id Bedrock** (le xuid n'existe pas dans l'API 2.11), résolution pseudo↔id, promotion auto des entrées migrées au join, compteur de sessions, grade copié (`src/players.ts`)
- [x] **Territoires v2** : `ownerId` (id Bedrock stable) + `ownerName` + **membres** (member/officer) — le propriétaire ET ses membres peuvent construire ; les protections et le PvP utilisent les IDs
- [x] **Menu DB `/sn:db menu`** (admin) : navigation par sections (joueurs, territoires, rôles, grades, bans, mutes, warns, modules…), vue document avec **édition des champs texte/nombre**, vidage de section, sauvegarde forcée — tout persisté
- [x] Persistance **Dynamic Properties** du monde (stockage Bedrock natif, `src/db/bedrock-storage.ts`)
- [x] **Dirty tracking** : on ne sauvegarde que si des données ont changé
- [x] **Autosave** toutes les 5 s (`src/db/autosave.ts`), sûr en early execution
- [x] **Découpage** : les gros payloads sont fragmentés automatiquement (limite de taille des Dynamic Properties)
- [x] Chargement **post-worldLoad uniquement** (le `getDynamicProperty` est interdit en early execution — bug corrigé, voir Historique)
- [x] **Garde anti-écrasement** (régression) : `save()` refuse d'écrire tant que la base n'est pas chargée — un join avant le worldLoad ne peut plus vider la DB stockée
- [x] **Base vide = valide** : un monde neuf (0 territoire) donne une base vide **prête à l'emploi** (`loaded = true` immédiat) — « DB non chargée » ne se produit plus que si la base est réellement illisible
- [x] Commandes admin `/sn:db` (menu, stats, list, show, save)

### Scripts & toolchain
- [x] TypeScript strict compilé en **un seul bundle** `BP/scripts/main.js` (esbuild) — c'est normal qu'il n'y ait qu'un .js dans BP/scripts
- [x] Manifest BP en TypeScript-compat (API **`@minecraft/server` 2.11.0-beta** = Minecraft **1.26.50**, expérimentation Beta APIs requise)
- [x] **Lib `@bedrock-oss/bedrock-boost` intégrée** (v2.2.0, org Bedrock-OSS, à jour) : `Logger` par module (niveaux filtrables **en jeu** : `/scriptevent log:level <0-5>`, `/scriptevent log:filter <tags>`), `Timings` (mesure du chargement monde), `ColorJSON` (JSON colorisé dans `/sn:db show`). Vec3/cache/schedulers disponibles pour la suite
- [x] **43/43 tests unitaires** (bun test) : DB, migrations v1→v3, chunks, territoires, sanctions, permissions fines, classes, métiers

---

## 🚩 Module Territoires — `src/territories/`
- [x] `/sn:create` : menu (nom + couleur de drapeau) → conquiert le chunk courant
- [x] `/sn:info` : liste de tous les territoires + fiche détaillée cliquable
- [x] Protection totale du chunk : casse ❌, pose ❌ (rollback), interactions ❌, objets ❌, entités ❌, explosions filtrées
- [x] **PvP** : le propriétaire peut frapper quiconque est chez lui ; légitime défense autorisée depuis son propre territoire ; les visiteurs entre eux ne peuvent pas se taper dans un territoire
- [x] **Bandeau d'entrée/sortie** : `⚑ Nom — territoire de X` dans l'actionbar (custom JSON UI)
- [x] `/sn:setflag <couleur>` : changer la couleur de son drapeau
- [x] 1 territoire max/joueur, nom unique 3–24 caractères, limite 64 chunks
- [x] Persistance DB complète (collections `territories`), togglable via le gestionnaire de modules

---

## 👑 Permissions & rôles — `src/permissions/`
- [x] Rôles persistés en DB : nom, couleur (12), prefix, **niveau hiérarchique** (0–100+)
- [x] Par joueur : rôle attribué + prefix perso + couleur perso (prioritaires sur le rôle)
- [x] Bootstrap : le premier opérateur vanilla devient Admin (niveau 100)
- [x] Rôle Admin intouchable (suppression interdite)
- [x] **NameTags** colorés au-dessus des têtes, rafraîchis en continu
- [x] **Chat custom** : format `[grade] nom > message` — `[Admin]`/`[Modo]`/`[Joueur]` selon le rôle, pseudo coloré, séparateur `>` gris. Sans rôle : pseudo blanc + message gris clair ; avec rôle : couleur du rôle + message blanc. Mute géré dans le pipeline unique (bug du double subscriber corrigé)
- [x] **Rôle [Joueur] par défaut** : attribué automatiquement à chaque nouveau joueur (gris foncé §8, niveau 0) — personne n'est « sans rôle » ; `[Modo]` (bleu, niv. 60) pré-créé aussi
- [x] **Menus 100% DDUI (CustomForm)** : tous les menus (hub, territoires, rôles, joueurs, modération, modules, DB) utilisent la nouvelle API Data-Driven UI — boutons à **callbacks directs** (plus d'indexation fragile), headers, dividers, toggles réactifs, sliders et dropdowns à valeur explicite
- [x] **Menu Joueurs à 2 onglets** : 🟢 en ligne (connectés maintenant) + 📜 hors ligne (index DB avec sessions et dernière vue) — les deux gèrent rôle/prefix/couleur pareil
- [x] **BP dépend du RP** (`BP/manifest.json` → uuid RP) : activer le BP auto-active le RP dans le monde
- [x] `/sn:roles` : personnalisation (tous) + gestion complète (admins)
- [x] `/sn:admin` : menu central → Rôles / Joueurs / Modules

## 🧩 Gestionnaire de modules — `src/modules/`
- [x] Toggle on/off **persisté en DB** pour chaque module (territoires, modération)
- [x] Quand un module est off : ses commandes répondent "désactivé" et ses effets (protection...) se coupent
- [x] Accessible via `/sn:admin` → Modules

---

## 🔨 Module Modération — `src/moderation/`
- [x] `/sn:mod` : GUI de modération (stats, bans/mutes actifs cliquables, sanction rapide, historiques)
- [x] `/sn:kick <joueur> <raison>` · `/sn:ban <joueur> [durée_min] <raison>` (0 = permanent) · `/sn:unban` · `/sn:mute <joueur> <durée_min> [raison]` · `/sn:unmute` · `/sn:warn <joueur> <raison>` · `/sn:history <joueur>` — chaque action gated par sa permission fine (`mod.ban`, `mod.mute`...)
- [x] **playerId Bedrock stocké** sur bans/mutes/warns/grades (résolu en ligne au moment de la sanction, ou au join pour les offline) — robuste aux changements de pseudo
- [x] Bans réappliqués au join (message de motif), temporaires auto-levés
- [x] Mutes : messages interceptés dans le chat custom + rappel du temps restant
- [x] 5 collections DB (`bans`, `mutes`, `warns`, infractions, journal) + purges auto

---

## 🎨 UI / Resource Pack — `RP/`
- [x] Thème GUI partagé (`src/ui/theme.ts`) : titres unifiés `OM »`, **43 icônes toutes vérifiées** contre `Mojang/bedrock-samples` (6 chemins morts corrigés — un chemin invalide = icône silencieusement absente)
- [x] Helper `openWindow` (DDUI `CustomForm`, bêta server-ui 2.3) : la nouvelle API de menus réactifs — boutons à callbacks directs, **images depuis notre Resource Pack** (`image(src, pack)`), bindings observables. Migration progressive des menus prévue
- [x] **Moteur de menus `OMForm`** (`src/ui/theme.ts`) : enveloppe du `CustomForm` DDUI qui apporte les 2 correctifs d'affichage :
  - **Codes § rendus** : tout texte (titres, labels, headers, boutons, toggles, sliders, dropdowns, textFields) est converti en **`UIRawMessage`** (`{ rawtext: [{ text }] }`) — c'est le seul format où le rendu DDUI interprète les codes `§l`/`§a`… ; en string brute ils s'affichaient littéralement dans le menu
  - **Navigation** : le formulaire ouvert est suivi par joueur (`openForms`) ; `OMForm.button()` ferme TOUJOURS l'écran courant au clic — soit le menu ouvert par le callback le remplace (navigation), soit l'écran se referme (action terminale) ; `show()` ferme aussi un écran précédent encore affiché ; le suivi est nettoyé à la fermeture (`.finally`)
- [x] **Limite API documentée** : un script ne peut PAS ouvrir un écran JSON UI arbitraire (le JSON UI est rendu par le RP, l'ouverture via script n'existe pas) — `CustomForm` est l'évolution officielle
- [x] **Hub central `/sn:menu`** : porte d'entrée de tout, n'affiche que ce à quoi ton rôle donne droit
- [x] **JSON UI réel** : `RP/ui/hud_screen.json` **PARTIEL** qui redéfinit les 2 éléments ciblés (`hud_actionbar_text`, `hud_title_text`) copiés du vanilla + retouches (fond `om_actionbar_bg`)
  - **Méthode des packs établis** (vérifiée sur Canopy et OriginsPE) : redéclarer un élément vanilla **par son nom exact** dans un `ui/*.json` référencé par `_ui_defs.json` — le moteur fusionne par nom. Pas de copie des 118 Ko, pas de patch par recherche-remplace (la texture ciblée apparaissait 5 fois → mauvaise occurrence patchée = « aucune UI visible »)
  - Généré par `scripts/build_rp_hud.py` (extraction automatique du vanilla + retouches + validation)
- [x] Script reproductible **`scripts/build_rp_hud.py`** : retélécharge le vanilla, applique les patchs, valide — à relancer après chaque mise à jour Minecraft
- [x] Textures UI générées sans dépendance par **`scripts/make_ui_textures.py`** (`bun run textures`) : bannières de héros, icônes pixel-art des menus, fond d'actionbar, pack_icon
- [x] Resource Pack séparé (manifest resources + pack_icon), à activer **en plus** du BP dans le monde

---

## 🌍 Déploiement serveur — `serveur/`
- [x] **`serveur/world_behavior_packs.json`** : active le BP OpenMontage (`2915bab9-50f2-442e-a17a-4c8e9cd688fb` v1.0.0) sur le monde
- [x] **`serveur/world_resource_packs.json`** : active le RP OpenMontage UI (`33ca6e1c-4f30-46ae-8b56-1510382e3f61` v1.0.0)
- [x] **`serveur/README.md`** : guide d'installation BDS pas à pas (copie des packs, fusion des tableaux si le monde a déjà des packs, vérifications en jeu, rappel des commandes `/scriptevent sn:*`)
- [x] Le BP dépend du RP (manifest dependencies) : activer le BP via le monde suffit, le RP est chargé avec lui
- ⚠️ Rappel : après toute modif TS, `bun run build` puis re-copier `BP/` sur le serveur

---

## 🔍 Analyse Leaf + tag de marque OM (v13.3)
- [x] **L'addon Leaf (V4.2.4, uploadé dans le repo) décortiqué** : framework UI complet (starlib2), et surtout le système **NutUI** — des tags invisibles dans le titre du form (`§f§0§0`, `§t§h§e§m§0§1`…) que le JSON UI détecte via `(#title_text - 'tag') != #title_text` pour **changer de design à la volée** (leur `custom_form_switch` route entre plusieurs écrans selon le tag) — la technique des captures « grandes UIs colorées »
- [x] **Adaptation OM (le « pareil sans tout copier »)** : le moteur préfixe tout titre par **`§r§r`** (deux resets = strictement invisible, zéro manipulation de chaîne) ; le JSON UI révèle alors un **bandeau OM** derrière le titre (`om_title_band`, texture bordée, bindings sur `#title_text`). Les forms d'autres add-ons (sans tag) gardent le skin neutre
- [x] `custom_form`/`long_form` passent par `title_area_with_om_band` (bandeau conditionnel + titre standard)
- [x] Packs bumpés **1.5.2 → 1.5.3**

## 🎨 Reskin « technique pro » par variables (v13.2)
- [x] **Méthode des vrais packs** (décodée dans `ui_template_buttons.json` vanilla) : `light_text_button` est entièrement piloté par des **variables** (`$default_button_texture`, `$hover_button_texture`, `$pressed_button_texture`, `$default/hover/pressed_text_color`) — au lieu de recopier la structure, on **redéfinit les variables au point d'usage** : mêmes leviers officiels, nos textures à nous, **zéro structure copiée** (si Mojang change ses widgets, on suit automatiquement)
- [x] **Boutons OM 3 états** : submit + boutons de listes = textures noires bordées bleu (normal / liseré vert clair au survol / enfoncé), texte blanc → vert au survol
- [x] **Titre vert OM** sur les deux types de formulaires (`$title_text_color`)
- [x] Portée limitée aux **forms serveur** : le reste de l'UI du jeu (menus settings, etc.) n'est pas touché
- [x] Packs bumpés **1.5.1 → 1.5.2**

## 🔧 Fix routage moteur + reskin héritage vanilla (v13.1)
- [x] **`/sn:create` réparé (la vraie cause, merci le message en jeu)** : `OMForm: textField() impossible après un bouton/label (ce menu est en mode ActionForm)` — le verrou de mode v13.0 était **trop strict** : il refusait le mélange header/label + textField, or **`ModalFormData` supporte nativement `header()`, `label()`, `divider()` et `submitButton()`** (vérifié dans l'API 2.3.0). Le moteur ne verrouille plus le mode sur les éléments neutres : `button()` → mode actions, `textField/toggle/slider/dropdown()` → mode fields, header/label/divider acceptés partout. En mode fields, le **dernier bouton devient le submit natif** (son callback part à la validation) — exactement le schéma de /sn:create
- [x] **Reskin recentré** : `custom_form`/`long_form` héritent de `common_dialogs.main_panel_no_buttons` (fichier vanilla **réel** `ui_template_dialogs.json`, confirmé chargé par le `_ui_defs.json` officiel du jeu) avec `$custom_background` = notre fond bleu nuit + `submit_button`/`form_button` sur `common_buttons.light_text_button` (vanilla réel aussi) — structure fidèle du vanilla, widgets 100% natifs
- [x] Packs bumpés **1.5.0 → 1.5.1** (BP header/module/dépendance, RP header/module, `serveur/*.json`)

## 🔁 Migration moteur UI vanilla + reskin common_dialogs (v13)
- [x] **DDUI (CustomForm bêta) abandonné définitivement** : trop capricieux (observable `clientWritable`, boutons mono-ligne sans codes §, écrans perdus). Les menus passent sur **ActionFormData** (boutons + icônes RP + labels multi-lignes + codes § rendus nativement) et **ModalFormData** (champs : texte, switchs, sliders, dropdowns — la « vraie » saisie)
- [x] **Même API OMForm pour les menus** : `button(label, cb, opts, icon)`, `textField`, `slider(label, obs, min, max)`, `dropdown`, `toggleOb`, `hero`, `header`… — les observables deviennent des shims simples (valeur lue au submit via l'index des champs). Menus adaptés : modules (toggles → boutons ON/OFF cliquables), db, modération, rôles, territoires, hub
- [x] **Reskin JSON UI réécrit avec la vraie source vanilla** : le dépôt **ZtechNetwork/MCBVanillaResourcePack** fournit le RP vanilla complet, dont `ui_template_dialogs.json` = namespace **`common_dialogs`** (introuvable dans bedrock-samples !). Décodé : `main_panel_no_buttons` accepte **`$custom_background`** → notre fond bleu nuit `om_dialog_bg` est injecté proprement via la variable officielle, sans reconstruire la structure (25 éléments au lieu de 32, héritage standard préservé)
- [x] **Ce que ça donne** : menus à boutons = habillage bleu nuit + icônes + labels couleur multi-lignes **réellement rendus** ; formulaires de saisie = switchs/sliders/dropdowns vanilla fonctionnels
- [x] Erreurs toujours visibles en jeu (`§c[OM] Le menu « … » …`)
- [x] Packs bumpés **1.4.2 → 1.5.0**

## 🐛 Fix clientWritable + limites boutons DDUI (v12.2)
- [x] **Le crash `/sn:create` identifié précisément** (merci le message en jeu v12.1) : `Expect 'text' observable to be client writable`. L'API DDUI exige que l'observable lié à un champ **écrit par le client** (textField, dropdown, slider, toggle) soit créé avec **`{ clientWritable: true }`** (liaison bidirectionnelle UI↔script). `obString`/`obNumber`/`obBool`/`obToggle` le passent maintenant systématiquement — TOUS les menus à champ de saisie étaient concernés, pas seulement /sn:create
- [x] **Versions API vérifiées** : `@minecraft/server 2.11.0-beta` + `@minecraft/server-ui 2.3.0-beta` — identiques entre node_modules et manifest, le bug n'était PAS un mismatch de version
- [x] **Boutons mono-ligne sans codes §** : constaté en jeu — le template vanilla dit « Per design buttons are single line text only » (un `\n` écrase le rendu → barre plate) et les codes `§` ne sont pas interprétés dans les boutons (contrairement aux labels/headers qui les rendent). `OMForm.button` aplati maintenant tout label sur une ligne (`\n` → « — ») et retire les codes — au niveau moteur, tous les menus en profitent sans rien changer aux appelants
- [x] Packs bumpés **1.4.1 → 1.4.2**

## 🎨 Reskin JSON UI des formulaires + fix /sn:create (v12.1)
- [x] **⚠️ Correction v12.1 — pourquoi le reskin v12 n'a rien changé** : le fichier déclarait `namespace: "om_server_form"` → ses éléments (`om_server_form.custom_form`) n'étaient référencés **par rien** (l'usine vanilla charge `@server_form.custom_form`) et la fusion « par nom » ne peut pas faire matcher deux namespaces différents. Pareil pour `om_buttons` : `common_buttons.light_text_button` vit dans un namespace intégré au moteur, **non définissable** depuis un RP
- [x] **Nouvelle méthode : écrasement complet** — le RP fournit `ui/server_form.json` (même chemin que vanilla, comme notre `hud_screen.json`) avec `namespace: "server_form"` : tout le fichier vanilla est remplacé par notre version (32 éléments, copie fidèle des bindings, zéro héritage de `common_dialogs` non définissable)
- [x] **Rendu custom réel** : `custom_form`/`long_form` = panneaux autonomes — **fond bleu nuit** (`om_dialog_bg`) sur toute la surface, **titre sur bandeau noir** en tête, `om_submit_button`/`om_form_button` (boutons noirs bordés à 3 états normal/hover/pressed) utilisés par les forms DDUI ET les long forms vanilla, headers/labels de section sur bandeau
- [x] **Widgets restés vanilla** (toggles, sliders, dropdowns, inputs, multiselect) : définis en wrappers exacts des composants `settings_common` (namespaces `settings_common`/`common`/`progress` = fichiers vanilla réels ou intégrés moteur, tous disponibles à l'héritage)
- [x] `RP/ui/om_buttons.json` (namespace mort) supprimé, `_ui_defs.json` nettoyé
- [x] **Erreurs de menus VISIBLES EN JEU** (v12.1) : construction ET affichage d'un écran en échec affichent désormais `§c[OM] Le menu « … » … : <raison>` au joueur + log serveur — plus jamais un menu mort sans explication ; les **actions de boutons** sont aussi couvertes (exception dans un callback `manager.create` etc. → message en jeu au lieu de mourir en silence)
- [x] **Nouvelles textures** : `om_dialog_bg` (bleu nuit, bordure bleue), `om_header_band`, `om_btn`, `om_btn_hover`, `om_btn_press`
- [x] Packs bumpés **1.4.0 → 1.4.1** (fichier reskin réécrit — indispensable pour le cache)

## ⚔️ Module Classes & Métiers (v11) — `src/classes/` + `src/jobs/`
- [x] **Classes — la route du joueur** : `/sn:classes` ouvre UN menu à deux états — sans classe : catalogue cliquable (Guerrier, Mage, Archer) avec **confirmation** (le choix est **DÉFINITIF**) ; avec classe : **progression** (niveau, barre d'XP ASCII, XP total). Le menu « change » tout seul après le choix, comme demandé
- [x] **XP/niveaux de classe** : paliers de 100 XP (`classLevel`, `classProgress`) — l'API `addXp` est prête à être branchée sur les events du jeu (mine, cut, kill)
- [x] **Réinitialisation admin** : bouton dédié dans le menu (admins seulement) → le joueur peut re-choisir
- [x] **Métiers — la base, catalogue VIDE** (comme demandé) : `/sn:jobs` affiche les métiers exercés (XP/niveau) et annonce le catalogue à venir (bûcheron, mineur…). Fondations complètes : stockage multi-métiers par joueur, XP par métier (paliers de 50), collection `jobs`
- [x] **Intégration complète** : collections DB `classes`/`jobs` + meta menu DB, managers markLoaded (worldLoad + fallback), commandes `/sn:classes` + `/sn:jobs`, entrées dans le hub (badge « choisis ta route » tant que pas de classe), **invite au premier spawn** (« Choisis ta route avec /sn:classes — c'est définitif ! »)
- [x] **Textures** : héros `om_hero_classes` (violet→rouge) et `om_hero_jobs` (or→orange), icônes `axe`, `pickaxe`, `hammer` — packs bumpés en **1.3.0**
- [x] **10 tests dédiés** (choix définitif, XP refusée sans classe, reset admin, persistance mutations en place, paliers de niveaux)

---

## 🔧 Correctifs UI (v10.1) — moteur d'affichage : différé + fallback auto
- [x] **Show différé de 2 ticks** : ouvrir un menu dans le même tick que la fermeture du précédent fait perdre le nouvel écran en silence (piège Bedrock DDUI) — `openWindow`/`openWindowRaw` passent par `buildAndShow` qui diffère le `show()` de 2 ticks
- [x] **Fallback automatique sans images** : si un écran contenant des images échoue à s'afficher (client sans le RP, texture indisponible…), le design image est désactivé automatiquement (log warn filtrable) et le menu est **reconstruit sans aucune image** → il s'affiche toujours. Plus jamais « la commande n'ouvre rien »
- [x] Tout passe par un **unique point de construction** (`buildAndShow`) : suivi du formulaire ouvert, bouton fermer, différé et fallback centralisés

## 🔧 Correctifs UI (v10) — la vraie cause : mauvais identifiant de pack
- [x] **`imagePackId` = UUID, pas le nom** : l'API DDUI attend l'**identifiant** du pack — en Bedrock c'est son **UUID** (le `pack_id` de world_resource_packs.json). On passait `"OpenMontage UI"` (le nom d'affichage) → ne matchait aucun pack → **toutes les images des menus étaient silencieusement ignorées** alors même que le RP était correctement chargé. C'était LA cause du « menus toujours basiques »
- [x] **Extension `.png` requise** : la doc dit « chemin relatif vers un fichier image » → les chemins `om_hero_*` / `om_ic_*` incluent désormais `.png` (les textures sont bien des fichiers .png du RP)
- [x] **Bump 1.1.0 → 1.2.0** (BP, RP + modules, `serveur/world_*_packs.json`) — indispensable pour que le cache Bedrock recharge les packs avec le bundle corrigé
- [x] **Diagnostic worldLoad** : le log affiche maintenant `UI images : pack_id=<UUID>` — si les images manquent en jeu, on vérifie en une ligne que ce pack_id correspond bien au RP actif du client
- [x] Typecheck + 33/33 tests + bundle recompilé (vérifié : UUID et chemins .png embarqués)

## 🔧 Correctifs UI (v9) — « menus non changés / certains ne s'ouvrent pas »
- [x] **Cause racine du « menus inchangés »** : Bedrock met les packs en **cache par uuid+version** — nos manifest étaient restés en 1.0.0, donc le jeu rechargait l'ancien RP (sans héros/icônes). **BP + RP passés en 1.1.0** et `serveur/world_*_packs.json` mis en cohérence ; règle documentée : toute modif de pack = version +1
- [x] **Cause du « certains menus ne s'ouvrent pas »** : les images DDUI (héros + `imageDetails`) référencent des textures que l'ancien RP caché ne contient pas → écrans qui plantent. Double protection :
  - **Fail-safe dans `OMForm`** : `hero()` et `button()` dégradent silencieusement si l'image est refusée (bouton réessayé sans image, menu garanti ouvert)
  - **Toggle runtime** : `/scriptevent sn:ui off` → tous les menus sans image (mode compatibilité), `sn:ui on` pour réactiver
- [x] **Veille API UI Bedrock** dans `utile.md` : mcbe-ui-codex (référence vérifiée textures/JSON UI/Script API), Chest-Form (menus coffre), forms-plus & better-forms (wrappers typés), bedrock-tile-menu, EasyUIBuilder, Ore-UI-Types — LeviInterface écarté (LeviLamina, pas add-on)

## 🎨 Refonte design des menus (v8)
- [x] **Zéro texture placeholder restante** : les 10 bandeaux `om_banner_*` (déjà inutilisés) sont supprimés ; `scripts/make_placeholder_pngs.py` remplacé par **`scripts/make_ui_textures.py`** (`bun run textures`)
- [x] **Bannières de héros 256×48** (7 variantes : home, territories, admin, mod, role, modules, database) — panneaux slate dégradé à ruban accent et clef de voûte or, affichées **pleine largeur en tête de chaque menu principal** via `OMForm.hero()` (image DDUI du RP OpenMontage)
- [x] **24 icônes 32×32 pixel-art** (flag, crown, shield, sword, ban, bell, warn, history, trash, save, search, user, tag, gear…) — tuiles slate à liseré accent, passées aux boutons via **`imageDetails`** (API DDUI bêta) : chaque bouton porte désormais son icône
- [x] **Icônes dans NOTRE pack** : fin des chemins vanilla dont l'existence dépendait du client (les « icônes non chargées » historiques) — tout vient de `OpenMontage UI`
- [x] Émojis remplacés par les codes couleur normés (`§a■`, `§4■`…) — rendu propre et cohérent, icône à gauche du label
- [x] Habillage appliqué aux **7 familles de menus** : hub, territoires, rôles (+couleur/prefix/niveau/membres), joueurs (config + assignation), modération (bans/mutes/sanction/historique), modules (+confirmation), DB (sections + documents)

## 🔍 Revue « base propre » (v7)
- [x] **Chat triplé en jeu** : `registerChat` était appelé 2× dans worldLoad (bloc dupliqué) + 1× par le fallback sans garde partagée → chaque message émis **3 fois** et `registerEnforcement` (éjection des bannis) enregistré **2×**. Corrigé par une garde unique `registerChatOnce()` partagée entre worldLoad et fallback
- [x] **Imports dynamiques supprimés** : `import("..")` en QuickJS/Bedrock est risqué (chunking esbuild) → remplacés par des imports statiques (menus Modules→Territoires et Modération→kickPlayer), vérifiés sans cycle d'import
- [x] **Confirmation vanilla résiduelle** : le menu « Supprimer TOUS les territoires » utilisait encore un `MessageFormData` vanilla → migré en DDUI (thème cohérent, messages en rawtext)
- [x] Ré-export mort `ICONS` (modules/ui) supprimé — plus aucun import inutilisé

## 🔍 Revue complète (v6)
- [x] **worldLoad** : `sanctions.markLoaded()` était oublié → un banni n'était JAMAIS éjecté au join (`registerEnforcement` vérifiait `sanctions.loaded`, resté false). + chat/enforcement désormais aussi enregistrés dans le fallback (sans worldLoad : un muet pouvait parler)
- [x] **Kick côté serveur** : `player.runCommand("kick")` échouait pour un non-opérateur → `dimension.runCommand` (permissions serveur) + échappement des guillemets du motif
- [x] **Events read-only** : les `sendMessage` dans les before-events (protection territoires) sont interdits en read-only → planifiés au tick suivant (`safeSend`) — plus d'erreurs silencieuses du content log
- [x] **Dropdown OMForm** : labels d'items convertis en rawtext (les § s'affichaient) et objets appelants JAMAIS mutés (reconstruction avec valeur conservée)
- [x] **Anti-injection chat** : les codes § saisis par les joueurs sont neutralisés (plus de couleurs arbitraires dans le chat)
- [x] **`toLocaleString()`** (Intl indisponible dans QuickJS) remplacé par `formatDate()` dans l'historique de modération
- [x] **deleteRole** : détache les membres (role="") au lieu de supprimer leurs fiches — prefix/couleur perso et playerId préservés
- [x] Message d'éjection `[Territoires/OpenMontage]` → `[OpenMontage]` ; calcul Ko corrigé dans `/sn:db list`
- [x] Doc obsolète (kick via player.runCommand) mise à jour

## 🧰 Veille outils
- [x] `utile.md` : outils GitHub classés (toolchain, Script API, serveurs, JSON UI) — déjà utilisés vs à évaluer

---

## 🗺️ Roadmap (proposée, non commencée)
- **Phase 2 modération (suite)** : logs de grief (qui a cassé quoi + rollback), config globale GUI
- **Phase 1 socle** : économie (`/sn:money`, `/sn:pay`), homes & TP (`/sn:sethome`, `/sn:tpa`...), stats joueurs (`/sn:top`)
- **Phase 3 gameplay** : boutique, kits & récompenses quotidiennes, quêtes, classements temps réel
- **Qualité** : cooldowns génériques, pagination des menus, i18n FR/EN

---

## 📜 Historique des corrections marquantes
1. **Early execution** : `getDynamicProperty` interdit avant `worldLoad` → crash au chargement du pack. Corrigé (DB lue au worldLoad/fallback spawn).
2. **Formulaire de création** : `formValues` indexait aussi header/label → "nom entre 3 et 24 caractères" à tort. Corrigé (lecture par type).
3. **Chat** : `chatSend` absent de la stable 2.9.0 (uniquement doc) → migration vers la bêta 2.11.0 (Minecraft 1.26.50), où il existe bel et bien.
4. **JSON UI** : les éléments custom dans un fichier séparé ne sont pas instanciés par le HUD → remplacement du `hud_screen.json` entier (méthode officielle des packs UI).
5. **Identité joueurs** : pas de `xuid` dans l'API bêta 2.11 → identité stable par `Player.id` + migration des anciennes entrées (clés `name:<pseudo>` promues automatiquement au join).
6. **DB « non chargée » / 0 territoire** : `load()` sur base inexistante ne posait pas `loaded` (monde neuf = tout mort) et `save()` pouvait écraser la DB stockée avec du vide avant le worldLoad. Corrigé + tests de régression.
7. **JSON UI invisible** : le patch par remplacement de texte tapait la 1re occurrence d'une texture présente 5 fois (pas celle de l'actionbar). Remplacé par la méthode partielle des packs établis (Canopy/OriginsPE).
8. **Icônes invisibles dans les menus** : 6 chemins d'icônes n'existaient pas dans le vanilla (`icon_missing_item`, `icon_save`, `banner_base`, `shield_base`, `golden_helmet`, `door_acacia_upper`, `bell`, `anvil`, `barrier`, `fire_charge` en items...). Corrigés et **tous vérifiés automatiquement** contre l'arborescence officielle.
9. **`§l` visibles en clair dans les menus DDUI** : le rendu `CustomForm` n'interprète pas les codes § dans les strings brutes — passage systématique par `UIRawMessage` (rawtext) dans le wrapper `OMForm`.
10. **Menu qui reste ouvert après un clic** : les callbacks ouvraient un 2e formulaire par-dessus le 1er (empilement) — `OMForm` ferme désormais l'écran courant avant chaque action/navigation (suivi par joueur + `close()`).
11. **Bans jamais appliqués au join** : `sanctions.markLoaded()` manquant au worldLoad → `registerEnforcement` se croyait désactivé. Corrigé (+ fallback chat/enforcement).
12. **Kick qui échouait pour un non-op** : kick exécuté côté serveur (`dimension.runCommand`) au lieu de la perspective du joueur.
13. **Chat ×3 / bans éjectés 2×** : `registerChat` souscrit sans garde interne ; l'appeler N fois = N traitements par message. Garde unique `registerChatOnce()` (worldLoad + fallback partagent le même flag).
14. **sendMessage en read-only** : messages de protection planifiés au tick suivant via `system.run` (écriture interdite dans les before-events).
15. **Images des menus invisibles (RP pourtant chargé)** : `imagePackId` du DDUI reçoit l'**UUID** du pack (pas son nom) et les chemins portent `.png` — l'ancien code passait le nom du pack, ignoré silencieusement par le moteur.
