import type { Player } from "@minecraft/server";
import { windowTitle, divider, ICONS, RP_PACK_ID, openWindow } from "./theme";
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
import type { JsonDatabase } from "../db/database";

export interface HubDeps {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
  sanctions: SanctionsManager;
  /** Index joueurs (onglet hors ligne du menu Joueurs). */
  db?: JsonDatabase;
}

/**
 * Menu hub central (/sn:menu) — DDUI CustomForm.
 * Le point d'entrée graphique de l'add-on : boutons à callbacks directs,
 * layout riche (headers, dividers). Les entrées n'apparaissent que pour
 * les personnes autorisées.
 */
export function openHubMenu(player: Player, deps: HubDeps): void {
  const { permissions, modules, territories, sanctions } = deps;

  const isOp = player.playerPermissionLevel >= 2;
  const isAdmin = canUseAdminPanel(player, permissions);
  const isMod = permissions.can(player.name, "mod.panel", isOp);
  const canCreate = permissions.can(player.name, "territories.create", isOp);
  const hasRole = permissions.getMember(player.name) !== undefined;
  const canSelfColor = permissions.can(player.name, "chat.color", isOp) || hasRole;

  void openWindow(player, "Menu", (form) => {
    form.header(`§aOpenMontage§r §8» §7Menu principal`);
    form.divider();

    // Bandeau d'identité : le rôle du joueur, coloré.
    form.label(
      hasRole
        ? `§7Salut §f${player.name}§7 ! Ton rôle : ${permissions.nameTagFor(player.name)}§r`
        : `§7Salut §f${player.name}§7 ! Tu n'as pas encore de rôle.`,
    );
    form.spacer();

    // Entrées joueur.
    form.button(
      `🚩 §lTerritoires§r\n§7${canCreate ? "créer, lister, explorer" : "lister, explorer"}`,
      () => openTerritoriesMenu(player, territories),
      { tooltip: "Revendique et explore les territoires" },
    );
    if (canSelfColor) {
      form.button(`🧭 §lMon rôle§r\n§7couleur, prefix perso`, () =>
        openSelfRoleMenu(player, permissions),
      );
    }

    // Entrées modération.
    if (isMod) {
      form.button(`🛡 §lModération§r\n§7bans, mutes, warns`, () =>
        openSanctionsMenu(player, sanctions, permissions),
      );
    }

    // Entrées admin.
    if (isAdmin) {
      form.header(`§6§lAdministration`);
      form.button(`👑 §lRôles§r\n§7créer et régler les rôles`, () => openRolesMenu(player, permissions));
      form.button(`📜 §lJoueurs§r\n§7en ligne + hors ligne`, () =>
        openPlayersMenu(player, permissions, deps.db),
      );
      form.button(`🔧 §lModules§r\n§7activer/désactiver les features`, () =>
        openModulesMenu(player, modules, territories),
      );
    }
  }).catch((error: unknown) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
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

// Ré-exporte windowTitle/divider/ICONS pour compat avec les anciens imports.
export { windowTitle, divider, ICONS, RP_PACK_ID };
