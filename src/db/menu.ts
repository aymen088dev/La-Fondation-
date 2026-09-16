/**
 * Menu d'administration de la base de données (/sn:db menu).
 *
 * Navigation par section (collections) avec vue détaillée de chaque
 * document : édition des champs simples (texte/nombre/booléen), bascule
 * d'éléments dans les tableaux simples (perms, membres), suppression,
 * vidage de section — le tout persisté immédiatement.
 * Réservé aux opérateurs (commande GameDirectors).
 */

import type { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { ICONS } from "../ui/theme";
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
  const stats = db.stats();
  const sections = listSections(db);

  const form = new ActionFormData()
    .title("OpenMontage » Base de données")
    .body(
      `§7${stats.documents} documents · ${stats.bytes} octets\n` +
        `§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}\n` +
        `§7Choisis une section à explorer :`,
    );

  for (const section of sections) {
    form.button(`${collectionLabel(section)}\n§8${stats.collections[section]} doc(s)`, ICONS.iconSetting);
  }
  form.button("💾 Forcer la sauvegarde", ICONS.save);
  form.button("§c« Fermer", ICONS.iconImport);

  const response = await form.show(player);
  if (response.canceled) return;

  if (response.selection === sections.length) {
    db.save(true);
    player.sendMessage("§a[DB] Sauvegarde forcée.");
    return;
  }
  if (response.selection === sections.length + 1) return;

  const section = sections[response.selection ?? 0];
  if (section !== undefined) await openSectionMenu(db, player, section);
}

/** Menu d'une section : liste des documents + actions. */
async function openSectionMenu(db: JsonDatabase, player: Player, section: string): Promise<void> {
  const docs = db.find<Record<string, unknown>>(section);

  const form = new ActionFormData()
    .title(`OpenMontage » ${collectionLabel(section)}`)
    .body(`§7${docs.length} document(s) — clique pour inspecter/modifier :`);

  for (const doc of docs) form.button(summarize(doc));
  form.button("§c🗑 Vider la section", ICONS.trash);
  form.button("§7« Retour", ICONS.iconImport);

  const response = await form.show(player);
  if (response.canceled) return;

  if (response.selection === docs.length) {
    const removed = db.clear(section);
    db.save();
    player.sendMessage(`§c[DB] Section "${section}" vidée (${removed} document(s) supprimés).`);
    return;
  }
  if (response.selection === docs.length + 1) {
    await openDbMenu(db, player);
    return;
  }

  const doc = docs[response.selection ?? 0];
  if (doc !== undefined) await openDocumentMenu(db, player, section, doc.id);
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
  const form = new ModalFormData().title(`OpenMontage » ${docId}`);

  // Champs éditables : textes, nombres, booléens (toggle). Le reste est
  // affiché en lecture seule.
  const editableKeys: string[] = [];
  const kinds: ("string" | "number" | "boolean")[] = [];
  const readonlyLines: string[] = [];

  for (const [key, value] of entries) {
    if (typeof value === "string") {
      form.textField(`§e${key}`, value, { defaultValue: value });
      editableKeys.push(key);
      kinds.push("string");
    } else if (typeof value === "number") {
      form.textField(`§e${key} §7(nombre)`, String(value), { defaultValue: String(value) });
      editableKeys.push(key);
      kinds.push("number");
    } else if (typeof value === "boolean") {
      form.toggle(`§e${key}`, { defaultValue: value });
      editableKeys.push(key);
      kinds.push("boolean");
    } else {
      readonlyLines.push(`§7${key}: §f${summarizeValue(value)}`);
    }
  }

  form.label(`§7id: §f${docId}\n${readonlyLines.join("\n")}`);
  form.submitButton("💾 Appliquer");

  const response = await form.show(player);
  if (response.canceled) return;

  // Réapplique les valeurs éditées sur les bons champs.
  const values = response.formValues ?? [];
  const patch: Record<string, string | number | boolean> = {};
  let changed = false;
  for (let i = 0; i < editableKeys.length; i++) {
    const key = editableKeys[i];
    const raw = values[i];
    const kind = kinds[i];

    if (kind === "number") {
      const num = Number(raw);
      if (!Number.isNaN(num) && num !== doc.data[key]) {
        patch[key] = num;
        changed = true;
      }
    } else if (kind === "boolean") {
      if (Boolean(raw) !== doc.data[key]) {
        patch[key] = Boolean(raw);
        changed = true;
      }
    } else if (typeof raw === "string" && raw !== doc.data[key]) {
      patch[key] = raw;
      changed = true;
    }
  }

  if (changed) {
    db.update(section, docId, patch);
    db.save();
    player.sendMessage(`§a[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
  } else {
    player.sendMessage("§7[DB] Aucun changement.");
  }

  await openSectionMenu(db, player, section);
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
