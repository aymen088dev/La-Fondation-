import {
  CustomCommandParamType,
  CustomCommandStatus,
  CommandPermissionLevel,
  system,
} from "@minecraft/server";
import type { CustomCommandOrigin, Player, StartupEvent } from "@minecraft/server";
import { world } from "@minecraft/server";
import type { SanctionsManager } from "./manager";
import { formatDuration } from "./manager";
import { kickPlayer } from "./enforcement";
import type { PermissionManager } from "../permissions/manager";
import type { PermId } from "../permissions/perms";
import { resolvePlayer } from "../players";
import { openSanctionsMenu } from "./ui";
import type { JsonDatabase } from "../db/database";

interface ModDeps {
  sanctions: SanctionsManager;
  permissions: PermissionManager;
  db?: JsonDatabase;
}

const NOT_PLAYER = "§c[Modération] Réservé aux joueurs.";

/** Le joueur a-t-il la permission fine requise ? (ou op vanilla) */
function requires(player: Player, permissions: PermissionManager, perm: PermId): boolean {
  return permissions.can(player.name, perm, player.playerPermissionLevel >= 2);
}

/** Informe la cible si elle est en ligne. */
function notifyTarget(targetName: string, message: string): void {
  const target = world.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (target !== undefined) system.run(() => target.sendMessage(message));
}

/**
 * Résout le Player.id Bedrock d'une cible : en ligne d'abord, puis via
 * l'index joueurs (offline connu). Renvoie null si inconnu.
 */
function resolveTargetId(targetName: string, db?: JsonDatabase): string | null {
  const online = world.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (online !== undefined) return online.id;
  if (db !== undefined) return resolvePlayer(db, targetName)?.data.playerId ?? null;
  return null;
}

/**
 * Enregistre les commandes de modération.
 * À appeler dans system.beforeEvents.startup (early execution).
 */
export function registerModerationCommands(deps: ModDeps): void {
  const { sanctions, permissions, db } = deps;

  system.beforeEvents.startup.subscribe((event: StartupEvent) => {
    const guardAndRun = (
      origin: CustomCommandOrigin,
      action: (player: Player) => void,
    ): { status: CustomCommandStatus; message?: string } | undefined => {
      const player = origin.sourceEntity as Player | undefined;
      if (player === undefined || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus.Failure, message: NOT_PLAYER };
      }
      if (!requires(player, permissions, "mod.panel")) {
        return { status: CustomCommandStatus.Failure, message: "§c[Modération] Permission manquante (mod.panel)." };
      }
      system.run(() => action(player));
      return { status: CustomCommandStatus.Success };
    };

    /** Garde par permission fine pour les commandes d'action. */
    const guardPerm = (
      origin: CustomCommandOrigin,
      perm: PermId,
      action: (player: Player) => void,
    ): { status: CustomCommandStatus; message?: string } | undefined => {
      const player = origin.sourceEntity as Player | undefined;
      if (player === undefined || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus.Failure, message: NOT_PLAYER };
      }
      if (!requires(player, permissions, perm)) {
        return { status: CustomCommandStatus.Failure, message: `§c[Modération] Permission manquante (${perm}).` };
      }
      system.run(() => action(player));
      return { status: CustomCommandStatus.Success };
    };

    const stringParam = (name: string) => ({ name, type: CustomCommandParamType.String });

    // -----------------------------------------------------------------------
    // /sn:mod — GUI de modération
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mod",
        description: "Panneau de modération (bans, mutes, warns)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
      },
      (origin) =>
        guardAndRun(origin, (player) => {
          openSanctionsMenu(player, sanctions, permissions);
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:kick <joueur> <raison...>
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:kick",
        description: "Éjecte un joueur du monde",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")],
      },
      (origin, target: string, reason: string) =>
        guardPerm(origin, "mod.kick", (player) => {
          if (target === player.name) {
            player.sendMessage("§c[Modération] Tu ne peux pas te kick toi-même.");
            return;
          }
          if (kickPlayer(target, reason)) {
            player.sendMessage(`§a[Modération] ${target} éjecté. Raison : ${reason}`);
            sanctions.log("kick", target, player.name, reason);
          } else {
            player.sendMessage(`§c[Modération] ${target} n'est pas en ligne.`);
          }
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:ban <joueur> [durée en minutes] [raison...]
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:ban",
        description: "Banni un joueur (durée en minutes, 0 = permanent)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")],
        optionalParameters: [{ name: "duree_min", type: CustomCommandParamType.Integer }],
      },
      (origin, target: string, reason: string, minutes?: number) =>
        guardPerm(origin, "mod.ban", (player) => {
          const duration = minutes ?? 0;
          const result = sanctions.ban(target, player.name, reason, duration, resolveTargetId(target, db));
          if (!result.ok) {
            player.sendMessage(`§c[Modération] ${result.error}`);
            return;
          }
          player.sendMessage(
            `§a[Modération] ${target} banni (${formatDuration(duration)}). Raison : ${reason}`,
          );
          notifyTarget(target, `§4[Modération] Tu es banni (${formatDuration(duration)}) : ${reason}`);
          system.run(() => kickPlayer(target, reason));
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:unban <joueur>
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unban",
        description: "Débanni un joueur",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")],
      },
      (origin, target: string) =>
        guardPerm(origin, "mod.ban", (player) => {
          const result = sanctions.unban(target);
          player.sendMessage(result.ok ? `§a[Modération] ${target} débanni.` : `§c[Modération] ${result.error}`);
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:mute <joueur> <durée_min> [raison...]
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mute",
        description: "Rend muet un joueur (durée en minutes, 0 = permanent)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), { name: "duree_min", type: CustomCommandParamType.Integer }],
        optionalParameters: [stringParam("raison")],
      },
      (origin, target: string, minutes: number, reason?: string) =>
        guardPerm(origin, "mod.mute", (player) => {
          const cleanReason = reason ?? "non spécifié";
          const result = sanctions.mute(target, player.name, cleanReason, minutes, resolveTargetId(target, db));
          if (!result.ok) {
            player.sendMessage(`§c[Modération] ${result.error}`);
            return;
          }
          player.sendMessage(`§a[Modération] ${target} muet (${formatDuration(minutes)}).`);
          notifyTarget(target, `§c[Modération] Tu es muet (${formatDuration(minutes)}) : ${cleanReason}`);
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:unmute <joueur>
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unmute",
        description: "Rend la parole à un joueur muet",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")],
      },
      (origin, target: string) =>
        guardPerm(origin, "mod.mute", (player) => {
          const result = sanctions.unmute(target);
          player.sendMessage(result.ok ? `§a[Modération] ${target} peut parler.` : `§c[Modération] ${result.error}`);
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:warn <joueur> <raison...>
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:warn",
        description: "Avertit un joueur (historisé)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")],
      },
      (origin, target: string, reason: string) =>
        guardPerm(origin, "mod.warn", (player) => {
          const result = sanctions.warn(target, player.name, reason, resolveTargetId(target, db));
          if (!result.ok) {
            player.sendMessage(`§c[Modération] ${result.error}`);
            return;
          }
          const count = sanctions.warnsOf(target).length;
          player.sendMessage(`§a[Modération] ${target} averti (${count} warn(s) au total).`);
          notifyTarget(target, `§6[Modération] ⚠ Avertissement (${count}) : ${reason}`);
        }),
    );

    // -----------------------------------------------------------------------
    // /sn:history <joueur>
    // -----------------------------------------------------------------------
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:history",
        description: "Historique des sanctions d'un joueur",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")],
      },
      (origin, target: string) =>
        guardPerm(origin, "mod.history", (player) => {
          const entries = sanctions.historyOf(target, 10);
          if (entries.length === 0) {
            player.sendMessage(`§7[Modération] ${target} : casier vierge.`);
            return;
          }
          player.sendMessage(`§6[Modération] Historique de ${target} :`);
          for (const entry of entries) {
            const date = new Date(entry.data.at);
            const hh = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
            player.sendMessage(
              `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${hh})`,
            );
          }
        }),
    );
  });
}
