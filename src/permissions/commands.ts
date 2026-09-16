import { CustomCommandStatus, CommandPermissionLevel, system, PlayerPermissionLevel } from "@minecraft/server";
import { openWindow } from "../ui/theme";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { PermissionManager } from "./manager";
import { openRolesMenu, openColorPicker } from "./ui";
import { openPlayersMenu as openPlayersManager } from "./players-ui";
import type { ModuleManager } from "../modules/manager";
import { openModulesMenu } from "../modules/ui";
import type { TerritoryManager } from "../territories/manager";
import type { SanctionsManager } from "../moderation/manager";
import type { JsonDatabase } from "../db/database";
import { openHubMenu } from "../ui/hub";

interface AdminContext {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
  sanctions: SanctionsManager;
  /** Index joueurs (menu Joueurs → onglet hors ligne). */
  db?: JsonDatabase;
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

    // /sn:menu : hub central (tous les outils, filtré par permission)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:menu",
        description: "Ouvre le menu principal OpenMontage",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => openHubMenu(player, ctx));
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

          void openWindow(player, "Administration", (form) => {
            form.header(`§6■ §lAdministration`);
            form.label("§7Que veux-tu gérer ?");
            form.divider();
            form.button(`§6■ Rôles\n§7créer, couleurs, niveaux, permissions`, () =>
              openRolesMenu(player, ctx.permissions),
            );
            form.button(`§b■ Joueurs\n§7en ligne + hors ligne`, () =>
              openPlayersManager(player, ctx.permissions, ctx.db),
            );
            form.button(`§a■ Modules\n§7activer/désactiver les features`, () =>
              openModulesMenu(player, ctx.modules, ctx.territories),
            );
          }).catch((error: unknown) =>
            console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`),
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );
  });
}
