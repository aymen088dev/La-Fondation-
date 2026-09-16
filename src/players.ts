import type { JsonDatabase } from "./db";
import { PLAYERS_COLLECTION } from "./db/collections";

/**
 * Index des joueurs (collection "players_index").
 *
 * Identité stable = Player.id (l'identifiant Bedrock du joueur, stable
 * dans un même monde entre les sessions — l'API bêta 2.11 n'expose pas
 * de xuid). L'id sert de clé primaire ; le pseudo est résolu à la volée.
 *
 * Deux formes d'id de document :
 *  - `<playerId>` quand le playerId Bedrock est connu (join)
 *  - `name:<pseudo>` pour les entrées héritées de la v1, résolues au join
 */

/** Collection DB de l'index joueurs. */
export { PLAYERS_COLLECTION };

export interface PlayerRecord {
  /** Player.id Bedrock (null pour les entrées migrées pas encore re-vues). */
  playerId: string | null;
  /** Dernier pseudo connu (les pseudos peuvent changer). */
  name: string;
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  /** Grade/rôle actuel (copie dénormalisée pour les listes rapides). */
  grade: string;
}

/** Recherche par identifiant Bedrock direct. */
export function findPlayerById(db: JsonDatabase, playerId: string) {
  return db.findOne<PlayerRecord>(PLAYERS_COLLECTION, playerId);
}

/** Recherche par pseudo (entrée migrée ou entrée à jour). */
export function findPlayerByName(db: JsonDatabase, playerName: string) {
  return db.find<PlayerRecord>(
    PLAYERS_COLLECTION,
    (doc) => doc.data.name === playerName,
  )[0];
}

/**
 * Enregistre un join : crée/met à jour l'entrée du joueur, migre l'entrée
 * héritée `name:<pseudo>` si présente, et renvoie l'id du document.
 */
export function trackPlayerJoin(
  db: JsonDatabase,
  playerId: string,
  playerName: string,
  grade = "",
): string {
  const now = Date.now();
  const existing = findPlayerById(db, playerId);
  const legacy = findPlayerByName(db, playerName);

  // Entrée à jour : refresh + copie du grade.
  if (existing !== undefined) {
    existing.data.name = playerName;
    existing.data.lastSeen = now;
    existing.data.sessions += 1;
    if (grade !== "") existing.data.grade = grade;
    existing.updatedAt = now;
    db.save();
    return existing.id;
  }

  // Entrée migrée name:<pseudo> : on la promeut sur le vrai id Bedrock.
  if (legacy !== undefined && legacy.id.startsWith("name:")) {
    db.delete(PLAYERS_COLLECTION, legacy.id);
    const promoted = db.insert<PlayerRecord>(
      PLAYERS_COLLECTION,
      {
        playerId,
        name: playerName,
        firstSeen: legacy.data.firstSeen,
        lastSeen: now,
        sessions: legacy.data.sessions + 1,
        grade: grade !== "" ? grade : legacy.data.grade,
      },
      playerId,
    );
    db.save();
    return promoted.id;
  }

  // Première visite.
  db.insert<PlayerRecord>(
    PLAYERS_COLLECTION,
    { playerId, name: playerName, firstSeen: now, lastSeen: now, sessions: 1, grade },
    playerId,
  );
  db.save();
  return playerId;
}

/** Résout un pseudo en entrée d'index (id Bedrock si connu). */
export function resolvePlayer(db: JsonDatabase, playerName: string) {
  return findPlayerByName(db, playerName);
}

/** Tous les joueurs connus, triés par dernière activité. */
export function allKnownPlayers(db: JsonDatabase) {
  return db
    .find<PlayerRecord>(PLAYERS_COLLECTION)
    .sort((a, b) => b.data.lastSeen - a.data.lastSeen);
}
