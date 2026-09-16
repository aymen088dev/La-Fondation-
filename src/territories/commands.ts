import { CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, system } from "@minecraft/server";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { JsonDatabase } from "../db/database";
import { openDbMenu } from "../db/menu";
import { ColorJSON } from "@bedrock-oss/bedrock-boost";
import type { TerritoryManager } from "./manager";
import type { ModuleManager } from "../modules/manager";
import type { PermissionManager } from "../permissions/manager";
import { TERRITORY_COLORS } from "./types";
import { openCreateMenu, openTerritoriesMenu } from "./ui";

/**
 * Enregistre les commandes custom /sn:create, /sn:info, /sn:db etc.
 * À appeler dans system.beforeEvents.startup (early execution).
 */
export function registerCommands(
  manager: TerritoryManager,
  db?: JsonDatabase,
  modules?: ModuleManager,
  permissions?: PermissionManager,
): void {
  /** Le module territoires est-il actif ? */
  const enabled = (): boolean => modules === undefined || modules.isEnabled("territories");

  /** Permission fine (fallback permissif si pas de manager — compat tests). */
  const allowed = (player: Player, perm: Parameters<PermissionManager["can"]>[1]): boolean => {
    if (permissions === undefined) return true;
    return permissions.can(player.name, perm, player.playerPermissionLevel >= 2);
  };

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

        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module Territoires est désactivé." };
        }
        if (!allowed(player, "territories.create")) {
          return { status: CustomCommandStatus.Failure, message: "§c[Territoires] Tu n'as pas la permission de créer un territoire." };
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

    // /sn:setflag : change la couleur du drapeau de SON territoire
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:setflag",
        description: "Change la couleur du drapeau de ton territoire",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "couleur", type: CustomCommandParamType.String }],
      },
      (origin: CustomCommandOrigin, couleur: string) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        const territory = manager.findByOwner(player.name);
        if (territory === undefined) {
          return { status: CustomCommandStatus.Failure, message: "Tu ne possèdes pas de territoire (/sn:create)." };
        }

        const color = TERRITORY_COLORS.find((candidate) => candidate.id === couleur.toLowerCase());
        if (color === undefined) {
          return {
            status: CustomCommandStatus.Failure,
            message: `Couleur inconnue. Disponibles : ${TERRITORY_COLORS.map((candidate) => candidate.id).join(", ")}`,
          };
        }

        territory.data.color = color.id;
        territory.updatedAt = Date.now();
        db?.markDirty();
        manager.save();
        return { status: CustomCommandStatus.Success, message: `Drapeau changé : ${color.code}■ ${color.id}` };
      },
    );

    // /sn:db : consultation de la base de données (réservé aux admins)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:db",
        description: "Consulte la base de données (admins)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
        optionalParameters: [
          { name: "arg1", type: CustomCommandParamType.String },
          { name: "arg2", type: CustomCommandParamType.String },
        ],
      },
      (_origin: CustomCommandOrigin, action: string, arg1?: string, arg2?: string) => {
        if (db === undefined) {
          return { status: CustomCommandStatus.Failure, message: "DB indisponible." };
        }

        switch (action) {
          case "menu": {
            if (db.loaded) {
              system.run(() => {
                void openDbMenu(db, _origin.sourceEntity as Player).catch((error: unknown) =>
                  console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`),
                );
              });
              return { status: CustomCommandStatus.Success };
            }
            return {
              status: CustomCommandStatus.Failure,
              message:
                "§c[DB] Base non chargée : lecture impossible (monde pas encore prêt ou base corrompue). " +
                "§7Quitte et relance le monde ; si l'erreur persiste, regarde le content log pour le message d'erreur exact.",
            };
          }
          case "stats": {
            const stats = db.stats();
            const collections = Object.entries(stats.collections)
              .map(([name, count]) => `${name}=${count}`)
              .join(", ");
            return {
              status: CustomCommandStatus.Success,
              message: `§a[DB] ${stats.documents} docs, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"} §7{${collections}}`,
            };
          }
          case "list": {
            if (arg1 === undefined) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db list <collection>" };
            }
            const docs = db.find(arg1);
            if (docs.length === 0) {
              return { status: CustomCommandStatus.Success, message: `§7[DB] Collection "${arg1}" vide ou inexistante.` };
            }
            const preview = docs
              .slice(0, 10)
              .map((doc) => `§f${doc.id}§7(${Math.round(JSON.stringify(doc).length / 1024 * 10) / 10}ko)`)
              .join(", ");
            return {
              status: CustomCommandStatus.Success,
              message: `§a[DB] ${docs.length} doc(s) dans "${arg1}" : ${preview}${docs.length > 10 ? " …" : ""}`,
            };
          }
          case "show": {
            if (arg1 === undefined || arg2 === undefined) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db show <collection> <id>" };
            }
            const doc = db.findOne(arg1, arg2);
            if (doc === undefined) {
              return { status: CustomCommandStatus.Failure, message: `§c[DB] "${arg2}" introuvable dans "${arg1}".` };
            }
            // JSON colorisé (clés/valeurs/nombres distinguishables) via bedrock-boost.
            return { status: CustomCommandStatus.Success, message: ColorJSON.DEFAULT.stringify(doc) };
          }
          case "save": {
            const wrote = db.save(true);
            return { status: CustomCommandStatus.Success, message: wrote ? "§a[DB] Sauvegardée." : "§7[DB] Rien à sauvegarder." };
          }
          default:
            return {
              status: CustomCommandStatus.Failure,
              message: "Actions : menu, stats, list <collection>, show <collection> <id>, save",
            };
        }
      },
    );
  });
}
