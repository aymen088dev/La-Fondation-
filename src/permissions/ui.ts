import type { Player } from "@minecraft/server";
import { windowTitle, openWindow, openWindowRaw, obString, obNumber } from "../ui/theme";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import type { RoleData } from "./manager";
import type { StoredDocument } from "../db";

/** Garde-fou : un non-admin ne peut pas ouvrir la GUI d'admin. */
export function isAdmin(playerName: string, permissions: PermissionManager): boolean {
  return permissions.levelOf(playerName) >= 100;
}

/** Menu principal des rôles (admin). */
export function openRolesMenu(player: Player, permissions: PermissionManager): void {
  const roles = permissions.allRoles();

  void openWindow(player, "Rôles", (form) => {
    form.header(`§6■ §lRôles du serveur`);
    form.label(`§7${roles.length} rôle(s). Clique pour configurer :`);
    form.divider();
    form.button(`§a■ §lCréer un rôle`, () => openCreateRoleMenu(player, permissions), undefined, "plus");

    for (const role of roles) {
      form.button(
        `${role.data.color}[${role.data.name}]§r §7— niv. ${role.data.level} · ${permissions.membersWithRole(role.data.name).length} membre(s)`,
        () => openRoleConfigMenu(player, role, permissions),
        undefined,
        "crown",
      );
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Création d'un rôle : nom + couleur + niveau. */
export function openCreateRoleMenu(player: Player, permissions: PermissionManager): void {
  const name = obString("");
  const colorIndex = obNumber(0);
  const level = obNumber(10);

  void openWindowRaw(player, windowTitle("Créer un rôle"), (form) => {
    form.header(`§a■ §lNouveau rôle`);
    form.divider();
    form.textField("§eNom (2-16 caractères)", name);
    form.dropdown(
      "§eCouleur",
      colorIndex,
      ROLE_COLORS.map((color, value) => ({ label: `${color.code}■ ${color.id}`, value })),
    );
    form.slider("§eNiveau hiérarchique (100 = admin max)", level, 0, 100, { step: 5 });
    form.divider();
    form.button(`§a■ §lCréer le rôle`, () => {
      const clean = name.getData().trim();
      const color = ROLE_COLORS[colorIndex.getData()] ?? ROLE_COLORS[0];
      if (clean === "") {
        player.sendMessage("§c[Rôles] Nom vide.");
        return;
      }
      const result = permissions.createRole(clean, color?.code ?? "§f", level.getData());
      player.sendMessage(
        result.ok ? `§a[Rôles] Rôle ${color?.code}[${clean}]§r§a créé.` : `§c[Rôles] ${result.error}`,
      );
    });
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Configuration d'un rôle existant (callbacks directs). */
export function openRoleConfigMenu(
  player: Player,
  role: StoredDocument<RoleData>,
  permissions: PermissionManager,
): void {
  void openWindow(player, `Rôle ${role.data.color}${role.data.name}`, (form) => {
    form.header(`${role.data.color}■ §l${role.data.name}§r §7(niveau ${role.data.level})`);
    form.label(
      `§7Membres : §f${permissions.membersWithRole(role.data.name).length}\n§7Prefix : §f${role.data.prefix}`,
    );
    form.divider();
    form.button(`§e■ §lChanger la couleur`, () =>
      openColorPicker(player, "Couleur du rôle", (colorId) => {
        const result = permissions.setRoleColor(role.data.name, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      }), undefined, "pencil",
    );
    form.button(`§e■ §lChanger le prefix`, () =>
      openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
        const result = permissions.setRolePrefix(role.data.name, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }), undefined, "tag",
    );
    form.button(`§e■ §lChanger le niveau (actuel : ${role.data.level})`, () => openLevelMenu(player, role, permissions), undefined, "list");
    form.button(`§b■ §lVoir les membres`, () => openRoleMembersMenu(player, role, permissions), undefined, "user");
    form.button(`§c■ §lSupprimer ce rôle`, () => {
      const result = permissions.deleteRole(role.data.name);
      player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
    }, undefined, "trash");
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Slider de niveau hiérarchique. */
function openLevelMenu(player: Player, role: StoredDocument<RoleData>, permissions: PermissionManager): void {
  const level = obNumber(role.data.level);

  void openWindowRaw(player, windowTitle(`Niveau de [${role.data.name}]`), (form) => {
    form.slider("§eNiveau (100 = admin max)", level, 0, 100, { step: 5 });
    form.button(`§a■ §lValider`, () => {
      const result = permissions.setRoleLevel(role.data.name, level.getData());
      player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
    }, undefined, "check");
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Membres d'un rôle : clic pour retirer. */
function openRoleMembersMenu(
  player: Player,
  role: StoredDocument<RoleData>,
  permissions: PermissionManager,
): void {
  void openWindow(player, `Membres ${role.data.color}[${role.data.name}]`, (form) => {
    const members = permissions.membersWithRole(role.data.name);
    if (members.length === 0) {
      form.label("§7Aucun membre dans ce rôle.");
    } else {
      form.label("§7Clique sur un membre pour lui retirer le rôle :");
      for (const member of members) {
        form.button(`§f${member.data.name}`, () => {
          permissions.removeRole(member.data.name);
          player.sendMessage(`§a[Rôles] ${member.data.name} ne fait plus partie du rôle.`);
          openRoleMembersMenu(player, role, permissions);
        }, undefined, "user");
      }
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * Sélecteur de couleur — RÉSERVÉ À L'ADMIN (couleur d'un rôle).
 * La couleur d'un joueur vient désormais de son rôle : le choix individuel
 * a été retiré à la demande.
 */
export function openColorPicker(player: Player, title: string, onPick: (colorId: string) => void): void {
  void openWindow(player, title, (form) => {
    form.label("§7Choisis une couleur :");
    for (const color of ROLE_COLORS) {
      form.button(`${color.code}■■■ ${color.id}`, () => onPick(color.id), undefined, "pencil");
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Menu de saisie de prefix. */
export function openPrefixMenu(player: Player, title: string, onDone: (prefix: string) => void): void {
  const prefix = obString("");

  void openWindowRaw(player, windowTitle(title), (form) => {
    form.textField("§ePrefix (vide = défaut [Nom])", prefix);
    form.button(`§a■ §lValider`, () => onDone(prefix.getData()), undefined, "check");
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
