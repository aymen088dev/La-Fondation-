/** Tests for the native Bedrock forms UI adapter. */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_SECTIONS, DESIGN_SPECS, PARCHMENT_SECTIONS, designForSection, designForTitle, SHEET_SECTIONS, sheetTitleFor, TITLE_PREFIX } from "./sheets";

const ROOT = join(import.meta.dir, "..", "..");

describe("Native Bedrock UI adapter", () => {
  it("declares a valid lightweight JSON UI presentation layer", () => {
    const defs = JSON.parse(readFileSync(join(ROOT, "RP/ui/_ui_defs.json"), "utf8")) as { ui_defs: string[] };
    const serverForm = JSON.parse(readFileSync(join(ROOT, "RP/ui/server_form.json"), "utf8")) as {
      long_form?: { modifications?: unknown[] };
      custom_form?: { modifications?: unknown[] };
    };
    expect(defs.ui_defs).toContain("ui/server_form.json");
    expect(serverForm.long_form?.modifications?.length).toBeGreaterThan(0);
    expect(serverForm.custom_form?.modifications?.length).toBeGreaterThan(0);
    expect(readFileSync(join(ROOT, "RP/textures/ui/om_sheet_bg.png"))).toBeTruthy();
    expect(readFileSync(join(ROOT, "RP/textures/ui/om_cards_bg.png"))).toBeTruthy();
  });

  it("does not depend on the removed custom renderer", () => {
    const source = readFileSync(join(ROOT, "src/ui/theme.ts"), "utf8");
    expect(source).toContain("@minecraft/server-ui");
    expect(source).not.toContain("@bedrock-core/ui");
  });

  it("keeps the official native form dependency in the behavior pack", () => {
    const manifest = readFileSync(join(ROOT, "BP/manifest.json"), "utf8");
    expect(manifest).toContain("@minecraft/server-ui");
  });

  it("keeps the BP, RP and server activation versions synchronized", () => {
    const bp = JSON.parse(readFileSync(join(ROOT, "BP/manifest.json"), "utf8")) as { header: { version: number[] } };
    const rp = JSON.parse(readFileSync(join(ROOT, "RP/manifest.json"), "utf8")) as { header: { version: number[] } };
    const bpActivation = JSON.parse(readFileSync(join(ROOT, "serveur/world_behavior_packs.json"), "utf8")) as [{ version: number[] }];
    const rpActivation = JSON.parse(readFileSync(join(ROOT, "serveur/world_resource_packs.json"), "utf8")) as [{ version: number[] }];
    expect(rp.header.version).toEqual(bp.header.version);
    expect(bpActivation[0].version).toEqual(bp.header.version);
    expect(rpActivation[0].version).toEqual(rp.header.version);
  });
});

describe("Menu routing remains compatible", () => {
  it("keeps content and record sections disjoint", () => {
    expect(new Set(CARD_SECTIONS).size).toBe(CARD_SECTIONS.length);
    expect(new Set(PARCHMENT_SECTIONS).size).toBe(PARCHMENT_SECTIONS.length);
    expect(new Set(SHEET_SECTIONS).size).toBe(SHEET_SECTIONS.length);
    expect([...CARD_SECTIONS].some((section) => PARCHMENT_SECTIONS.includes(section as never))).toBe(false);
  });

  it("routes known titles without a JSON UI title hack", () => {
    for (const section of SHEET_SECTIONS) {
      expect(designForSection(section)).not.toBe("console");
      expect(designForTitle(sheetTitleFor(section))).toBe(designForSection(section));
    }
    expect(sheetTitleFor("Classes")).toBe(`${TITLE_PREFIX}Classes`);
    expect(designForTitle("Administration")).toBe("console");
  });

  it("retains a declarative style contract for future native wrappers", () => {
    expect(DESIGN_SPECS.console.rowHeight).toBeGreaterThan(0);
    expect(DESIGN_SPECS.cards.rowHeight).toBeGreaterThan(DESIGN_SPECS.console.rowHeight);
    expect(DESIGN_SPECS.parchment.rowHeight).toBeGreaterThan(0);
  });
});
