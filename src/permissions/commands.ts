import { CustomCommandStatus, CommandPermissionLevel, system, PlayerPermissionLevel } from "@minecraft/server";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { PermissionManager } from "./manager";
import { openRolesMenu } from "./ui";
import type { ModuleManager } from "../modules/manager";
import type { TerritoryManager } from "../territories/manager";
import type { SanctionsManager } from "../moderation/manager";
import type { JsonDatabase } from "../db/database";
import { openHubMenu } from "../ui/hub";
import { openAdminMenu } from "../ui/admin";
import { openClassesMenu } from "../classes/ui";
import type { ClassManager } from "../classes/manager";
import { openJobsMenu } from "../jobs/ui";
import type { JobManager } from "../jobs/manager";

interface AdminContext {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
  sanctions: SanctionsManager;
  /** Index joueurs (menu Joueurs → onglet hors ligne). */
  db?: JsonDatabase;
  /** Module Classes (route de la première connexion). */
  classes?: ClassManager;
  /** Module Métiers (catalogue à venir). */
  jobs?: JobManager;
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
    // /sn:roles : GUI des rôles (admins) — la couleur vient désormais du
    // rôle uniquement (plus de choix de couleur par le joueur).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:roles",
        description: "Gestion des rôles (admins)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => {
          if (canUseAdminPanel(player, ctx.permissions)) {
            openRolesMenu(player, ctx.permissions);
            return;
          }

          const member = ctx.permissions.getMember(player.name);
          const roleTag =
            member === undefined ? "§8aucun" : ctx.permissions.nameTagFor(player.name);
          player.sendMessage(
            `§e[Rôles] Ton rôle : ${roleTag}§r§e — la couleur vient de ton rôle (modifiable par un admin).`,
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:menu : hub central (tous les outils, filtré par permission)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:menu",
        description: "Ouvre le menu principal NaLandia",
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

        system.run(() => openAdminMenu(player, ctx));
        return { status: CustomCommandStatus.Success };
      },
    );
    // /sn:classes : route du joueur (choix définitif → progression)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:classes",
        description: "Choisis ta classe (définitif) et suis ta progression",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => {
          if (ctx.classes === undefined) {
            player.sendMessage("§c[Classes] Module indisponible.");
            return;
          }
          const isAdmin = canUseAdminPanel(player, ctx.permissions);
          openClassesMenu(player, ctx.classes, isAdmin);
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:jobs : métiers (base prête, catalogue à venir)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:jobs",
        description: "Voir tes métiers et leur progression",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        system.run(() => {
          if (ctx.jobs === undefined) {
            player.sendMessage("§c[Métiers] Module indisponible.");
            return;
          }
          openJobsMenu(player, ctx.jobs);
        });
        return { status: CustomCommandStatus.Success };
      },
    );
  });
}
