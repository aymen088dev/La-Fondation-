#!/usr/bin/env python3
"""Construit RP/ui/hud_screen.json : fichier PARTIEL qui redéfinit les
éléments du HUD qu'OpenMontage personnalise.

MÉTHODE (celle des packs établis : Canopy, OriginsPE) :
  Un RP peut redéfinir un élément vanilla par son NOM EXACT dans un fichier
  ui/*.json référencé par _ui_defs.json. Le moteur FUSIONNE par nom d'élément :
  seule la définition donnée remplace l'originale. Inutile (et fragile) de
  copier les 118 Ko du fichier vanilla complet — surtout que les patchs par
  remplacement de texte y tapent la mauvaise occurrence (la texture
  hud_tip_text_background apparaît 5 fois).

Éléments redéfinis ici (copie vanilla + retouches OpenMontage) :
  - hud_actionbar_text : bandeau des territoires (⚑ ...) -> fond om_actionbar_bg
  - hud_title_text     : gros titres (OpenMontage ✔, /sn:menu) -> même fond
    (l'élément complet est copié du vanilla pour conserver title+subtitle+anims)

Les textures om_actionbar_bg.png etc. sont générées par
scripts/make_placeholder_pngs.py (RP/textures/ui/).

Usage : python3 scripts/build_rp_hud.py
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

RAW_URL = (
    "https://raw.githubusercontent.com/Mojang/bedrock-samples/"
    "main/resource_pack/ui/hud_screen.json"
)
CACHE = Path(__file__).resolve().parent / ".cache_hud_screen.json"
OUTPUT = Path(__file__).resolve().parent.parent / "RP" / "ui" / "hud_screen.json"

OM_TEXTURE = "textures/ui/om_actionbar_bg"


def load_vanilla_text() -> str:
    if CACHE.exists():
        print(f"Cache utilisé : {CACHE.name}")
        return CACHE.read_text(encoding="utf-8")

    print(f"Téléchargement depuis {RAW_URL} ...")
    with urllib.request.urlopen(RAW_URL, timeout=30) as response:
        text = response.read().decode("utf-8")
    CACHE.write_text(text, encoding="utf-8")
    return text


def parse_vanilla() -> dict:
    """Parse le vanilla (JSON avec commentaires //) en dict."""
    text = load_vanilla_text()
    stripped = re.sub(r"(?<!:)//.*$", "", text, flags=re.MULTILINE)
    return json.loads(stripped)


def main() -> int:
    vanilla = parse_vanilla()

    # --- Extraction des éléments à retoucher -------------------------------
    actionbar = vanilla.get("hud_actionbar_text")
    title = vanilla.get("hud_title_text")
    if not isinstance(actionbar, dict) or not isinstance(title, dict):
        print("ERREUR : hud_actionbar_text / hud_title_text introuvables dans le vanilla.", file=sys.stderr)
        return 1

    # --- Retouche 1 : actionbar --------------------------------------------
    # C'est un type "image" : la racine EST le fond. On remplace la texture
    # et on élargit un peu. Le label enfant reste inchangé.
    if actionbar.get("texture") != "textures/ui/hud_tip_text_background":
        print(f"ERREUR : texture actionbar inattendue : {actionbar.get('texture')}", file=sys.stderr)
        return 1
    actionbar["texture"] = OM_TEXTURE
    actionbar["size"] = ["100%c + 24px", "100%c + 5px"]

    # --- Retouche 2 : title (title_background dans le stack_panel) ---------
    # On cherche le contrôle title_background dans title_frame/controls.
    patched_bg = False
    for control in title.get("controls", []):
        frame = control.get("title_frame")
        if not isinstance(frame, dict):
            continue
        for sub in frame.get("controls", []):
            bg = sub.get("title_background")
            if isinstance(bg, dict) and bg.get("texture") == "textures/ui/hud_tip_text_background":
                bg["texture"] = OM_TEXTURE
                bg["size"] = ["100%sm + 34px", "100%sm + 8px"]
                patched_bg = True
    if not patched_bg:
        print("ERREUR : title_background non trouvé dans hud_title_text.", file=sys.stderr)
        return 1

    # --- Écriture du fichier partiel ----------------------------------------
    partial = {"hud_actionbar_text": actionbar, "hud_title_text": title}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(partial, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    json.loads(OUTPUT.read_text(encoding="utf-8"))
    print(f"OK : {OUTPUT.relative_to(OUTPUT.parent.parent)} "
          f"({OUTPUT.stat().st_size} octets, 2 éléments redéfinis, JSON valide)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
