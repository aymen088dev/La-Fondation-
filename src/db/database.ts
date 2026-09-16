import { DB_SCHEMA_VERSION } from "./types";
import type { DatabaseFile, StoredDocument } from "./types";
import type { StorageAdapter } from "./storage";
import { migrateDatabase } from "./migrations";

/** Génère un identifiant unique suffisant pour une DB locale. */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface DatabaseStats {
  collections: Record<string, number>;
  documents: number;
  bytes: number;
  savedAt: number;
  dirty: boolean;
}

/**
 * Base de données JSON locale, organisée en collections de documents.
 *
 * Usage :
 * ```ts
 * const db = new JsonDatabase(createBedrockStorage(), "openmontage");
 * db.load();
 * db.insert("players", { name: "Aymen", sessions: 1 }, "Aymen");
 * db.save();
 * ```
 *
 * Les mutations marquent la base comme "dirty" ; save() n'écrit que si
 * nécessaire (sauf force). Pour un jeu, combinez avec registerAutosave().
 */
export class JsonDatabase {
  private file: DatabaseFile;
  private dirty = false;

  /** Passe à true après le premier load() réussi (monde chargé). */
  loaded = false;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly name: string = "openmontage",
  ) {
    this.file = { schemaVersion: DB_SCHEMA_VERSION, name, savedAt: 0, collections: {} };
  }

  /**
   * Charge la base depuis le stockage. À appeler uniquement quand le monde
   * est chargé (worldLoad) : en early execution, la lecture des Dynamic
   * Properties est interdite par Bedrock.
   */
  load(): void {
    try {
      const raw = this.storage.read();
      if (raw === null) return;

      const parsed = JSON.parse(raw) as DatabaseFile;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof parsed.collections !== "object" ||
        parsed.collections === null
      ) {
        throw new Error("structure inattendue");
      }
      migrateDatabase(parsed);
      if (parsed.schemaVersion !== DB_SCHEMA_VERSION) {
        console.warn(
          `[DB] Version de schéma ${parsed.schemaVersion} != ${DB_SCHEMA_VERSION} après migration.`,
        );
      }
      this.file = {
        schemaVersion: DB_SCHEMA_VERSION,
        name: this.name,
        savedAt: parsed.savedAt ?? 0,
        collections: parsed.collections,
      };
      this.dirty = true; // la version migrée sera persistée au prochain save
      this.loaded = true;
    } catch (error) {
      console.warn(
        `[DB] Chargement impossible ("${this.name}") : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Écrit la base dans le stockage si elle a été modifiée (ou si force).
   * Renvoie true si une écriture a eu lieu.
   */
  save(force = false): boolean {
    if (!this.dirty && !force) return false;

    this.file.savedAt = Date.now();
    this.storage.write(JSON.stringify(this.file));
    this.dirty = false;
    return true;
  }

  /** Insère un document (id auto ou fourni) et le renvoie. Échoue si l'id existe. */
  insert<T>(collection: string, data: T, id?: string): StoredDocument<T> {
    const now = Date.now();
    const doc: StoredDocument<T> = { id: id ?? generateId(), createdAt: now, updatedAt: now, data };

    if (this.findOne(collection, doc.id) !== undefined) {
      throw new Error(`[DB] L'id "${doc.id}" existe déjà dans "${collection}" (utilisez upsert).`);
    }

    this.ensureCollection<T>(collection).push(doc);
    this.dirty = true;
    return doc;
  }

  /** Insère ou met à jour un document par identifiant (fusion pour la mise à jour). */
  upsert<T>(collection: string, id: string, data: T): StoredDocument<T> {
    const existing = this.findOne<T>(collection, id);
    if (existing === undefined) {
      return this.insert(collection, data, id);
    }

    existing.data = { ...existing.data, ...data };
    existing.updatedAt = Date.now();
    this.dirty = true;
    return existing;
  }

  /** Renvoie les documents d'une collection, éventuellement filtrés (copie défensive). */
  find<T>(collection: string, predicate?: (doc: StoredDocument<T>) => boolean): StoredDocument<T>[] {
    const docs = this.getCollection<T>(collection);
    return predicate ? docs.filter(predicate) : docs.slice();
  }

  /** Renvoie un document par identifiant. */
  findOne<T>(collection: string, id: string): StoredDocument<T> | undefined {
    return this.getCollection<T>(collection).find((doc) => doc.id === id);
  }

  /** Fusionne un patch dans un document existant et le renvoie. */
  update<T>(collection: string, id: string, patch: Partial<T>): StoredDocument<T> | undefined {
    const doc = this.findOne<T>(collection, id);
    if (doc === undefined) return undefined;

    doc.data = { ...doc.data, ...patch };
    doc.updatedAt = Date.now();
    this.dirty = true;
    return doc;
  }

  /** Supprime un document. Renvoie true s'il existait. */
  delete(collection: string, id: string): boolean {
    const docs = this.getCollection(collection);
    const index = docs.findIndex((doc) => doc.id === id);
    if (index === -1) return false;

    docs.splice(index, 1);
    this.dirty = true;
    return true;
  }

  /** Nombre de documents, éventuellement filtrés. */
  count<T>(collection: string, predicate?: (doc: StoredDocument<T>) => boolean): number {
    return predicate ? this.find(collection, predicate).length : this.getCollection(collection).length;
  }

  /** Vide une collection. Renvoie le nombre de documents supprimés. */
  clear(collection: string): number {
    const docs = this.getCollection(collection);
    const removed = docs.length;
    if (removed > 0) {
      this.file.collections[collection] = [];
      this.dirty = true;
    }
    return removed;
  }

  /** Supprime entièrement une collection. Renvoie true si elle existait. */
  drop(collection: string): boolean {
    if (this.file.collections[collection] === undefined) return false;

    delete this.file.collections[collection];
    this.dirty = true;
    return true;
  }

  /** Statistiques rapides de la base (logs, debug). */
  stats(): DatabaseStats {
    const collections: Record<string, number> = {};
    let documents = 0;
    for (const [name, docs] of Object.entries(this.file.collections)) {
      collections[name] = docs.length;
      documents += docs.length;
    }
    return {
      collections,
      documents,
      bytes: JSON.stringify(this.file).length,
      savedAt: this.file.savedAt,
      dirty: this.dirty,
    };
  }

  /** Accès en lecture (ne crée pas la collection). */
  private getCollection<T>(collection: string): StoredDocument<T>[] {
    const docs = this.file.collections[collection];
    return docs === undefined ? [] : (docs as unknown as StoredDocument<T>[]);
  }

  /** Accès en écriture (crée la collection si besoin). */
  private ensureCollection<T>(collection: string): StoredDocument<T>[] {
    const docs = this.getCollection<T>(collection);
    if (this.file.collections[collection] === undefined) {
      this.file.collections[collection] = docs as unknown as StoredDocument[];
    }
    return docs;
  }
}
