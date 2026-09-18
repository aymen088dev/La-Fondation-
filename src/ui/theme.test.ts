/**
 * Tests du CONTRAT entre les menus TypeScript et l'habillage (v20).
 *
 * ⚠️ Ce fichier a été RÉÉCRIT en v20 : le reskin JSON UI maison (et sa
 * détection de menu par comparaison de TITRE dans le JSON UI) a été remplacé
 * par le runtime `@bedrock-core/ui` + son render pack. Les régressions à
 * protéger ne sont donc plus les mêmes :
 *
 *  1. le render pack est réellement installé et DÉCLARÉ (sinon rien ne
 *     s'affiche : les formulaires restent bruts, voire vides) ;
 *  2. le toolchain compile bien le JSX (tsconfig) et la dépendance runtime est
 *     déclarée (sinon le build casse) ;
 *  3. chaque famille de menus a un habillage DISTINCT — c'était le cœur de la
 *     demande « les menus doivent tous être différents de /sn:menu » ;
 *  4. chaque texture citée par un habillage existe dans le Resource Pack ;
 *  5. les textures de cadre/carte déclarent leur nineslice (sans quoi un cadre
 *     est étiré/déformé au lieu d'être une bordure) ;
 *  6. plus aucun fichier UI maison ne subsiste à côté du render pack (deux
 *     définitions concurrentes d'un même écran = écran cassé).
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BACK_ARROW_ICON,
  CARD_SECTIONS,
  DESIGN_SPECS,
  DIVIDER_TEXTURE,
  designForSection,
  designForTitle,
  PARCHMENT_SECTIONS,
  PANE_TEXTURE,
  SHEET_SECTIONS,
  sheetTitleFor,
  TITLE_PREFIX,
  type DesignSpec,
  type ScreenDesign,
} from "./sheets";

const ROOT = join(import.meta.dir, "..", "..");
const RP_ROOT = join(ROOT, "RP");
const RP_UI = join(RP_ROOT, "ui");

/** Fichiers UI du pack, chemins relatifs à RP/ (ex. « ui/server_form.json »). */
function uiFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".json")) {
        found.push(`${prefix}${entry.name}`);
      }
    }
  };
  walk(RP_UI, "ui/");
  return found.sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Chemin disque d'un chemin de texture du jeu (« textures/ui/x » → RP/…png). */
function texturePath(asset: string): string {
  return join(RP_ROOT, `${asset}.png`);
}

describe("Render pack @bedrock-core/ui", () => {
  it("le décodeur occupe l'emplacement vanilla et déclare son protocole", () => {
    const text = readFileSync(join(RP_UI, "server_form.json"), "utf8");
    expect(text).toContain('"namespace": "server_form"');
    expect(text).toContain('"long_form"');
    // Sans ce numéro de protocole, le pack et le runtime se désynchronisent.
    expect(text).toContain('$protocol_header": "bcuiv0008"');
  });

  it("_ui_defs.json est un JSON valide et déclare EXACTEMENT les fichiers présents", () => {
    const defs = readJson<{ ui_defs: string[] }>(join(RP_UI, "_ui_defs.json"));
    const declared = [...defs.ui_defs].sort();
    const onDisk = uiFiles().filter((file) => file !== "ui/_ui_defs.json");
    expect(declared).toEqual(onDisk);
  });

  it("chaque fichier déclaré existe réellement sur le disque", () => {
    const defs = readJson<{ ui_defs: string[] }>(join(RP_UI, "_ui_defs.json"));
    const missing = defs.ui_defs.filter((file) => !existsSync(join(RP_ROOT, file)));
    expect(missing).toEqual([]);
  });

  it("le render pack complet est présent (root scroll + composants décodés)", () => {
    for (const file of [
      "ui/core-ui/common/control.json",
      "ui/core-ui/common/state.json",
      "ui/core-ui/screens/scroll.json",
      "ui/core-ui/screens/scroll_pool.json",
      "ui/core-ui/components/button.json",
      "ui/core-ui/components/text.json",
      "ui/core-ui/form_components/form_shared.json",
      "ui/core-ui/form_components/label.json",
    ]) {
      expect(existsSync(join(RP_ROOT, file))).toBe(true);
    }
  });

  it("le HUD maison (actionbar / titres) est conservé", () => {
    const text = readFileSync(join(RP_UI, "hud_screen.json"), "utf8");
    expect(text).toContain("hud_actionbar_text");
    expect(text).toContain("textures/ui/om_actionbar_bg");
  });

  it("plus aucun fichier UI maison concurrent ne subsiste", () => {
    // Deux définitions du même écran = écran cassé / style aléatoire.
    for (const legacy of ["ui/om_base.json", "ui/om_sheets.json", "ui/om_forms.json"]) {
      expect(existsSync(join(RP_ROOT, legacy))).toBe(false);
    }
  });

  it("les textures décodées par le render pack sont présentes", () => {
    for (const asset of ["textures/ui/pointer", "textures/ui/unstyled"]) {
      expect(existsSync(texturePath(asset))).toBe(true);
    }
  });
});

describe("Toolchain JSX", () => {
  it("tsconfig compile le JSX avec le runtime @bedrock-core/ui", () => {
    const tsconfig = readJson<{
      compilerOptions: Record<string, unknown>;
      include: string[];
    }>(join(ROOT, "tsconfig.json"));
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("@bedrock-core/ui");
    expect(tsconfig.include).toContain("src/**/*.tsx");
  });

  it("@bedrock-core/ui est une dépendance déclarée et épinglée", () => {
    const pkg = readJson<{ dependencies: Record<string, string> }>(
      join(ROOT, "package.json"),
    );
    expect(pkg.dependencies["@bedrock-core/ui"]).toBeDefined();
  });
});

describe("Familles de menus — une silhouette par famille", () => {
  it("les listes de sections sont disjointes et sans doublon", () => {
    const cards = new Set<string>(CARD_SECTIONS);
    const parchment = new Set<string>(PARCHMENT_SECTIONS);
    expect(cards.size).toBe(CARD_SECTIONS.length);
    expect(parchment.size).toBe(PARCHMENT_SECTIONS.length);
    expect([...cards].filter((s) => parchment.has(s))).toEqual([]);
    expect(new Set(SHEET_SECTIONS).size).toBe(SHEET_SECTIONS.length);
    expect([...SHEET_SECTIONS].sort()).toEqual(
      [...new Set([...CARD_SECTIONS, ...PARCHMENT_SECTIONS])].sort(),
    );
  });

  it("chaque section connue tombe dans SA famille", () => {
    for (const section of CARD_SECTIONS as readonly string[]) {
      expect(designForSection(section)).toBe("cards");
    }
    for (const section of PARCHMENT_SECTIONS as readonly string[]) {
      expect(designForSection(section)).toBe("parchment");
    }
  });

  it("les menus hub/admin restent en famille « console »", () => {
    // C'est le point de la demande : ces menus ne partagent PAS leur
    // silhouette avec Classes / États / Clans / Monde.
    for (const section of [
      "Menu",
      "Administration",
      "Modération",
      "Rôles",
      "Joueurs",
      "Base de données",
      "Modules",
      "Bans actifs",
      "Mutes actifs",
      "Historique",
    ]) {
      expect(designForSection(section)).toBe("console");
    }
  });

  it("les titres dynamiques retombent proprement sur « console »", () => {
    for (const section of ["Rôle §6Admin", "Steve", "bans", "doc-12"]) {
      expect(designForSection(section)).toBe("console");
    }
  });

  it("designForTitle tolère le préfixe du moteur", () => {
    for (const section of SHEET_SECTIONS as readonly string[]) {
      expect(designForTitle(sheetTitleFor(section))).toBe(designForSection(section));
      expect(designForTitle(section)).toBe(designForSection(section));
      expect(sheetTitleFor(section)).toBe(`${TITLE_PREFIX}${section}`);
    }
    expect(designForTitle("Le Monde")).toBe("cards");
  });

  it("les trois familles ont des habillages réellement différents", () => {
    const entries = Object.entries(DESIGN_SPECS) as [ScreenDesign, DesignSpec][];
    // Fond propre à chaque famille.
    const backgrounds = entries.map(([, spec]) => spec.bg);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
    // Tuile de contenu propre à chaque famille.
    const rows = entries.map(([, spec]) => spec.row);
    expect(new Set(rows).size).toBe(rows.length);
    // Les grandes cartes sont nettement plus hautes que les tuiles fines.
    expect(DESIGN_SPECS.cards.rowHeight).toBeGreaterThan(DESIGN_SPECS.console.rowHeight * 1.4);
    expect(DESIGN_SPECS.cards.scale).toBeGreaterThan(DESIGN_SPECS.console.scale);
    expect(DESIGN_SPECS.cards.titleScale).toBeGreaterThan(DESIGN_SPECS.console.titleScale);
  });
});

describe("Textures des habillages", () => {
  it("chaque texture citée par un habillage existe dans le pack", () => {
    const missing: string[] = [];
    for (const [design, spec] of Object.entries(DESIGN_SPECS) as [string, DesignSpec][]) {
      for (const asset of [spec.bg, spec.banner, spec.row, spec.rowHover, spec.rowPress]) {
        if (!existsSync(texturePath(asset))) missing.push(`${design} → ${asset}.png`);
      }
    }
    for (const asset of [DIVIDER_TEXTURE, PANE_TEXTURE]) {
      if (!existsSync(texturePath(asset))) missing.push(`moteur → ${asset}.png`);
    }
    expect(missing).toEqual([]);
  });

  it("l'icône du bouton retour existe (flèche blanche, haut à gauche)", () => {
    expect(existsSync(texturePath(BACK_ARROW_ICON))).toBe(true);
    expect(existsSync(texturePath(`${BACK_ARROW_ICON}_hover`))).toBe(true);
  });

  it("les fonds, cadres et cartes déclarent leur nineslice", () => {
    // Sans ce fichier jumeau, la texture est ÉTIRÉE au lieu d'être une bordure.
    for (const asset of [
      ...Object.values(DESIGN_SPECS).flatMap((spec) => [
        spec.bg,
        spec.banner,
        spec.row,
        spec.rowHover,
        spec.rowPress,
      ]),
      PANE_TEXTURE,
    ]) {
      expect(existsSync(join(RP_ROOT, `${asset}.json`))).toBe(true);
    }
  });

  it("les nineslice déclarés sont cohérents (bords < taille de base)", () => {
    const broken: string[] = [];
    for (const asset of [PANE_TEXTURE, "textures/ui/om_btn", "textures/ui/om_card"]) {
      const config = readJson<{ nineslice_size: number[]; base_size: number[] }>(
        join(RP_ROOT, `${asset}.json`),
      );
      const [left, top, right, bottom] = config.nineslice_size;
      const [width, height] = config.base_size;
      if (
        left === undefined ||
        top === undefined ||
        right === undefined ||
        bottom === undefined ||
        left + right >= width ||
        top + bottom >= height
      ) {
        broken.push(asset);
      }
    }
    expect(broken).toEqual([]);
  });
});
