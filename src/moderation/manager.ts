/**
 * Module de modération : bans, mutes, warns et historique, persistés en DB.
 *
 * - Ban : persistant -> le joueur est éjecté au join s'il est banni
 * - Mute : temporisé -> ses messages chat sont bloqués
 * - Warn : compteur d'avertissements avec historique
 * - Kick : éjection immédiate (via dimension.runCommand("kick"), côté serveur)
 *
 * Toutes les sanctions sont journalisées dans la collection "infractions".
 */

import type { JsonDatabase } from "../db/database";
import { BANS_COLLECTION, MUTES_COLLECTION, WARNS_COLLECTION, INFRACTIONS_COLLECTION } from "../db/collections";

export { BANS_COLLECTION, MUTES_COLLECTION, WARNS_COLLECTION, INFRACTIONS_COLLECTION };

export interface BanData {
  name: string;
  reason: string;
  by: string;
  at: number;
  /** Timestamp d'expiration, ou 0 = permanent. */
  expiresAt: number;
  /** Player.id Bedrock (v3) : null tant que non résolu (ban par pseudo). */
  playerId: string | null;
}

export interface MuteData {
  name: string;
  reason: string;
  by: string;
  at: number;
  expiresAt: number;
  /** Player.id Bedrock (v3) : null tant que non résolu. */
  playerId: string | null;
}

export interface WarnData {
  name: string;
  reason: string;
  by: string;
  at: number;
  /** Player.id Bedrock (v3) : null tant que non résolu. */
  playerId: string | null;
}

export type InfractionKind = "ban" | "unban" | "mute" | "unmute" | "warn" | "kick";

/**
 * Le playerId (Player.id Bedrock) est passé OPTIONNELLEMENT par les couches
 * supérieures (commandes/GUI) qui ont accès à `world` — le manager reste
 * pur et testable hors du jeu. La couche commandes résout via le joueur
 * en ligne, ou via l'index joueurs (src/players.ts) pour un offline connu.
 */

export interface InfractionEntry {
  kind: InfractionKind;
  target: string;
  by: string;
  reason: string;
  at: number;
  /** Durée en minutes (0 = permanent/immédiat). */
  durationMinutes: number;
}

/** Format lisible d'une durée en minutes. */
export function formatDuration(minutes: number): string {
  if (minutes === 0) return "permanent";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export class SanctionsManager {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;

  /** Accès DB (lecture pour tests et GUI avancées). */
  readonly db: JsonDatabase;

  constructor(db: JsonDatabase) {
    this.db = db;
  }

  markLoaded(): void {
    this.loaded = true;
  }

  /** Journalise une infraction (historique). */
  log(kind: InfractionKind, target: string, by: string, reason: string, durationMinutes = 0): void {
    this.db.insert<InfractionEntry>(
      INFRACTIONS_COLLECTION,
      { kind, target, by, reason, at: Date.now(), durationMinutes },
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    this.db.save();
  }

  // -------------------------------------------------------------------------
  // Bans
  // -------------------------------------------------------------------------

  /** Banni un joueur. durationMinutes = 0 -> permanent. playerId = Player.id si connu. */
  ban(
    name: string,
    by: string,
    reason: string,
    durationMinutes = 0,
    playerId?: string | null,
  ): { ok: boolean; error?: string } {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };

    this.db.upsert<BanData>(BANS_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 60_000,
      playerId: playerId ?? null,
    });
    this.db.save();
    this.log("ban", name, by, reason, durationMinutes);
    return { ok: true };
  }

  unban(name: string): { ok: boolean; error?: string } {
    const removed = this.db.delete(BANS_COLLECTION, name);
    if (!removed) return { ok: false, error: `${name} n'est pas banni.` };

    this.db.save();
    this.log("unban", name, "—", "déban");
    return { ok: true };
  }

  /** Le joueur est-il banni ? Renvoie la raison si oui (avec purge des bans expirés). */
  getBan(name: string): BanData | undefined {
    const ban = this.db.findOne<BanData>(BANS_COLLECTION, name);
    if (ban === undefined) return undefined;

    if (ban.data.expiresAt !== 0 && ban.data.expiresAt <= Date.now()) {
      this.db.delete(BANS_COLLECTION, name);
      this.db.save();
      return undefined;
    }
    return ban.data;
  }

  isBanned(name: string): boolean {
    return this.getBan(name) !== undefined;
  }

  allBans() {
    return this.db.find<BanData>(BANS_COLLECTION);
  }

  // -------------------------------------------------------------------------
  // Mutes
  // -------------------------------------------------------------------------

  mute(
    name: string,
    by: string,
    reason: string,
    durationMinutes: number,
    playerId?: string | null,
  ): { ok: boolean; error?: string } {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };

    this.db.upsert<MuteData>(MUTES_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 60_000,
      playerId: playerId ?? null,
    });
    this.db.save();
    this.log("mute", name, by, reason, durationMinutes);
    return { ok: true };
  }

  unmute(name: string): { ok: boolean; error?: string } {
    const removed = this.db.delete(MUTES_COLLECTION, name);
    if (!removed) return { ok: false, error: `${name} n'est pas muet.` };

    this.db.save();
    this.log("unmute", name, "—", "démute");
    return { ok: true };
  }

  /** Le joueur est-il muet ? (purge automatique des mutes expirés) */
  getMute(name: string): MuteData | undefined {
    const mute = this.db.findOne<MuteData>(MUTES_COLLECTION, name);
    if (mute === undefined) return undefined;

    if (mute.data.expiresAt !== 0 && mute.data.expiresAt <= Date.now()) {
      this.db.delete(MUTES_COLLECTION, name);
      this.db.save();
      return undefined;
    }
    return mute.data;
  }

  isMuted(name: string): boolean {
    return this.getMute(name) !== undefined;
  }

  allMutes() {
    return this.db.find<MuteData>(MUTES_COLLECTION);
  }

  // -------------------------------------------------------------------------
  // Warns
  // -------------------------------------------------------------------------

  warn(name: string, by: string, reason: string, playerId?: string | null): { ok: boolean; error?: string } {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };

    this.db.insert<WarnData>(WARNS_COLLECTION, { name, reason, by, at: Date.now(), playerId: playerId ?? null });
    this.db.save();
    this.log("warn", name, by, reason);
    return { ok: true };
  }

  warnsOf(name: string) {
    return this.db.find<WarnData>(WARNS_COLLECTION, (doc) => doc.data.name === name);
  }

  /** Retire le dernier warn d'un joueur (pardon). */
  clearLastWarn(name: string): boolean {
    const warns = this.warnsOf(name);
    const last = warns[warns.length - 1];
    if (last === undefined) return false;

    this.db.delete(WARNS_COLLECTION, last.id);
    this.db.save();
    return true;
  }

  // -------------------------------------------------------------------------
  // Historique
  // -------------------------------------------------------------------------

  /** Historique des infractions d'un joueur (du plus récent au plus ancien). */
  historyOf(name: string, limit = 10) {
    // Les ids étant chronologiques, on trie par ordre d'insertion inversé :
    // plus robuste que le timestamp quand plusieurs sanctions partagent la même ms.
    return this.db
      .find<InfractionEntry>(INFRACTIONS_COLLECTION, (doc) => doc.data.target === name)
      .reverse()
      .slice(0, limit);
  }

  stats(): { bans: number; mutes: number; warns: number } {
    return {
      bans: this.allBans().length,
      mutes: this.allMutes().length,
      warns: this.db.count(WARNS_COLLECTION),
    };
  }
}
