import { ActionFormData } from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { windowTitle, divider, ICONS } from "./theme";
import { openTerritoriesMenu } from "../territories/ui";
import type { TerritoryManager } from "../territories/manager";
import { openRolesMenu, openColorPicker } from "../permissions/ui";
import { openPlayersMenu } from "../permissions/players-ui";
import type { PermissionManager } from "../permissions/manager";
import { canUseAdminPanel } from "../permissions/commands";
import { openModulesMenu } from "../modules/ui";
import type { ModuleManager } from "../modules/manager";
import { openSanctionsMenu } from "../moderation/ui";
import type { SanctionsManager } from "../moderation/manager";

export interface HubDeps {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
  sanctions: SanctionsManager;
}

/**
 * Menu hub central (/sn:menu) : le point d'entrée graphique de l'add-on.
 * Les entrées admin/modération n'apparaissent que pour les personnes autorisées.
 */
export function openHubMenu(player: Player, deps: HubDeps): void {
  const { permissions, modules, territories, sanctions } = deps;

  const isAdmin = canUseAdminPanel(player, permissions);
  const isMod = permissions.levelOf(player.name) >= 60 || player.playerPermissionLevel >= 2;
  const hasRole = permissions.getMember(player.name) !== undefined;

  const form = new ActionFormData()
    .title(windowTitle("Menu"))
    .body(
      `${divider()}\n§7Salut §f${player.name}§7 !\n` +
        (hasRole
          ? `§7Ton rôle : ${permissions.nameTagFor(player.name)}§r\n`
          : "") +
        divider(),
    );

  // Entrées joueur (toujours visibles)
  form.button(`${ICONS.flag}`, "§lTerritoires§r\n§7créer, lister, explorer").button(`${ICONS.compass}`, "§lMon rôle§r\n§7couleur, prefix perso");

  // Entrées modération
  if (isMod) {
    form.button(`${ICONS.shield}`, "§lModération§r\n§7bans, mutes, warns");
  }

  // Entrées admin
  if (isAdmin) {
    form.button(`${ICONS.crown}`, "§lRôles§r\n§7créer et régler les rôles");
    form.button(`${ICONS.paper}`, "§lJoueurs§r\n§7attribuer rôles et prefixes");
    form.button(`${ICONS.wrench}`, "§lModules§r\n§7activer/désactiver les features");
  }

  form.button(`${ICONS.barrier}`, "§8Fermer");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;

      // On reconstruit l'indexation dynamiquement selon les entrées affichées.
      const actions: (() => void)[] = [];

      actions.push(() => openTerritoriesMenu(player, territories));
      actions.push(() => openSelfRoleMenu(player, permissions));

      if (isMod) {
        actions.push(() => openSanctionsMenu(player, sanctions, permissions));
      }
      if (isAdmin) {
        actions.push(() => openRolesMenu(player, permissions));
        actions.push(() => openPlayersMenu(player, permissions));
        actions.push(() => openModulesMenu(player, modules, territories));
      }

      const action = actions[response.selection];
      if (action !== undefined) system.run(() => action());
    })
    .catch((error: unknown) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}

/** Personnalisation de son propre rôle (couleur du nom). */
function openSelfRoleMenu(player: Player, permissions: PermissionManager): void {
  const member = permissions.getMember(player.name);
  if (member === undefined) {
    player.sendMessage("§7[OM] Tu n'as pas encore de rôle. Demande à un admin !");
    return;
  }

  player.sendMessage(`§a[OM] Ton rôle : ${permissions.nameTagFor(player.name)}§r§a — choisis ta couleur :`);
  openColorPicker(player, "Ta couleur de nom", (colorId) => {
    const result = permissions.setCustomColor(player.name, colorId);
    player.sendMessage(result.ok ? "§a[OM] Couleur mise à jour !" : `§c[OM] ${result.error}`);
  });
}
