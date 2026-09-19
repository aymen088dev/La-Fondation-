#!/usr/bin/env python3
"""Pipeline UI NaLandia — génère RP/ui/server_form.json de façon DÉTERMINISTE.

Méthode (celle d'EasyUIBuilder, appliquée à notre projet) :
  1. lecture du server_form.json VANILLA officiel (Mojang/bedrock-samples) ;
  2. fusion non destructive : on ne touche QUE
       - long_form               : ajout du namespace OM (menus à tuiles) ;
       - custom_form             : variable $custom_background (habillage) ;
       - om_menu_panel           : variables par défaut (fenêtre + tuiles) ;
       - dynamic_button          : textures des 3 états (habillage boutons) ;
     tout le reste du vanilla est recopié TEL QUEL ;
  3. menus OM générés depuis le contrat TypeScript : ce fichier embarque la
     même table `TILE_MENUS` que src/ui/tiles.ts (module sans import, copiée
     par un test d'égalité — voir src/ui/tiles.test.ts) ;
  4. validation stricte : chaque référence "server_form.X" doit se résoudre,
     aucun duplicate "X" / "X@parent", textures om_* vérifiées sur disque ;
  5. écriture si (et seulement si) le résultat diffère du fichier actuel.

Usage :
  python3 scripts/build_ui.py            # build (réseau si cache absent)
  python3 scripts/build_ui.py --offline  # cache scripts/vanilla_cache/ requis
"""
from __future__ import annotations

import copy
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RP_UI = ROOT / "RP" / "ui"
RP_TEXTURES = ROOT / "RP" / "textures"
CACHE = Path(__file__).resolve().parent / "vanilla_cache"
VANILLA_URL = (
    "https://raw.githubusercontent.com/Mojang/bedrock-samples/main/"
    "resource_pack/ui/server_form.json"
)

# ---------------------------------------------------------------------------
# Contrat des menus à tuiles — lu DIRECTEMENT dans src/ui/tiles.ts (bloc
# @ui-contract-begin/end). Le TypeScript est la source de vérité unique :
# ce fichier ne contient AUCUNE copie de la table.
# ---------------------------------------------------------------------------

def load_tile_contract() -> dict:
    """Extrait le bloc JSON du contrat depuis src/ui/tiles.ts."""
    source = (ROOT / "src" / "ui" / "tiles.ts").read_text(encoding="utf-8")
    begin = source.find("// @ui-contract-begin")
    end = source.find("// @ui-contract-end")
    if begin == -1 or end == -1 or end <= begin:
        sys.exit("[build_ui] contrat introuvable dans src/ui/tiles.ts (@ui-contract-begin/end)")
    block = source[begin:end]
    # Le bloc est du JSON avec des commentaires de ligne : on les retire.
    lines = [ln.split("//", 1)[0] if not ln.strip().startswith("//") else "" for ln in block.splitlines()]
    payload = "\n".join(lines)
    payload = payload[payload.find("{") : payload.rfind("}") + 1]
    return json.loads(payload)

# ---------------------------------------------------------------------------
# Habillage Or & Argent — textures produites par scripts/make_ui_textures.py.
# ---------------------------------------------------------------------------
FLAGS = ["aqua", "blanc", "blason", "bleu", "gris", "jaune", "or", "rose", "rouge", "vert", "violet"]

BAND = "textures/ui/om_header_band"
WINDOW = "textures/ui/om_window"
CARD = "textures/ui/om_btn"
CARD_HOVER = "textures/ui/om_btn_hover"
CARD_PRESS = "textures/ui/om_btn_press"
PLATE = "textures/ui/om_plate"

# Thèmes des menus à liste (id -> titre). Fenêtre om_menu_<id>_bg optionnelle,
# sinon la fenêtre or générique est utilisée.
MENU_THEMES: dict[str, str] = {
    "Mines": "mines",
    "Moderation": "moderation",
    "Bans": "bans",
    "Mutes": "mutes",
    "Roles": "roles",
    "Joueurs": "joueurs",
    "Membres": "membres",
    "Membre": "membre",
    "Modules": "modules",
    "Metiers": "metiers",
    "Quetes": "quetes",
    "Drapeau": "drapeau",
    "Dissoudre": "dissoudre",
    "Base de donnees": "base",
}


def load_vanilla(offline: bool) -> dict:
    """Charge le vanilla officiel : cache local d'abord, réseau en repli."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE / "server_form.json"
    if cache_file.exists():
        return _load_jsonc(cache_file.read_text(encoding="utf-8"))
    if offline:
        sys.exit(
            "[build_ui] --offline mais aucun cache. Lance `python3 scripts/build_ui.py` "
            "avec le réseau une fois : le vanilla est mis en cache localement."
        )
    raw = urllib.request.urlopen(VANILLA_URL, timeout=30).read().decode("utf-8")
    data = _load_jsonc(raw)
    cache_file.write_text(raw, encoding="utf-8")
    return data


def _load_jsonc(text: str) -> dict:
    """Parse du JSON avec commentaires C-style (les fichiers Mojang en ont)."""
    out: list[str] = []
    i, n = 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        out.append(c)
        i += 1
    return json.loads("".join(out))


# ---------------------------------------------------------------------------
# Widgets OM (le petit namespace maison, génération 100 % déterministe).
# ---------------------------------------------------------------------------

def widget_list_tile() -> dict:
    """Une tuile de liste : bouton 3 états + libellé. Input 100 % vanilla
    (button.menu_select / button.menu_ok) : tactile, manette et clavier OK."""
    return {
        "$slot|default": [180, 23],
        "$align|default": "left",
        "$tile|default": CARD,
        "$tile_hover|default": CARD_HOVER,
        "$tile_press|default": CARD_PRESS,
        "type": "panel",
        "size": "$slot",
        "controls": [
            {
                "om_lt_click": {
                    "type": "button",
                    "size": ["100%", "100%"],
                    "layer": 1,
                    "default_control": "om_lt_off",
                    "hover_control": "om_lt_hover",
                    "pressed_control": "om_lt_press",
                    "sound_name": "random.click",
                    "controls": [
                        {"om_lt_off": {"type": "image", "texture": "$tile", "size": ["100%", "100%"]}},
                        {"om_lt_hover": {"type": "image", "texture": "$tile_hover", "size": ["100%", "100%"]}},
                        {"om_lt_press": {"type": "image", "texture": "$tile_press", "size": ["100%", "100%"]}},
                    ],
                    "bindings": [
                        {"binding_type": "collection_details", "binding_collection_name": "form_buttons"}
                    ],
                    "button_mappings": [
                        {
                            "from_button_id": "button.menu_select",
                            "to_button_id": "button.form_button_click",
                            "mapping_type": "pressed",
                            "button_up": True,
                        },
                        {
                            "from_button_id": "button.menu_ok",
                            "to_button_id": "button.form_button_click",
                            "mapping_type": "focused",
                        },
                    ],
                }
            },
            {
                "om_lt_text": {
                    "type": "label",
                    "text": "#form_button_text",
                    "localize": False,
                    "size": ["100% - 16px", "100%"],
                    "offset": [8, 0],
                    "layer": 9,
                    "text_alignment": "$align",
                    "color": [0.95, 0.93, 0.87],
                    "shadow": True,
                    "anchor_from": "left_middle",
                    "anchor_to": "left_middle",
                    "bindings": [
                        {
                            "binding_name": "#form_button_text",
                            "binding_type": "collection",
                            "binding_collection_name": "form_buttons",
                        }
                    ],
                }
            },
        ],
    }


def widget_list_column() -> dict:
    """Colonne verticale : une tuile par bouton reçu (factory vanilla)."""
    return {
        "type": "stack_panel",
        "orientation": "vertical",
        "size": ["100%", "100%c"],
        "anchor_from": "top_left",
        "anchor_to": "top_left",
        "factory": {"name": "buttons", "control_ids": {"button": "server_form.om_list_tile"}},
        "collection_name": "form_buttons",
        "bindings": [
            {"binding_name": "#form_button_contents", "binding_name_override": "#collection_length"}
        ],
    }


def widget_body_label() -> dict:
    """Panneau de texte du côté droit (bindings #form_button_text[0])."""
    return {
        "type": "label",
        "text": "#form_button_text",
        "localize": False,
        "size": ["100%", "default"],
        "layer": 4,
        "text_alignment": "left",
        "color": [0.95, 0.93, 0.87],
        "shadow": True,
        "anchor_from": "top_left",
        "anchor_to": "top_left",
        "bindings": [
            {
                "binding_name": "#form_button_text",
                "binding_type": "collection",
                "binding_collection_name": "form_buttons",
                "collection_index": 0,
            }
        ],
    }


def widget_menu_panel() -> dict:
    """Le panneau générique des menus à LISTE : variables par thème.
    Colonne de tuiles à gauche, plaque de texte à droite."""
    return {
        "$frame|default": WINDOW,
        "$card|default": CARD,
        "$card_hover|default": CARD_HOVER,
        "$card_press|default": CARD_PRESS,
        "$title_color|default": [0.94, 0.8, 0.47],
        "type": "panel",
        "size": ["100%", "100%"],
        "controls": [
            {"om_menu_window": {"type": "image", "texture": "$frame", "size": ["100%", "100%"]}},
            {
                "om_menu_band": {
                    "type": "image",
                    "texture": BAND,
                    "size": ["100% - 12px", 18],
                    "offset": [6, 6],
                    "layer": 2,
                    "anchor_from": "top_left",
                    "anchor_to": "top_left",
                }
            },
            {
                "om_menu_title": {
                    "type": "label",
                    "text": "#title_text",
                    "localize": False,
                    "size": ["100% - 12px", 18],
                    "offset": [6, 6],
                    "layer": 3,
                    "text_alignment": "center",
                    "color": "$title_color",
                    "shadow": True,
                    "anchor_from": "top_left",
                    "anchor_to": "top_left",
                    "bindings": [{"binding_name": "#title_text"}],
                }
            },
            {
                "om_menu_cards@server_form.om_list_column": {
                    "size": [180, 192],
                    "offset": [6, 26],
                    "anchor_from": "top_left",
                    "anchor_to": "top_left",
                    "$tile": "$card",
                    "$tile_hover": "$card_hover",
                    "$tile_press": "$card_press",
                }
            },
            {
                "om_menu_plate": {
                    "type": "image",
                    "texture": PLATE,
                    "size": ["100% - 198px", 192],
                    "offset": [192, 26],
                    "anchor_from": "top_left",
                    "anchor_to": "top_left",
                    "controls": [
                        {
                            "om_menu_body@server_form.om_body_label": {
                                "size": ["100% - 12px", 182],
                                "offset": [6, 5],
                                "anchor_from": "top_left",
                                "anchor_to": "top_left",
                            }
                        }
                    ],
                }
            },
        ],
    }


def title_equal_binding(title: str) -> list[dict]:
    return [
        {
            "binding_type": "view",
            "source_property_name": f"(#title_text = '{title}')",
            "target_property_name": "#visible",
        }
    ]


def fallback_visible_binding(all_titles: list[str]) -> list[dict]:
    """Le repli vanilla n'est visible QUE si AUCUN menu OM ne matche.

    S'il restait toujours visible, le formulaire vanilla se dessinait SOUS
    notre panneau (artefacts « en bas des menus » des captures). L'expression
    est générée depuis la liste des titres : impossible qu'elle dérive.
    """
    conditions = " && ".join(f"(!(#title_text = '{t}'))" for t in all_titles)
    return [
        {
            "binding_type": "view",
            "source_property_name": conditions,
            "target_property_name": "#visible",
        }
    ]


def root_panel(name: str, title: str, panel_ref: str, size: tuple[int, int]) -> dict:
    return {
        name: {
            "type": "panel",
            "size": ["100%", "100%"],
            "bindings": title_equal_binding(title),
            "controls": [
                {
                    f"{name}_center@{panel_ref}": {
                        "size": list(size),
                        "anchor_from": "center",
                        "anchor_to": "center",
                    }
                }
            ],
        }
    }


# ---------------------------------------------------------------------------
# Assemblage des panneaux OM indexés (un contrôle par index de collection).
# ---------------------------------------------------------------------------

def tile_control(index: int, slot: tuple[int, int], offset: tuple[int, int]) -> dict:
    """Une tuile NUMÉROTÉE : lit form_button_text[index], envoie button[index]."""
    w, h = slot
    x, y = offset
    return {
        f"om_tile_{index}@server_form.om_list_tile": {
            "size": [w, h],
            "offset": [x, y],
            "anchor_from": "top_left",
            "anchor_to": "top_left",
            "bindings": [
                {"binding_type": "collection_details", "binding_collection_name": "form_buttons"}
            ],
            "controls": [
                {
                    "om_lt_text": {
                        "type": "label",
                        "text": "#form_button_text",
                        "localize": False,
                        "size": ["100% - 16px", "100%"],
                        "offset": [8, 0],
                        "layer": 9,
                        "text_alignment": "left",
                        "color": [0.95, 0.93, 0.87],
                        "shadow": True,
                        "anchor_from": "left_middle",
                        "anchor_to": "left_middle",
                        "bindings": [
                            {
                                "binding_name": "#form_button_text",
                                "binding_type": "collection",
                                "binding_collection_name": "form_buttons",
                                "collection_index": index,
                            }
                        ],
                    }
                }
            ],
        }
    }


def data_label(name: str, index: int, rect: tuple[int, int, int, int], align: str = "left", color: list | None = None) -> dict:
    """Étiquette de données : lit un bouton invisible (index) sans le rendre cliquable."""
    w, h, x, y = rect
    return {
        name: {
            "type": "label",
            "text": "#form_button_text",
            "localize": False,
            "size": [w, h],
            "offset": [x, y],
            "layer": 5,
            "text_alignment": align,
            "color": color or [0.95, 0.93, 0.87],
            "shadow": True,
            "anchor_from": "top_left",
            "anchor_to": "top_left",
            "bindings": [
                {
                    "binding_name": "#form_button_text",
                    "binding_type": "collection",
                    "binding_collection_name": "form_buttons",
                    "collection_index": index,
                }
            ],
        }
    }


def indexed_panel(title: str, layout: dict) -> dict:
    """Panneau à emplacements numérotés : le contrat définit TOUTES les positions.
    Fenêtre or + bandeau + tuiles posées à la main + étiquettes de données."""
    actions = layout["actions"]
    data = layout["data"]
    controls: list[dict] = []
    # Fenêtre + bandeau + titre
    controls.append({"om_window": {"type": "image", "texture": WINDOW, "size": ["100%", "100%"]}})
    controls.append(
        {
            "om_band": {
                "type": "image",
                "texture": BAND,
                "size": ["100% - 12px", 18],
                "offset": [6, 6],
                "layer": 2,
                "anchor_from": "top_left",
                "anchor_to": "top_left",
            }
        }
    )
    controls.append(
        {
            "om_title": {
                "type": "label",
                "text": "#title_text",
                "localize": False,
                "size": ["100% - 12px", 18],
                "offset": [6, 6],
                "layer": 3,
                "text_alignment": "center",
                "color": [0.94, 0.8, 0.47],
                "shadow": True,
                "anchor_from": "top_left",
                "anchor_to": "top_left",
                "bindings": [{"binding_name": "#title_text"}],
            }
        }
    )
    # Colonne d'actions (une tuile par action, posée verticalement)
    y = 28
    for i in range(len(actions)):
        controls.append(tile_control(i, (180, 23), (6, y)))
        y += 24
    # Étiquettes de données (texte transporté, non cliquable)
    base = len(actions)
    for k, key in enumerate(data):
        idx = base + k
        controls.append(data_label(f"om_data_{key}", idx, (100, 20, 192, 30 + k * 22)))
    # Décorations spécifiques (drapeau du clan, dérivées du contrat).
    if title == "Mon clan":
        controls.extend(clan_panel_decoration(layout))
    return {"type": "panel", "size": ["100%", "100%"], "controls": controls}



def widget_flag_image() -> dict:
    """Une image de drapeau, affichée si le bouton data porte son token."""
    return {
        "$tex|default": "textures/ui/om_flag_rouge",
        "type": "image",
        "texture": "$tex",
        "size": ["100%", "100%"],
    }


def clan_flag_controls(flag_index: int) -> list[dict]:
    """Les 11 drapeaux superposés, visibles selon le token du bouton data."""
    controls: list[dict] = []
    for color in FLAGS:
        controls.append(
            {
                "om_flag_%s@server_form.om_flag_image" % color: {
                    "collection_index": flag_index,
                    "$tex": "textures/ui/om_flag_%s" % color,
                    "bindings": [
                        {
                            "binding_name": "#form_button_text",
                            "binding_type": "collection",
                            "binding_collection_name": "form_buttons",
                        },
                        {
                            "binding_type": "view",
                            "source_property_name": "(#form_button_text = 'FLAG:%s')" % color,
                            "target_property_name": "#visible",
                        },
                    ],
                }
            }
        )
    return controls


def clan_panel_decoration(layout: dict) -> list[dict]:
    """Décoration du panneau « Mon clan » : cadres banque/drapeau + rendu du
    drapeau courant. L'index de collection du drapeau est DÉRIVÉ du contrat :
    base = nombre d'actions, offset = position de 'flag_id' dans data."""
    actions = layout["actions"]
    data = layout["data"]
    flag_index = len(actions) + data.index("flag_id")
    controls: list[dict] = []
    # Cadre du drapeau + son rendu conditionnel
    controls.append(
        {
            "om_clan_flag_frame": {
                "type": "image",
                "texture": "textures/ui/om_slot_empty",
                "size": [52, 36],
                "offset": [230, 22],
                "anchor_from": "top_left",
                "anchor_to": "top_left",
            }
        }
    )
    controls.append(
        {
            "om_clan_flag": {
                "type": "panel",
                "size": [44, 28],
                "offset": [234, 26],
                "layer": 3,
                "anchor_from": "top_left",
                "anchor_to": "top_left",
                "collection_name": "form_buttons",
                "controls": clan_flag_controls(flag_index),
            }
        }
    )
    return controls


# ---------------------------------------------------------------------------
# Fusion vanilla + OM
# ---------------------------------------------------------------------------

def build(vanilla: dict, contract: dict) -> dict:
    d = dict(vanilla)  # copie de surface : on ne remplace QUE ce qui est listé
    tile_menus = contract  # {"indexed": {...}, "generic": [...]}

    # 1. custom_form : habillage via la variable officielle, EN PLACE
    #    (muter la définition vanilla au lieu d'en déclarer une seconde —
    #    un second « custom_form » créerait un duplicate interdit).
    d["custom_form@common_dialogs.main_panel_no_buttons"]["$custom_background"] = WINDOW

    # 2. dynamic_button : habillage des 3 états (les widgets vanilla de la
    #    factory generated_contents s'habillent, la structure ne bouge pas).
    db = d["dynamic_button"]
    db.setdefault("$texture|default", CARD)
    db.setdefault("$hover_texture|default", CARD_HOVER)
    db.setdefault("$pressed_texture|default", CARD_PRESS)

    # 3. Widgets OM
    d["om_list_tile"] = widget_list_tile()
    d["om_list_column"] = widget_list_column()
    d["om_body_label"] = widget_body_label()
    d["om_flag_image"] = widget_flag_image()
    d["om_menu_panel"] = widget_menu_panel()

    # 4. long_form : notre routing REMPLACE la définition vanilla en place,
    #    et une copie PROFONDE intacte devient le repli (aucun match OM).
    lf_key = "long_form@common_dialogs.main_panel_no_buttons"
    roots: list[dict] = []

    # Panneaux indexés
    indexed_sizes: dict[str, tuple[int, int]] = {
        "Classes": (340, 236),
        "Mon clan": (300, 224),
        "Menu": (300, 220),
        "Administration": (300, 220),
        "Nations": (300, 216),
        "Mes infos": (300, 216),
        "Le Monde": (340, 236),
    }
    for title, layout in tile_menus["indexed"].items():
        panel = f"om_panel_{_slug(title)}"
        d[panel] = indexed_panel(title, layout)
        roots.append(root_panel(f"om_root_{_slug(title)}", f"NaLandia » {title}", f"server_form.{panel}", indexed_sizes[title]))

    # Menus à liste (un root par thème, tous sur om_menu_panel)
    for title in tile_menus["generic"]:
        theme = MENU_THEMES[title]
        frame = f"textures/ui/om_menu_{theme}_bg"
        d[f"om_panel_{_slug(title)}"] = dict(d["om_menu_panel"])
        d[f"om_panel_{_slug(title)}"]["$frame"] = frame
        roots.append(root_panel(f"om_root_{_slug(title)}", f"NaLandia » {title}", f"server_form.om_panel_{_slug(title)}", (330, 236)))

    # Repli : copie PROFONDE et intacte de la définition vanilla — les
    # formulaires des autres add-ons et les titres inconnus gardent leur
    # rendu natif, sans jamais voir notre namespace. Masqué quand un menu
    # OM matche (sinon le vanilla se dessine SOUS notre panneau).
    fallback = copy.deepcopy(d[lf_key])
    all_titles = [f"NaLandia » {t}" for t in [*tile_menus["indexed"], *tile_menus["generic"]]]
    fallback["bindings"] = fallback_visible_binding(all_titles)
    roots.append({"om_default_form@common_dialogs.main_panel_no_buttons": fallback})

    routed = dict(d[lf_key])
    routed["controls"] = roots
    d[lf_key] = routed
    return d


def _slug(title: str) -> str:
    return (
        title.replace(" ", "_")
        .replace("é", "e")
        .replace("è", "e")
        .replace("à", "a")
        .replace("ç", "c")
        .lower()
    )


# ---------------------------------------------------------------------------
# Validation stricte
# ---------------------------------------------------------------------------

def validate(d: dict) -> list[str]:
    errors: list[str] = []

    # a) aucun duplicate "X" / "X@parent"
    bases: dict[str, list[str]] = {}
    for key in d:
        if key == "namespace":
            continue
        base = key.split("@")[0]
        bases.setdefault(base, []).append(key)
    for base, keys in bases.items():
        if len(keys) > 1:
            errors.append(f"duplicate definitions for '{base}': {keys}")

    # b) chaque référence "server_form.X" se résout
    known = {k.split("@")[0] for k in d}

    def walk(node, where: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and v.startswith("server_form."):
                    target = v.split(".", 1)[1]
                    if target not in known:
                        errors.append(f"{where}: unresolvable ref '{v}'")
                walk(v, where)
        elif isinstance(node, list):
            for item in node:
                walk(item, where)

    walk(d, "<root>")

    # c) références locales "om_*@" sans définition
    for key in d:
        if "@" in key:
            parent = key.split("@", 1)[1]
            if parent.startswith("server_form."):
                target = parent.split(".", 1)[1]
                if target not in known:
                    errors.append(f"'{key}': unresolvable parent '{parent}'")

    # d) textures om_* existent
    def check_textures(node, where: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "texture" and isinstance(v, str) and "/om_" in v:
                    # Les chemins de texture sont relatifs à la racine du RP.
                    base = RP_TEXTURES.parent / v.lstrip("/")
                    if not any(base.with_suffix(ext).exists() for ext in (".png", ".json", ".tga")):
                        errors.append(f"{where}: texture absente {v}")
                check_textures(v, where)
        elif isinstance(node, list):
            for item in node:
                check_textures(item, where)

    check_textures(d, "<root>")
    return errors


# ---------------------------------------------------------------------------
# Écriture conditionnelle
# ---------------------------------------------------------------------------

def write_if_changed(path: Path, content: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        print(f"[build_ui] {path.name} : inchangé")
        return False
    path.write_text(content, encoding="utf-8")
    print(f"[build_ui] {path.name} : écrit")
    return True


def main() -> None:
    offline = "--offline" in sys.argv
    contract = load_tile_contract()
    vanilla = load_vanilla(offline)
    d = build(vanilla, contract)
    errors = validate(d)
    if errors:
        print("[build_ui] VALIDATION FAILED:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    content = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    write_if_changed(RP_UI / "server_form.json", content)
    print(f"[build_ui] OK — {len(d)} définitions")


if __name__ == "__main__":
    main()
