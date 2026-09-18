import { CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, system, world } from "@minecraft/server";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import type { JsonDatabase } from "../db/database";
import { openDbMenu } from "../db/menu";
import { ColorJSON } from "@bedrock-oss/bedrock-boost";
import type { TerritoryManager } from "./manager";
import type { ModuleManager } from "../modules/manager";
import type { PermissionManager } from "../permissions/manager";
import { TERRITORY_COLORS } from "./types";
import { openCreateMenu, openStatesMenu, openMyClanMenu, openFlagMenu, openDissolveMenu } from "./ui";
import { MinesManager } from "../mines/manager";
import { openWorldMenu } from "../mines/ui";

/**
 * Enregistre les commandes custom /sn:create, /sn:info, /sn:db etc.
 * À appeler dans system.beforeEvents.startup (early execution).
 */
export function registerCommands(
  manager: TerritoryManager,
  db?: JsonDatabase,
  modules?: ModuleManager,
  permissions?: PermissionManager,
  mines?: MinesManager,
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
        description: "Fonde ton clan sur le chunk où tu te trouves",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }

        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        if (!allowed(player, "territories.create")) {
          return { status: CustomCommandStatus.Failure, message: "§c[Clans] Tu n'as pas la permission de fonder un clan." };
        }

        // Pas de menu depuis l'event de commande : on planifie en tick suivant.
        system.run(() => openCreateMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      },
    );

    event.customCommandRegistry.registerCommand(
      {
        name: "sn:info",
        description: "Liste les États (clans) de NaLandia",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }

        system.run(() => openStatesMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:claim : étend le clan sur le chunk où l'on se trouve (adjacent,
    // dans le carré 3×3 autour du chunk fondateur).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:claim",
        description: "Revendique le chunk où tu te trouves pour ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory =
            manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan. Fonde-le avec §f/sn:create§e.");
            return;
          }
          // Note : la vérification chef/officier est faite par le manager.
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut étendre le territoire.");
            return;
          }
          const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
          const result = manager.addChunk(territory.id, key);
          player.sendMessage(
            result.ok
              ? `§a[Clans] Chunk revendiqué pour §f${territory.data.name}§a !`
              : `§c[Clans] ${result.reason ?? "Revendication impossible."}`,
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:clan : ouvre les options de SON clan (chef, officier ou membre).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:clan",
        description: "Gère ton clan (extension, membres, drapeau)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan. Fonde-le avec §f/sn:create§e.");
            return;
          }
          openMyClanMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:unclaim : libère le chunk où l'on se trouve (jamais le fondateur).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unclaim",
        description: "Libère le chunk où tu te trouves (chef/officier)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut libérer un chunk.");
            return;
          }
          const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
          const result = manager.removeChunk(territory.id, key);
          player.sendMessage(
            result.ok
              ? `§a[Clans] Chunk libéré. §7${territory.data.chunkKeys.length} chunk(s) restant(s).`
              : `§c[Clans] ${result.reason ?? "Action impossible."}`,
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:invite <joueur> : invite un joueur en ligne dans SON clan (chef/officier).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:invite",
        description: "Invite un joueur en ligne dans ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "joueur", type: CustomCommandParamType.String }],
      },
      (origin: CustomCommandOrigin, joueur: string) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        let sent: CustomCommandStatus = CustomCommandStatus.Success;
        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan : fonde-le avec §f/sn:create§e.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut inviter.");
            return;
          }
          const target = world.getAllPlayers().find(
            (candidate) => candidate.name.toLowerCase() === joueur.toLowerCase(),
          );
          if (target === undefined) {
            player.sendMessage(`§c[Clans] "§f${joueur}§c" n'est pas en ligne.`);
            return;
          }
          const result = manager.addMember(territory.id, target.id, target.name);
          if (result.ok) {
            player.sendMessage(`§a[Clans] ${target.name} a rejoint §f${territory.data.name}§a !`);
            target.sendMessage(`§a[Clans] Tu as rejoint le clan §f${territory.data.name}§a !`);
          } else {
            player.sendMessage(`§c[Clans] ${result.error ?? "Invitation impossible."}`);
            sent = CustomCommandStatus.Failure;
          }
        });
        return { status: sent };
      },
    );

    // /sn:leave : quitte son clan (membres, pas le chef).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:leave",
        description: "Quitte ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'es membre d'aucun clan.");
            return;
          }
          const ok = manager.leave(territory.id, player.id);
          player.sendMessage(
            ok
              ? `§e[Clans] Tu as quitté §f${territory.data.name}§e.`
              : "§c[Clans] Impossible de quitter le clan (le chef doit le dissoudre : /sn:disband).",
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:promote <joueur> et /sn:demote <joueur> (chef uniquement).
    const rankCommand = (name: string, rank: "officer" | "member", verb: string): void => {
      event.customCommandRegistry.registerCommand(
        {
          name,
          description: `${verb} un membre de ton clan (chef uniquement)`,
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: [{ name: "membre", type: CustomCommandParamType.String }],
        },
        (origin: CustomCommandOrigin, membre: string) => {
          const player = origin.sourceEntity as Player | undefined;
          if (player === undefined || player.typeId !== "minecraft:player") {
            return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
          }
          if (!enabled()) {
            return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
          }

          system.run(() => {
            const territory = manager.findByOwner(player.name) ??
              manager.findByMemberId(player.id);
            if (territory === undefined) {
              player.sendMessage("§e[Clans] Tu n'as pas de clan.");
              return;
            }
            const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
            if (!isOwner) {
              player.sendMessage("§c[Clans] Seul le chef du clan peut gérer les rangs.");
              return;
            }
            const member = territory.data.members.find(
              (m) => m.name.toLowerCase() === membre.toLowerCase(),
            );
            if (member === undefined) {
              player.sendMessage(`§c[Clans] "§f${membre}§c" n'est pas membre de ton clan.`);
              return;
            }
            const result = manager.setMemberRank(territory.id, member.playerId, rank);
            player.sendMessage(
              result.ok
                ? rank === "officer"
                  ? `§a[Clans] ${member.name} est désormais §bofficier§a.`
                  : `§a[Clans] ${member.name} est redevenu §7membre§a.`
                : `§c[Clans] ${result.error ?? "Action impossible."}`,
            );
          });
          return { status: CustomCommandStatus.Success };
        },
      );
    };
    rankCommand("sn:promote", "officer", "Promeut officier");
    rankCommand("sn:demote", "member", "Rétrograde membre");

    // /sn:ckick <membre> : exclut un membre du clan (chef/officier).
    // (Renommé : /sn:kick est la commande de modération — éjecte du monde.)
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:ckick",
        description: "Exclut un membre de ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "membre", type: CustomCommandParamType.String }],
      },
      (origin: CustomCommandOrigin, membre: string) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut exclure.");
            return;
          }
          const member = territory.data.members.find(
            (m) => m.name.toLowerCase() === membre.toLowerCase(),
          );
          if (member === undefined) {
            player.sendMessage(`§c[Clans] "§f${membre}§c" n'est pas membre de ton clan.`);
            return;
          }
          const result = manager.removeMember(territory.id, member.playerId);
          player.sendMessage(
            result.ok
              ? `§a[Clans] ${member.name} a été exclu du clan.`
              : `§c[Clans] ${result.error ?? "Action impossible."}`,
          );
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:disband : dissout SON clan (chef uniquement, confirmation via menu).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:disband",
        description: "Dissout ton clan (chef uniquement)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          if (!isOwner) {
            player.sendMessage("§c[Clans] Seul le chef peut dissoudre le clan (pour partir : /sn:leave).");
            return;
          }
          // Passe par la confirmation du menu Mon clan.
          openDissolveMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:flag : ouvre le choix de drapeau (couleur ou blason personnalisé).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:flag",
        description: "Choisis le drapeau de ton clan (chef)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }

        system.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === undefined) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          if (!isOwner) {
            player.sendMessage("§c[Clans] Seul le chef peut changer le drapeau.");
            return;
          }
          openFlagMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:setflag : raccourci chat — change la couleur du drapeau de SON clan
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:setflag",
        description: "Change la couleur du drapeau de ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "couleur", type: CustomCommandParamType.String }],
      },
      (origin: CustomCommandOrigin, couleur: string) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }

        const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
        if (territory === undefined) {
          return { status: CustomCommandStatus.Failure, message: "Tu ne fais partie d'aucun clan (/sn:create)." };
        }

        const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
        if (!isOwner) {
          return { status: CustomCommandStatus.Failure, message: "Seul le chef du clan peut changer le drapeau (/sn:clan)." };
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
        return { status: CustomCommandStatus.Success, message: `Drapeau changé : ${color.code}${color.id}` };
      },
    );

    // /sn:db : consultation de la base de données (réservé aux admins)
    // /sn:mine : bascule surface ↔ dimension minière (retour = dernière
    // position du monde normal).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mine",
        description: "Va dans la dimension minière / revient à ta dernière position",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (mines === undefined) {
          return { status: CustomCommandStatus.Failure, message: "Mines indisponibles." };
        }

        system.run(() => {
          const message = mines.toggle(player);
          player.sendMessage(message);
        });
        return { status: CustomCommandStatus.Success };
      },
    );

    // /sn:monde : menu de choix du monde (Monde normal / Mine).
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:monde",
        description: "Choisis ton monde : normal (surface) ou Mine",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin: CustomCommandOrigin) => {
        const player = origin.sourceEntity as Player | undefined;
        if (player === undefined || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (mines === undefined) {
          return { status: CustomCommandStatus.Failure, message: "Mines indisponibles." };
        }

        system.run(() => openWorldMenu(player, mines));
        return { status: CustomCommandStatus.Success };
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
            // v18 : plus aucun retour DB dans le chat — tout en console.
            const stats = db.stats();
            const collections = Object.entries(stats.collections)
              .map(([name, count]) => `${name}=${count}`)
              .join(", ");
            console.log(`[DB] ${stats.documents} docs, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"} {${collections}}`);
            return { status: CustomCommandStatus.Success };
          }
          case "list": {
            if (arg1 === undefined) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db list <collection>" };
            }
            const docs = db.find(arg1);
            if (docs.length === 0) {
              console.log(`[DB] Collection "${arg1}" vide ou inexistante.`);
              return { status: CustomCommandStatus.Success };
            }
            const preview = docs
              .slice(0, 10)
              .map((doc) => `${doc.id}(${Math.round(JSON.stringify(doc).length / 1024 * 10) / 10}ko)`)
              .join(", ");
            console.log(`[DB] ${docs.length} doc(s) dans "${arg1}" : ${preview}${docs.length > 10 ? " …" : ""}`);
            return { status: CustomCommandStatus.Success };
          }
          case "show": {
            if (arg1 === undefined || arg2 === undefined) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db show <collection> <id>" };
            }
            const doc = db.findOne(arg1, arg2);
            if (doc === undefined) {
              console.warn(`[DB] "${arg2}" introuvable dans "${arg1}".`);
              return { status: CustomCommandStatus.Success };
            }
            // JSON colorisé (clés/valeurs/nombres distinguishables) via bedrock-boost — console uniquement.
            console.log(ColorJSON.DEFAULT.stringify(doc));
            return { status: CustomCommandStatus.Success };
          }
          case "save": {
            const wrote = db.save(true);
            console.log(wrote ? "[DB] Sauvegardée." : "[DB] Rien à sauvegarder.");
            return { status: CustomCommandStatus.Success };
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
