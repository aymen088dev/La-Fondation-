/**
 * Tests du pipeline UI — la source de vérité est tiles.ts, le JSON généré
 * par scripts/build_ui.py doit rester en accord, sinon ces tests échouent.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function loadServerForm(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, "RP/ui/server_form.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("Pipeline UI — server_form.json généré", () => {
  const form = loadServerForm();
  const defs = Object.keys(form).filter((k) => k !== "namespace");

  it("déclare le fichier dans _ui_defs.json", () => {
    const defsFile = JSON.parse(readFileSync(join(ROOT, "RP/ui/_ui_defs.json"), "utf8")) as {
      ui_defs: string[];
    };
    expect(defsFile.ui_defs).toContain("ui/server_form.json");
  });

  it("ne contient AUCUN duplicate « X » / « X@parent »", () => {
    const seen = new Map<string, string[]>();
    for (const key of defs) {
      const base = key.split("@")[0];
      seen.set(base, [...(seen.get(base) ?? []), key]);
    }
    const dupes = [...seen.entries()].filter(([, keys]) => keys.length > 1);
    expect(dupes).toEqual([]);
  });

  it("garde les définitions vanilla (formulaires natifs rendus)", () => {
    for (const key of [
      "custom_form@common_dialogs.main_panel_no_buttons",
      "custom_form_panel@common.scrolling_panel",
      "custom_form_scrolling_content",
      "custom_toggle@settings_common.option_toggle",
      "custom_slider@settings_common.option_slider",
      "custom_dropdown",
      "custom_input@settings_common.option_text_edit",
      "dynamic_button",
      "generated_contents",
      "long_form_panel",
      "long_form_scrolling_content",
      "main_screen_content",
      "third_party_server_screen@common.base_screen",
    ]) {
      expect(form[key]).toBeDefined();
    }
  });

  it("habille custom_form via la variable officielle uniquement", () => {
    const cf = form["custom_form@common_dialogs.main_panel_no_buttons"] as Record<string, unknown>;
    expect(cf["$custom_background"]).toBe("textures/ui/om_window");
    expect(cf["$child_control"]).toBe("server_form.custom_form_panel");
  });

  it("route long_form via un wrappeur à deux branches (OM + repli vanilla)", () => {
    const lf = form["long_form@common_dialogs.main_panel_no_buttons"] as {
      type: string;
      controls: Array<Record<string, unknown>>;
    };
    // Le wrappeur ne doit PAS contenir les variables du template vanilla
    // (sinon son contenu se dessinerait sous nos écrans : double rendu).
    expect(lf.type).toBe("panel");
    expect(lf.controls).toBeDefined();
    const names = lf.controls.map((c) => Object.keys(c)[0]);
    expect(names).toContain("om_root_classes");
    expect(names).toContain("om_root_menu");
    expect(names).toContain("om_root_base_de_donnees");
    const fallback = (
      lf.controls.find((c) => "om_default_form@common_dialogs.main_panel_no_buttons" in c) as
        | {
            "om_default_form@common_dialogs.main_panel_no_buttons": {
              bindings: Array<{ source_property_name?: string; binding_name?: string }>;
            };
          }
        | undefined
    )?.["om_default_form@common_dialogs.main_panel_no_buttons"];
    // Le repli vanilla est masqué quand un menu OM matche (sinon il se
    // dessine SOUS notre panneau : artefacts « en bas des menus »).
    expect(fallback).toBeDefined();
    const sources = fallback?.bindings.map((b) => b.source_property_name ?? "").join(" ");
    expect(sources).toContain("!");
    // Chaque branche collecte #title_text (résolution obligatoire).
    for (const b of fallback?.bindings ?? []) {
      if (b.binding_name === undefined && b.source_property_name === undefined) {
        throw new Error("binding sans nom ni source dans le repli");
      }
    }
  });

  it("conserve les références résolubles", () => {
    const known = new Set(defs.map((k) => k.split("@")[0]));
    const walk = (node: unknown, path: string): string[] => {
      const errors: string[] = [];
      if (Array.isArray(node)) {
        node.forEach((item, i) => errors.push(...walk(item, `${path}[${i}]`)));
      } else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (typeof v === "string" && v.startsWith("server_form.")) {
            const target = v.slice("server_form.".length);
            if (!known.has(target)) errors.push(`${path}.${k} -> ${v}`);
          }
          errors.push(...walk(v, `${path}.${k}`));
        }
      }
      return errors;
    };
    expect(walk(form, "<root>")).toEqual([]);
  });

  it("garde le contrat TypeScript et le JSON UI en accord", () => {
    const source = readFileSync(join(ROOT, "src/ui/tiles.ts"), "utf8");
    expect(source).toContain("// @ui-contract-begin");
    expect(source).toContain("// @ui-contract-end");
    const lf = form["long_form@common_dialogs.main_panel_no_buttons"] as {
      controls: Array<Record<string, unknown>>;
    };
    const routing = JSON.stringify(lf.controls);
    for (const section of [
      "Classes",
      "Menu",
      "Administration",
      "Mon clan",
      "Nations",
      "Mes infos",
      "Le Monde",
      "Metiers",
      "Base de donnees",
    ]) {
      expect(routing).toContain(`NaLandia » ${section}`);
      expect(source).toContain(section);
    }
  });
});

describe("Adapter runtime", () => {
  it("n'utilise que les formulaires natifs (pas de moteur custom)", () => {
    const source = readFileSync(join(ROOT, "src/ui/theme.ts"), "utf8");
    expect(source).toContain("@minecraft/server-ui");
    expect(source).not.toContain("@bedrock-core/ui");
  });

  it("garde la dépendance server-ui dans le behavior pack", () => {
    const manifest = readFileSync(join(ROOT, "BP/manifest.json"), "utf8");
    expect(manifest).toContain("@minecraft/server-ui");
  });

  it("garde les textures d'habillage présentes", () => {
    for (const texture of ["om_window.png", "om_header_band.png", "om_btn.png", "om_plate.png"]) {
      expect(readFileSync(join(ROOT, "RP/textures/ui", texture))).toBeTruthy();
    }
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
