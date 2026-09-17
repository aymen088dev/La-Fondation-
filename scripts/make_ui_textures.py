#!/usr/bin/env python3
"""Génère les textures UI du Resource Pack NaLandia — SANS dépendance externe.

Écrit des PNG 8-bit RGBA à la main (struct + zlib depuis la stdlib).

Thème NaLandia : panneaux noirs/charbon, ornements OR (accents chauds) et
ARGENT (cadres froids), surbrillance dorée au survol des boutons.

Sortie :
  RP/textures/ui/om_hero_*.png       bannières de héros 256x48 (tête de menu)
  RP/textures/ui/om_ic_*.png         icônes 32x32 pixel-art (boutons)
  RP/textures/ui/om_actionbar_bg.png fond d'actionbar (hud_screen.json)
  RP/textures/ui/om_ornate_bg.png    grand panneau cuir sombre cadre or/argent
  RP/textures/ui/om_content_bg.png   panneau interne de contenu (liseré argent)
  RP/textures/ui/om_btn*.png         tuiles-boutons 3 états (surbrillance or)
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
CHARCOAL_LIGHT = (36, 34, 38)  # fond des boutons au survol
INK = (10, 10, 12)            # contours les plus sombres
GOLD = (212, 175, 88)         # or principal (bordures, ornements)
GOLD_LIGHT = (244, 214, 132)  # or clair (surbrillance, points lumineux)
GOLD_DIM = (150, 120, 58)     # or assombri (ombres des ornements)
SILVER = (176, 182, 192)      # argent principal (cadres internes, texte)
SILVER_DIM = (110, 116, 128)  # argent assombri
SILVER_BRIGHT = (220, 226, 236)  # argent lumineux (surbrillance argent)
WHITE = (242, 242, 242)
SLATE_DARK = (18, 20, 26)
SLATE_MID = (26, 29, 39)
SLATE_LIGHT = (38, 43, 56)
GREEN = (58, 178, 102)
AQUA = (52, 190, 196)
CRIMSON = (202, 62, 62)
SKY = (86, 156, 226)
PURPLE = (148, 92, 214)
EMERALD = (46, 186, 130)
AMBER = (232, 160, 54)
ORANGE = (226, 128, 58)
STEEL = (96, 148, 220)
PAPER = (222, 200, 140)


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
# Bannières de héros 256x48 — bandeau noir à ornements or/argent
# ---------------------------------------------------------------------------
def hero(name: str, accent: tuple[int, int, int], accent2: tuple[int, int, int]) -> None:
    """Bandeau noir/charbon, filigrane accent discret, losange OR au centre."""
    w, h = 256, 48
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        row: list[tuple[int, int, int, int]] = []
        for x in range(w):
            # Fond : dégradé vertical noir → charbon
            base = lerp(BLACK, CHARCOAL_LIGHT, (y / (h - 1)) * 0.7)
            # Léger vignettage horizontal (coins plus sombres)
            edge = min(x, w - 1 - x) / (w / 2)
            base = lerp(INK, base, min(1.0, edge * 1.6 + 0.25))
            row.append((*base, 245))
        px.append(row)

    # Filigrane accent : deux bandes très discrètes (haut/bas)
    for x in range(w):
        t = x / (w - 1)
        fade = 1.0 - abs(t - 0.5) * 2.0  # s'estompe vers les bords
        for y in (3, 4, h - 5, h - 6):
            c = lerp(lerp(accent, accent2, t), BLACK, 0.55)
            row_c = lerp(BLACK, c, 0.45 * fade + 0.1)
            px[y][x] = (*row_c, 245)

    # Filet or en haut, filet argent en bas (signature NaLandia)
    for x in range(w):
        px[1][x] = (*lerp(GOLD, GOLD_DIM, x / w), 255)
        px[2][x] = (*lerp(GOLD_DIM, GOLD, x / w), 255)
        px[h - 2][x] = (*lerp(SILVER_DIM, SILVER, x / w), 255)
        px[h - 3][x] = (*lerp(SILVER, SILVER_DIM, x / w), 255)

    # Losange OR central (signature), liseré argent
    cx, cy = w // 2, h // 2
    for dy in range(-11, 12):
        for dx in range(-11, 12):
            d = abs(dx) + abs(dy)
            if d <= 11:
                x, y = cx + dx, cy + dy
                if 0 <= x < w and 0 <= y < h:
                    if d > 8:
                        color = SILVER_DIM
                    elif d > 5:
                        color = GOLD
                    else:
                        color = GOLD_LIGHT
                    px[y][x] = (*color, 255)
    # Marques latérales : tirets argent + or autour du centre
    for dash_x in range(24, 104, 16):
        for dx in range(8):
            for dy in range(2):
                y = cy - 1 + dy
                px[y][dash_x + dx] = (*SILVER, 170)
    for dash_x in range(152, 232, 16):
        for dx in range(8):
            for dy in range(2):
                y = cy - 1 + dy
                px[y][dash_x + dx] = (*GOLD, 170)

    write_png(RP_ROOT / "textures" / "ui" / f"om_hero_{name}.png", w, h, px)


# ---------------------------------------------------------------------------
# Icônes 32x32 — tuile charbon + cadre or/argent + glyphe blanc
# ---------------------------------------------------------------------------
class Icon:
    def __init__(self, accent: tuple[int, int, int]):
        self.accent = accent
        self.px: list[list[tuple[int, int, int, int]]] = []
        for y in range(32):
            row: list[tuple[int, int, int, int]] = []
            for x in range(32):
                if x in (0, 31) or y in (0, 31):
                    row.append((*INK, 220))                     # contour noir
                elif x in (1, 30) or y in (1, 30):
                    row.append((*GOLD_DIM, 235))                # liseré or sombre
                elif x in (2, 29) or y in (2, 29):
                    row.append((*CHARCOAL_LIGHT, 240))          # biseau
                else:
                    row.append((*CHARCOAL, 240))                # fond charbon
            self.px.append(row)

    def set(self, x: int, y: int, color: tuple[int, int, int] = WHITE, alpha: int = 255) -> None:
        if 2 <= x <= 29 and 2 <= y <= 29:
            self.px[y][x] = (*color, alpha)

    def rect(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int] = WHITE) -> None:
        for y in range(max(2, y0), min(29, y1) + 1):
            for x in range(max(2, x0), min(29, x1) + 1):
                self.set(x, y, color)

    def clear(self, x0: int, y0: int, x1: int, y1: int) -> None:
        """Redessine le fond (pour découper des détails dans un glyphe)."""
        for y in range(max(2, y0), min(29, y1) + 1):
            for x in range(max(2, x0), min(29, x1) + 1):
                self.set(x, y, CHARCOAL)

    def dot(self, cx: int, cy: int, r: int, color: tuple[int, int, int] = WHITE) -> None:
        for y in range(cy - r, cy + r + 1):
            for x in range(cx - r, cx + r + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, color)

    def ring(self, cx: int, cy: int, r: int, t: int, color: tuple[int, int, int] = WHITE) -> None:
        for y in range(cy - r - 1, cy + r + 2):
            for x in range(cx - r - 1, cx + r + 2):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if (r - t) ** 2 <= d2 <= r * r:
                    self.set(x, y, color)

    def line(self, x0: int, y0: int, x1: int, y1: int, t: int = 1, color: tuple[int, int, int] = WHITE) -> None:
        steps = max(abs(x1 - x0), abs(y1 - y0))
        if steps == 0:
            self.dot(x0, y0, t, color)
            return
        for i in range(steps + 1):
            x = round(x0 + (x1 - x0) * i / steps)
            y = round(y0 + (y1 - y0) * i / steps)
            self.dot(x, y, t, color)

    def save(self, name: str) -> None:
        write_png(RP_ROOT / "textures" / "ui" / f"om_ic_{name}.png", 32, 32, self.px)


def make_icons() -> None:
    icons: list[tuple[str, tuple[int, int, int], callable]] = [
        ("flag", GREEN, lambda i: (
            i.rect(10, 6, 11, 26),                      # mât
            i.rect(12, 6, 22, 8),                       # drapeau
            i.rect(12, 8, 19, 10),
            i.rect(12, 10, 16, 12),
        )),
        ("compass", AQUA, lambda i: (
            i.ring(16, 16, 10, 2),
            i.rect(15, 9, 16, 13),                      # aiguille N
            i.rect(15, 19, 16, 23),                     # aiguille S
            i.dot(16, 16, 2),
        )),
        ("shield", STEEL, lambda i: (
            i.rect(9, 7, 22, 20),
            i.rect(11, 20, 20, 22),
            i.rect(13, 22, 18, 24),
            i.rect(14, 24, 17, 25),
            i.clear(12, 10, 19, 18),                    # creux intérieur
        )),
        ("crown", GOLD_LIGHT, lambda i: (
            i.rect(9, 19, 22, 23),                      # base
            i.rect(9, 11, 11, 19),                      # pointes
            i.rect(15, 9, 17, 19),
            i.rect(20, 11, 22, 19),
            i.dot(10, 10, 1), i.dot(16, 8, 1), i.dot(21, 10, 1),
        )),
        ("scroll", PAPER, lambda i: (
            i.rect(9, 6, 22, 26),                       # parchemin
            i.clear(12, 11, 19, 12),                    # lignes de texte
            i.clear(12, 15, 19, 16),
            i.clear(12, 19, 17, 20),
        )),
        ("gear", SILVER, lambda i: (
            i.ring(16, 16, 8, 3),
            i.rect(14, 5, 17, 9),                       # dents
            i.rect(14, 23, 17, 27),
            i.rect(5, 14, 9, 17),
            i.rect(23, 14, 27, 17),
            i.clear(14, 14, 17, 17),                    # trou central
        )),
        ("database", EMERALD, lambda i: (
            i.rect(9, 6, 22, 11),
            i.rect(9, 13, 22, 18),
            i.rect(9, 20, 22, 25),
            i.clear(12, 8, 19, 9),
            i.clear(12, 15, 19, 16),
            i.clear(12, 22, 19, 23),
        )),
        ("sword", CRIMSON, lambda i: (
            i.rect(14, 4, 16, 6),                       # pointe
            i.rect(14, 6, 16, 17),                      # lame
            i.rect(10, 17, 20, 19),                     # garde
            i.rect(14, 19, 16, 26),                     # manche
            i.dot(15, 26, 1),
        )),
        ("ban", CRIMSON, lambda i: (
            i.ring(16, 16, 10, 3),
            i.line(9, 23, 23, 9, 2),
        )),
        ("bell", ORANGE, lambda i: (
            i.rect(11, 10, 20, 20),                     # dôme
            i.rect(13, 8, 18, 10),
            i.dot(16, 23, 2),                           # battant
            i.dot(16, 7, 1),
        )),
        ("warn", AMBER, lambda i: (
            *[i.rect(16 - ((y - 6) // 3 + 1), y, 16 + ((y - 6) // 3 + 1), y) for y in range(6, 26)],
            i.clear(15, 12, 17, 19),                    # « ! »
            i.clear(15, 21, 17, 22),
        )),
        ("history", SKY, lambda i: (
            i.ring(16, 16, 10, 2),
            i.rect(15, 10, 16, 17),                     # aiguilles
            i.rect(16, 15, 21, 17),
        )),
        ("plus", GREEN, lambda i: (
            i.rect(14, 8, 17, 24),
            i.rect(8, 14, 23, 17),
        )),
        ("check", GREEN, lambda i: (
            i.line(8, 17, 13, 22, 2),
            i.line(13, 22, 24, 9, 2),
        )),
        ("trash", CRIMSON, lambda i: (
            i.rect(9, 7, 22, 9),                        # couvercle
            i.rect(14, 5, 17, 7),                       # poignée
            i.rect(10, 10, 21, 26),                     # corps
            i.clear(13, 12, 14, 24),                    # fentes
            i.clear(17, 12, 18, 24),
        )),
        ("search", AQUA, lambda i: (
            i.ring(14, 13, 7, 2),
            i.line(19, 18, 25, 24, 2),
        )),
        ("save", GREEN, lambda i: (
            i.rect(7, 7, 24, 25),
            i.clear(11, 7, 20, 13),                     # cran haut
            i.rect(10, 17, 21, 25),                     # étiquette
        )),
        ("back", GOLD_LIGHT, lambda i: (
            i.line(23, 16, 12, 16, 2),
            i.line(12, 16, 18, 10, 2),
            i.line(12, 16, 18, 22, 2),
        )),
        ("close", CRIMSON, lambda i: (
            i.line(9, 9, 22, 22, 2),
            i.line(22, 9, 9, 22, 2),
        )),
        ("list", SILVER, lambda i: (
            i.dot(10, 10, 1), i.rect(14, 9, 23, 11),
            i.dot(10, 16, 1), i.rect(14, 15, 23, 17),
            i.dot(10, 22, 1), i.rect(14, 21, 23, 23),
        )),
        ("pencil", AMBER, lambda i: (
            i.line(11, 21, 20, 12, 2),                  # corps
            i.line(20, 12, 23, 9, 1),                   # pointe
            i.line(11, 21, 9, 23, 1),
        )),
        ("user", SKY, lambda i: (
            i.dot(16, 11, 4),                           # tête
            i.rect(9, 18, 22, 25),                      # buste
            i.clear(9, 18, 10, 19), i.clear(21, 18, 22, 19),
        )),
        ("tag", SILVER_BRIGHT, lambda i: (
            i.rect(7, 12, 20, 20),                      # étiquette
            i.dot(11, 16, 2),                           # trou
            i.line(20, 16, 25, 16, 2),                  # pointe
        )),
        ("online", GREEN, lambda i: (
            i.dot(16, 16, 8),
            i.clear(13, 13, 19, 19),
        )),
        ("axe", AMBER, lambda i: (
            i.line(21, 7, 10, 25, 2),                    # manche
            i.rect(13, 5, 22, 8),                        # tête
            i.rect(11, 7, 17, 13),
            i.clear(13, 9, 15, 11),
        )),
        ("pickaxe", SKY, lambda i: (
            i.line(21, 7, 10, 25, 2),                    # manche
            i.line(7, 12, 25, 5, 2),                     # arche
            i.line(7, 12, 8, 16, 1),
            i.line(25, 5, 22, 9, 1),
        )),
        ("hammer", STEEL, lambda i: (
            i.line(21, 7, 11, 24, 2),                    # manche
            i.rect(10, 5, 20, 11),                       # masse
            i.clear(14, 7, 16, 9),
        )),
    ]

    for name, accent, glyph in icons:
        icon = Icon(accent)
        glyph(icon)
        icon.save(name)


# ---------------------------------------------------------------------------
# Boutons « tuile » 3 états — charbon, cadre or, SURBRILLANCE au survol
# ---------------------------------------------------------------------------
def button_tiles() -> None:
    """3 états pour les boutons des formulaires :
    - om_btn        : charbon + cadre or sombre
    - om_btn_hover  : charbon éclairci + cadre or vif + cœur doré (surbrillance)
    - om_btn_press  : enfoncé, cadre or clair, fond plus sombre
    Tuiles 48x48 nineslice 10px (les coins ornementaux restent dans la zone
    de nineslice pour ne pas s'étirer)."""
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
        # Surbrillance : cœur central doré translucide (au hover uniquement)
        if glow is not None:
            for y in range(ns + 4, th - ns - 4):
                for x in range(ns + 4, tw - ns - 4):
                    dx = (x - tw / 2) / (tw / 2)
                    dy = (y - th / 2) / (th / 2)
                    t = max(0.0, 1.0 - (dx * dx + dy * dy) * 2.2)
                    if t > 0:
                        px[y][x] = (*lerp(px[y][x][:3], glow, t * 0.35), 255)
        # Point lumineux au coin de chaque cadre (touche bijou)
        for cx, cy, sx, sy in ((4, 4, 1, 1), (tw - 5, 4, -1, 1), (4, th - 5, 1, -1), (tw - 5, th - 5, -1, -1)):
            px[cy][cx] = (*GOLD_LIGHT, 255)
            px[cy + sy][cx] = (*lerp(GOLD, GOLD_DIM, 0.4), 255)
            px[cy][cx + sx] = (*lerp(GOLD, GOLD_DIM, 0.4), 255)
        return px

    write_png(RP_ROOT / "textures" / "ui" / "om_btn.png", tw, th, tile(CHARCOAL, GOLD_DIM, None, 4))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_hover.png", tw, th, tile(CHARCOAL_LIGHT, GOLD_LIGHT, GOLD_LIGHT, 3))
    write_png(RP_ROOT / "textures" / "ui" / "om_btn_press.png", tw, th, tile((20, 19, 22), GOLD, None, 3))


# ---------------------------------------------------------------------------
# Panneaux principaux — grand fond orné + panneau de contenu interne
# ---------------------------------------------------------------------------
def ornate_textures() -> None:
    # ---- Grand panneau 128x128 (nineslice 12px) : cuir sombre, cadre or/argent ----
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

    # Cadre : sombre (extérieur) → OR (liseré) → argent discret (interne)
    for y in range(h):
        for x in range(w):
            edge = min(x, y, w - 1 - x, h - 1 - y)
            if edge <= 1:
                px[y][x] = (14, 13, 15, 255)                    # cadre noir
            elif edge <= 3:
                px[y][x] = (*lerp(GOLD, GOLD_DIM, (x + y) / (w + h)), 255)  # or
            elif edge == 4:
                px[y][x] = (*lerp(SILVER_DIM, SILVER, (x + y) / (w + h)), 255)  # argent
            elif edge == 5:
                px[y][x] = (30, 29, 32, 255)                    # ombre interne

    # Coins ornementés : double arc or + point argent
    for cx, cy, sx, sy in ((6, 6, 1, 1), (w - 7, 6, -1, 1), (6, h - 7, 1, -1), (w - 7, h - 7, -1, -1)):
        for i in range(9):
            x, y = cx + sx * (8 - i), cy + sy * 8
            if 4 <= x < w - 4 and 4 <= y < h - 4:
                px[y][x] = (*GOLD, 255)
            x2, y2 = cx + sx * 8, cy + sy * (8 - i)
            if 4 <= x2 < w - 4 and 4 <= y2 < h - 4:
                px[y2][x2] = (*GOLD, 255)
        xg, yg = cx + sx * 8, cy + sy * 8
        if 4 <= xg < w - 4 and 4 <= yg < h - 4:
            px[yg][xg] = (*GOLD_LIGHT, 255)
            if 4 <= xg + sx < w - 4:
                px[yg][xg + sx] = (*SILVER, 255)

    write_png(RP_ROOT / "textures" / "ui" / "om_ornate_bg.png", w, h, px)

    # ---- Panneau de contenu 96x96 (nineslice 8px) : noir doux, liseré ARGENT ----
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
    # Coins : point lumineux argent
    for cx, cy in ((3, 3), (cw - 4, 3), (3, ch - 4), (cw - 4, ch - 4)):
        cpx[cy][cx] = (*SILVER_BRIGHT, 255)
    write_png(RP_ROOT / "textures" / "ui" / "om_content_bg.png", cw, ch, cpx)

    # ---- Bandeau d'en-tête 64x20 : noir à filet or (titres de section) ----
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


HEROES = {
    "home": (GOLD, AQUA),
    "territories": (GREEN, EMERALD),
    "admin": (GOLD, GOLD_LIGHT),
    "mod": (CRIMSON, ORANGE),
    "role": (SILVER, STEEL),
    "modules": (PURPLE, STEEL),
    "database": (EMERALD, AQUA),
    "classes": (PURPLE, CRIMSON),
    "jobs": (GOLD, ORANGE),
}


def main() -> None:
    print("Génération des textures UI (Resource Pack NaLandia)...")
    for name, (a, b) in HEROES.items():
        hero(name, a, b)
    make_icons()
    button_tiles()
    ornate_textures()
    actionbar_bg()
    pack_icon()
    print("Terminé.")


if __name__ == "__main__":
    main()
