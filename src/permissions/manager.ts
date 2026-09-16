/**
 * Système de rôles et permissions, persisté en DB.
 *
 * Un rôle = nom + couleur + prefix (affiché au-dessus du joueur).
 * Hiérarchie par "level" : plus le level est haut, plus le rôle est puissant.
 *
 * Bootstrap sécurité : au premier lancement, le premier opérateur
 * (PlayerPermissionLevel.Operator) détecté reçoit le rôle "Admin".
 */

import type { JsonDatabase } from "../db/database";

/** Collection DB des rôles (id = nom du rôle, ex : "Admin"). */
export const ROLES_COLLECTION = "roles";

/** Collection DB des attributions (id = pseudo du joueur). */
export const MEMBERS_COLLECTION = "role_members";

/** Palette de couleurs disponibles pour les rôles. */
export const ROLE_COLORS: { id: string; code: string }[] = [
  { id: "rouge", code: "§c" },
  { id: "vert", code: "§a" },
  { id: "bleu", code: "§9" },
  { id: "jaune", code: "§e" },
  { id: "or", code: "§6" },
  { id: "violet", code: "§5" },
  { id: "rose", code: "§d" },
  { id: "aqua", code: "§b" },
  { id: "blanc", code: "§f" },
  { id: "gris", code: "§7" },
  { id: "noir", code: "§0" },
  { id: "vert-fonce", code: "§2" },
];

export interface RoleData {
  name: string;
  /** Code couleur Minecraft (§x) du rôle. */
  color: string;
  /** Prefix affiché avant le nom (ex : "[Admin]"). Vide = nom du rôle. */
  prefix: string;
  /** Hiérarchie : 0 = joueur, 100 = admin max. */
  level: number;
}

export interface MemberData {
  name: string;
  /** Nom du rôle attribué. */
  role: string;
  /** Prefix personnalisé (chat/tag), écrase celui du rôle si défini. */
  customPrefix?: string;
  /** Couleur personnalisée du nom, écrase celle du rôle si définie. */
  customColor?: string;
}

export class PermissionManager {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  // -------------------------------------------------------------------------
  // Rôles
  // -------------------------------------------------------------------------

  allRoles() {
    return this.db.find<RoleData>(ROLES_COLLECTION);
  }

  getRole(name: string) {
    return this.db.findOne<RoleData>(ROLES_COLLECTION, name);
  }

  /** Crée un rôle. Échoue s'il existe déjà. */
  createRole(name: string, color: string, level: number): { ok: boolean; error?: string } {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 16) {
      return { ok: false, error: "Le nom du rôle doit faire entre 2 et 16 caractères." };
    }
    if (this.getRole(clean) !== undefined) {
      return { ok: false, error: `Le rôle "${clean}" existe déjà.` };
    }

    this.db.insert<RoleData>(
      ROLES_COLLECTION,
      { name: clean, color, prefix: `[${clean}]`, level },
      clean,
    );
    this.db.save();
    return { ok: true };
  }

  deleteRole(name: string): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    // Interdit de supprimer les rôles système
    if (role.data.level >= 100) return { ok: false, error: "Impossible de supprimer un rôle Admin." };

    // Détache tous les membres avant suppression
    for (const member of this.db.find<MemberData>(MEMBERS_COLLECTION, (doc) => doc.data.role === name)) {
      this.db.delete(MEMBERS_COLLECTION, member.id);
    }
    this.db.delete(ROLES_COLLECTION, name);
    this.db.save();
    return { ok: true };
  }

  /** Change la couleur d'un rôle. */
  setRoleColor(name: string, colorId: string): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    const color = ROLE_COLORS.find((candidate) => candidate.id === colorId);
    if (color === undefined) return { ok: false, error: "Couleur inconnue." };

    role.data.color = color.code;
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  /** Change le prefix d'un rôle ("" = revenir au défaut [Nom]). */
  setRolePrefix(name: string, prefix: string): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    role.data.prefix = prefix.trim();
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  /** Change le niveau hiérarchique d'un rôle. */
  setRoleLevel(name: string, level: number): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    role.data.level = Math.max(0, Math.min(1000, Math.floor(level)));
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------

  getMember(playerName: string) {
    return this.db.findOne<MemberData>(MEMBERS_COLLECTION, playerName);
  }

  allMembers() {
    return this.db.find<MemberData>(MEMBERS_COLLECTION);
  }

  membersWithRole(roleName: string) {
    return this.db.find<MemberData>(MEMBERS_COLLECTION, (doc) => doc.data.role === roleName);
  }

  /** Attribue un rôle à un joueur (upsert). */
  assignRole(playerName: string, roleName: string): { ok: boolean; error?: string } {
    if (this.getRole(roleName) === undefined) {
      return { ok: false, error: `Le rôle "${roleName}" n'existe pas.` };
    }

    const existing = this.getMember(playerName);
    if (existing === undefined) {
      this.db.insert<MemberData>(MEMBERS_COLLECTION, { name: playerName, role: roleName }, playerName);
    } else {
      existing.data.role = roleName;
      existing.updatedAt = Date.now();
    }
    this.db.save();
    return { ok: true };
  }

  /** Retire le rôle d'un joueur. */
  removeRole(playerName: string): boolean {
    return this.db.delete(MEMBERS_COLLECTION, playerName);
  }

  /** Prefix personnalisé d'un joueur ("" pour réinitialiser). */
  setCustomPrefix(playerName: string, prefix: string): { ok: boolean; error?: string } {
    const member = this.getMember(playerName);
    if (member === undefined) return { ok: false, error: "Ce joueur n'a pas de rôle." };

    member.data.customPrefix = prefix.trim() || undefined;
    member.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  /** Couleur personnalisée du nom d'un joueur ("" pour réinitialiser). */
  setCustomColor(playerName: string, colorId: string): { ok: boolean; error?: string } {
    const member = this.getMember(playerName);
    if (member === undefined) return { ok: false, error: "Ce joueur n'a pas de rôle." };

    if (colorId === "") {
      member.data.customColor = undefined;
    } else {
      const color = ROLE_COLORS.find((candidate) => candidate.id === colorId);
      if (color === undefined) return { ok: false, error: "Couleur inconnue." };
      member.data.customColor = color.code;
    }
    member.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Rendu visuel
  // -------------------------------------------------------------------------

  /** Rôle effectif d'un joueur (ou undefined si aucun). */
  roleOf(playerName: string) {
    const member = this.getMember(playerName);
    return member === undefined ? undefined : this.getRole(member.data.role);
  }

  /** Level effectif d'un joueur (0 si aucun rôle). */
  levelOf(playerName: string): number {
    return this.roleOf(playerName)?.data.level ?? 0;
  }

  /** Le tag complet au-dessus du joueur : "§6[Admin] §fAymen". */
  nameTagFor(playerName: string): string {
    const member = this.getMember(playerName);
    const role = this.roleOf(playerName);

    if (role === undefined) return `§f${playerName}`;

    const color = member?.data.customColor ?? role.data.color;
    const prefix = member?.data.customPrefix ?? role.data.prefix;
    const prefixPart = prefix === "" ? "" : `${color}${prefix} §r`;
    return `${prefixPart}${color}${playerName}`;
  }

  // -------------------------------------------------------------------------
  // Bootstrap : premier admin automatique
  // -------------------------------------------------------------------------

  /** Le monde a-t-il déjà un admin (quelqu'un avec level >= 100) ? */
  hasAdmin(): boolean {
    return this.allRoles().some((role) => role.data.level >= 100);
  }

  /** Crée le rôle Admin par défaut et l'attribue au premier opérateur vu. */
  bootstrapAdmin(operatorName: string): void {
    if (this.getRole("Admin") === undefined) {
      this.db.insert<RoleData>(
        ROLES_COLLECTION,
        { name: "Admin", color: "§c", prefix: "[Admin]", level: 100 },
        "Admin",
      );
    }
    this.assignRole(operatorName, "Admin");
  }
}
