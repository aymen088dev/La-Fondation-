import type { JsonDatabase, StoredDocument } from "../db";
import { TERRITORY_COLLECTION } from "../db/collections";
import type { TerritoryData } from "./types";

/** Collection DB des territoires (les « États » de NaLandia). */
export { TERRITORY_COLLECTION };

/**
 * Limite d'extension : le territoire de départ (1 chunk) peut s'étendre en
 * un carré de CLAN_RADIUS chunks de côté — soit 3×3 chunks autour du chunk
 * fondateur. Les claims doivent être ADJACENTS (côté ou coin) au territoire.
 */
export const CLAN_RADIUS = 1;
export const MAX_CHUNKS_PER_TERRITORY = (CLAN_RADIUS * 2 + 1) ** 2;

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

/** Le chunk (dimension,cx,cz) est-il à portée d'extension (carré 3×3) du chunk fondateur ? */
export function isWithinRadius(foundation: string, dimensionId: string, cx: number, cz: number): boolean {
  const f = parseChunkKey(foundation);
  if (f.dimensionId !== dimensionId) return false;
  return Math.abs(cx - f.cx) <= CLAN_RADIUS && Math.abs(cz - f.cz) <= CLAN_RADIUS;
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
 * Logique métier des clans/États de NaLandia. Toutes les données vivent
 * dans la DB (collection "territories") : le manager ne garde aucun état
 * en cache, il relit donc toujours les données les plus fraîches.
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

  /** Le territoire d'un joueur (par son pseudo, v1/v2). */
  findByOwner(owner: string): StoredDocument<TerritoryData> | undefined {
    return this.db.find<TerritoryData>(TERRITORY_COLLECTION, (doc) => doc.data.owner === owner)[0];
  }

  /** Un clan par son identifiant (relecture fraîche pour les menus). */
  findOne(territoryId: string): StoredDocument<TerritoryData> | undefined {
    return this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
  }

  /** Le territoire dont ce joueur (par id Bedrock) est propriétaire. */
  findByOwnerId(ownerId: string): StoredDocument<TerritoryData> | undefined {
    return this.db.find<TerritoryData>(TERRITORY_COLLECTION, (doc) => doc.data.ownerId === ownerId)[0];
  }

  /** Le territoire où ce playerId est propriétaire OU membre (rang quelconque). */
  findByMemberId(playerId: string): StoredDocument<TerritoryData> | undefined {
    return this.db.find<TerritoryData>(
      TERRITORY_COLLECTION,
      (doc) =>
        doc.data.ownerId === playerId ||
        doc.data.members.some((member) => member.playerId === playerId),
    )[0];
  }

  /** Ce joueur (pseudo) peut-il interagir/bâtir dans ce chunk ? */
  isAllowed(playerName: string, key: string): boolean {
    const territory = this.findByChunk(key);
    return territory === undefined || territory.data.owner === playerName;
  }

  /**
   * Ce joueur (id Bedrock) peut-il construire dans ce chunk ?
   * Vrai si chunk libre, s'il est propriétaire, ou membre du territoire.
   */
  isAllowedFor(playerId: string, playerName: string, key: string): boolean {
    const territory = this.findByChunk(key);
    if (territory === undefined) return true;
    if (territory.data.ownerId === playerId) return true;
    if (territory.data.owner === playerName) return true; // compat v1
    return territory.data.members.some((member) => member.playerId === playerId);
  }

  /** Ce chunk est-il revendiqué par quelqu'un ? */
  isProtected(key: string): boolean {
    return this.findByChunk(key) !== undefined;
  }

  /** La clé est-elle dans le carré d'extension 3×3 de ce clan ? */
  withinBounds(territory: StoredDocument<TerritoryData>, key: string): boolean {
    const foundation = territory.data.chunkKeys[0];
    if (foundation === undefined) return false;
    const { dimensionId, cx, cz } = parseChunkKey(key);
    return isWithinRadius(foundation, dimensionId, cx, cz);
  }

  /** Ce joueur (id Bedrock) peut-il REVENDIQUER (étendre) ce chunk ? (usage : gestionnaire) */
  canClaim(playerId: string, playerName: string, key: string): { ok: boolean; reason?: string } {
    if (this.isProtected(key)) return { ok: false, reason: "Ce chunk appartient déjà à un autre clan." };
    const territory = this.findByMemberId(playerId) ?? this.findByOwner(playerName);
    if (territory === undefined) return { ok: false, reason: "Tu n'as pas de clan : fonde-le avec /sn:create." };
    if (!this.withinBounds(territory, key)) {
      const side = CLAN_RADIUS * 2 + 1;
      return { ok: false, reason: `Extension limitée au carré ${side}×${side} autour du chunk fondateur.` };
    }
    if (territory.data.chunkKeys.includes(key)) {
      return { ok: false, reason: "Ce chunk fait déjà partie de ton clan." };
    }
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) {
      return { ok: false, reason: `Limite d'extension atteinte (${MAX_CHUNKS_PER_TERRITORY} chunks, carré ${CLAN_RADIUS * 2 + 1}×${CLAN_RADIUS * 2 + 1}).` };
    }
    return { ok: true };
  }

  /** Sauvegarde immédiate de la DB sous-jacente. */
  save(): void {
    this.db.save();
  }

  /** Marque la DB dirty (mutations en place, cf. markDirty()). */
  private touch(): void {
    this.db.markDirty();
  }

  // -------------------------------------------------------------------------
  // Membres (v3)
  // -------------------------------------------------------------------------

  /** Ajoute un membre à un territoire. Renvoie une erreur si déjà membre. */
  addMember(territoryId: string, playerId: string, playerName: string): { ok: boolean; error?: string } {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return { ok: false, error: "Territoire introuvable." };
    if (territory.data.ownerId === playerId) return { ok: false, error: "C'est le propriétaire." };
    if (territory.data.members.some((m) => m.playerId === playerId)) {
      return { ok: false, error: `${playerName} fait déjà partie du territoire.` };
    }

    territory.data.members.push({ playerId, name: playerName, rank: "member" });
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Retire un membre (par playerId) d'un territoire. */
  removeMember(territoryId: string, playerId: string): { ok: boolean; error?: string } {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return { ok: false, error: "Territoire introuvable." };

    const before = territory.data.members.length;
    territory.data.members = territory.data.members.filter((m) => m.playerId !== playerId);
    if (territory.data.members.length === before) return { ok: false, error: "Ce joueur n'est pas membre." };

    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Change le rang d'un membre ("member" ou "officer"). */
  setMemberRank(territoryId: string, playerId: string, rank: "member" | "officer"): { ok: boolean; error?: string } {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return { ok: false, error: "Territoire introuvable." };

    const member = territory.data.members.find((m) => m.playerId === playerId);
    if (member === undefined) return { ok: false, error: "Ce joueur n'est pas membre." };
    if (member.rank === rank) return { ok: true };

    member.rank = rank;
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /**
   * Crée un clan sur le chunk à la position donnée : `ownerId` = Player.id
   * Bedrock (identité stable) ; `owner` = pseudo. Valide : nom, 1 clan par
   * joueur, chunk libre.
   */
  create(
    owner: string,
    name: string,
    colorId: string,
    dimensionId: string,
    x: number,
    z: number,
    ownerId?: string,
  ): CreateResult {
    const cleanName = name.trim().replace(/\s+/g, " ");
    const stableOwnerId = ownerId ?? `name:${owner}`;

    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) {
      return { ok: false, error: `Le nom doit faire entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
    }
    if (!NAME_PATTERN.test(cleanName)) {
      return { ok: false, error: "Le nom ne peut contenir que lettres, chiffres, espaces, _ et -." };
    }
    if (this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, cleanName) !== undefined) {
      return { ok: false, error: "Ce nom de clan est déjà pris." };
    }
    if (this.findByOwner(owner) !== undefined) {
      return { ok: false, error: "Tu possèdes déjà un clan." };
    }
    const key = chunkKeyFromPosition(dimensionId, x, z);
    if (this.isProtected(key)) {
      return { ok: false, error: "Ce chunk est déjà revendiqué par un autre clan." };
    }

    const territory = this.db.insert<TerritoryData>(
      TERRITORY_COLLECTION,
      {
        name: cleanName,
        owner,
        ownerId: stableOwnerId,
        ownerName: owner,
        members: [],
        color: colorId,
        chunkKeys: [key],
        createdAt: Date.now(),
      },
      cleanName,
    );
    this.db.save();
    return { ok: true, territory };
  }

  /** Ajoute un chunk à un clan : libre + dans le carré 3×3 du fondateur. */
  addChunk(territoryId: string, key: string): { ok: boolean; reason?: string } {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return { ok: false, reason: "Clan introuvable." };
    if (this.isProtected(key)) return { ok: false, reason: "Ce chunk appartient déjà à un autre clan." };
    if (territory.data.chunkKeys.includes(key)) return { ok: false, reason: "Ce chunk fait déjà partie de ton clan." };
    if (!this.withinBounds(territory, key)) {
      const side = CLAN_RADIUS * 2 + 1;
      return { ok: false, reason: `Extension limitée au carré ${side}×${side} autour du chunk fondateur.` };
    }
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) {
      return { ok: false, reason: `Limite d'extension atteinte (${MAX_CHUNKS_PER_TERRITORY} chunks).` };
    }

    territory.data.chunkKeys.push(key);
    territory.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  /** Dissout un clan (propriétaire uniquement, par id Bedrock ou pseudo compat v1). */
  remove(territoryId: string, requester: string, requesterId?: string): boolean {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return false;
    const isOwner = territory.data.ownerId === requesterId || territory.data.owner === requester;
    if (!isOwner) return false;

    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }

  /** Un membre (non propriétaire) quitte son clan. */
  leave(territoryId: string, playerId: string): boolean {
    const territory = this.db.findOne<TerritoryData>(TERRITORY_COLLECTION, territoryId);
    if (territory === undefined) return false;

    const before = territory.data.members.length;
    territory.data.members = territory.data.members.filter((m) => m.playerId !== playerId);
    if (territory.data.members.length === before) return false;

    territory.updatedAt = Date.now();
    this.db.save();
    return true;
  }

  /** Supprime un territoire sans vérification de propriétaire (usage admin). */
  removeForced(territoryId: string): boolean {
    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }
}
