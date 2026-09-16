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
import { defaultPermsForLevel, isPermId } from "./perms";
import type { PermId } from "./perms";

/** Nom du rôle attribué à tous les nouveaux joueurs. */
export const DEFAULT_ROLE_NAME = "Joueur";
/** Couleur du rôle Joueur : gris foncé. */
export const DEFAULT_ROLE_COLOR = "§8";
/** Prefix du rôle Joueur. */
export const DEFAULT_ROLE_PREFIX = "[Joueur]";

import { ROLES_COLLECTION, MEMBERS_COLLECTION } from "../db/collections";

/** Collection DB des rôles (id = nom du rôle, ex : "Admin"). */
export { ROLES_COLLECTION, MEMBERS_COLLECTION };

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
  /**
   * Permissions explicites du rôle (v3). S'ajoutent aux permissions par
   * défaut du niveau : un rôle joueur avec ["mod.ban"] peut bannir.
   */
  perms: PermId[];
}

export interface MemberData {
  name: string;
  /** Nom du rôle attribué. */
  role: string;
  /** Prefix personnalisé (chat/tag), écrase celui du rôle si défini. */
  customPrefix?: string;
  /** Couleur personnalisée du nom, écrase celle du rôle si définie. */
  customColor?: string;
  /** Player.id Bedrock (v3) : null tant que le joueur n'a pas rejoint. */
  playerId: string | null;
  /** Date d'attribution (v3). */
  firstSeen: number;
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
      { name: clean, color, prefix: `[${clean}]`, level, perms: defaultPermsForLevel(level) },
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

    // Détache tous les membres (rôle vidé) SANS supprimer leur fiche :
    // elle porte leur prefix/couleur perso et leur identité (playerId).
    for (const member of this.db.find<MemberData>(MEMBERS_COLLECTION, (doc) => doc.data.role === name)) {
      member.data.role = "";
      member.updatedAt = Date.now();
    }
    this.db.delete(ROLES_COLLECTION, name);
    this.touch();
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
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Change le prefix d'un rôle ("" = revenir au défaut [Nom]). */
  setRolePrefix(name: string, prefix: string): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    role.data.prefix = prefix.trim();
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Change le niveau hiérarchique d'un rôle. */
  setRoleLevel(name: string, level: number): { ok: boolean; error?: string } {
    const role = this.getRole(name);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    role.data.level = Math.max(0, Math.min(1000, Math.floor(level)));
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /**
   * Remplace la liste des permissions explicites d'un rôle.
   * Seuls les ids connus du catalogue sont retenus (garde-fou).
   */
  setRolePermissions(roleName: string, permIds: string[]): { ok: boolean; error?: string } {
    const role = this.getRole(roleName);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    const clean = permIds.filter((id): id is PermId => isPermId(id));
    role.data.perms = [...new Set(clean)];
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Ajoute une permission à un rôle (idempotent). */
  grantPermission(roleName: string, permId: PermId): { ok: boolean; error?: string } {
    const role = this.getRole(roleName);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };
    if (role.data.perms.includes(permId)) return { ok: true };

    role.data.perms.push(permId);
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  /** Retire une permission explicite d'un rôle. */
  revokePermission(roleName: string, permId: PermId): { ok: boolean; error?: string } {
    const role = this.getRole(roleName);
    if (role === undefined) return { ok: false, error: "Rôle introuvable." };

    const before = role.data.perms.length;
    role.data.perms = role.data.perms.filter((id) => id !== permId);
    if (role.data.perms.length === before) return { ok: true };

    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------

  getMember(playerName: string) {
    return this.db.findOne<MemberData>(MEMBERS_COLLECTION, playerName);
  }

  /** Le membre par id Bedrock (résolu au join). */
  getMemberById(playerId: string) {
    return this.db.find<MemberData>(MEMBERS_COLLECTION, (doc) => doc.data.playerId === playerId)[0];
  }

  /** Le membre par pseudo OU playerId (les deux sont cherchés). */
  getMemberAny(playerName: string, playerId?: string) {
    if (playerId !== undefined) {
      const byId = this.getMemberById(playerId);
      if (byId !== undefined) return byId;
    }
    return this.getMember(playerName);
  }

  allMembers() {
    return this.db.find<MemberData>(MEMBERS_COLLECTION);
  }

  membersWithRole(roleName: string) {
    return this.db.find<MemberData>(MEMBERS_COLLECTION, (doc) => doc.data.role === roleName);
  }

  /**
   * Attribue le rôle par défaut [Joueur] si le joueur n'a AUCUN rôle.
   * Utilisé à chaque join : tout le monde a au minimum ce rôle (gris).
   */
  ensureDefaultRole(playerName: string, playerId?: string): void {
    if (this.getMember(playerName) !== undefined) return;
    if (this.getRole(DEFAULT_ROLE_NAME) === undefined) return; // pas encore bootstrappé
    this.assignRole(playerName, DEFAULT_ROLE_NAME, playerId);
  }

  /**
   * Attribue un rôle à un joueur (upsert). `playerId` (id Bedrock) est
   * stocké quand connu : identité stable même si le pseudo change.
   */
  assignRole(playerName: string, roleName: string, playerId?: string): { ok: boolean; error?: string } {
    if (this.getRole(roleName) === undefined) {
      return { ok: false, error: `Le rôle "${roleName}" n'existe pas.` };
    }

    const existing = this.getMember(playerName);
    if (existing === undefined) {
      this.db.insert<MemberData>(
        MEMBERS_COLLECTION,
        { name: playerName, role: roleName, playerId: playerId ?? null, firstSeen: Date.now() },
        playerName,
      );
    } else {
      existing.data.role = roleName;
      existing.data.name = playerName;
      if (playerId !== undefined) existing.data.playerId = playerId;
      existing.updatedAt = Date.now();
      this.touch();
    }
    this.db.save();
    return { ok: true };
  }

  /** Retire le rôle d'un joueur. */
  removeRole(playerName: string): boolean {
    const removed = this.db.delete(MEMBERS_COLLECTION, playerName);
    if (removed) this.touch();
    return removed;
  }

  /** Prefix personnalisé d'un joueur ("" pour réinitialiser). */
  setCustomPrefix(playerName: string, prefix: string): { ok: boolean; error?: string } {
    const member = this.getMember(playerName);
    if (member === undefined) return { ok: false, error: "Ce joueur n'a pas de rôle." };

    member.data.customPrefix = prefix.trim() || undefined;
    member.updatedAt = Date.now();
    this.touch();
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
    this.touch();
    this.db.save();
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  /**
   * Le porteur de ce rôle a-t-il la permission `permId` ?
   * Sémantique additive : perms par défaut du niveau UNION perms explicites.
   */
  roleCan(role: RoleData, permId: PermId): boolean {
    if (role.level >= 100) return true; // Admin : tout
    return defaultPermsForLevel(role.level).includes(permId) || role.perms.includes(permId);
  }

  /** Le joueur a-t-il la permission `permId` ? (opérateur vanilla = toujours oui) */
  can(playerName: string, permId: PermId, isVanillaOp = false): boolean {
    if (isVanillaOp) return true;
    const role = this.roleOf(playerName);
    return role !== undefined && this.roleCan(role.data, permId);
  }

  // -------------------------------------------------------------------------
  // Rendu visuel
  // -------------------------------------------------------------------------

  /** Rôle effectif d'un joueur (ou undefined si aucun). */
  roleOf(playerName: string) {
    const member = this.getMember(playerName);
    return member === undefined ? undefined : this.getRole(member.data.role);
  }

  /** Rôle effectif par id Bedrock (résolu au join, plus fiable que le pseudo). */
  roleOfId(playerId: string) {
    const member = this.getMemberById(playerId);
    return member === undefined ? undefined : this.getRole(member.data.role);
  }

  /** Level effectif d'un joueur (0 si aucun rôle). */
  levelOf(playerName: string): number {
    return this.roleOf(playerName)?.data.level ?? 0;
  }

  /** Le tag complet au-dessus du joueur : "§6[Admin] §fAymen". */
  nameTagFor(playerName: string): string {
    const member = this.getMemberAny(playerName);
    const role = this.roleOf(playerName) ?? (member !== undefined ? this.getRole(member.data.role) : undefined);

    if (role === undefined) return `§f${playerName}`;

    const color = member?.data.customColor ?? role.data.color;
    const prefix = member?.data.customPrefix ?? role.data.prefix;
    const prefixPart = prefix === "" ? "" : `${color}${prefix} §r`;
    return `${prefixPart}${color}${playerName}`;
  }

  /**
   * Marque la DB dirty après une MUTATION EN PLACE d'un document (role.data.x
   * = y) : db.update() n'est pas passé par là, donc le flag ne serait pas
   * levé et la sauvegarde écrirait l'ancien état. (Bug de perte de données.)
   */
  private touch(): void {
    // Accès à l'API interne dirty via un save forcé différé serait coûteux :
    // on passe par upsert sur le document concerné n'est pas faisable ici
    // (pas d'id) — la DB expose donc markDirty() public.
    this.db.markDirty();
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
        { name: "Admin", color: "§c", prefix: "[Admin]", level: 100, perms: defaultPermsForLevel(100) },
        "Admin",
      );
    }
    this.assignRole(operatorName, "Admin");
  }

  /**
   * Crée les rôles par défaut du monde s'ils n'existent pas :
   * [Joueur] (gris foncé, niveau 0, tout le monde) et [Modo] (niveau 60).
   * À appeler au worldLoad, avant la promotion du premier admin.
   */
  bootstrapDefaultRoles(): void {
    if (this.getRole(DEFAULT_ROLE_NAME) === undefined) {
      this.db.insert<RoleData>(
        ROLES_COLLECTION,
        {
          name: DEFAULT_ROLE_NAME,
          color: DEFAULT_ROLE_COLOR,
          prefix: DEFAULT_ROLE_PREFIX,
          level: 0,
          perms: defaultPermsForLevel(0),
        },
        DEFAULT_ROLE_NAME,
      );
    }
    if (this.getRole("Modo") === undefined) {
      this.db.insert<RoleData>(
        ROLES_COLLECTION,
        { name: "Modo", color: "§9", prefix: "[Modo]", level: 60, perms: defaultPermsForLevel(60) },
        "Modo",
      );
    }
  }
}
