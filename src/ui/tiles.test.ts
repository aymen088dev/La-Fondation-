/** Tests du contrat des menus à tuiles (source de vérité unique). */
import { describe, expect, it } from "bun:test";
import {
  PANEL_TILE_CAPACITY,
  TILE_MENUS,
  fitLabel,
  isTileSection,
  pageSlice,
  tileButtonCount,
  tileTitleFor,
  wrapLabel,
  type TileSection,
} from "./tiles";

const indexedSections = Object.keys(TILE_MENUS.indexed) as TileSection[];

describe("Contrat des menus à tuiles", () => {
  it("n'a aucune section dupliquée entre indexées et génériques", () => {
    const generic = TILE_MENUS.generic as readonly string[];
    for (const section of indexedSections) {
      expect(generic).not.toContain(section);
    }
    expect(new Set(generic).size).toBe(generic.length);
  });

  it("déclare le bouton back en dernière ACTION de chaque menu indexé", () => {
    for (const section of indexedSections) {
      const layout = TILE_MENUS.indexed[section as keyof typeof TILE_MENUS.indexed];
      expect(layout.actions[layout.actions.length - 1]).toBe("back");
    }
  });

  it("calcule le nombre total de boutons (actions + data)", () => {
    expect(tileButtonCount("Classes" as TileSection)).toBe(7); // 4 actions + 3 data
    expect(tileButtonCount("Menu" as TileSection)).toBe(7);
    expect(tileButtonCount("Mon clan" as TileSection)).toBe(8); // 6 actions + 2 data
  });

  it("filtre les sections à tuiles", () => {
    expect(isTileSection("Menu")).toBe(true);
    expect(isTileSection("Mines")).toBe(true);
    expect(isTileSection("Inconnu")).toBe(false);
  });

  it("construit les titres exacts attendus par le JSON UI", () => {
    expect(tileTitleFor("Menu" as TileSection)).toBe("NaLandia » Menu");
    expect(tileTitleFor("Base de donnees" as TileSection)).toBe("NaLandia » Base de donnees");
  });
});

describe("Pagination des listes génériques", () => {
  it("découpe selon PANEL_TILE_CAPACITY et borne la page", () => {
    expect(PANEL_TILE_CAPACITY).toBeGreaterThan(0);
    const items = Array.from({ length: 23 }, (_u, i) => i);
    const first = pageSlice(items, 0, PANEL_TILE_CAPACITY);
    expect(first.items.length).toBe(PANEL_TILE_CAPACITY);
    expect(first.pageCount).toBe(3);
    const overflow = pageSlice(items, 99, PANEL_TILE_CAPACITY);
    expect(overflow.page).toBe(2);
    expect(overflow.items.length).toBe(7);
  });

  it("gère les listes vides", () => {
    const empty = pageSlice([], 0, PANEL_TILE_CAPACITY);
    expect(empty.pageCount).toBe(1);
    expect(empty.items).toEqual([]);
  });
});

describe("Bornage des libellés", () => {
  it("fitLabel coupe au-delà de la borne (codes § non comptés)", () => {
    expect(fitLabel("court", 10)).toBe("court");
    const long = fitLabel("§6un libellé beaucoup trop long pour la tuile", 12);
    expect(long.replace(/§./g, "").length).toBeLessThanOrEqual(12);
    expect(long.endsWith("…")).toBe(true);
  });

  it("wrapLabel limite le nombre de lignes", () => {
    const wrapped = wrapLabel("mot ".repeat(40).trim(), 20, 3);
    expect(wrapped.split("\n").length).toBeLessThanOrEqual(3);
  });

  it("wrapLabel préserve les mots courts", () => {
    expect(wrapLabel("salut", 20, 2)).toBe("salut");
  });
});
