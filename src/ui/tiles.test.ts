/**
 * Vérifie que le SCRIPT et le RESOURCE PACK restent d'accord sur les menus à
 * tuiles. C'est le seul filet de sécurité possible ici : le rendu JSON UI ne
 * peut pas être testé hors du jeu, mais l'ACCORD des index, des titres et des
 * textures, oui.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TERRITORY_COLORS } from "../territories/types";
import { TITLE_PREFIX } from "./sheets";
import {
  MENU_THEMES,
  TILE_MENUS,
  TILE_PANELS,
  TILE_SECTIONS,
  actionIndex,
  dataIndex,
  expectedTileIndexes,
  menuCardTexture,
  menuFrameTexture,
  pageSlice,
  tileButtonCount,
  tileTitleFor,
} from "./tiles";
import type { MenuTheme } from "./tiles";

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

/**
 * Ce bouton a-t-il bien été envoyé par un script ?
 *
 * Les listes dynamiques sont câblées avec un littéral gabarit
 * (`` action(`clan_${slot}`) ``) : on accepte donc les DEUX formes, littérale
 * et gabarit — sinon le test signalerait à tort les cartes de ces listes.
 */
function isSent(joined: string, method: "action" | "data", key: string): boolean {
  if (new RegExp(`${method}\\(\\s*"${key}"`).test(joined)) return true;
  const dynamic = /^(.*)_\d+$/.exec(key);
  if (dynamic === null || dynamic[1] === undefined) return false;
  return new RegExp(`${method}\\(\\s*\`${dynamic[1]}_\\$\\{`).test(joined);
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

/**
 * Le panneau réellement instancié par un menu, avec sa taille. La racine doit
 * pointer DIRECTEMENT sur le panneau (aucune variable intermédiaire) : une
 * indirection cassée laisserait le menu entièrement vide.
 */
function panelOf(section: (typeof TILE_SECTIONS)[number]): { panel: string; size: number[] } {
  const root = controllers()[TILE_PANELS[section].controller];
  const controls = (root?.["controls"] ?? []) as Record<string, unknown>[];
  expect(controls.length).toBe(1);
  const instance = controls[0] as Record<string, Record<string, unknown>>;
  const name = Object.keys(instance)[0] as string;
  return { panel: name.split("@")[1] as string, size: instance[name]?.["size"] as number[] };
}

describe("Menus à tuiles (JSON UI)", () => {
  it("déclare un contrôle et un panneau pour chaque menu à tuiles", () => {
    const declared = controllers();
    for (const section of TILE_SECTIONS) {
      const spec = TILE_PANELS[section];
      const controller = declared[spec.controller];
      expect(controller).toBeDefined();
      // Le contrôle doit pointer DIRECTEMENT sur notre panneau, sans passer
      // par le cadre vanilla (aucun main_panel_no_buttons).
      const actual = panelOf(section);
      expect(actual.panel).toBe(spec.panel);
      expect(actual.size).toEqual(spec.size);
      // Et donc lire le titre exact produit par `windowTitle()`.
      const serialized = JSON.stringify(controller);
      expect(serialized).toContain(`(#title_text = '${tileTitleFor(section)}')`);
      expect(serverForm[spec.panel.split(".")[1] as string]).toBeDefined();
    }
  });

  it("ne laisse pas un menu à tuiles retomber sur le rendu natif", () => {
    const serialized = JSON.stringify(controllers()["om_default_form"]);
    // Le cadre vanilla se retire dès que le titre porte le préfixe NaLandia :
    // aucun menu à tuiles ne peut donc s'afficher DEUX fois (le panneau dessiné
    // ET le formulaire natif), et l'ajout d'un menu n'est jamais oublié ici.
    expect(serialized).toContain(`(#title_text - '${TITLE_PREFIX}') = #title_text`);
  });

  it("distingue les panneaux à emplacements dessinés des listes génériques", () => {
    for (const section of TILE_SECTIONS) {
      const panelName = TILE_PANELS[section].panel.split(".")[1] as string;
      const panel = serverForm[panelName] as Record<string, unknown>;
      const indexes = collect(panel, "collection_index");
      if (TILE_PANELS[section].indexed) {
        // Mise en page dessinée : chaque tuile a SA position.
        expect(indexes.length).toBeGreaterThan(0);
      } else {
        // Liste générique : le panneau délègue sa colonne à une factory, qui
        // instancie une tuile par bouton reçu (donc aucun index figé).
        expect(indexes.length).toBe(0);
        expect(JSON.stringify(panel)).toContain("server_form.om_list_column");
        const column = serverForm["om_list_column"] as Record<string, unknown>;
        expect(column).toBeDefined();
        expect(JSON.stringify(column)).toContain('"factory"');
        expect(column["collection_name"]).toBe("form_buttons");
        expect(JSON.stringify(column)).toContain("#form_button_contents");
      }
    }
  });

  it("pagine les listes dynamiques sans perdre d'entrée", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g"];
    expect(pageSlice(items, 0, 5)).toEqual({ items: ["a", "b", "c", "d", "e"], page: 0, pageCount: 2 });
    expect(pageSlice(items, 1, 5).items).toEqual(["f", "g"]);
    // Page hors bornes : on retombe sur la dernière page au lieu d'une page vide.
    expect(pageSlice(items, 9, 5).page).toBe(1);
    expect(pageSlice([], 0, 5)).toEqual({ items: [], page: 0, pageCount: 1 });
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

  it("n'utilise que des titres ASCII (le routage JSON UI est littéral)", () => {
    expect(TITLE_PREFIX).toBe("NaLandia » ");
    for (const section of TILE_SECTIONS) {
      // Un titre accentué (« États ») ne matchait pas dans le binding
      // `#title_text = '…'` : le menu retombait entièrement sur le cadre
      // vanilla, sans aucun signe côté script. Le préfixe commun (avec son
      // guillemet français, commun à TOUS les menus) est le seul caractère
      // non ASCII autorisé ; le nom de section, lui, doit rester ASCII.
      const title = tileTitleFor(section);
      expect(title.startsWith(TITLE_PREFIX)).toBe(true);
      expect(title.slice(TITLE_PREFIX.length)).toMatch(/^[\x20-\x7e]+$/);
      expect(section).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("envoie bien toutes les clés attendues par les panneaux dessinés", () => {
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) sources.push(readFileSync(path, "utf8"));
      }
    };
    walk(join(ROOT, "src"));
    const joined = sources.join("\n");
    for (const section of TILE_SECTIONS) {
      if (!TILE_PANELS[section].indexed) continue;
      const { actions, data } = TILE_MENUS[section];
      // Une clé du contrat sans `menu.action("clé")`/`menu.data("clé")` dans le
      // script = une tuile vide à l'écran (et un index décalé).
      for (const key of actions) expect(isSent(joined, "action", key)).toBe(true);
      for (const key of data) expect(isSent(joined, "data", key)).toBe(true);
    }
  });

  it("donne à chaque menu de liste SA fenêtre et SES cartes (menus uniques)", () => {
    const declared = controllers();
    const frames = new Set<string>();
    for (const section of TILE_SECTIONS) {
      const spec = TILE_PANELS[section];
      if (spec.indexed) {
        // Les menus dessinés à la main ont leur propre panneau : aucun thème n'a
        // besoin de leur être attribué ici.
        expect(spec.theme).toBeUndefined();
        continue;
      }
      const theme = MENU_THEMES[section] as MenuTheme | undefined;
      expect(theme).toBeDefined();
      if (theme === undefined) continue;
      expect(spec.theme).toBe(theme.id);

      // Le contrôle racine porte le titre exact de la section…
      const root = declared[spec.controller] as Record<string, unknown>;
      expect(root).toBeDefined();
      expect(JSON.stringify(root)).toContain(`(#title_text = '${tileTitleFor(section)}')`);

      // …et il transmet à `om_menu_panel` les textures et la couleur de SON
      // thème, sinon le menu repartirait sur la fenêtre par défaut.
      const instance = (root["controls"] as Record<string, Record<string, unknown>>[])[0] as Record<
        string,
        Record<string, unknown>
      >;
      const vars = Object.values(instance)[0] as Record<string, unknown>;
      expect(vars["$frame"]).toBe(menuFrameTexture(theme));
      expect(vars["$card"]).toBe(menuCardTexture(theme));
      expect(vars["$card_hover"]).toBe(menuCardTexture(theme, "hover"));
      expect(vars["$card_press"]).toBe(menuCardTexture(theme, "press"));
      expect(vars["$title_color"]).toEqual(theme.titleColor);

      // Chaque texture annoncée existe VRAIMENT, découpage 9 tranches compris.
      for (const texture of [
        vars["$frame"],
        vars["$card"],
        vars["$card_hover"],
        vars["$card_press"],
      ] as string[]) {
        expect(existsSync(join(ROOT, "RP", `${texture}.png`))).toBe(true);
        expect(existsSync(join(ROOT, "RP", `${texture}.json`))).toBe(true);
      }
      frames.add(String(vars["$frame"]));
    }

    // Deux menus ne peuvent plus partager la même fenêtre : ce serait un retour
    // aux trois familles partagées d'avant.
    const generic = TILE_SECTIONS.filter((section) => !TILE_PANELS[section].indexed);
    expect(frames.size).toBe(generic.length);
    expect(new Set(generic.map((section) => TILE_PANELS[section].controller)).size).toBe(generic.length);
  });

  it("ouvre réellement chaque menu à tuiles depuis un script", () => {
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts")) sources.push(readFileSync(path, "utf8"));
      }
    };
    walk(join(ROOT, "src"));
    const joined = sources.join("\n");
    for (const section of TILE_SECTIONS) {
      // Le panneau peut exister dans le JSON et le contrat être juste : si
      // aucun script n'ouvre la section, le menu reste en formulaire natif
      // (c'est exactement ce qui est arrivé à « Le Monde »).
      const opened = new RegExp(`openTileMenu\\([^,]+,\\s*"${section}"`).test(joined);
      expect(opened).toBe(true);
    }
  });

  it("habille aussi les formulaires à champs (plus de cadre vanilla)", () => {
    // Le nom complet de l'élément inclut son héritage (comme dans le fichier
    // vanilla), c'est ce couple qui écrase la définition de Mojang.
    const customForm = serverForm["custom_form@common_dialogs.main_panel_no_buttons"] as Record<string, unknown>;
    expect(customForm).toBeDefined();
    // Le fond gris/blanc « control » de Mojang est remplacé par notre fenêtre
    // or & argent, sinon les formulaires à champs jurent avec les menus à tuiles.
    expect(customForm["$custom_background"]).toBe("server_form.om_dialog_bg");
    const dialogBg = serverForm["om_dialog_bg"] as Record<string, unknown>;
    expect(dialogBg["texture"]).toBe("textures/ui/om_window");
    expect(existsSync(join(ROOT, "RP/textures/ui/om_window.png"))).toBe(true);
    // Même habillage pour le formulaire de secours (titre non reconnu).
    const fallback = controllers()["om_default_form"] as Record<string, unknown>;
    expect(fallback["$custom_background"]).toBe("server_form.om_dialog_bg");
    expect(JSON.stringify(serverForm)).not.toContain("common.dialog_background_opaque");
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
