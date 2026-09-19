#!/usr/bin/env python3
"""
Génère RP/ui/server_form.json — LE fichier UI du serveur.

Méthode « vanilla-first » (celle des packs de production) :
  1. La base est le server_form.json OFFICIEL de Mojang (1.26.50), mis en
     cache dans scripts/vanilla_server_form.json. On ne le réécrit jamais à
     la main : on part du vrai fichier et on applique des modifications
     ciblées, listées ci-dessous.
  2. Les points de contact (rien d'autre) :
       - fenêtres élargies (long_form / custom_form) ;
       - titre doré ;
       - boutons vanilla re-texturés avec nos dalles om_btn (3 états) ;
       - contrôle om_focus_button (navigation clavier/manette du réseau).
  3. Validation stricte (exit 1) : chaque texture référencée existe dans
     RP/, aucune définition dupliquée, les définitions vanilla que le jeu
     attend restent présentes.

Le JSON n'est réécrit QUE s'il change (mtime stable pour le watch).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RP = ROOT / "RP"
VANILLA = Path(__file__).resolve().parent / "vanilla_server_form.json"
OUT = RP / "ui" / "server_form.json"

WINDOW_SIZE = [430, 252]
FORM_SIZE = [300, 240]
TITLE_GOLD = [1.0, 0.667, 0.0]
CARD_HEIGHT = 32
TEXT_MAX = ["100%", 20]
TEXT_COLOR = [0.96, 0.96, 0.96]

# Définitions vanilla que ce fichier ne redéclare PAS (elles restent lues
# dans ui_common.json ; c'est le cas vanilla).
EXCLUDE_IDS = {
    "dynamic_label",
    "dynamic_header",
    "custom_label",
    "custom_header",
    "custom_toggle",
    "custom_slider",
    "custom_step_slider",
    "custom_dropdown_content",
    "custom_dropdown_radio",
    "custom_multiselect",
    "custom_multiselect_checkbox",
    "custom_input",
}

# ---------------------------------------------------------------------------
# Contrôle bouton : copie autonome du pattern vanilla (common.button +
# common_buttons.light_text_button) re-texturé avec nos dalles om_btn.
# Texte de collection ($button_text) OU littéral ($om_label) : $om_text_src.
# ---------------------------------------------------------------------------
OM_BUTTON = {
    "type": "button",
    "$focus_id|default": "",
    "$focus_override_down|default": "",
    "$focus_override_up|default": "",
    "$focus_override_left|default": "",
    "$focus_override_right|default": "",
    "focus_identifier": "$focus_id",
    "focus_change_down": "$focus_override_down",
    "focus_change_up": "$focus_override_up",
    "focus_change_left": "$focus_override_left",
    "focus_change_right": "$focus_override_right",
    "focus_enabled": True,
    "focus_magnet_enabled": True,
    "focus_wrap_enabled": True,
    "$button_tts_name|default": "accessibility.button.tts.title",
    "$button_tts_header|default": "menu",
    "tts_name": "$button_tts_name",
    "tts_control_header": "$button_tts_header",
    "sound_name": "random.click",
    "default_control": "default",
    "hover_control": "hover",
    "pressed_control": "pressed",
    "button_mappings": [
        {"from_button_id": "button.menu_select", "to_button_id": "$pressed_button_name", "mapping_type": "pressed"},
        {"from_button_id": "button.menu_ok", "to_button_id": "$pressed_button_name", "mapping_type": "focused"},
    ],
    "controls": [
        {
            "default": {
                "type": "image",
                "layer": 1,
                "texture": "$om_btn_default",
                "size": ["100%", "100%"],
            }
        },
        {
            "hover": {
                "type": "image",
                "layer": 2,
                "texture": "$om_btn_hover",
                "size": ["100%", "100%"],
            }
        },
        {
            "pressed": {
                "type": "image",
                "layer": 3,
                "texture": "$om_btn_pressed",
                "size": ["100%", "100%"],
            }
        },
        {
            "label": {
                "type": "label",
                "layer": 4,
                "color": "$om_text_color",
                "text": "$om_text_src",
                "text_alignment": "center",
                "anchor_from": "center",
                "anchor_to": "center",
                "size": ["100%", "default"],
                "max_size": "$om_text_max",
                "shadow": True,
                "font_size": "normal",
            }
        },
    ],
}

# Bouton « réseau » : zone cliquable invisible pour les flèches de focus.
OM_FOCUS_BUTTON = {
    "type": "button",
    "size": [12, 12],
    "layer": 40,
    "visible": False,
    "$focus_id|default": "",
    "$focus_override_down|default": "",
    "$focus_override_up|default": "",
    "$focus_override_left|default": "",
    "$focus_override_right|default": "",
    "focus_identifier": "$focus_id",
    "focus_change_down": "$focus_override_down",
    "focus_change_up": "$focus_override_up",
    "focus_change_left": "$focus_override_left",
    "focus_change_right": "$focus_override_right",
    "focus_magnet_enabled": True,
    "default_focus_precedence": -1000000,
    "button_mappings": [
        {"from_button_id": "button.menu_select", "to_button_id": "$pressed_button_name", "mapping_type": "pressed"},
        {"from_button_id": "button.menu_ok", "to_button_id": "$pressed_button_name", "mapping_type": "focused"},
    ],
}


def om_dynamic_button() -> dict:
    """dynamic_button vanilla : l'image de gauche est conservée (drapeaux,
    icônes des drapeaux de clan), le bouton reçoit nos dalles om_btn."""
    return {
        "type": "stack_panel",
        "size": ["100%", CARD_HEIGHT],
        "orientation": "horizontal",
        "controls": [
            {
                "panel_name": {
                    "type": "panel",
                    "size": [34, "100%c"],
                    "bindings": [
                        {
                            "binding_type": "view",
                            "source_control_name": "image",
                            "resolve_sibling_scope": True,
                            "source_property_name": "(not (#texture = ''))",
                            "target_property_name": "#visible",
                        }
                    ],
                    "controls": [
                        {
                            "image": {
                                "type": "image",
                                "layer": 2,
                                "size": [32, 32],
                                "bindings": [
                                    {
                                        "binding_name": "#form_button_texture",
                                        "binding_name_override": "#texture",
                                        "binding_type": "collection",
                                        "binding_collection_name": "form_buttons",
                                    },
                                    {
                                        "binding_name": "#form_button_texture_file_system",
                                        "binding_name_override": "#texture_file_system",
                                        "binding_type": "collection",
                                        "binding_collection_name": "form_buttons",
                                    },
                                    {
                                        "binding_type": "view",
                                        "source_property_name": "(not ((#texture = '') or (#texture = 'loading')))",
                                        "target_property_name": "#visible",
                                    },
                                ],
                            }
                        }
                    ],
                }
            },
            {
                "form_button@server_form.om_button": {
                    "$pressed_button_name": "button.form_button_click",
                    "anchor_from": "top_left",
                    "anchor_to": "top_left",
                    "size": ["fill", CARD_HEIGHT],
                    "$button_text": "#form_button_text",
                    "$om_text_src": "#form_button_text",
                    "$om_btn_default": "textures/ui/om_btn",
                    "$om_btn_hover": "textures/ui/om_btn_hover",
                    "$om_btn_pressed": "textures/ui/om_btn_press",
                    "$om_text_color": TEXT_COLOR,
                    "$om_text_max": TEXT_MAX,
                    "$button_text_binding_type": "collection",
                    "$button_binding_condition": "always",
                    "$button_text_grid_collection_name": "form_buttons",
                    "bindings": [
                        {
                            "binding_type": "collection_details",
                            "binding_collection_name": "form_buttons",
                        }
                    ],
                }
            },
        ],
    }


def om_submit_button() -> dict:
    """Bouton « Valider » des formulaires à champs, même habillage."""
    return {
        "type": "button",
        "$pressed_button_name": "button.submit_custom_form",
        "size": ["100%", CARD_HEIGHT],
        "layer": 2,
        "$button_text": "#submit_text",
        "$om_text_src": "#submit_text",
        "$om_btn_default": "textures/ui/om_btn",
        "$om_btn_hover": "textures/ui/om_btn_hover",
        "$om_btn_pressed": "textures/ui/om_btn_press",
        "$om_text_color": TEXT_COLOR,
        "$om_text_max": TEXT_MAX,
        "$button_text_binding_type": "global",
        "$button_binding_condition": "once",
        "bindings": [{"binding_name": "#submit_button_visible", "binding_name_override": "#visible"}],
    }


def load_vanilla() -> dict:
    raw = VANILLA.read_text(encoding="utf-8")
    raw = re.sub(r"^\s*//.*$", "", raw, flags=re.M)
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    data = json.loads(raw)
    namespace = data.pop("namespace")
    assert namespace == "server_form", namespace
    return data


def with_namespace(data: dict, namespace: str = "server_form") -> dict:
    """JSON UI : un fichier DOIT déclarer son namespace (première clé)."""
    return {"namespace": namespace, **data}


def base_id(key: str) -> str:
    return key.split("@")[0]


def find_key(data: dict, base: str) -> str:
    for key in data:
        if base_id(key) == base:
            return key
    raise KeyError(base)


def apply(data: dict) -> dict:
    # 1) Fenêtres élargies + titre doré.
    for base, size in (("long_form", WINDOW_SIZE), ("custom_form", FORM_SIZE)):
        key = find_key(data, base)
        data[key]["size"] = size
        data[key]["$title_text_color"] = TITLE_GOLD
        data[key]["$panel_indent_size"] = ["100% - 18px", "100% - 34px"]

    # 2) Nos contrôles.
    data["om_button"] = OM_BUTTON
    data["om_focus_button"] = OM_FOCUS_BUTTON
    data["dynamic_button"] = om_dynamic_button()
    data["om_submit_button"] = om_submit_button()

    # 3) Le submit des formulaires à champs passe sur notre habillage
    #    (même structure vanilla : un contrôle dans le stack_panel).
    controls = data[find_key(data, "custom_form_scrolling_content")]["controls"]
    for index, control in enumerate(controls):
        if "submit_button@common_buttons.light_text_button" in control:
            controls[index] = {"submit_button@server_form.om_submit_button": {}}
            break

    return data


def validate(data: dict) -> None:
    # Définitions dupliquées : LE bug historique de ce dépôt, interdit.
    ids = [key.split("@")[0] for key in data]
    dupes = {name for name in ids if ids.count(name) > 1}
    if dupes:
        raise SystemExit(f"[build_server_form] définitions dupliquées : {sorted(dupes)}")

    # Les définitions vanilla attendues par le jeu restent toutes là
    # (mêmes clés que le fichier officiel : on n'en retire aucune).
    vanilla = load_vanilla()
    missing = [key for key in vanilla if key not in data]
    if missing:
        raise SystemExit(f"[build_server_form] définitions vanilla manquantes : {missing}")

    # Héritages internes résolus (chaque `X@server_form.Y` trouve son Y).
    local = {key.split("@")[0] for key in data}
    for key, definition in data.items():
        for match in re.findall(r"@server_form\.([A-Za-z0-9_]+)", json.dumps(definition)):
            if match not in local:
                raise SystemExit(f"[build_server_form] héritage cassé : {key} → {match}")

    # Chaque texture référencée doit exister dans RP/.
    blob = json.dumps(data)
    for name in sorted(set(re.findall(r"textures/ui/([A-Za-z0-9_]+)", blob))):
        if not (RP / "textures" / "ui" / f"{name}.png").exists():
            raise SystemExit(f"[build_server_form] texture absente du RP : {name}")


def main() -> None:
    data = load_vanilla()
    data = apply(data)
    validate(data)
    data = with_namespace(data)

    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if OUT.exists() and OUT.read_text(encoding="utf-8") == text:
        print("[build_server_form] inchangé.")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"[build_server_form] écrit : {OUT.relative_to(ROOT)} ({len(text)} octets)")


if __name__ == "__main__":
    main()
