import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import type { RoleData } from "./manager";
import type { StoredDocument } from "../db";

/** Garde-fou : un non-admin ne peut pas ouvrir la GUI d'admin. */
export function isAdmin(playerName: string, permissions: PermissionManager): boolean {
  return permissions.levelOf(playerName) >= 100;
}

/** Menu principal des rôles. */
export function openRolesMenu(player: Player, permissions: PermissionManager): void {
  const roles = permissions.allRoles();

  const form = new ActionFormData()
    .title("§lGestion des rôles")
    .body(`§7${roles.length} rôle(s). Sélectionne pour configurer.`)
    .button("§a+ Créer un rôle");

  for (const role of roles) {
    form.button(`${role.data.color}[${role.data.name}]§r\n§7niveau ${role.data.level} · ${permissions.membersWithRole(role.data.name).length} membre(s)`);
  }
  form.button("§4Fermer");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return void openCreateRoleMenu(player, permissions);
      if (response.selection >= roles.length + 1) return;

      const role = roles[response.selection - 1];
      if (role !== undefined) openRoleConfigMenu(player, role, permissions);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Création d'un rôle : nom + couleur + niveau. */
export function openCreateRoleMenu(player: Player, permissions: PermissionManager): void {
  const colorItems = ROLE_COLORS.map((color) => `${color.code}■ ${color.id}`);

  new ModalFormData()
    .title("Créer un rôle")
    .textField("Nom du rôle (2-16 caractères)", "Ex : Modo, VIP,_builder")
    .slider("Niveau hiérarchique", 0, 100, { valueStep: 5, defaultValue: 10 })
    .dropdown("Couleur", colorItems, { defaultValueIndex: 0 })
    .submitButton("Créer")
    .show(player)
    .then((response) => {
      if (response.canceled) return;

      const values = response.formValues ?? [];
      const strings = values.filter((value): value is string => typeof value === "string");
      const numbers = values.filter((value): value is number => typeof value === "number");

      const name = (strings[0] ?? "").trim();
      const level = numbers[0] ?? 10;
      const colorIndex = numbers[1] ?? 0;
      const color = ROLE_COLORS[colorIndex]?.code ?? "§f";

      if (name === "") {
        player.sendMessage("§c[Rôles] Nom vide.");
        return;
      }

      const result = permissions.createRole(name, color, level);
      player.sendMessage(result.ok ? `§a[Rôles] Rôle ${color}[${name}]§r§a créé.` : `§c[Rôles] ${result.error}`);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Configuration d'un rôle existant. */
export function openRoleConfigMenu(
  player: Player,
  role: StoredDocument<RoleData>,
  permissions: PermissionManager,
): void {
  new ActionFormData()
    .title(`${role.data.color}[${role.data.name}]`)
    .body(
      `§7Niveau : §f${role.data.level}\n` +
        `§7Membres : §f${permissions.membersWithRole(role.data.name).length}\n` +
        `§7Prefix : §f${role.data.prefix}`,
    )
    .button("§eChanger la couleur")
    .button("§eChanger le prefix")
    .button("§eChanger le niveau")
    .button("§bVoir les membres")
    .button("§4Supprimer ce rôle")
    .button("§8← Retour")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;

      switch (response.selection) {
        case 0:
          openColorPicker(player, "Couleur du rôle", (colorId) => {
            const result = permissions.setRoleColor(role.data.name, colorId);
            player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
          });
          break;
        case 1:
          openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
            const result = permissions.setRolePrefix(role.data.name, prefix);
            player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
          });
          break;
        case 2:
          openLevelMenu(player, role, permissions);
          break;
        case 3:
          openRoleMembersMenu(player, role, permissions);
          break;
        case 4: {
          const result = permissions.deleteRole(role.data.name);
          player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
          break;
        }
        case 5:
          openRolesMenu(player, permissions);
          break;
      }
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Slider de niveau hiérarchique. */
function openLevelMenu(player: Player, role: StoredDocument<RoleData>, permissions: PermissionManager): void {
  new ModalFormData()
    .title(`Niveau de [${role.data.name}]`)
    .slider("Niveau (100 = admin max)", 0, 100, { valueStep: 5, defaultValue: role.data.level })
    .submitButton("Valider")
    .show(player)
    .then((response) => {
      if (response.canceled) return;
      const numbers = (response.formValues ?? []).filter((value): value is number => typeof value === "number");
      const result = permissions.setRoleLevel(role.data.name, numbers[0] ?? role.data.level);
      player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Membres d'un rôle : clic pour retirer. */
function openRoleMembersMenu(
  player: Player,
  role: StoredDocument<RoleData>,
  permissions: PermissionManager,
): void {
  const members = permissions.membersWithRole(role.data.name);

  const form = new ActionFormData()
    .title(`Membres ${role.data.color}[${role.data.name}]`)
    .body(members.length === 0 ? "§7Aucun membre." : "§7Clique sur un membre pour lui retirer le rôle.");

  for (const member of members) form.button(`§f${member.data.name}`);
  form.button("§8← Retour");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= members.length) return void openRoleConfigMenu(player, role, permissions);

      const member = members[response.selection];
      if (member !== undefined) {
        permissions.removeRole(member.data.name);
        player.sendMessage(`§a[Rôles] ${member.data.name} ne fait plus partie du rôle.`);
        openRoleMembersMenu(player, role, permissions);
      }
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Sélecteur de couleur réutilisable. */
export function openColorPicker(player: Player, title: string, onPick: (colorId: string) => void): void {
  const form = new ActionFormData().title(title).body("§7Choisis une couleur :").button("§8← Annuler");

  for (const color of ROLE_COLORS) {
    form.button(`${color.code}■■■ §7${color.id}`);
  }

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return; // Annuler

      const picked = ROLE_COLORS[response.selection - 1];
      if (picked !== undefined) onPick(picked.id);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Menu de saisie de prefix. */
export function openPrefixMenu(player: Player, title: string, onDone: (prefix: string) => void): void {
  new ModalFormData()
    .title(title)
    .textField("Prefix (vide = défaut [Nom])", "Ex : ★ Boss, [VIP+]")
    .submitButton("Valider")
    .show(player)
    .then((response) => {
      if (response.canceled) return;
      const strings = (response.formValues ?? []).filter((value): value is string => typeof value === "string");
      onDone(strings[0] ?? "");
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
