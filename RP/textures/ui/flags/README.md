# Blasons personnalisés des clans

Dépose ici tes drapeaux/blasons au format **PNG** :

- `1.png`, `2.png`, `3.png` … jusqu'à `8.png`
- Taille conseillée : **64×64** (ou 32×32) — carré, fond transparent
- Après ajout/modification de fichiers, **bump la version du RP**
  (`RP/manifest.json`) pour forcer Bedrock à recharger les textures.

Les joueurs choisissent ensuite leur blason dans **/sn:flag**
(menu Drapeau du clan → section « blasons personnalisés ») :
le choix est stocké en base (`color: "flag:<n>"`) et s'affiche dans les
menus et l'annonce HUD.

Tant qu'un fichier manque, l'entrée du menu reste utilisable (le jeu
affiche simplement une texture vide — aucun crash).
