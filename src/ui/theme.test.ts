/**
 * Tests du CONTRAT entre le moteur TypeScript et le reskin JSON UI.
 *
 * Ce que ces tests protègent (ce sont les régressions qui ont réellement
 * produit les bugs signalés en jeu) :
 *  1. tous les fichiers UI du pack sont des JSON valides et déclarés ;
 *  2. aucun héritage `@namespace.controle` ne pointe dans le vide — une
 *     référence cassée fait disparaître le style (ou l'écran entier) ;
 *  3. chaque texture référencée existe dans le Resource Pack — une texture
 *     manquante rend un cadre/une flèche invisible ;
 *  4. la liste des menus « fiches » du JSON UI correspond EXACTEMENT à
 *     SHEET_SECTIONS — une désynchro faisait que tous les menus ressemblaient
 *     à /sn:menu (bug « les menus n'ont pas changé ») ;
 *  5. le marqueur du bouton retour (label « §r ») et son icône sont bien ceux
 *     que le moteur envoie, sinon la flèche redevient un bouton de liste.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BACK_ARROW_ICON,
  BUTTON_BACK_MARKER,
  SHEET_SECTIONS,
  sheetTitleFor,
} from "./sheets";

const RP_ROOT = join(import.meta.dir, "..", "..", "RP");
const RP_UI = join(RP_ROOT, "ui");

/** Namespaces UI maison → fichier qui les définit (les autres sont vanilla). */
const OWN_NAMESPACES: Record<string, string> = {
  om_base: "om_base.json",
  om_sheets: "om_sheets.json",
  om_forms: "om_forms.json",
  server_form: "server_form.json",
};

function uiFiles(): string[] {
  return readdirSync(RP_UI)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readUi(name: string): string {
  return readFileSync(join(RP_UI, name), "utf8");
}

/**
 * Noms de contrôles définis par un fichier UI. En JSON UI la clé porte
 * l'héritage (« om_scroll_pane@common.scrolling_panel ») : on ne garde que la
 * partie avant le @, c'est le nom référençable depuis les autres fichiers.
 */
function definedControls(file: string): Set<string> {
  const doc = JSON.parse(readUi(file)) as Record<string, unknown>;
  return new Set(Object.keys(doc).map((key) => key.split("@")[0]));
}

/** Titres de formulaires reconnus par le JSON UI (comparaisons #om_title). */
function matchedTitles(text: string): string[] {
  return [...text.matchAll(/#om_title = '([^']*)'/g)].map((match) => match[1]);
}

describe("Fichiers JSON UI du Resource Pack", () => {
  it("tous les fichiers sont des JSON valides", () => {
    const broken = uiFiles().filter((name) => {
      try {
        JSON.parse(readUi(name));
        return false;
      } catch {
        return true;
      }
    });
    expect(broken).toEqual([]);
  });

  it("_ui_defs.json déclare tous les fichiers UI maison", () => {
    const defs = JSON.parse(readUi("_ui_defs.json")) as { ui_defs: string[] };
    for (const file of Object.values(OWN_NAMESPACES)) {
      expect(defs.ui_defs).toContain(`ui/${file}`);
    }
  });

  it("chaque héritage @namespace.controle pointe vers un contrôle existant", () => {
    const defined = new Map(
      Object.values(OWN_NAMESPACES).map((file) => [file, definedControls(file)]),
    );
    const missing: string[] = [];
    for (const name of uiFiles()) {
      for (const match of readUi(name).matchAll(/@([a-z_]+)\.([a-z0-9_]+)/g)) {
        const target = OWN_NAMESPACES[match[1]];
        if (target === undefined) continue; // contrôle vanilla : hors périmètre
        if (!defined.get(target)?.has(match[2])) {
          missing.push(`${name} → @${match[1]}.${match[2]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("chaque variable de contrôle (fond, panneau, contenu) cible un contrôle existant", () => {
    const defined = new Map(
      Object.values(OWN_NAMESPACES).map((file) => [file, definedControls(file)]),
    );
    const missing: string[] = [];
    for (const name of uiFiles()) {
      for (const match of readUi(name).matchAll(/"\$[a-z_]+":\s*"([a-z_]+)\.([a-z0-9_]+)"/g)) {
        const target = OWN_NAMESPACES[match[1]];
        if (target === undefined) continue;
        if (!defined.get(target)?.has(match[2])) {
          missing.push(`${name} → $… : ${match[1]}.${match[2]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("chaque texture maison (om_*) référencée existe dans le pack", () => {
    // Les textures « nues » (hud_tip_text_background…) viennent du pack vanilla
    // et n'ont pas à être présentes ici : on ne vérifie que les nôtres.
    const missing: string[] = [];
    for (const name of uiFiles()) {
      for (const match of readUi(name).matchAll(/"textures\/(ui\/om_[a-z0-9_]+)"/g)) {
        if (!existsSync(join(RP_ROOT, "textures", `${match[1]}.png`))) {
          missing.push(`${name} → textures/${match[1]}.png`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("Style par famille de menu (titre = canal de style)", () => {
  it("le JSON UI reconnaît EXACTEMENT les sections de SHEET_SECTIONS", () => {
    const text = readUi("om_sheets.json");
    const found = matchedTitles(text);
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set(SHEET_SECTIONS.map(sheetTitleFor)));
  });

  it("les DEUX sélecteurs (fond + panneau) portent la liste complète", () => {
    const text = readUi("om_sheets.json");
    const chains = [...text.matchAll(/#om_title = 'NaLandia » [^']*'/g)];
    // 2 sélecteurs × la liste complète : si un menu est oublié dans l'un des
    // deux, la comparaison de titres n'est plus fiable et le style saute.
    expect(chains.length).toBe(SHEET_SECTIONS.length * 2);
  });

  it("aucun doublon et titres produits conformes au format des fenêtres", () => {
    expect(new Set(SHEET_SECTIONS).size).toBe(SHEET_SECTIONS.length);
    for (const section of SHEET_SECTIONS) {
      // Miroir du format de windowTitle() (theme.ts) après nettoyage des §.
      expect(sheetTitleFor(section)).toBe(`NaLandia » ${section}`);
    }
  });

  it("le fond et les panneaux des deux familles sont bien distincts", () => {
    const sheets = readUi("om_sheets.json");
    const base = readUi("om_base.json");
    // Famille « fiches » : émeraude à double filet or/argent, panneau à liseré or.
    expect(sheets).toContain("textures/ui/om_sheet_bg");
    expect(sheets).toContain("textures/ui/om_sheet_pane");
    // Famille « menus » (hub/admin) : cuir orné + panneau argenté, inchangés.
    expect(base).toContain("textures/ui/om_ornate_bg");
    expect(base).toContain("textures/ui/om_content_bg");
    expect(sheets).toContain("om_base.om_ornate_background");
    expect(sheets).toContain("om_base.om_pane_image");
  });
});

describe("Bouton retour en icône", () => {
  it("le marqueur du moteur est celui comparé par le JSON UI", () => {
    const text = readUi("server_form.json");
    expect(text).toContain(`(#om_label = '${BUTTON_BACK_MARKER}')`);
    expect(text).toContain(`(not (#om_label = '${BUTTON_BACK_MARKER}'))`);
  });

  it("la branche retour est une pastille à icône, sans tuile de bouton", () => {
    const text = readUi("server_form.json");
    expect(text).toContain("om_base.om_back_arrow");
    // Tuile désactivée : sinon la flèche ressemblerait aux autres boutons.
    expect(text).toContain('"$button_image": "common.empty_panel"');
    // Filet de sécurité : l'icône native réaffiche la flèche si le marqueur
    // n'était pas reconnu (et elle ne s'affiche que pour NOTRE texture).
    expect(text).toContain("om_base.om_button_icon");
    expect(readUi("om_base.json")).toContain(`(#om_icon = '${BACK_ARROW_ICON}')`);
  });

  it("l'icône du moteur existe dans le pack", () => {
    expect(existsSync(join(RP_ROOT, `${BACK_ARROW_ICON}.png`))).toBe(true);
  });
});
