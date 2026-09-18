#!/usr/bin/env python3
"""Génère les textures UI du Resource Pack NaLandia — SANS dépendance externe.

Écrit des PNG 8-bit RGBA à la main (struct + zlib depuis la stdlib).

Thème NaLandia : panneaux noirs/charbon, ornements OR (accents chauds) et
ARGENT (cadres froids), SURBRILLANCE dorée marquée au survol des boutons,
fioritures (arabesques) aux coins des grands cadres et des panneaux internes.

v18 : les coins sont NETS — plus aucun carré/perle flottant (« ça fait
chelou ») : les cadres se rejoignent par un onglet propre à 45° (façon
jointure de cadre), les boutons ont des angles droits sobres.

Sortie :
  RP/textures/ui/om_actionbar_bg.png  fond d'actionbar (hud_screen.json)
  RP/textures/ui/om_ornate_bg.png     grand cadre orné (coins à arabesques)
  RP/textures/ui/om_sheet_bg.png      grand cadre variante « FICHES » (émeraude)
  RP/textures/ui/om_content_bg.png    panneau interne argenté (coins perlés)
  RP/textures/ui/om_sheet_pane.png    panneau interne des fiches (filet or)
  RP/textures/ui/om_header_band.png   bandeau de section (filet or/argent)
  RP/textures/ui/om_btn*.png          tuiles-boutons 3 états (surbrillance or)
  RP/textures/ui/om_card*.png         GRANDES CARTES 3 états de la variante « fiches »
  RP/textures/ui/om_btn_back*.png     flèche retour (icône 26px, 2 états)
  RP/pack_icon.png

Usage: python3 scripts/make_ui_textures.py
"""
import json
import struct
import zlib
from pathlib import Path

RP_ROOT = Path(__file__).resolve().parent.parent / "RP"

# ---------------------------------------------------------------------------
# Palette NaLandia : noir profond, or chaud, argent froid
# ---------------------------------------------------------------------------
BLACK = (16, 15, 17)          # fond des panneaux (noir chaud)
CHARCOAL = (26, 25, 28)       # fond des boutons (charbon)
CHARCOAL_LIGHT = (40, 37, 41)  # fond des boutons au survol
INK = (10, 10, 12)            # contours les plus sombres
GOLD = (212, 175, 88)         # or principal (bordures, ornements)
GOLD_LIGHT = (244, 214, 132)  # or clair (surbrillance, points lumineux)
GOLD_DIM = (150, 120, 58)     # or assombri (ombres des ornements)
EMERALD = (34, 62, 50)        # vert profond des fiches (variante « fiches »)
EMERALD_DIM = (18, 34, 28)    # vert profond assombri (bords)
SILVER = (176, 182, 192)      # argent principal (cadres internes, texte)
SILVER_DIM = (110, 116, 128)  # argent assombri
SILVER_BRIGHT = (220, 226, 236)  # argent lumineux (perles des coins)
WHITE = (242, 242, 242)


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *px) for px in row) for row in pixels
    )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"  + {path.relative_to(RP_ROOT.parent)} ({width}x{height})")


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


# ---------------------------------------------------------------------------
# Boutons « tuile » 3 états — charbon, cadre or, SURBRILLANCE au survol
# ---------------------------------------------------------------------------
def button_tiles() -> None:
    """3 états pour les boutons des formulaires :
    - om_btn        : charbon + cadre or sombre
    - om_btn_hover  : cadre or VIF + liseré doré large + cœur doré marqué
    - om_btn_press  : enfoncé, cadre or clair, fond plus sombre
    Tuiles 48x48, nineslice 10px (le JSON UI passe l'image par om_btn_image
    avec le même nineslice — bords or uniformes quelle que soit la largeur)."""
    tw = th = 48
    ns = 10

    def tile(fill: tuple[int, int, int], frame: tuple[int, int, int],
             glow: tuple[int, int, int] | None, grain_mod: int) -> list[list[tuple[int, int, int, int]]]:
        px: list[list[tuple[int, int, int, int]]] = []
        for y in range(th):
            row: list[tuple[int, int, int, int]] = []
            for x in range(tw):
                edge = min(x, y, tw - 1 - x, th - 1 - y)
                if edge == 0:
                    row.append((*INK, 255))                    # contour noir
                elif edge in (1, 2):
                    row.append((*frame, 255))                  # cadre or
                elif edge == 3:
                    row.append((*lerp(frame, fill, 0.6), 255))  # raccord
                else:
                    g = ((x * 5 + y * 11) % grain_mod) - grain_mod // 2
                    row.append((max(0, fill[0] + g), max(0, fill[1] + g), max(0, fill[2] + g), 255))
            px.append(row)
        # Surbrillance marquée (hover) : cœur doré ample + halos près des bords.
        if glow is not None:
            for y in range(ns + 2, th - ns - 2):
                for x in range(ns + 2, tw - ns - 2):
                    dx = (x - tw / 2) / (tw / 2)
                    dy = (y - th / 2) / (th / 2)
                    t = max(0.0, 1.0 - (dx * dx + dy * dy) * 2.0)
                    if t > 0:
                        px[y][x] = (*lerp(px[y][x][:3], glow, t * 0.42), 255)
            # Liseré lumineux juste à l'intérieur du cadre (glow border).
            for i in range(th):
                for j in (4, tw - 5):
                    px[i][j] = (*lerp(px[i][j][:3], glow, 0.30), 255)
            for j in range(tw):
                for i in (4, th - 5):
                    px[i][j] = (*lerp(px[i][j][:3], glow, 0.30), 255)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_btn.png", tw, th, tile(CHARCOAL, GOLD_DIM, None, 4))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_hover.png", tw, th, tile(CHARCOAL_LIGHT, GOLD_LIGHT, GOLD_LIGHT, 3))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_press.png", tw, th, tile((20, 19, 22), GOLD, None, 3))


# ---------------------------------------------------------------------------
# Panneaux principaux — grand cadre orné (fioritures) + panneau interne
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# GRANDES CARTES de la variante « fiches » — silhouette différente des tuiles
# ---------------------------------------------------------------------------
def card_tiles() -> None:
    """3 états pour les cartes des menus de contenu (Classes, États, Clans,
    Monde, Mines, Métiers, Mes infos) : grandes dalles pleine largeur, marge
    transparente de 2 px (les cartes sont donc espacées), cadre OR et BARRE
    D'ACCENT dorée de 4 px le long du bord gauche. Rien à voir avec les tuiles
    fines des menus hub/admin : c'est la géométrie ET la texture qui changent.

    Tuiles 48x48, nineslice 10 : la barre d'accent (x 5..8) et le cadre sont
    entièrement dans les tranches fixes, donc nets quelle que soit la largeur."""
    tw = th = 48
    fill = (26, 36, 31)          # vert charbon (fond de carte)

    def card(base: tuple[int, int, int], frame: tuple[int, int, int],
             accent: tuple[int, int, int], glow: tuple[int, int, int] | None,
             grain_mod: int) -> list[list[tuple[int, int, int, int]]]:
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * tw for _ in range(th)]
        for y in range(th):
            for x in range(tw):
                edge = min(x, y, tw - 1 - x, th - 1 - y)
                if edge <= 1:
                    continue                                   # marge transparente
                if edge in (2, 3):
                    px[y][x] = (*frame, 255)                   # cadre
                elif edge == 4:
                    px[y][x] = (*lerp(base, SILVER_DIM, 0.35), 255)  # filet interne
                else:
                    g = ((x * 7 + y * 11) % grain_mod) - grain_mod // 2
                    px[y][x] = (max(0, base[0] + g), max(0, base[1] + g), max(0, base[2] + g), 255)
        # Halo doré (survol) : cœur éclairci + liseré lumineux intérieur.
        if glow is not None:
            for y in range(5, th - 5):
                for x in range(10, tw - 5):
                    dx = (x - tw * 0.55) / (tw / 2)
                    dy = (y - th / 2) / (th / 2)
                    t = max(0.0, 1.0 - (dx * dx + dy * dy) * 2.2)
                    if t > 0:
                        px[y][x] = (*lerp(px[y][x][:3], glow, t * 0.40), 255)
            for i in range(5, th - 5):
                px[i][5] = (*lerp(px[i][5][:3], glow, 0.35), 255)
                px[i][tw - 6] = (*lerp(px[i][tw - 6][:3], glow, 0.30), 255)
        # Barre d'accent verticale (bord gauche) — marqueur visuel des cartes.
        for y in range(5, th - 5):
            for x in range(6, 10):
                px[y][x] = (*accent, 255)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_card.png", tw, th,
              card(fill, GOLD_DIM, GOLD, None, 4))
    write_png(RP_ROOT / "textures" / "ui" / "om_card_hover.png", tw, th,
              card((38, 52, 45), GOLD_LIGHT, GOLD_LIGHT, GOLD_LIGHT, 3))
    write_png(RP_ROOT / "textures" / "ui" / "om_card_press.png", tw, th,
              card((18, 26, 22), GOLD, GOLD_LIGHT, None, 3))


def draw_miter(
    px: list[list[tuple[int, int, int, int]]],
    w: int,
    h: int,
    accents: list[tuple[int, tuple[int, int, int]]],
) -> None:
    """Dessine un onglet propre à 45° dans chaque coin (façon jointure de
    cadre) : remplace les anciennes perles/arabesques qui rendaient en
    carrés étirés disgracieux. `accents` = liste (distance diagonale, couleur)."""
    for cx, cy, sx, sy in ((0, 0, 1, 1), (w - 1, 0, -1, 1), (0, h - 1, 1, -1), (w - 1, h - 1, -1, -1)):
        for d, color in accents:
            for i in range(d + 1):
                x = cx + sx * i
                y = cy + sy * (d - i)
                if 0 <= x < w and 0 <= y < h:
                    px[y][x] = (*color, 255)


def ornate_textures() -> None:
    # ---- Grand cadre 128x128 (nineslice 12px) : cuir sombre, cadre or/argent,
    #      coins à onglet 45° (or clair sur la bande or, argent sur le filet). ----
    w = h = 128
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        row: list[tuple[int, int, int, int]] = []
        for x in range(w):
            d = ((x - w / 2) ** 2 + (y - h / 2) ** 2) ** 0.5 / (w / 2)
            base = lerp((34, 33, 35), (22, 21, 24), min(1.0, d))
            grain = ((x * 7 + y * 13) % 5) - 2
            base = (max(0, base[0] + grain), max(0, base[1] + grain), max(0, base[2] + grain))
            row.append((*base, 255))
        px.append(row)

    # Cadre : noir (extérieur) → OR (liseré) → argent (interne) → ombre.
    for y in range(h):
        for x in range(w):
            edge = min(x, y, w - 1 - x, h - 1 - y)
            if edge <= 1:
                px[y][x] = (14, 13, 15, 255)
            elif edge <= 3:
                px[y][x] = (*lerp(GOLD, GOLD_DIM, (x + y) / (w + h)), 255)
            elif edge == 4:
                px[y][x] = (*lerp(SILVER_DIM, SILVER, (x + y) / (w + h)), 255)
            elif edge == 5:
                px[y][x] = (30, 29, 32, 255)

    # Coins à onglet : la bande or et le filet argent se rejoignent à 45°.
    draw_miter(px, w, h, [(3, GOLD_LIGHT), (4, SILVER)])

    write_png(RP_ROOT / "textures" / "ui" / "om_ornate_bg.png", w, h, px)

    # ---- Grand cadre « CARTES » 128x128 (nineslice 12px) : variante
    #      distinction visuelle pour Le Monde / Classes / fiches de clan —
    #      corps bleu nuit, double filet ARGENT extérieur + OR intérieur,
    #      coins à onglet inversés (argent clair sur la bande argent).
    px2: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        row2: list[tuple[int, int, int, int]] = []
        for x in range(w):
            d = ((x - w / 2) ** 2 + (y - h / 2) ** 2) ** 0.5 / (w / 2)
            base = lerp((30, 34, 44), (20, 23, 31), min(1.0, d))   # bleu nuit
            grain = ((x * 7 + y * 13) % 5) - 2
            base = (max(0, base[0] + grain), max(0, base[1] + grain), max(0, base[2] + grain))
            row2.append((*base, 255))
        px2.append(row2)
    for y in range(h):
        for x in range(w):
            edge = min(x, y, w - 1 - x, h - 1 - y)
            if edge <= 1:
                px2[y][x] = (12, 13, 18, 255)
            elif edge <= 3:
                px2[y][x] = (*lerp(SILVER, SILVER_DIM, (x + y) / (w + h)), 255)
            elif edge == 4:
                px2[y][x] = (*lerp(GOLD_DIM, GOLD, (x + y) / (w + h)), 255)
            elif edge == 5:
                px2[y][x] = (28, 31, 40, 255)
    draw_miter(px2, w, h, [(3, SILVER_BRIGHT), (4, GOLD)])
    write_png(RP_ROOT / "textures" / "ui" / "om_cards_bg.png", w, h, px2)

    # ---- Grand cadre « FICHES » 128x128 (nineslice 12px) : variante des
    #      menus de contenu (Classes, États, Clans, Monde, Mines, Métiers,
    #      Mes infos) — corps VERT PROFOND, double filet large OR extérieur +
    #      ARGENT intérieur séparés par un joint sombre : la silhouette du
    #      cadre elle-même change, pas seulement la teinte. Cette texture
    #      n'est affichée que si le titre du formulaire est reconnu par
    #      om_sheets.json (voir ce fichier), donc les menus hub/admin gardent
    #      le cuir orné « classique ».
    fx: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        rowf: list[tuple[int, int, int, int]] = []
        for x in range(w):
            d = ((x - w / 2) ** 2 + (y - h / 2) ** 2) ** 0.5 / (w / 2)
            base = lerp(EMERALD, EMERALD_DIM, min(1.0, d))
            grain = ((x * 11 + y * 5) % 5) - 2
            base = (max(0, base[0] + grain), max(0, base[1] + grain), max(0, base[2] + grain))
            rowf.append((*base, 255))
        fx.append(rowf)
    for y in range(h):
        for x in range(w):
            edge = min(x, y, w - 1 - x, h - 1 - y)
            if edge == 0:
                fx[y][x] = (10, 14, 12, 255)                     # contour noir-vert
            elif edge in (1, 2):
                fx[y][x] = (*lerp(GOLD_LIGHT, GOLD, (x + y) / (w + h)), 255)  # bande OR large
            elif edge == 3:
                fx[y][x] = (12, 20, 17, 255)                     # joint sombre
            elif edge in (4, 5):
                fx[y][x] = (*lerp(SILVER, SILVER_DIM, (x + y) / (w + h)), 255)  # filet ARGENT
            elif edge == 6:
                fx[y][x] = (16, 30, 25, 255)                     # ombre intérieure
    draw_miter(fx, w, h, [(2, WHITE), (5, SILVER_BRIGHT), (6, EMERALD)])
    write_png(RP_ROOT / "textures" / "ui" / "om_sheet_bg.png", w, h, fx)

    # ---- Panneau interne 96x96 (nineslice 8px) : noir doux, liseré ARGENT,
    #      perles lumineuses aux 4 coins + retour fin (liseré double). ----
    cw = ch = 96
    cpx: list[list[tuple[int, int, int, int]]] = []
    for y in range(ch):
        row: list[tuple[int, int, int, int]] = []
        for x in range(cw):
            edge = min(x, y, cw - 1 - x, ch - 1 - y)
            if edge == 0:
                row.append((12, 12, 14, 255))                   # contour noir
            elif edge in (1, 2):
                row.append((*lerp(SILVER, SILVER_DIM, (x + y) / (cw + ch)), 255))  # argent
            elif edge == 3:
                row.append((34, 34, 38, 255))                   # raccord
            else:
                g = ((x * 3 + y * 9) % 4) - 1
                row.append((max(0, 24 + g), max(0, 24 + g), max(0, 27 + g), 235))
        cpx.append(row)
    # Coins à onglet discret : le liseré argent se replie à 45°.
    draw_miter(cpx, cw, ch, [(2, SILVER_BRIGHT), (3, SILVER_DIM)])
    write_png(RP_ROOT / "textures" / "ui" / "om_content_bg.png", cw, ch, cpx)

    # ---- Panneau interne des FICHES 96x96 (nineslice 8px) : vert très sombre
    #      à liseré OR (le panneau argenté reste réservé aux menus hub/admin
    #      et aux formulaires) — les cadres internes des fiches sont donc
    #      dorés, ceux des menus classiques argentés.
    spx: list[list[tuple[int, int, int, int]]] = []
    for y in range(ch):
        row: list[tuple[int, int, int, int]] = []
        for x in range(cw):
            edge = min(x, y, cw - 1 - x, ch - 1 - y)
            if edge == 0:
                row.append((9, 13, 11, 255))                    # contour noir-vert
            elif edge in (1, 2):
                row.append((*lerp(GOLD, GOLD_DIM, (x + y) / (cw + ch)), 255))  # or
            elif edge == 3:
                row.append((22, 38, 32, 255))                   # raccord
            else:
                g = ((x * 5 + y * 3) % 4) - 1
                row.append((max(0, 17 + g), max(0, 28 + g), max(0, 24 + g), 235))
        spx.append(row)
    draw_miter(spx, cw, ch, [(2, GOLD_LIGHT), (3, GOLD_DIM)])
    write_png(RP_ROOT / "textures" / "ui" / "om_sheet_pane.png", cw, ch, spx)

    # ---- Bandeau d'en-tête 64x20 : noir à filet or (titres de section). ----
    bw, bh = 64, 20
    bpx: list[list[tuple[int, int, int, int]]] = []
    for y in range(bh):
        row: list[tuple[int, int, int, int]] = []
        for x in range(bw):
            edge = min(x, y, bw - 1 - x, bh - 1 - y)
            if edge == 0:
                row.append((10, 10, 12, 255))
            elif y == 1:
                row.append((*lerp(GOLD, GOLD_DIM, x / bw), 255))   # filet or haut
            elif y == bh - 2:
                row.append((*lerp(SILVER_DIM, SILVER, x / bw), 255))  # filet argent bas
            else:
                g = ((x * 7 + y * 5) % 4) - 1
                row.append((max(0, 14 + g), max(0, 14 + g), max(0, 16 + g), 235))
        bpx.append(row)
    write_png(RP_ROOT / "textures" / "ui" / "om_header_band.png", bw, bh, bpx)


# ---------------------------------------------------------------------------
# Flèche « ← » du bouton retour (vraie icône, 2 états)
# ---------------------------------------------------------------------------
def back_arrow() -> None:
    """om_btn_back / om_btn_back_hover : FLÈCHE BLANCHE pleine, nette, sur
    une petite plaque sombre à liseré doré — c'est une ICÔNE de 26 px posée
    en haut à gauche du menu (rendue par server_form.dynamic_button), pas une
    tuile large comme les autres boutons. L'état survol allume le liseré et
    la flèche (surbrillance), donc la cible reste évidente à la souris.

    Grille 32x32 : la flèche va de x=5 (pointe) à x=26 (queue), centrée sur
    y=16 ; la plaque laisse 3 px de marge pour le liseré.
    """
    s = 32

    def arrow(hover: bool) -> list[list[tuple[int, int, int, int]]]:
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * s for _ in range(s)]
        # plaque (coins coupés à 2 px, façon pastille d'icône)
        for y in range(3, s - 3):
            for x in range(3, s - 3):
                cut = (x in (3, s - 4) and y in (3, s - 4))
                if cut:
                    continue
                px[y][x] = (*lerp(CHARCOAL, CHARCOAL_LIGHT, 0.6), 190)
        rim = GOLD_LIGHT if hover else GOLD_DIM
        for i in range(3, s - 3):
            px[3][i] = (*rim, 235)
            px[s - 4][i] = (*rim, 235)
            px[i][3] = (*rim, 235)
            px[i][s - 4] = (*rim, 235)
        # flèche → vers la GAUCHE : pointe en x=6, base en x=15, queue jusqu'à x=25
        ink = WHITE if hover else (238, 238, 238, 255)
        for x in range(6, 15):
            spread = x - 6
            for y in range(16 - spread, 17 + spread):
                if 0 <= y < s:
                    px[y][x] = (*ink[:3], 255)
        for x in range(14, 26):
            for y in range(14, 19):
                px[y][x] = (*ink[:3], 255)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_btn_back.png", s, s, arrow(False))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_back_hover.png", s, s, arrow(True))


def actionbar_bg() -> None:
    """Fond d'actionbar 128x10 : bandeau noir semi-transparent, liseré or."""
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(10):
        row: list[tuple[int, int, int, int]] = []
        for x in range(128):
            corner = (x in (0, 127) and y in (0, 9))
            top = (y == 1 and 2 <= x <= 125)
            bottom = (y == 8 and 2 <= x <= 125)
            border = (x in (1, 126) and 1 <= y <= 8) or (y in (2, 7) and 1 <= x <= 126)
            if corner:
                row.append((16, 15, 17, 0))
            elif top:
                row.append((212, 175, 88, 130))                # filet or
            elif bottom:
                row.append((176, 182, 192, 110))               # filet argent
            elif border:
                row.append((10, 10, 12, 170))
            else:
                row.append((14, 13, 16, 165))
        px.append(row)
    write_png(RP_ROOT / "textures" / "ui" / "om_actionbar_bg.png", 128, 10, px)


def pack_icon() -> None:
    """Icône 64x64 NaLandia : damier noir/or, bandeau argent, « N »."""
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(64):
        row: list[tuple[int, int, int, int]] = []
        for x in range(64):
            dark = ((x // 8) + (y // 8)) % 2 == 0
            if dark:
                row.append((20, 19, 22, 255))                  # noir
            else:
                row.append((30, 29, 33, 255))                  # charbon
            if 22 <= y <= 40:
                # Bandeau central : or dégradé
                row.append((*lerp(GOLD, GOLD_LIGHT, x / 64), 255))
            if 25 <= y <= 37 and 14 <= x <= 50:
                # « N » pixel dans le bandeau
                col_in_n = (14 <= x <= 19) or (45 <= x <= 50) or (abs((x - 14) - (37 - y) * 1.0) < 7 and 20 <= x <= 44)
                if col_in_n:
                    row.append((24, 22, 26, 255))
        px.append(row)
    write_png(RP_ROOT / "pack_icon.png", 64, 64, px)


# ---------------------------------------------------------------------------
# TUILES DES MENUS « JSON UI » (menu Classes + menu Clan)
# ---------------------------------------------------------------------------
def _clamp(value: int) -> int:
    return max(0, min(255, value))


def write_nineslice(name: str, nineslice: list[int], base: list[int]) -> None:
    """Décrit le découpage 9 tranches d'une texture (fichier .json voisin)."""
    path = RP_ROOT / "textures" / "ui" / f"{name}.json"
    path.write_text(json.dumps({"nineslice_size": nineslice, "base_size": base}, indent=2) + "\n")
    print(f"  + {path.relative_to(RP_ROOT.parent)}")


def clan_action_tiles() -> None:
    """`om_clan_tile` (+ _hover / _press) : barres d'action du menu Clan.

    Géométrie PROPRE au menu Clan (différente des tuiles fines du hub) : marge
    transparente de 2 px, cadre sombre, filet ARGENT sur les côtés, onglet OR
    en haut, filet argent en bas et barre d'accent dorée à gauche. La barre
    d'accent reste dans la tranche fixe du nineslice (x 5..7), donc elle est
    nette quelle que soit la largeur du bouton.
    """
    tw = th = 48

    def bar(fill: tuple[int, int, int], top: tuple[int, int, int],
            accent: tuple[int, int, int], glow: tuple[int, int, int] | None,
            grain_mod: int) -> list[list[tuple[int, int, int, int]]]:
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * tw for _ in range(th)]
        for y in range(th):
            for x in range(tw):
                edge = min(x, y, tw - 1 - x, th - 1 - y)
                if edge <= 1:
                    continue                                # marge transparente
                if edge == 2:
                    px[y][x] = (*INK, 255)                   # contour
                elif edge == 3:
                    px[y][x] = (*SILVER_DIM, 255)            # filet argent
                elif y in (4, 5):
                    px[y][x] = (*top, 255)                   # onglet or (haut)
                elif y in (th - 6, th - 5):
                    px[y][x] = (*SILVER_DIM, 255)            # filet argent (bas)
                else:
                    g = ((x * 3 + y * 7) % grain_mod) - grain_mod // 2
                    px[y][x] = (_clamp(fill[0] + g), _clamp(fill[1] + g), _clamp(fill[2] + g), 255)
        if glow is not None:
            for y in range(6, th - 6):
                for x in range(9, tw - 5):
                    dx = (x - tw * 0.5) / (tw / 2)
                    dy = (y - th / 2) / (th / 2)
                    t = max(0.0, 1.0 - (dx * dx + dy * dy) * 2.4)
                    if t > 0:
                        px[y][x] = (*lerp(px[y][x][:3], glow, t * 0.45), 255)
        for y in range(6, th - 6):
            for x in range(5, 8):
                px[y][x] = (*accent, 255)                    # barre d'accent
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_clan_tile.png", tw, th,
              bar((24, 23, 27), GOLD_DIM, GOLD, None, 4))
    write_png(RP_ROOT / "textures" / "ui" / "om_clan_tile_hover.png", tw, th,
              bar((38, 36, 41), GOLD_LIGHT, GOLD_LIGHT, GOLD_LIGHT, 3))
    write_png(RP_ROOT / "textures" / "ui" / "om_clan_tile_press.png", tw, th,
              bar((17, 16, 19), GOLD, GOLD_LIGHT, None, 3))
    for name in ("om_clan_tile", "om_clan_tile_hover", "om_clan_tile_press"):
        write_nineslice(name, [10, 10, 10, 10], [48, 48])


def tile_glow_overlays() -> None:
    """`om_glow_hover` / `om_glow_press` : voiles transparents posés SUR une
    tuile déjà dessinée (cartes de classe). Ils ne remplacent pas la texture,
    ils l'éclairent : c'est ce qui donne un état survol/appui sans dupliquer
    chaque carte en trois versions."""
    s = 16

    def glow(border: tuple[int, int, int], border_a: int,
             fill: tuple[int, int, int], fill_a: int) -> list[list[tuple[int, int, int, int]]]:
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * s for _ in range(s)]
        for y in range(s):
            for x in range(s):
                edge = min(x, y, s - 1 - x, s - 1 - y)
                if edge == 0:
                    px[y][x] = (*border, border_a)
                elif edge == 1:
                    px[y][x] = (*border, border_a // 2)
                elif fill_a > 0:
                    px[y][x] = (*fill, fill_a)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_glow_hover.png", s, s,
              glow(GOLD_LIGHT, 190, GOLD_LIGHT, 26))
    write_png(RP_ROOT / "textures" / "ui" / "om_glow_press.png", s, s,
              glow(GOLD, 210, GOLD_DIM, 58))
    write_nineslice("om_glow_hover", [6, 6, 6, 6], [16, 16])
    write_nineslice("om_glow_press", [6, 6, 6, 6], [16, 16])


def clan_slot_textures() -> None:
    """`om_slot_empty` : emplacement encadré (haut gauche de la fiche clan =
    future banque, et cadre du drapeau). Fond sombre creusé, cadre OR, ombre
    intérieure : la case est visiblement VIDE, sans aucun glyphe."""
    s = 40
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(s):
        row: list[tuple[int, int, int, int]] = []
        for x in range(s):
            edge = min(x, y, s - 1 - x, s - 1 - y)
            if edge == 0:
                row.append((*INK, 255))
            elif edge in (1, 2):
                row.append((*lerp(GOLD, GOLD_DIM, (x + y) / (s * 2)), 255))
            elif edge == 3:
                row.append((22, 21, 25, 255))
            elif edge == 4:
                row.append((40, 38, 44, 255))            # ombre intérieure
            else:
                g = ((x * 5 + y * 3) % 4) - 2
                row.append((_clamp(19 + g), _clamp(19 + g), _clamp(23 + g), 255))
        px.append(row)
    draw_miter(px, s, s, [(2, GOLD_LIGHT), (3, GOLD_DIM)])
    write_png(RP_ROOT / "textures" / "ui" / "om_slot_empty.png", s, s, px)
    write_nineslice("om_slot_empty", [8, 8, 8, 8], [40, 40])


# Couleurs des drapeaux : mêmes identifiants que TERRITORY_COLORS (src/territories/types.ts).
FLAG_COLORS: dict[str, tuple[int, int, int]] = {
    "rouge": (168, 54, 50),
    "vert": (85, 141, 60),
    "bleu": (61, 90, 168),
    "jaune": (200, 176, 60),
    "or": (212, 175, 88),
    "violet": (127, 74, 177),
    "rose": (200, 105, 160),
    "aqua": (70, 168, 180),
    "blanc": (232, 232, 232),
    "gris": (128, 128, 128),
}


def flag_banners() -> None:
    """Une bannière par couleur de drapeau (`om_flag_<id>`) + `om_flag_blason`
    pour les blasons importés par le serveur. Le JSON UI choisit la bannière
    affichée selon la valeur du drapeau, donc chaque couleur doit exister."""
    w, h = 32, 24

    def banner(base: tuple[int, int, int]) -> list[list[tuple[int, int, int, int]]]:
        light = lerp(base, WHITE, 0.25)
        dark = lerp(base, (0, 0, 0), 0.3)
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * w for _ in range(h)]
        for y in range(h):
            for x in range(w):
                if x <= 3:
                    # hampe dorée
                    px[y][x] = (*lerp(GOLD_DIM, GOLD_LIGHT, y / h), 255)
                    continue
                if y in (0, h - 1) or x in (4, w - 1):
                    px[y][x] = (*lerp(GOLD, GOLD_DIM, 0.35), 255)   # liseré doré
                    continue
                if y < 8:
                    px[y][x] = (*base, 255)
                elif y < 16:
                    px[y][x] = (*light, 255)
                else:
                    px[y][x] = (*dark, 255)
        return px

    for flag_id, color in FLAG_COLORS.items():
        write_png(RP_ROOT / "textures" / "ui" / f"om_flag_{flag_id}.png", w, h, banner(color))

    # Blason : damier or/argent neutre, remplacé visuellement par le PNG importé
    # du serveur aussi souvent que possible, mais toujours disponible.
    blason: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if x <= 3:
                blason[y][x] = (*lerp(GOLD_DIM, GOLD_LIGHT, y / h), 255)
                continue
            if y in (0, h - 1) or x in (4, w - 1):
                blason[y][x] = (*GOLD_DIM, 255)
                continue
            checker = ((x // 4) + (y // 4)) % 2 == 0
            blason[y][x] = (*(SILVER if checker else GOLD_DIM), 255)
    write_png(RP_ROOT / "textures" / "ui" / "om_flag_blason.png", w, h, blason)


def class_card_textures() -> None:
    """`om_class_guerrier` / `om_class_mage` / `om_class_archer` : grandes
    cartes verticales du menu Classes. Même cadre OR que le reste du thème,
    mais chaque voie possède SA couleur : onglet coloré en haut, barre
    colorée à gauche, corps sombre teinté. Le texte (nom + description) est
    écrit par le JSON UI par-dessus, donc aucune lettre n'est dessinée ici."""
    s = 64
    cards: dict[str, tuple[int, int, int]] = {
        "guerrier": (140, 45, 45),
        "mage": (95, 60, 145),
        "archer": (45, 110, 65),
    }

    def card(accent: tuple[int, int, int]) -> list[list[tuple[int, int, int, int]]]:
        body = lerp((24, 23, 27), accent, 0.18)
        px: list[list[tuple[int, int, int, int]]] = [[(0, 0, 0, 0)] * s for _ in range(s)]
        for y in range(s):
            for x in range(s):
                edge = min(x, y, s - 1 - x, s - 1 - y)
                if edge <= 1:
                    continue                                  # marge transparente
                if edge in (2, 3):
                    px[y][x] = (*lerp(GOLD, GOLD_DIM, (x + y) / (s * 2)), 255)
                elif edge == 4:
                    px[y][x] = (*lerp(accent, SILVER_DIM, 0.4), 255)
                else:
                    g = ((x * 7 + y * 5) % 5) - 2
                    px[y][x] = (_clamp(body[0] + g), _clamp(body[1] + g), _clamp(body[2] + g), 255)
        # Onglet de couleur en haut (tranche fixe du nineslice).
        for y in range(6, 12):
            for x in range(6, s - 6):
                px[y][x] = (*lerp(accent, WHITE, 0.12 if y == 6 else 0.0), 255)
        # Barre de couleur à gauche (tranche fixe, continue sur toute la hauteur).
        for y in range(6, s - 6):
            for x in range(6, 9):
                px[y][x] = (*accent, 255)
        # Petit retour d'angle doré : la carte reste dans le thème or/argent.
        draw_miter(px, s, s, [(3, GOLD_LIGHT), (4, GOLD_DIM)])
        return px

    for name, accent in cards.items():
        write_png(RP_ROOT / "textures" / "ui" / f"om_class_{name}.png", s, s, card(accent))
        write_nineslice(f"om_class_{name}", [12, 12, 12, 12], [64, 64])


def main() -> None:
    print("Génération des textures UI (Resource Pack NaLandia)...")
    button_tiles()
    card_tiles()
    ornate_textures()
    back_arrow()
    actionbar_bg()
    clan_action_tiles()
    tile_glow_overlays()
    clan_slot_textures()
    flag_banners()
    class_card_textures()
    pack_icon()
    print("Terminé.")


if __name__ == "__main__":
    main()
