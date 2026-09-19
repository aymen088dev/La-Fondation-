import type { Player } from "@minecraft/server";
import { windowTitle, openWindow, openWindowRaw, obString, obNumber, openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import type { RoleData } from "./manager";
import type { StoredDocument } from "../db";

/** Nombre de rôles affichés par page (plus la création, la pagination et le retour). */
export const ROLES_PER_PAGE = 4;

/** Garde-fou : un non-admin ne peut pas ouvrir la GUI d'admin. */
export function isAdmin(playerName: string, permissions: PermissionManager): boolean {
  return permissions.levelOf(playerName) >= 100;
}

/** Menu principal des rôles (admin) — LISTE GÉNÉRIQUE (panneau bleu nuit). */
export function openRolesMenu(player: Player, permissions: PermissionManager, page = 0): void {
  const roles = permissions.allRoles();
  const { items, page: current, pageCount } = pageSlice(roles, page, ROLES_PER_PAGE);

  openTileMenu(player, "Roles", (menu) => {
    menu.body(
      [
        "§6§lRôles du serveur§r",
        `§7${roles.length} rôle(s) — page §f${current + 1}§7/§f${pageCount}`,
        "",
        "§8Clique un rôle pour changer sa couleur, son préfixe,",
        "§8son niveau, voir ses membres ou le supprimer.",
      ].join("\n"),
    );

    for (let slot = 0; slot < ROLES_PER_PAGE; slot++) {
      const role = items[slot];
      if (role === undefined) continue;
      menu.action(
        `role_${slot}`,
        `${role.data.color}[${role.data.name}] §7niv. ${role.data.level}`,
        () => openRoleConfigMenu(player, role, permissions),
      );
    }

    menu.action("create", `§aCréer un rôle`, () => openCreateRoleMenu(player, permissions));
    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openRolesMenu(player, permissions, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openRolesMenu(player, permissions, current + 1);
    });
    menu.action("back", `§7Fermer`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}

/** Création d'un rôle : nom + couleur + niveau. */
export function openCreateRoleMenu(player: Player, permissions: PermissionManager): void {
  const name = obString("");
  const colorIndex = obNumber(0);
  const level = obNumber(10);

  void openWindowRaw(player, windowTitle("Créer un rôle"), (form) => {
    form.header(`§a§lNouveau rôle`);
    form.divider();
    form.textField("§eNom (2-16 caractères)", name);
    form.dropdown(
      "§eCouleur",
      colorIndex,
      ROLE_COLORS.map((color, value) => ({ label: `${color.code}${color.id}`, value })),
    );
    form.slider("§eNiveau hiérarchique (100 = admin max)", level, 0, 100, { step: 5 });
    form.divider();
    form.button(`§a§lCréer le rôle`, () => {
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
    form.header(`${role.data.color}§l${role.data.name}§r §7(niveau ${role.data.level})`);
    form.label(
      `§7Membres : §f${permissions.membersWithRole(role.data.name).length}\n§7Prefix : §f${role.data.prefix}`,
    );
    form.divider();
    form.button(`§e§lChanger la couleur`, () =>
      openColorPicker(player, "Couleur du rôle", (colorId) => {
        const result = permissions.setRoleColor(role.data.name, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      }),
    );
    form.button(`§e§lChanger le prefix`, () =>
      openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
        const result = permissions.setRolePrefix(role.data.name, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }),
    );
    form.button(`§e§lChanger le niveau (actuel : ${role.data.level})`, () => openLevelMenu(player, role, permissions));
    form.button(`§b§lVoir les membres`, () => openRoleMembersMenu(player, role, permissions));
    form.button(`§c§lSupprimer ce rôle`, () => {
      const result = permissions.deleteRole(role.data.name);
      player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
    });
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Slider de niveau hiérarchique. */
function openLevelMenu(player: Player, role: StoredDocument<RoleData>, permissions: PermissionManager): void {
  const level = obNumber(role.data.level);

  void openWindowRaw(player, windowTitle(`Niveau de [${role.data.name}]`), (form) => {
    form.slider("§eNiveau (100 = admin max)", level, 0, 100, { step: 5 });
    form.button(`§a§lValider`, () => {
      const result = permissions.setRoleLevel(role.data.name, level.getData());
      player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
    });
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * Membres d'un rôle : clic pour retirer. MÊME PANNEAU que la liste des rôles
 * (le titre est fixe « Roles » — c'est le corps qui annonce le rôle affiché).
 */
function openRoleMembersMenu(
  player: Player,
  role: StoredDocument<RoleData>,
  permissions: PermissionManager,
  page = 0,
): void {
  const members = permissions.membersWithRole(role.data.name);
  const { items, page: current, pageCount } = pageSlice(members, page, 5);

  openTileMenu(player, "Roles", (menu) => {
    menu.body(
      [
        `§6§lMembres ${role.data.color}[${role.data.name}]§r`,
        members.length === 0
          ? "§7Aucun membre dans ce rôle."
          : `§7${members.length} membre(s) — page §f${current + 1}§7/§f${pageCount}`,
        "",
        "§8Clique un membre pour lui retirer ce rôle.",
      ].join("\n"),
    );

    for (let slot = 0; slot < 5; slot++) {
      const member = items[slot];
      if (member === undefined) continue;
      menu.action(`member_${slot}`, `§f${member.data.name}`, () => {
        permissions.removeRole(member.data.name);
        player.sendMessage(`§a[Rôles] ${member.data.name} ne fait plus partie du rôle.`);
        openRoleMembersMenu(player, role, permissions, current);
      });
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openRoleMembersMenu(player, role, permissions, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openRoleMembersMenu(player, role, permissions, current + 1);
    });
    menu.action("back", `§7Retour aux rôles`, () => openRolesMenu(player, permissions));
  });
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
      form.button(`${color.code}${color.id}`, () => onPick(color.id));
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Menu de saisie de prefix. */
export function openPrefixMenu(player: Player, title: string, onDone: (prefix: string) => void): void {
  const prefix = obString("");

  void openWindowRaw(player, windowTitle(title), (form) => {
    form.textField("§ePrefix (vide = défaut [Nom])", prefix);
    form.button(`§a§lValider`, () => onDone(prefix.getData()));
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
