import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import { openColorPicker, openPrefixMenu } from "./ui";

/** Confirmation avant une action. */
export function confirmDialog(player: Player, title: string, body: string): Promise<boolean> {
  return new MessageFormData()
    .title(title)
    .body(body)
    .button2("§aConfirmer")
    .button1("§cAnnuler")
    .show(player)
    .then((response) => response.selection === 1)
    .catch(() => false);
}

/**
 * Liste des joueurs ayant (ou ayant eu) un rôle + saisie manuelle d'un pseudo.
 * Réservé aux admins.
 */
export function openPlayersMenu(player: Player, permissions: PermissionManager): void {
  const members = permissions.allMembers();

  const form = new ActionFormData()
    .title("§lGestion des joueurs")
    .body("§7Joueurs avec un rôle. Tu peux aussi ajouter un joueur manuellement.")
    .button("§a+ Gérer un joueur (saisir le pseudo)");

  for (const member of members) {
    const role = permissions.getRole(member.data.role);
    form.button(`${role?.data.color ?? "§7"}${member.data.name}§r\n§7${member.data.role}`);
  }
  form.button("§4Fermer");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) return void openPlayerLookupMenu(player, permissions);
      if (response.selection >= members.length + 1) return;

      const member = members[response.selection - 1];
      if (member !== undefined) openPlayerConfigMenu(player, member.data.name, permissions);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Saisie d'un pseudo pour gérer un joueur (même hors ligne). */
export function openPlayerLookupMenu(player: Player, permissions: PermissionManager): void {
  new ModalFormData()
    .title("Gérer un joueur")
    .textField("Pseudo du joueur", "Ex : Steve")
    .submitButton("Rechercher")
    .show(player)
    .then((response) => {
      if (response.canceled) return;
      const strings = (response.formValues ?? []).filter((value): value is string => typeof value === "string");
      const name = (strings[0] ?? "").trim();
      if (name === "") return;

      openPlayerConfigMenu(player, name, permissions);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Fiche de configuration d'un joueur. */
export function openPlayerConfigMenu(player: Player, targetName: string, permissions: PermissionManager): void {
  const member = permissions.getMember(targetName);

  const roleLabel = member === undefined ? "§7aucun" : `${permissions.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const colorLabel = member?.data.customColor ?? "(défaut du rôle)";

  const form = new ActionFormData()
    .title(`§l${targetName}`)
    .body(`§7Rôle : ${roleLabel}\n§7Prefix perso : §f${prefixLabel}\n§7Couleur perso : §f${colorLabel}`)
    .button("§eAttribuer / changer de rôle")
    .button("§ePrefix personnalisé")
    .button("§eCouleur de nom personnalisée");

  if (member !== undefined) {
    form.button("§4Retirer tous les rôles");
  }
  form.button("§8← Retour");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;

      const removeIndex = member !== undefined ? 3 : -1;
      const backIndex = removeIndex + 1;

      if (response.selection === 0) {
        openAssignRoleMenu(player, targetName, permissions);
      } else if (response.selection === 1) {
        openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
          const result = permissions.setCustomPrefix(targetName, prefix);
          player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
        });
      } else if (response.selection === 2) {
        openColorPicker(player, `Couleur de ${targetName}`, (colorId) => {
          const result = permissions.setCustomColor(targetName, colorId);
          player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
        });
      } else if (response.selection === removeIndex && member !== undefined) {
        permissions.removeRole(targetName);
        player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
      } else if (response.selection === backIndex) {
        openPlayersMenu(player, permissions);
      }
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Choix du rôle à attribuer à un joueur. */
function openAssignRoleMenu(player: Player, targetName: string, permissions: PermissionManager): void {
  const roles = permissions.allRoles();

  if (roles.length === 0) {
    player.sendMessage("§c[Rôles] Aucun rôle existant. Crée-en un d'abord (/sn:roles).");
    return;
  }

  const form = new ActionFormData().title(`Rôle de ${targetName}`).body("§7Choisis le rôle à attribuer :");
  for (const role of roles) {
    form.button(`${role.data.color}[${role.data.name}]§r\n§7niveau ${role.data.level}`);
  }
  form.button("§8← Retour");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= roles.length) return void openPlayerConfigMenu(player, targetName, permissions);

      const role = roles[response.selection];
      if (role === undefined) return;

      const result = permissions.assignRole(targetName, role.data.name);
      player.sendMessage(
        result.ok
          ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.`
          : `§c[Rôles] ${result.error}`,
      );
      openPlayerConfigMenu(player, targetName, permissions);
    })
    .catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Ré-export pour la compatibilité des imports. */
export { ROLE_COLORS };
