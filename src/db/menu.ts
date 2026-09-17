/**
 * Menu d'administration de la base de données (/sn:db menu).
 *
 * Navigation par section (collections) avec vue détaillée de chaque
 * document : édition des champs simples (texte/nombre/booléen), suppression,
 * vidage de section — le tout persisté immédiatement.
 * Réservé aux opérateurs (commande GameDirectors).
 */

import type { Player } from "@minecraft/server";
import { windowTitle, openWindow, openWindowRaw, obString, obBool } from "../ui/theme";
import { collectionLabel, SECTION_ORDER } from "./collections";
import type { JsonDatabase, StoredDocument } from "./index";

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
    return `§f${data.name}§r§7${extras.length > 0 ? ` — ${extras.join(" · ")}` : ""}`;
  }

  if (typeof data.playerId === "string" && data.playerId !== "") {
    return `§fid:${String(data.playerId).slice(0, 12)}…§r§7${typeof data.name === "string" ? ` ${data.name}` : ""}`;
  }

  return `§f${doc.id}`;
}

/** Menu principal : stats globales + sections. */
export async function openDbMenu(db: JsonDatabase, player: Player): Promise<void> {
  await openWindow(player, "Base de données", (form) => {
    const stats = db.stats();
    const sections = listSections(db);

    form.hero("database");
    form.header(`§a■ §lBase de données`);
    form.label(
      `§7${stats.documents} documents · ${stats.bytes} octets\n§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}`,
    );
    form.divider();

    for (const section of sections) {
      form.button(
        `${collectionLabel(section)}\n§8${stats.collections[section]} doc(s)`,
        () => {
          void openSectionMenu(db, player, section);
        }, undefined, "database",
      );
    }

    form.divider();
    form.button(`§a■ §lForcer la sauvegarde`, () => {
      db.save(true);
      player.sendMessage("§a[DB] Sauvegarde forcée.");
    }, undefined, "save");
  }).catch((error: unknown) =>
    console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`),
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
    form.button(`§c■ §lVider la section`, () => {
      const removed = db.clear(section);
      db.save();
      player.sendMessage(`§c[DB] Section "${section}" vidée (${removed} document(s) supprimés).`);
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
    player.sendMessage("§c[DB] Document introuvable (déjà supprimé ?).");
    return;
  }

  const entries = Object.entries(doc.data).filter(([key]) => !READONLY_KEYS.has(key));

  await openWindowRaw(player, windowTitle(docId), (form) => {
    form.header(`§b■ §l${docId}`);
    form.label(`§7collection : §f${section}`);

    // Champs éditables : textes, nombres, booléens (toggle). Le reste est
    // affiché en lecture seule.
    const editableKeys: string[] = [];
    const kinds: ("string" | "number" | "boolean")[] = [];
    const boolValues: Record<string, ReturnType<typeof obBool>> = {};
    const readonlyLines: string[] = [];

    for (const [key, value] of entries) {
      if (typeof value === "string") {
        form.textField(`§e${key}`, obString(value));
        editableKeys.push(key);
        kinds.push("string");
      } else if (typeof value === "number") {
        form.textField(`§e${key} §7(nombre)`, obString(String(value)));
        editableKeys.push(key);
        kinds.push("number");
      } else if (typeof value === "boolean") {
        const toggle = obBool(value);
        boolValues[key] = toggle;
        form.toggleOb(`§e${key}`, toggle);
        editableKeys.push(key);
        kinds.push("boolean");
      } else {
        readonlyLines.push(`§7${key}: §f${summarizeValue(value)}`);
      }
    }

    if (readonlyLines.length > 0) {
      form.divider();
      form.label(`§7— lecture seule —\n${readonlyLines.join("\n")}`);
    }

    form.divider();
    form.button(`§a■ §lAppliquer`, () => {
      // NOTE : les textes saisis ne sont pas relisibles depuis l'Observable
      // après fermeture dans cette bêta (le binding est initialisé avec la
      // valeur d'origine) : seuls les toggles sont appliqués de façon fiable.
      const patch: Record<string, boolean> = {};
      for (const [key, toggle] of Object.entries(boolValues)) {
        const current = doc.data[key];
        if (typeof current === "boolean" && toggle.getData() !== current) {
          patch[key] = toggle.getData();
        }
      }

      if (Object.keys(patch).length > 0) {
        db.update(section, docId, patch);
        db.save();
        player.sendMessage(`§a[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
      } else {
        player.sendMessage("§7[DB] Aucun changement (seuls les interrupteurs sont éditables).");
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
