#!/usr/bin/env python3
"""Génère les textures UI du Resource Pack OpenMontage — SANS dépendance externe.

Écrit des PNG 8-bit RGBA à la main (struct + zlib depuis la stdlib).

Sortie :
  RP/textures/ui/om_hero_*.png     bannières de héros 256x48 (tête de menu)
  RP/textures/ui/om_ic_*.png       icônes 32x32 pixel-art (boutons DDUI)
  RP/textures/ui/om_actionbar_bg.png  fond d'actionbar (référencé par RP/ui/hud_screen.json)
  RP/pack_icon.png

Usage: python3 scripts/make_ui_textures.py
"""
import struct
import zlib
from pathlib import Path

RP_ROOT = Path(__file__).resolve().parent.parent / "RP"

# Palette OM
SLATE_DARK = (18, 20, 26)
SLATE_MID = (26, 29, 39)
SLATE_LIGHT = (38, 43, 56)
WHITE = (242, 242, 242)
GOLD = (222, 168, 52)
GOLD_LIGHT = (244, 202, 96)
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
# Bannières de héros 256x48 — tête graphique de chaque menu
# ---------------------------------------------------------------------------
def hero(name: str, accent: tuple[int, int, int], accent2: tuple[int, int, int]) -> None:
    """Panneau slate dégradé, ruban accent dégradé horizontal, clef de voûte or."""
    w, h = 256, 48
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        row: list[tuple[int, int, int, int]] = []
        for x in range(w):
            # Fond : dégradé vertical slate
            base = lerp(SLATE_MID, SLATE_LIGHT, y / (h - 1) * 0.9)
            # Ruban horizontal accent (bandeau médian) avec dégradé gauche→droite
            if 16 <= y <= 31:
                t = x / (w - 1)
                ribbon = lerp(accent, accent2, t)
                # Bords du ruban adoucis (2px de fondu)
                edge = min(y - 16, 31 - y)
                alpha = 255 if edge >= 2 else 200
                row.append((*ribbon, alpha))
                continue
            row.append((*base, 235))
        px.append(row)

    # Lignes de cadre haut/bas (accent sombre)
    for x in range(w):
        px[0][x] = (*lerp(accent, SLATE_DARK, 0.45), 255)
        px[h - 1][x] = (*lerp(accent, SLATE_DARK, 0.45), 255)

    # Clef de voûte : losange or centré (par-dessus le ruban)
    cx, cy = w // 2, h // 2
    for dy in range(-10, 11):
        for dx in range(-10, 11):
            d = abs(dx) + abs(dy)
            if d <= 10:
                x, y = cx + dx, cy + dy
                if 0 <= x < w and 0 <= y < h:
                    color = GOLD if d > 5 else GOLD_LIGHT
                    px[y][x] = (*color, 255)
    # Marques latérales discrètes (tirets) sur le ruban
    for dash_x in range(24, 101, 16):
        for dx in range(8):
            for dy in range(2):
                y = cy - 1 + dy
                px[y][dash_x + dx] = (*SLATE_DARK, 160)
                px[y][w - dash_x - 8 + dx if False else dash_x + dx] = px[y][dash_x + dx]
    for dash_x in range(148, 225, 16):
        for dx in range(8):
            for dy in range(2):
                y = cy - 1 + dy
                px[y][dash_x + dx] = (*SLATE_DARK, 160)

    write_png(RP_ROOT / "textures" / "ui" / f"om_hero_{name}.png", w, h, px)


# ---------------------------------------------------------------------------
# Icônes 32x32 — tuile slate + liseré accent + glyphe blanc
# ---------------------------------------------------------------------------
class Icon:
    def __init__(self, accent: tuple[int, int, int]):
        self.accent = accent
        self.px: list[list[tuple[int, int, int, int]]] = []
        for y in range(32):
            row: list[tuple[int, int, int, int]] = []
            for x in range(32):
                if x in (0, 31) or y in (0, 31):
                    row.append((*lerp(accent, SLATE_DARK, 0.35), 210))
                elif x in (1, 30) or y in (1, 30):
                    row.append((*SLATE_LIGHT, 235))
                else:
                    row.append((*SLATE_MID, 235))
            self.px.append(row)

    def set(self, x: int, y: int, color: tuple[int, int, int] = WHITE, alpha: int = 255) -> None:
        if 1 <= x <= 30 and 1 <= y <= 30:
            self.px[y][x] = (*color, alpha)

    def rect(self, x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int] = WHITE) -> None:
        for y in range(max(1, y0), min(31, y1) + 1):
            for x in range(max(1, x0), min(31, x1) + 1):
                self.set(x, y, color)

    def clear(self, x0: int, y0: int, x1: int, y1: int) -> None:
        """Redessine le fond (pour découper des détails dans un glyphe)."""
        for y in range(max(2, y0), min(30, y1) + 1):
            for x in range(max(2, x0), min(30, x1) + 1):
                self.set(x, y, SLATE_MID)

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
        # (nom, accent, glyphe)
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
        ("crown", GOLD, lambda i: (
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
        ("gear", PURPLE, lambda i: (
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
        ("back", GOLD, lambda i: (
            i.line(23, 16, 12, 16, 2),
            i.line(12, 16, 18, 10, 2),
            i.line(12, 16, 18, 22, 2),
        )),
        ("close", CRIMSON, lambda i: (
            i.line(9, 9, 22, 22, 2),
            i.line(22, 9, 9, 22, 2),
        )),
        ("list", GREEN, lambda i: (
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
        ("tag", SKY, lambda i: (
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
# Textures conservées (déjà référencées par le RP)
# ---------------------------------------------------------------------------
NAVY = (12, 20, 54)
NAVY_BORDER = (52, 87, 213)
NAVY_BORDER_DARK = (24, 40, 110)
BTN_BG = (10, 13, 24)
BTN_BORDER = (58, 66, 88)
BTN_BORDER_HOVER = (127, 168, 255)
BTN_BG_HOVER = (16, 23, 40)
BAND_BG = (8, 8, 16)


def panel_png(name: str, w: int, h: int, fill: tuple[int, int, int], border: tuple[int, int, int],
              alpha: int = 255, border_alpha: int = 255, corner_cut: int = 0) -> None:
    """Panneau nine-slice : fill uni + bordure 2px (coin extérieur 1px sombre)."""
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(h):
        row: list[tuple[int, int, int, int]] = []
        for x in range(w):
            edge_outer = x in (0, w - 1) or y in (0, h - 1)
            edge_inner = x in (1, 2, w - 2, w - 3) or y in (1, 2, h - 2, h - 3)
            if edge_outer:
                row.append((*NAVY_BORDER_DARK, border_alpha))
            elif edge_inner:
                row.append((*border, border_alpha))
            else:
                row.append((*fill, alpha))
        px.append(row)
    if corner_cut > 0:
        for i in range(corner_cut):
            for (x, y) in [(i, 0), (w - 1 - i, 0), (i, h - 1), (w - 1 - i, h - 1),
                           (0, i), (w - 1, i), (0, h - 1 - i), (w - 1, h - 1 - i)]:
                if 0 <= x < w and 0 <= y < h:
                    px[y][x] = (0, 0, 0, 0)
    write_png(RP_ROOT / "textures" / "ui" / f"{name}.png", w, h, px)


def form_reskin_textures() -> None:
    """Textures du reskin JSON UI des formulaires serveur (DDUI) :
    panneau bleu nuit + boutons noirs bordés + bandeaux d'en-tête."""
    # Fond principal des formulaires (bleu nuit, bordure bleue vive)
    panel_png("om_dialog_bg", 64, 64, NAVY, NAVY_BORDER, alpha=252)
    # Bandeau d'en-tête (bande noire derrière les titres de section)
    panel_png("om_header_band", 64, 20, BAND_BG, BTN_BORDER, alpha=235)
    # Boutons (états)
    panel_png("om_btn", 32, 32, BTN_BG, BTN_BORDER)
    panel_png("om_btn_hover", 32, 32, BTN_BG_HOVER, BTN_BORDER_HOVER)
    panel_png("om_btn_press", 32, 32, (9, 12, 22), BTN_BORDER_HOVER)


def actionbar_bg() -> None:
    """Fond d'actionbar 128x10 : panneau sombre semi-transparent aux coins adoucis."""
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(10):
        row: list[tuple[int, int, int, int]] = []
        for x in range(128):
            corner = (x in (0, 127) and y in (0, 9))
            border = (x in (1, 126) and 1 <= y <= 8) or (y in (1, 8) and 1 <= x <= 126)
            if corner:
                row.append((16, 18, 24, 0))
            elif border:
                row.append((233, 233, 233, 90))
            else:
                row.append((16, 18, 24, 150))
        px.append(row)
    write_png(RP_ROOT / "textures" / "ui" / "om_actionbar_bg.png", 128, 10, px)


def pack_icon() -> None:
    """Icône 64x64 : damier dégradé vert/or (OpenMontage)."""
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(64):
        row: list[tuple[int, int, int, int]] = []
        for x in range(64):
            dark = ((x // 8) + (y // 8)) % 2 == 0
            if dark:
                row.append((24, 92, 62, 255))
            else:
                row.append((36, 126, 84, 255))
            if 26 <= y <= 37 and 8 <= x <= 55:
                row.append((222, 168, 52, 255))
            if 29 <= y <= 34 and 14 <= x <= 49 and (x + y) % 2 == 0:
                row.append((244, 202, 96, 255))
        px.append(row)
    write_png(RP_ROOT / "pack_icon.png", 64, 64, px)


HEROES = {
    "home": (GREEN, AQUA),
    "territories": (GREEN, EMERALD),
    "admin": (GOLD, AMBER),
    "mod": (CRIMSON, ORANGE),
    "role": (SKY, STEEL),
    "modules": (PURPLE, STEEL),
    "database": (EMERALD, AQUA),
    "classes": (PURPLE, CRIMSON),
    "jobs": (GOLD, ORANGE),
}


def main() -> None:
    print("Génération des textures UI (OpenMontage RP)...")
    for name, (a, b) in HEROES.items():
        hero(name, a, b)
    make_icons()
    form_reskin_textures()
    actionbar_bg()
    pack_icon()
    print("Terminé.")


if __name__ == "__main__":
    main()
