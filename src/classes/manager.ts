/**
 * Module Classes — la « route » que le joueur choisit à sa première
 * connexion (/sn:classes). Choix définitif (réinitialisation réservée aux
 * admins), affichage de sa progression dans le même menu.
 *
 * Base volontairement simple : 3 classes avec XP gagné par les actions
 * du jeu (mine, cut, kill) et niveaux = paliers de 100 XP chacun. Le
 * catalogue et les bonus seront complétés et modulés plus tard.
 */

import type { JsonDatabase, StoredDocument } from "../db";
import { CLASSES_COLLECTION } from "../db/collections";

/** Collection DB des choix de classe (id = pseudo). */
export { CLASSES_COLLECTION };

/** Identifiants du catalogue de classes. */
export const CLASS_IDS = ["guerrier", "mage", "archer"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export interface ClassInfo {
  id: ClassId;
  name: string;
  color: string;
  icon: "sword" | "compass" | "tag";
  description: string;
}

/** Catalogue de classes (extensible — sera modulé plus tard). */
export const CLASS_CATALOG: ClassInfo[] = [
  {
    id: "guerrier",
    name: "Guerrier",
    color: "§c",
    icon: "sword",
    description: "Route du combat au corps à corps",
  },
  {
    id: "mage",
    name: "Mage",
    color: "§5",
    icon: "compass",
    description: "Route de la magie et des potions",
  },
  {
    id: "archer",
    name: "Archer",
    color: "§a",
    icon: "tag",
    description: "Route de la précision et de la distance",
  },
];

export interface ClassSelection {
  classId: ClassId;
  /** Total d'XP accumulé (progression). */
  xp: number;
  chosenAt: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** XP par niveau : paliers de 100 XP. */
export const XP_PER_LEVEL = 100;

/** Niveau actuel (paliers de 100 XP, on démarre niveau 1). */
export function classLevel(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

/** XP déjà accumulé dans le niveau courant (0..99). */
export function classProgress(xp: number): number {
  return xp % XP_PER_LEVEL;
}

/**
 * Manager des classes.
 *
 * ⚠️ `selectClass` applique la règle « route de la première connexion » :
 * le choix est définitif sauf reset explicite (admin, via clearClass).
 */
export class ClassManager {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  /** La sélection de classe du joueur, si elle existe. */
  selectionOf(playerName: string): StoredDocument<ClassSelection> | undefined {
    return this.db.findOne<ClassSelection>(CLASSES_COLLECTION, playerName);
  }

  /** La classe du joueur, si choisie. */
  classOf(playerName: string): ClassSelection | undefined {
    return this.selectionOf(playerName)?.data;
  }

  /**
   * Choix de classe (définitif). Renvoie ok:false si le joueur a déjà
   * une classe ou si l'id est inconnu.
   */
  selectClass(playerName: string, classId: string): Result<ClassSelection> {
    if (this.selectionOf(playerName) !== undefined) {
      return { ok: false, error: "Tu as déjà choisi ta classe (choix définitif)." };
    }
    const info = CLASS_CATALOG.find((candidate) => candidate.id === classId);
    if (info === undefined) return { ok: false, error: "Classe inconnue." };

    const doc = this.db.insert<ClassSelection>(CLASSES_COLLECTION, {
      classId: info.id,
      xp: 0,
      chosenAt: Date.now(),
    }, playerName);
    return { ok: true, value: doc.data };
  }

  /** Ajoute de l'XP de classe (progression). Renvoie false si pas de classe. */
  addXp(playerName: string, amount: number): boolean {
    const doc = this.selectionOf(playerName);
    if (doc === undefined || amount <= 0) return false;
    doc.data.xp += amount;
    doc.updatedAt = Date.now();
    this.db.markDirty();
    return true;
  }

  /** Réinitialisation admin : le joueur pourra re-choisir. */
  clearClass(playerName: string): boolean {
    return this.db.delete(CLASSES_COLLECTION, playerName);
  }

  /** Nombre total de choix par classe (stats admin /sn:db). */
  countsByClass(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const doc of this.db.find<ClassSelection>(CLASSES_COLLECTION)) {
      counts[doc.data.classId] = (counts[doc.data.classId] ?? 0) + 1;
    }
    return counts;
  }
}
