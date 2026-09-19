/**
 * Tests du moteur UI — architecture v3.1 « transport invisible + JSON UI à nous ».
 *
 * Garde-fous :
 *  1. le script ne dépend plus d'aucun framework JSX (@bedrock-core) ;
 *  2. l'apparence vit dans RP/ui/server_form.json, généré depuis la base
 *     vanilla officielle (toutes les définitions vanilla restent présentes) ;
 *  3. chaque texture référencée par le JSON existe réellement dans le RP ;
 *  4. le câblage BP → RP (dépendance de manifest) reste correct ;
 *  5. les call sites gardent l'API historique du moteur.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const engine = (): string => readFileSync(join(ROOT, "src/ui/theme.ts"), "utf8");

/** Le code (hors commentaires) : les gardes anti-framework portent sur lui. */
const engineCode = (): string =>
  engine()
    .replace(/^\s*\/\/\/.*$/gm, "")
    .replace(/^\s*\/\*[\s\S]*?\*\/$/gm, "");

describe("Moteur UI — transport invisible", () => {
  it("ne dépend plus d'aucun framework JSX", () => {
    const source = engineCode();
    expect(source).not.toContain("@bedrock-core");
    expect(source).not.toContain("render(");
    expect(source).not.toContain("kit");
  });

  it("utilise l'API native server-ui comme transport", () => {
    const source = engine();
    expect(source).toContain('from "@minecraft/server-ui"');
    expect(source).toContain("new ActionFormData()");
    expect(source).toContain("new NativeCustomForm(");
  });

  it("expose l'API historique pour les call sites", () => {
    const source = engine();
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

  it("réessaie UserBusy (sans ça les menus ne s'ouvrent jamais)", () => {
    const source = engine();
    expect(source).toContain("UserBusy");
    expect(source).toContain("present(attempt + 1)");
  });

  it("n'envoie jamais de texture au transport (l'habillage vient du RP)", () => {
    // Le moteur ne référence aucune texture om_* : le RP habille tout.
    expect(engineCode()).not.toContain("om_");
  });
});

describe("JSON UI — RP/ui/server_form.json généré depuis la base vanilla", () => {
  const defs = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(ROOT, "RP/ui/server_form.json"), "utf8")) as Record<string, unknown>;

  it("existe et est déclaré en tête de _ui_defs.json", () => {
    const uiDefs = JSON.parse(readFileSync(join(ROOT, "RP/ui/_ui_defs.json"), "utf8")) as {
      ui_defs: string[];
    };
    expect(uiDefs.ui_defs.length).toBeGreaterThan(0);
    expect(uiDefs.ui_defs[0]).toBe("ui/server_form.json");
    for (const def of uiDefs.ui_defs) {
      expect(existsSync(join(ROOT, "RP", def))).toBe(true);
    }
  });

  it("contient le namespace server_form et les définitions vanilla attendues", () => {
    const data = defs();
    expect(Object.keys(data)).toContain("namespace");
    for (const key of [
      "long_form@common_dialogs.main_panel_no_buttons",
      "custom_form@common_dialogs.main_panel_no_buttons",
      "main_screen_content",
      "long_form_scrolling_content",
      "custom_form_scrolling_content",
    ]) {
      expect(Object.keys(data)).toContain(key);
    }
  });

  it("garde nos modifications : titre doré, dalles om_btn, fenêtres élargies", () => {
    const blob = JSON.stringify(defs());
    expect(blob).toContain("textures/ui/om_btn");
    expect(blob).toContain("textures/ui/om_btn_hover");
    expect(blob).toContain("textures/ui/om_btn_press");
    expect(blob).toContain("om_button");
  });

  it("chaque texture référencée existe dans le RP", () => {
    const blob = JSON.stringify(defs());
    for (const name of new Set(blob.match(/textures\/ui\/[A-Za-z0-9_]+/g) ?? [])) {
      expect(existsSync(join(ROOT, "RP", `${name}.png`))).toBe(true);
    }
  });

  it("le générateur est présent et sa base vanilla est vendue", () => {
    expect(existsSync(join(ROOT, "scripts/build_server_form.py"))).toBe(true);
    expect(existsSync(join(ROOT, "scripts/vanilla_server_form.json"))).toBe(true);
  });
});

describe("Habillage — textures om_* présentes", () => {
  it("dalles de bouton om_btn (3 états) vendues dans le RP", () => {
    for (const texture of ["om_btn", "om_btn_hover", "om_btn_press"]) {
      expect(existsSync(join(ROOT, "RP/textures/ui", `${texture}.png`))).toBe(true);
    }
  });

  it("aucune trace du render pack CoreUI supprimé", () => {
    expect(existsSync(join(ROOT, "RP/ui/core-ui"))).toBe(false);
    const uiDefs = readFileSync(join(ROOT, "RP/ui/_ui_defs.json"), "utf8");
    expect(uiDefs).not.toContain("core-ui");
  });
});

describe("Câblage packs", () => {
  it("BP dépend de NOTRE RP (et le RP existe)", () => {
    const bp = JSON.parse(readFileSync(join(ROOT, "BP/manifest.json"), "utf8")) as {
      header: { uuid: string };
      dependencies: Array<{ uuid?: string; version: number[] | string }>;
    };
    const rp = JSON.parse(readFileSync(join(ROOT, "RP/manifest.json"), "utf8")) as {
      header: { uuid: string };
    };
    expect(rp.header.uuid).toBe("33ca6e1c-4f30-46ae-8b56-1510382e3f61");
    const rpDep = bp.dependencies.find((d) => d.uuid === rp.header.uuid);
    expect(rpDep).toBeDefined();
  });

  it("les deux packs sont à la même version", () => {
    const bp = JSON.parse(readFileSync(join(ROOT, "BP/manifest.json"), "utf8")) as {
      header: { version: number[] };
    };
    const rp = JSON.parse(readFileSync(join(ROOT, "RP/manifest.json"), "utf8")) as {
      header: { version: number[] };
    };
    expect(bp.header.version).toEqual(rp.header.version);
  });
});
