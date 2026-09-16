#!/usr/bin/env python3
"""Construit RP/ui/hud_screen.json : le hud_screen.json VANILLA de Mojang
avec nos retouches OpenMontage.

Pourquoi surcharger le fichier entier ? Le HUD n'instancie que les éléments
déclarés dans ses propres définitions : ajouter de nouveaux éléments
(`om_xxx@hud.hud_actionbar_text`) dans un fichier séparé ne fait rien.
La seule méthode fiable est de remplacer ui/hud_screen.json dans le RP.

Source : Mojang/bedrock-samples (repo officiel des samples Mojang).

Retouches appliquées :
  1. hud_actionbar_text : texture de fond -> om_actionbar_bg (nuit, liseré clair)
  2. hud_actionbar_text : padding visuel élargi (12px -> 24px de marge)
  3. hud_title_text / title_background : texture de fond -> om_actionbar_bg

Usage : python3 scripts/build_rp_hud.py
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

# Ref du repo Mojang (branche main, dossier resource_pack vanilla).
RAW_URL = (
    "https://raw.githubusercontent.com/Mojang/bedrock-samples/"
    "main/resource_pack/ui/hud_screen.json"
)
# Cache local : évite de retélécharger à chaque exécution.
CACHE = Path(__file__).resolve().parent / ".cache_hud_screen.json"
OUTPUT = Path(__file__).resolve().parent.parent / "RP" / "ui" / "hud_screen.json"

OLD_AB_TEXTURE = '"texture": "textures/ui/hud_tip_text_background"'
OLD_AB_SIZE = '"size": [ "100%c + 12px", "100%c + 5px" ]'
OLD_TITLE_SIZE = '"size": [ "100%sm + 30px", "100%sm + 6px" ]'

NEW_AB_TEXTURE = '"texture": "textures/ui/om_actionbar_bg"'
NEW_AB_SIZE = '"size": [ "100%c + 24px", "100%c + 5px" ]'
NEW_TITLE_SIZE = '"size": [ "100%sm + 34px", "100%sm + 8px" ]'


def load_vanilla() -> str:
    if CACHE.exists():
        print(f"Cache utilisé : {CACHE.name}")
        return CACHE.read_text(encoding="utf-8")

    print(f"Téléchargement depuis {RAW_URL} ...")
    with urllib.request.urlopen(RAW_URL, timeout=30) as response:
        data = response.read()
    text = data.decode("utf-8")
    CACHE.write_text(text, encoding="utf-8")
    return text


def main() -> int:
    vanilla = load_vanilla()

    # Sanity check : la structure vanilla attendue doit être présente.
    for needle, what in [
        ('"hud_actionbar_text"', "bloc actionbar"),
        ('"hud_title_text"', "bloc title"),
        ('"title_background"', "fond de title"),
    ]:
        if needle not in vanilla:
            print(f"ERREUR : {what} introuvable dans le vanilla — format changé ?", file=sys.stderr)
            return 1

    patched = vanilla
    patched = patched.replace(OLD_AB_TEXTURE, NEW_AB_TEXTURE, 1)
    patched = patched.replace(OLD_AB_SIZE, NEW_AB_SIZE)
    patched = patched.replace(OLD_TITLE_SIZE, NEW_TITLE_SIZE, 1)

    # Vérification : nos retouches sont bien dans le résultat.
    checks = [
        (NEW_AB_TEXTURE in patched, "texture actionbar remplacée"),
        (NEW_TITLE_SIZE in patched, "taille title élargie"),
    ]
    failed = [name for ok, name in checks if not ok]
    if failed:
        print(f"ERREUR : retouches non appliquées : {', '.join(failed)}", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(patched, encoding="utf-8")

    # Validation : le vanilla contient des commentaires // (tolérés par
    # Bedrock mais pas par json) -> on les retire pour une validation locale.
    # Le lookbehind préserve les URLs (https://).
    stripped = re.sub(r"(?<!:)//.*$", "", patched, flags=re.MULTILINE)
    json.loads(stripped)
    print(f"OK : {OUTPUT.relative_to(OUTPUT.parent.parent)} ({len(patched)} octets, JSON valide hors commentaires)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
