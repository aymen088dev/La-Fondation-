/**
 * Migrations de schéma de la base de données.
 *
 * Historique :
 *  - v1 → v2 :
 *    • collection "role_members" renommée en "members"
 *    • collection "players" (sessions) convertie en "players_index"
 *      (identité stable par playerId, firstSeen/lastSeen)
 *    • territoires : ajout de ownerId / ownerName / members[]
 *      (owner conserve son rôle de compatibilité)
 */

import { DB_SCHEMA_VERSION } from "./types";
import type { DatabaseFile, StoredDocument } from "./types";

/** Un document brut, sans typage (contexte de migration). */
type RawDocument = StoredDocument<Record<string, unknown>>;

interface TerritoryLike {
  owner?: string;
  ownerId?: string;
  ownerName?: string;
  members?: { playerId: string; name: string; rank: string }[];
}

/**
 * Applique les migrations nécessaires pour amener la base à DB_SCHEMA_VERSION.
 * Ne lève jamais : en cas de structure inattendue, la collection est laissée
 * telle quelle (la suite du chargement la tolère).
 */
export function migrateDatabase(file: DatabaseFile): DatabaseFile {
  const from = typeof file.schemaVersion === "number" ? file.schemaVersion : 0;

  if (from >= DB_SCHEMA_VERSION) return file;
  if (from < 2) migrateV1ToV2(file);

  file.schemaVersion = DB_SCHEMA_VERSION;
  return file;
}

/** Migration v1 → v2. */
function migrateV1ToV2(file: DatabaseFile): void {
  const collections = file.collections ?? {};

  // 1. role_members → members
  const oldMembers = collections["role_members"];
  if (oldMembers !== undefined) {
    const members = collections["members"] ?? [];
    const known = new Set(members.map((doc) => doc.id));
    for (const doc of oldMembers) {
      if (!known.has(doc.id)) members.push(doc);
    }
    collections["members"] = members;
    delete collections["role_members"];
  }

  // 2. players (sessions v1, id = pseudo) → players_index (id = playerId)
  const oldPlayers = collections["players"];
  if (oldPlayers !== undefined) {
    const index = collections["players_index"] ?? [];
    const known = new Set(index.map((doc) => doc.id));
    for (const doc of oldPlayers) {
      const name = typeof doc.data?.name === "string" ? doc.data.name : doc.id;
      if (known.has(name)) continue;
      index.push({
        id: `name:${name}`,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        data: {
          playerId: null, // sera résolu au prochain join
          name,
          firstSeen: doc.createdAt,
          lastSeen: doc.updatedAt,
          sessions: typeof doc.data?.sessions === "number" ? doc.data.sessions : 1,
        },
      });
    }
    collections["players_index"] = index;
    delete collections["players"];
  }

  // 3. territoires : ownerId / ownerName / members[]
  const territories = collections["territories"];
  if (territories !== undefined) {
    for (const doc of territories as RawDocument[]) {
      const data = (doc?.data ?? {}) as TerritoryLike;
      if (typeof data.owner === "string") {
        if (typeof data.ownerName !== "string") data.ownerName = data.owner;
        if (typeof data.ownerId !== "string") data.ownerId = `name:${data.owner}`;
      }
      if (!Array.isArray(data.members)) data.members = [];
    }
  }
}
