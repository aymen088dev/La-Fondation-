/**
 * Menu d'administration de la base de données (/sn:db menu).
 *
 * Navigation par section (collections) avec vue détaillée de chaque
 * document : édition des champs simples (texte/nombre/booléen), suppression,
 * vidage de section — le tout persisté immédiatement.
 * Réservé aux opérateurs (commande GameDirectors).
 */

import type { Player } from "@minecraft/server";
import { windowTitle, openWindow, openWindowRaw, obString, obBool, openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import { collectionLabel, SECTION_ORDER, CLASSES_COLLECTION } from "./collections";
import type { JsonDatabase, StoredDocument } from "./index";

/**
 * Nombre de sections affichées par page : 3 sections + « forcer la sauvegarde »
 * + « réinitialiser une classe » + pagination + retour = 8 tuiles, la capacité
 * exacte de la colonne (`PANEL_TILE_CAPACITY` dans `src/ui/tiles.ts`).
 */
export const DB_SECTIONS_PER_PAGE = 3;

/**
 * Reset de classe (v18) : supprime le choix de classe d'un joueur pour
 * qu'il re-choisisse librement. Disponible ici (admin) et via la fiche
 * joueur du menu Classes.
 */
export function resetClassOf(db: JsonDatabase, playerName: string): boolean {
  return db.delete(CLASSES_COLLECTION, playerName);
}

/** Résumé court d'un document pour les listes. */
function summarize(doc: StoredDocument<Record<string, unknown>>): string {
  const data = doc.data ?? {};

  // Résumés spécifiques par collection courante.
  if (typeof data.name === "string" && data.name !== "") {
    const extras: string[] = [];
    if (typeof data.level === "number") extras.push(`niv. ${data.level}`);
    if (typeof data.role === "string") extras.push(String(data.role));
    if (typeof data.reason === "string") extras.push(String(data.reason).slice(0, 30));
    if (typeof data.enabled === "boolean") extras.push(data.enabled ? "ON" : "OFF");
    if (typeof data.grade === "string" && data.grade !== "") extras.push(`grade ${data.grade}`);
    if (typeof data.class === "string" && data.class !== "") extras.push(`classe ${data.class}`);
    if (typeof data.sessions === "number") extras.push(`${data.sessions} sessions`);
    if (Array.isArray(data.perms)) extras.push(`${data.perms.length} perms`);
    if (Array.isArray(data.members)) extras.push(`${data.members.length} membres`);
    return `§f${data.name}§r§7${extras.length > 0 ? ` — ${extras.join(", ")}` : ""}`;
  }

  if (typeof data.playerId === "string" && data.playerId !== "") {
    return `§fid:${String(data.playerId).slice(0, 12)}…§r§7${typeof data.name === "string" ? ` ${data.name}` : ""}`;
  }

  return `§f${doc.id}`;
}

/**
 * Menu principal — MENU À TUILES « Base de donnees » (panneau console),
 * paginé : une tuile par section (collection), plus la sauvegarde forcée et le
 * reset de classe. Les vues de documents restent des formulaires natifs (ce
 * sont des écrans de LECTURE/ÉDITION, avec des champs).
 */
export async function openDbMenu(db: JsonDatabase, player: Player, page = 0): Promise<void> {
  const stats = db.stats();
  const sections = listSections(db);
  const { items, page: current, pageCount } = pageSlice(sections, page, DB_SECTIONS_PER_PAGE);

  openTileMenu(player, "Base de donnees", (menu) => {
    menu.body(
      [
        "§a§lBase de données§r",
        `§7${stats.documents} documents — ${stats.bytes} octets`,
        `§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}`,
        "",
        `§7Sections — page §f${current + 1}§7/§f${pageCount}`,
        "§8Une tuile par collection : documents, champs, vidage.",
      ].join("\n"),
    );

    for (let slot = 0; slot < DB_SECTIONS_PER_PAGE; slot++) {
      const section = items[slot];
      if (section === undefined) continue;
      menu.action(`section_${slot}`, `${collectionLabel(section)} §8— ${stats.collections[section]} doc`, () => {
        void openSectionMenu(db, player, section);
      });
    }

    menu.action("save", `§aForcer la sauvegarde`, () => {
      db.save(true);
      // v17.1 : plus aucun retour DB dans le chat (console uniquement).
    });
    menu.action("reset", `§dRéinitialiser une classe`, () => {
      void openResetClassMenu(db, player);
    });
    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) void openDbMenu(db, player, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) void openDbMenu(db, player, current + 1);
    });
    menu.action("back", `§7Fermer`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}

/**
 * Reset de classe : dropdown des joueurs ayant une classe → suppression
 * du choix (le joueur re-choisira librement). Silencieux côté chat.
 */
async function openResetClassMenu(db: JsonDatabase, player: Player): Promise<void> {
  const docs = db.find<{ classId?: string }>(CLASSES_COLLECTION);
  if (docs.length === 0) {
    console.log("[DB] Aucune classe à réinitialiser.");
    return;
  }

  await openWindowRaw(player, windowTitle("Reset de classe"), (form) => {
    form.header(`§d§lRéinitialiser une classe`);
    form.label(`§7Le joueur choisira une nouvelle voie à la prochaine ouverture de §f/sn:classes§7.`);
    form.divider();
    for (const doc of docs) {
      form.button(`§f${doc.id} §7— §d${doc.data.classId ?? "?"}`, () => {
        if (resetClassOf(db, doc.id)) {
          db.save();
          console.log(`[DB] Classe de "${doc.id}" réinitialisée par ${player.name}.`);
        }
        void openResetClassMenu(db, player);
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[DB] Erreur menu reset classe : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Menu d'une section : liste des documents + actions. */
async function openSectionMenu(db: JsonDatabase, player: Player, section: string): Promise<void> {
  await openWindow(player, collectionLabel(section), (form) => {
    const docs = db.find<Record<string, unknown>>(section);

    form.label(`§7${docs.length} document(s) — clique pour inspecter/modifier :`);
    form.divider();

    for (const doc of docs) {
      form.button(summarize(doc), () => {
        void openDocumentMenu(db, player, section, doc.id);
      });
    }

    form.divider();
    form.button(`§c§lVider la section`, () => {
      db.clear(section);
      db.save();
      // Retour silencieux (console) — plus de message DB dans le chat.
      console.warn(`[DB] Section "${section}" vidée par ${player.name}.`);
    });
  }).catch((error: unknown) =>
    console.warn(`[DB] Erreur section : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Champs non éditables (structurels). */
const READONLY_KEYS = new Set(["chunkKeys"]);

/** Menu d'un document : champs éditables + actions. */
async function openDocumentMenu(
  db: JsonDatabase,
  player: Player,
  section: string,
  docId: string,
): Promise<void> {
  const doc = db.findOne<Record<string, unknown>>(section, docId);
  if (doc === undefined) {
    // Silencieux côté chat : les retours techniques restent en console.
    console.warn(`[DB] Document ${docId} introuvable (déjà supprimé ?).`);
    return;
  }

  const entries = Object.entries(doc.data).filter(([key]) => !READONLY_KEYS.has(key));

  await openWindowRaw(player, windowTitle(docId), (form) => {
    form.header(`§b§l${docId}`);
    form.label(`§7collection : §f${section}`);

    // Champs éditables : textes, nombres, booléens (toggle). Les observables
    // sont des VRAIES références vivantes : CustomForm y écrit la saisie du
    // joueur en direct, donc l'appliquer relit simplement getData().
    const stringValues: Record<string, ReturnType<typeof obString>> = {};
    const numberValues: Record<string, ReturnType<typeof obString>> = {};
    const boolValues: Record<string, ReturnType<typeof obBool>> = {};
    const readonlyLines: string[] = [];

    for (const [key, value] of entries) {
      if (typeof value === "string") {
        const observable = obString(value);
        stringValues[key] = observable;
        form.textField(`§e${key}`, observable);
      } else if (typeof value === "number") {
        // Un nombre s'édite en texte : on valide à l'application (évite un
        // champ partiellement saisi pendant que le joueur tape).
        const observable = obString(String(value));
        numberValues[key] = observable;
        form.textField(`§e${key} §7(nombre)`, observable);
      } else if (typeof value === "boolean") {
        const toggle = obBool(value);
        boolValues[key] = toggle;
        form.toggleOb(`§e${key}`, toggle);
      } else {
        readonlyLines.push(`§7${key}: §f${summarizeValue(value)}`);
      }
    }

    if (readonlyLines.length > 0) {
      form.divider();
      form.label(`§7— lecture seule —\n${readonlyLines.join("\n")}`);
    }

    form.divider();
    form.button(`§a§lAppliquer`, () => {
      const patch: Record<string, unknown> = {};
      for (const [key, observable] of Object.entries(stringValues)) {
        const next = observable.getData();
        if (next !== doc.data[key]) patch[key] = next;
      }
      for (const [key, observable] of Object.entries(numberValues)) {
        const parsed = Number(observable.getData().replace(",", "."));
        const current = doc.data[key];
        if (Number.isFinite(parsed) && parsed !== current) patch[key] = parsed;
      }
      for (const [key, toggle] of Object.entries(boolValues)) {
        const current = doc.data[key];
        if (typeof current === "boolean" && toggle.getData() !== current) {
          patch[key] = toggle.getData();
        }
      }

      if (Object.keys(patch).length > 0) {
        db.update(section, docId, patch);
        db.save();
        console.warn(`[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
      } else {
        console.warn(`[DB] "${docId}" : aucun changement détecté.`);
      }
    });
    form.closeButton();
  }).catch((error: unknown) =>
    console.warn(`[DB] Erreur document : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Résumé d'une valeur complexe (lecture seule). */
function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} élément(s) [${value
      .slice(0, 3)
      .map((item) => (typeof item === "object" ? JSON.stringify(item).slice(0, 40) : String(item)))
      .join(", ")}${value.length > 3 ? ", …" : ""}]`;
  }
  if (value !== null && typeof value === "object") {
    return `${Object.keys(value as Record<string, unknown>).length} champ(s)`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Les collections présentes dans la DB, triées (ordre connu d'abord). */
function listSections(db: JsonDatabase): string[] {
  const stats = db.stats();
  const names = Object.keys(stats.collections).filter((name) => stats.collections[name] > 0);
  return names.sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
