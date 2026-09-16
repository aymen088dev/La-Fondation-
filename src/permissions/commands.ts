import { CustomCommandStatus, CommandPermissionLevel, system, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { PermissionManager } from "./manager";
import { openRolesMenu, openColorPicker } from "./ui";
import { openPlayersMenu as openPlayersManager } from "./players-ui";
import type { ModuleManager } from "../modules/manager";
import { openModulesMenu } from "../modules/ui";
import type { TerritoryManager } from "../territories/manager";

interface AdminContext {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
}

/** Le joueur est-il autorisé à ouvrir la GUI d'admin ? (rôle >= 100 OU opérateur vanilla) */
export function canUseAdminPanel(player: Player, permissions: PermissionManager): boolean {
  return permissions.levelOf(player.name) >= 100 || player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}

/**
 * Enregistre les commandes d'administration.
 * À appeler dans system.beforeEvents.startup (early execution).
 */
export function registerAdminCommands(ctx: AdminContext): void {
  system.beforeEvents.startup.subscribe((event: StartupEvent) => {
    // /sn:roles : personnaliser son prefix/couleur (tous les joueurs)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:roles",
        description: "Personnalise ton prefix et ta couleur (si tu as un rôle)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => {
          // Les admins ouvrent directement la GUI de gestion complète
          if (canUseAdminPanel(player, ctx.permissions)) {
            openRolesMenu(player, ctx.permissions);
            return;
          }

          // Joueur lambda : personnalisation de son propre rôle
          const member = ctx.permissions.getMember(player.name);
          if (member === undefined) {
            player.sendMessage("§7[Rôles] Tu n'as pas de rôle. Demande à un admin !");
            return;
          }

          player.sendMessage(
            `§a[Rôles] Ton rôle : ${ctx.permissions.nameTagFor(player.name)}§r§a — personnalisation...`,
          );
          openColorPicker(player, "Ta couleur de nom", (colorId) => {
            const result = ctx.permissions.setCustomColor(player.name, colorId);
            player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour !" : `§c[Rôles] ${result.error}`);
          });
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:admin : menu d'administration (rôles, joueurs, modules)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:admin",
        description: "Panneau d'administration (rôles, joueurs, modules)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => {
          if (!canUseAdminPanel(player, ctx.permissions)) {
            player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
            return;
          }

          new ActionFormData()
            .title("§lAdministration")
            .body("§7Que veux-tu gérer ?")
            .button("§6Rôles\n§7créer, couleurs, niveaux")
            .button("§bJoueurs\n§7attribuer rôles et prefixes")
            .button("§aModules\n§7activer/désactiver les features")
            .button("§4Fermer")
            .show(player)
            .then((response) => {
              if (response.canceled || response.selection === undefined) return;
              if (response.selection === 0) openRolesMenu(player, ctx.permissions);
              else if (response.selection === 1) openPlayersManager(player, ctx.permissions);
              else if (response.selection === 2) openModulesMenu(player, ctx.modules, ctx.territories);
            })
            .catch((error: unknown) => console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`));
        });
        return { status: CustomCommandStatus.Success };
      },
    );
  });
}
