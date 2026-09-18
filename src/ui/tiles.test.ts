/**
 * Vérifie que le SCRIPT et le RESOURCE PACK restent d'accord sur les menus à
 * tuiles. C'est le seul filet de sécurité possible ici : le rendu JSON UI ne
 * peut pas être testé hors du jeu, mais l'ACCORD des index, des titres et des
 * textures, oui.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TERRITORY_COLORS } from "../territories/types";
import {
  TILE_MENUS,
  TILE_PANELS,
  TILE_SECTIONS,
  actionIndex,
  dataIndex,
  expectedTileIndexes,
  tileButtonCount,
  tileTitleFor,
} from "./tiles";

const ROOT = join(import.meta.dir, "..", "..");
const SERVER_FORM_PATH = join(ROOT, "RP/ui/server_form.json");
const serverForm = JSON.parse(readFileSync(SERVER_FORM_PATH, "utf8")) as Record<string, unknown>;

/** Récupère toutes les valeurs d'une clé dans un sous-arbre JSON. */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  for (const [current, value] of Object.entries(node as Record<string, unknown>)) {
    if (current === key) out.push(value);
    else collect(value, key, out);
  }
  return out;
}

/** Le contrôle `long_form` (une entrée par menu), sous forme { nom: définition }. */
function controllers(): Record<string, Record<string, unknown>> {
  const longForm = serverForm["long_form"] as { controls: Record<string, unknown>[] };
  const found: Record<string, Record<string, unknown>> = {};
  for (const entry of longForm.controls) {
    for (const [name, value] of Object.entries(entry)) {
      found[name.split("@")[0] as string] = value as Record<string, unknown>;
    }
  }
  return found;
}

describe("Menus à tuiles (JSON UI)", () => {
  it("déclare un contrôle et un panneau pour chaque menu à tuiles", () => {
    const declared = controllers();
    for (const section of TILE_SECTIONS) {
      const spec = TILE_PANELS[section];
      const controller = declared[spec.controller];
      expect(controller).toBeDefined();
      // Le contrôle doit basculer le formulaire natif vers notre panneau.
      expect(controller?.["$child_control"]).toBe(spec.panel);
      // Et donc lire le titre exact produit par `windowTitle()`.
      const serialized = JSON.stringify(controller);
      expect(serialized).toContain(`(#title_text = '${tileTitleFor(section)}')`);
      expect(serverForm[spec.panel.split(".")[1] as string]).toBeDefined();
    }
  });

  it("ne laisse pas un menu à tuiles retomber sur le rendu natif", () => {
    const fallback = controllers()["om_default_form"];
    const serialized = JSON.stringify(fallback);
    for (const section of TILE_SECTIONS) {
      // Le panneau par défaut doit connaître TOUS les titres à tuiles, sinon
      // deux panneaux s'afficheraient en même temps.
      expect(serialized).toContain(`'${tileTitleFor(section)}'`);
    }
  });

  it("déclare exactement les index de collection attendus par le script", () => {
    for (const section of TILE_SECTIONS) {
      const panelName = TILE_PANELS[section].panel.split(".")[1] as string;
      const indexes = collect(serverForm[panelName], "collection_index") as number[];
      const unique = [...new Set(indexes)].sort((a, b) => a - b);
      expect(unique).toEqual(expectedTileIndexes(section));
      // Aucun index hors contrat : une tuile pointant vers un bouton absent
      // resterait cliquable dans le vide.
      for (const index of indexes) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(tileButtonCount(section));
      }
    }
  });

  it("garde les clés de boutons uniques et ordonnées", () => {
    for (const section of TILE_SECTIONS) {
      const { actions, data } = TILE_MENUS[section];
      expect(new Set([...actions, ...data]).size).toBe(actions.length + data.length);
      actions.forEach((key, index) => expect(actionIndex(section, key)).toBe(index));
      data.forEach((key, index) => expect(dataIndex(section, key)).toBe(actions.length + index));
      expect(tileButtonCount(section)).toBe(actions.length + data.length);
      expect(actionIndex(section, "inexistant")).toBe(-1);
      expect(dataIndex(section, "inexistant")).toBe(-1);
    }
  });

  it("n'emploie que des textures présentes dans le pack", () => {
    const textures = [
      ...new Set([...collect(serverForm, "texture"), ...collect(serverForm, "$tex")] as string[]),
    ].filter((texture) => texture.startsWith("textures/"));
    expect(textures.length).toBeGreaterThan(0);
    for (const texture of textures) {
      expect(existsSync(join(ROOT, "RP", `${texture}.png`))).toBe(true);
    }
  });

  it("prévoit une bannière de drapeau pour chaque couleur du serveur", () => {
    const serialized = JSON.stringify(serverForm);
    for (const color of TERRITORY_COLORS) {
      expect(serialized).toContain(`FLAG:${color.id}`);
      expect(serialized).toContain(`textures/ui/om_flag_${color.id}`);
      expect(existsSync(join(ROOT, `RP/textures/ui/om_flag_${color.id}.png`))).toBe(true);
    }
    expect(serialized).toContain("FLAG:blason");
  });

  it("ne réintroduit aucun curseur ni contrôle tactile maison", () => {
    const serialized = JSON.stringify(serverForm).toLowerCase();
    for (const forbidden of ["hud_cursor", "pointer", "touch_input", "mouse_input"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Les tuiles restent des boutons NATIFS : mêmes mappings que le formulaire
    // vanilla, donc le tactile et la manette continuent de fonctionner.
    const serializedRaw = JSON.stringify(serverForm);
    expect(serializedRaw).toContain("button.form_button_click");
    expect(serializedRaw).toContain("collection_details");
  });
});
