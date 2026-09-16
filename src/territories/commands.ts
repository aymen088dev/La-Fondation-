import { CustomCommandStatus, CommandPermissionLevel, system } from "@minecraft/server";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { TerritoryManager } from "./manager";
import { openCreateMenu, openTerritoriesMenu } from "./ui";

/**
 * Enregistre les commandes custom /sn:create et /sn:info.
 * À appeler dans system.beforeEvents.startup (early execution).
 */
export function registerCommands(manager: TerritoryManager): void {
  system.beforeEvents.startup.subscribe((event: StartupEvent) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:create",
        description: "Revendique le chunk où tu te trouves (nom + couleur de drapeau)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }

        // Pas de menu depuis l'event de commande : on planifie en tick suivant.
        system.run(() => openCreateMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      },
    );

    event.customCommandRegistry.registerCommand(
      {
        name: "sn:info",
        description: "Affiche la liste de tous les territoires",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }

        system.run(() => openTerritoriesMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      },
    );
  });
}
