/**
 * Module Métiers — la base, SANS aucun métier pour l'instant (comme
 * demandé) : collections, manager et menus prêts à accueillir le
 * catalogue qui sera complété plus tard.
 *
 * Schéma d'un métier (à venir) : id, nom, couleur, icône, XP par action
 * (mine, cut, kill...), niveaux avec récompenses. Le joueur pourra
 * exercer plusieurs métiers en parallèle (contrairement à la classe,
 * qui est une route unique).
 */

import type { JsonDatabase } from "../db";
import { JOBS_COLLECTION } from "../db/collections";

/** Collection DB des métiers exercés (un document par métier exercé). */
export { JOBS_COLLECTION };

export interface JobSelection {
  /** Pseudo du joueur (les managers du projet sont indexés par pseudo). */
  playerName: string;
  /** id du métier (catalogue vide à la création de cette base). */
  jobId: string;
  xp: number;
  startedAt: number;
}

/** XP par niveau de métier : paliers de 50 XP (rythme plus rapide que les classes). */
export const JOB_XP_PER_LEVEL = 50;

/** Niveau d'un métier (paliers de 50 XP). */
export function jobLevel(xp: number): number {
  return Math.floor(xp / JOB_XP_PER_LEVEL) + 1;
}

/**
 * Manager des métiers. Le catalogue est volontairement VIDE : ce module
 * pose les fondations (stockage, XP, niveaux, menus) sans proposer
 * encore aucun métier.
 */
export class JobManager {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  /** Les métiers exercés par le joueur (vide = aucun). */
  jobsOf(playerName: string): JobSelection[] {
    return this.db
      .find<JobSelection>(JOBS_COLLECTION, (doc) => doc.data.playerName === playerName)
      .map((doc) => doc.data);
  }

  /** Exerce-t-il déjà ce métier ? */
  hasJob(playerName: string, jobId: string): boolean {
    return this.jobDoc(playerName, jobId) !== undefined;
  }

  /** Document DB d'un métier précis (usage interne). */
  private jobDoc(playerName: string, jobId: string) {
    return this.db
      .find<JobSelection>(JOBS_COLLECTION, (doc) => doc.data.playerName === playerName && doc.data.jobId === jobId)
      .at(0);
  }

  /** Ajoute de l'XP à un métier exercé. Renvoie false si le métier n'est pas pris. */
  addXp(playerName: string, jobId: string, amount: number): boolean {
    const doc = this.jobDoc(playerName, jobId);
    if (doc === undefined || amount <= 0) return false;
    doc.data.xp += amount;
    doc.updatedAt = Date.now();
    this.db.markDirty();
    return true;
  }

  /** Abandonne un métier (libère la place pour le futur catalogue). */
  quitJob(playerName: string, jobId: string): boolean {
    const doc = this.jobDoc(playerName, jobId);
    if (doc === undefined) return false;
    return this.db.delete(JOBS_COLLECTION, doc.id);
  }
}
