/**
 * Tests du moteur UI (theme.tsx) et du render pack CoreUI.
 *
 * Le moteur est désormais @bedrock-core/ui : les tests vérifient le câblage
 * dur (imports, fichiers vendus, dépendances) — le rendu lui-même est couvert
 * par les tests du framework en amont.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

describe("Moteur UI (@bedrock-core/ui)", () => {
  it("utilise le framework JSX (pas de JSON UI généré maison)", () => {
    const source = readFileSync(join(ROOT, "src/ui/theme.tsx"), "utf8");
    expect(source).toContain("@bedrock-core/ui");
    expect(source).not.toContain("ActionFormData()");
    // Les formulaires à champs restent natifs (input garanti).
    expect(source).toContain("CustomForm");
  });

  it("expose l'API historique pour les call sites", () => {
    const source = readFileSync(join(ROOT, "src/ui/theme.tsx"), "utf8");
    for (const symbol of [
      "export function openTileMenu",
      "export class OMForm",
      "export function openWindow",
      "export function openWindowRaw",
      "export class ObservableString",
      "export class ObservableNumber",
      "export class ObservableBoolean",
      "export function windowTitle",
      "export function setUiDesign",
    ]) {
      expect(source).toContain(symbol);
    }
  });

  it("garde le kit avec les textures du thème", () => {
    const kit = readFileSync(join(ROOT, "src/ui/kit.tsx"), "utf8");
    for (const texture of ["om_window", "om_header_band", "om_card", "om_plate", "om_btn"]) {
      expect(kit).toContain(texture);
      expect(existsSync(join(ROOT, "RP/textures/ui", `${texture}.png`))).toBe(true);
    }
  });

  it("vend le render pack CoreUI complet dans le RP", () => {
    const uiDefs = JSON.parse(readFileSync(join(ROOT, "RP/ui/_ui_defs.json"), "utf8")) as {
      ui_defs: string[];
    };
    expect(uiDefs.ui_defs.length).toBeGreaterThan(20);
    for (const def of uiDefs.ui_defs) {
      expect(existsSync(join(ROOT, "RP", def))).toBe(true);
    }
    // Le fichier de routing du render pack doit référencer son protocole.
    const routing = readFileSync(join(ROOT, "RP/ui/core-ui/server_form.json"), "utf8");
    expect(routing).toContain("bcuiv");
  });

  it("garde la dépendance render pack dans le behavior pack", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "BP/manifest.json"), "utf8")) as {
      dependencies: Array<{ uuid?: string; version: number[] }>;
    };
    const coreUi = manifest.dependencies.find((d) => d.uuid === "761ecd37-ad1c-4a64-862a-d6cc38767426");
    expect(coreUi).toBeDefined();
    expect(coreUi?.version).toEqual([1, 11, 0]);
  });

  it("garde les utilitaires de libellés", () => {
    const labels = readFileSync(join(ROOT, "src/ui/labels.ts"), "utf8");
    expect(labels).toContain("export function pageSlice");
    expect(labels).toContain("export function fitLabel");
    expect(labels).toContain("export function wrapLabel");
  });

  it("garde les versions BP / RP / activation synchronisées", () => {
    const bp = JSON.parse(readFileSync(join(ROOT, "BP/manifest.json"), "utf8")) as {
      header: { version: number[] };
    };
    const rp = JSON.parse(readFileSync(join(ROOT, "RP/manifest.json"), "utf8")) as {
      header: { version: number[] };
    };
    const bpActivation = JSON.parse(
      readFileSync(join(ROOT, "serveur/world_behavior_packs.json"), "utf8"),
    ) as Array<{ version: number[] }>;
    const rpActivation = JSON.parse(
      readFileSync(join(ROOT, "serveur/world_resource_packs.json"), "utf8"),
    ) as Array<{ version: number[] }>;
    expect(rp.header.version).toEqual(bp.header.version);
    expect(bpActivation[0].version).toEqual(bp.header.version);
    expect(rpActivation[0].version).toEqual(rp.header.version);
  });
});

describe("Utilitaires de libellés", () => {
  it("pagine les listes", async () => {
    const { pageSlice, PANEL_TILE_CAPACITY } = await import("./labels");
    const items = Array.from({ length: 25 }, (_v, i) => i);
    const page0 = pageSlice(items, 0, PANEL_TILE_CAPACITY);
    expect(page0.items).toHaveLength(PANEL_TILE_CAPACITY);
    expect(page0.pageCount).toBe(4);
    const last = pageSlice(items, 99, PANEL_TILE_CAPACITY);
    expect(last.items).toHaveLength(1);
  });

  it("borne les libellés sans casser les codes couleur", async () => {
    const { fitLabel } = await import("./labels");
    expect(fitLabel("§aBonjour", 20)).toBe("§aBonjour");
    expect(fitLabel("§aAnticonstitutionnellement", 10).endsWith("…")).toBe(true);
    expect(fitLabel("§aAnticonstitutionnellement", 10)).toContain("§a");
  });
});
