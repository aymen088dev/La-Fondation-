#!/usr/bin/env python3
"""Génère des textures PNG placeholder pour le Resource Pack OpenMontage.

Sans dépendance externe : écrire un PNG 8-bit RGBA à la main
(structure + zlib depuis la stdlib). Textures TEMPORAIRES à remplacer
plus tard par de vrais visuels.

Usage: python3 scripts/make_placeholder_pngs.py
"""
import struct
import zlib
from pathlib import Path

RP_ROOT = Path(__file__).resolve().parent.parent / "RP"


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


def banner(name: str, rgb: tuple[int, int, int]) -> None:
    """Bandeau horizontal 128x8 : dégradé léger + liseré lumineux en haut/bas."""
    r, g, b = rgb
    px: list[list[tuple[int, int, int, int]]] = []
    for y in range(8):
        row: list[tuple[int, int, int, int]] = []
        for x in range(128):
            edge = y in (0, 7)
            # centre légèrement plus clair pour un effet "satin"
            lift = 26 if 40 <= x <= 88 else 0
            if edge:
                row.append((min(255, r + 70), min(255, g + 70), min(255, b + 70), 235))
            else:
                row.append((min(255, r + lift), min(255, g + lift), min(255, b + lift), 190))
        px.append(row)
    write_png(RP_ROOT / "textures" / "ui" / f"om_banner_{name}.png", 128, 8, px)


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
            # bande dorée centrale
            if 26 <= y <= 37 and 8 <= x <= 55:
                row.append((222, 168, 52, 255))
            if 29 <= y <= 34 and 14 <= x <= 49 and (x + y) % 2 == 0:
                row.append((244, 202, 96, 255))
        px.append(row)
    write_png(RP_ROOT / "pack_icon.png", 64, 64, px)


BANNER_COLORS = {
    "red": (178, 44, 44),
    "green": (58, 158, 70),
    "blue": (56, 104, 198),
    "yellow": (214, 182, 44),
    "gold": (222, 148, 38),
    "purple": (136, 68, 200),
    "pink": (222, 108, 168),
    "aqua": (52, 178, 196),
    "white": (232, 232, 232),
    "gray": (128, 132, 140),
}


def main() -> None:
    print("Génération des textures placeholder (OpenMontage RP)...")
    for name, rgb in BANNER_COLORS.items():
        banner(name, rgb)
    actionbar_bg()
    pack_icon()
    print("Terminé.")


if __name__ == "__main__":
    main()
