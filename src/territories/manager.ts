import type { JsonDatabase, StoredDocument } from "../db";
import type { TerritoryData } from "./types";

/** Collection DB des territoires. */
export const TERRITORY_COLLECTION = "territories";

/** Limite de chunks par territoire (extensible via /sn:claim à l'avenir). */
export const MAX_CHUNKS_PER_TERRITORY = 64;

const NAME_MIN = 3;
const NAME_MAX = 24;
const NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;

/** Clé unique d'un chunk : `${dimensionId}:${cx}:${cz}`. */
export function chunkKey(dimensionId: string, cx: number, cz: number): string {
  return `${dimensionId}:${cx}:${cz}`;
}

/** Clé du chunk contenant une position monde. */
export function chunkKeyFromPosition(dimensionId: string, x: number, z: number): string {
  return chunkKey(dimensionId, Math.floor(x / 16), Math.floor(z / 16));
}

/** Décompose une clé de chunk en coordonnées. */
export function parseChunkKey(key: string): { dimensionId: string; cx: number; cz: number } {
  const parts = key.split(":");
  const cx = Number(parts[parts.length - 2]);
  const cz = Number(parts[parts.length - 1]);
  const dimensionId = parts.slice(0, -2).join(":");
  return { dimensionId, cx, cz };
}

/** Centre d'un chunk (pour afficher une position lisible). */
export function chunkCenter(key: string): { dimensionId: string; x: number; z: number } {
  const { dimensionId, cx, cz } = parseChunkKey(key);
  return { dimensionId, x: cx * 16 + 8, z: cz * 16 + 8 };
}

/** Formatage de date lisible sans Intl (non disponible dans QuickJS). */
export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type CreateResult =
  | { ok: true; territory: StoredDocument<TerritoryData> }
  | { ok: false; error: string };

/**
 * Logique métier des territoires. Toutes les données vivent dans la DB
 * (collection "territories") : le manager ne garde aucun état en cache,
 * il relit donc toujours les données les plus fraîches.
 */
export class TerritoryManager {
  /** Passe à true après le chargement de la DB (worldLoad). */
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  /** Tous les territoires. */
  all(): StoredDocument<TerritoryData>[] {
    return this.db.find<TerritoryData>(TERRITORY_COLLECTION);
  }

  /** Le territoire contrôlant ce chunk, s'il existe. */
  findByChunk(key: string): StoredDocument<TerritoryData> | undefined {
    return this.db.find<TerritoryData>(TERRITORY_COLLECTION, (doc) =>
      doc.data.chunkKeys.includes(key),
    )[0];
  }

  /** Le territoire d'un joueur (1 territoire par joueur). */
  findByOwner(owner: string): StoredDocument<TerritoryData> | undefined {
    return this.db.find<TerritoryData>(TERRITORY_COLLECTION, (doc) => doc.data.owner === owner)[0];
  }

  /** Ce joueur peut-il interagir/bâtir dans ce chunk ? */
  isAllowed(playerName: string, key: string): boolean {
    const territory = this.findByChunk(key);
    return territory === undefined || territory.data.owner === playerName;
  }

  /** Ce chunk est-il revendiqué par quelqu'un ? */
  isProtected(key: string): boolean {
    return this.findByChunk(key) !== undefined;
  }

  /**
   * Crée un territoire sur le chunk à la position donnée.
   * Valide : nom, 1 territoire par joueur, chunk libre.
   */
  create(owner: string, name: string, colorId: string, dimensionId: string, x: number, z: number): CreateResult {
    const cleanName = name.trim().replace(/\s+/g, " ");

    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) {
      return { ok: false, error: `Le nom doit faire entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
    }
    if (!NAME_PATTERN.test(cleanName)) {
      return { ok: false, error: "Le nom ne peut contenir que lettres, chiffres, espaces, _ et -." };
    }
    if (this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, cleanName) !== undefined) {
      return { ok: false, error: "Ce nom de territoire est déjà pris." };
    }
    if (this.findByOwner(owner) !== undefined) {
      return { ok: false, error: "Tu possèdes déjà un territoire." };
    }

    const key = chunkKeyFromPosition(dimensionId, x, z);
    if (this.isProtected(key)) {
      return { ok: false, error: "Ce chunk est déjà revendiqué par un autre joueur." };
    }

    const territory = this.db.insert<TerritoryData>(
      TERRITORY_COLLECTION,
      { name: cleanName, owner, color: colorId, chunkKeys: [key], createdAt: Date.now() },
      cleanName,
    );
    this.db.save();
    return { ok: true, territory };
  }

  /** Ajoute un chunk à un territoire (pour /sn:claim futur). */
  addChunk(territoryId: string, key: string): boolean {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined || territory.data.chunkKeys.includes(key)) return false;
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) return false;

    territory.data.chunkKeys.push(key);
    territory.updatedAt = Date.now();
    this.db.save();
    return true;
  }

  /** Supprime un territoire (par son propriétaire). */
  remove(territoryId: string, requester: string): boolean {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined || territory.data.owner !== requester) return false;

    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }
}
