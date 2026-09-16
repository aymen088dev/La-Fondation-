import type { JsonDatabase } from "./db";

/**
 * Enregistrement des joueurs dans la DB (collection "players").
 */

export interface PlayerRecord {
  name: string;
  sessions: number;
}

/** Insère le joueur ou incrémente son compteur de sessions. */
export function trackPlayerJoin(db: JsonDatabase, playerName: string): void {
  const record = db.findOne<PlayerRecord>("players", playerName);

  db.upsert<PlayerRecord>("players", playerName, {
    name: playerName,
    sessions: (record?.data.sessions ?? 0) + 1,
  });
}
