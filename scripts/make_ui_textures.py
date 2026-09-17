#!/usr/bin/env python3
"""Génère les textures UI du Resource Pack NaLandia — SANS dépendance externe.

Écrit des PNG 8-bit RGBA à la main (struct + zlib depuis la stdlib).

Thème NaLandia : panneaux noirs/charbon, ornements OR (accents chauds) et
ARGENT (cadres froids), SURBRILLANCE dorée marquée au survol des boutons,
fioritures (arabesques) aux coins des grands cadres et des panneaux internes.

v17.1 : les icônes de boutons et les bannières de héros ont été RETIRÉES
(« ça fait brouillon ») — le script ne les génère plus.

Sortie :
  RP/textures/ui/om_actionbar_bg.png  fond d'actionbar (hud_screen.json)
  RP/textures/ui/om_ornate_bg.png     grand cadre orné (coins à arabesques)
  RP/textures/ui/om_content_bg.png    panneau interne argenté (coins perlés)
  RP/textures/ui/om_header_band.png   bandeau de section (filet or/argent)
  RP/textures/ui/om_btn*.png          tuiles-boutons 3 états (surbrillance or)
  RP/pack_icon.png

Usage: python3 scripts/make_ui_textures.py
"""
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
        # Point lumineux au coin de chaque cadre (touche bijou).
        for cx, cy, sx, sy in ((4, 4, 1, 1), (tw - 5, 4, -1, 1), (4, th - 5, 1, -1), (tw - 5, th - 5, -1, -1)):
            px[cy][cx] = (*GOLD_LIGHT, 255)
            px[cy + sy][cx] = (*lerp(GOLD, GOLD_DIM, 0.4), 255)
            px[cy][cx + sx] = (*lerp(GOLD, GOLD_DIM, 0.4), 255)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_btn.png", tw, th, tile(CHARCOAL, GOLD_DIM, None, 4))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_hover.png", tw, th, tile(CHARCOAL_LIGHT, GOLD_LIGHT, GOLD_LIGHT, 3))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_press.png", tw, th, tile((20, 19, 22), GOLD, None, 3))


# ---------------------------------------------------------------------------
# Panneaux principaux — grand cadre orné (fioritures) + panneau interne
# ---------------------------------------------------------------------------
def ornate_textures() -> None:
    # ---- Grand cadre 128x128 (nineslice 12px) : cuir sombre, cadre or/argent,
    #      FIORITURES : arabesque en L aux 4 coins (or) + perle argent. ----
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

    # FIORITURES : arabesques en L (doubles arcs or) aux 4 coins + perle
    # argent au sommet — s'étendent le long des bords (dans la zone nineslice).
    for cx, cy, sx, sy in ((5, 5, 1, 1), (w - 6, 5, -1, 1), (5, h - 6, 1, -1), (w - 6, h - 6, -1, -1)):
        # Double arc : L intérieur épais + L extérieur fin.
        for i in range(11):
            x, y = cx + sx * (10 - i), cy + sy * 10
            if 4 <= x < w - 4 and 4 <= y < h - 4:
                px[y][x] = (*GOLD, 255)
                if i % 3 == 1:
                    px[y + (sy if sy > 0 else -1) * 0][x] = (*GOLD_LIGHT, 255)
            x2, y2 = cx + sx * 10, cy + sy * (10 - i)
            if 4 <= x2 < w - 4 and 4 <= y2 < h - 4:
                px[y2][x2] = (*GOLD, 255)
        # Arc fin décalé (2e volute).
        for i in range(7):
            x, y = cx + sx * (6 - i), cy + sy * 6
            if 4 <= x < w - 4 and 4 <= y < h - 4:
                px[y][x] = (*GOLD_DIM, 255)
            x2, y2 = cx + sx * 6, cy + sy * (6 - i)
            if 4 <= x2 < w - 4 and 4 <= y2 < h - 4:
                px[y2][x2] = (*GOLD_DIM, 255)
        # Perle dorée au coin + perle argent juste en diagonale.
        xg, yg = cx + sx * 10, cy + sy * 10
        if 4 <= xg < w - 4 and 4 <= yg < h - 4:
            px[yg][xg] = (*GOLD_LIGHT, 255)
        xs, ys = cx + sx * 7, cy + sy * 7
        if 4 <= xs < w - 4 and 4 <= ys < h - 4:
            px[ys][xs] = (*SILVER_BRIGHT, 255)

    write_png(RP_ROOT / "textures" / "ui" / "om_ornate_bg.png", w, h, px)

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
    # FIORITURES : petites volutes argent aux 4 coins (dans la zone nineslice).
    for cx, cy, sx, sy in ((3, 3, 1, 1), (cw - 4, 3, -1, 1), (3, ch - 4, 1, -1), (cw - 4, ch - 4, -1, -1)):
        for i in range(6):
            x, y = cx + sx * (5 - i), cy + sy * 5
            if 0 <= x < cw and 0 <= y < ch:
                cpx[y][x] = (*SILVER_BRIGHT, 255)
            x2, y2 = cx + sx * 5, cy + sy * (5 - i)
            if 0 <= x2 < cw and 0 <= y2 < ch:
                cpx[y2][x2] = (*SILVER_BRIGHT, 255)
        # Perle or discrète en diagonale (rappel du thème).
        xd, yd = cx + sx * 3, cy + sy * 3
        if 0 <= xd < cw and 0 <= yd < ch:
            cpx[yd][xd] = (*GOLD, 255)
    write_png(RP_ROOT / "textures" / "ui" / "om_content_bg.png", cw, ch, cpx)

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


def main() -> None:
    print("Génération des textures UI (Resource Pack NaLandia v17.1)...")
    button_tiles()
    ornate_textures()
    actionbar_bg()
    pack_icon()
    print("Terminé.")


if __name__ == "__main__":
    main()
