# ✅ DONE.md — État d'avancement d'OpenMontage

> Dernière mise à jour : **v13.1** — fix `/sn:create` (le verrou de mode du moteur refusait le mélange légitime header/label + textField — `ModalFormData` supporte nativement header/label/divider/submitButton, le moteur route maintenant correctement : dernier bouton = submit) + reskin recentré sur l'héritage vanilla réel. Packs en 1.5.1.
> ⚠️ Projet **en développement** — ne pas utiliser sur un monde important.

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
