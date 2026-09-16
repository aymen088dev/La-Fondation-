import { world, system } from "@minecraft/server";
import type { SanctionsManager } from "./manager";

/** Éjecte un joueur du monde (kick vanilla via runCommand). */
export function kickPlayer(playerName: string, reason: string): boolean {
  const player = world.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === undefined) return false;

  try {
    player.runCommand(`kick "${playerName}" ${reason}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Application active des bans : éjection au join avec motif affiché.
 *
 * (Le mute est désormais géré directement dans le pipeline chat unique
 * de src/permissions/chat.ts — l'ancien second subscriber chatSend
 * ré-émettait les messages des muets annulés ici : bug corrigé.)
 */
export function registerEnforcement(sanctions: SanctionsManager): void {
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn || !sanctions.loaded) return;

    const player = event.player;
    const ban = sanctions.getBan(player.name);
    if (ban === undefined) return;

    const expiry =
      ban.expiresAt === 0
        ? "§4BANNI PERMANENTLEMENT"
        : `§4BANNI§7 (encore ${Math.max(1, Math.ceil((ban.expiresAt - Date.now()) / 60_000))} min)`;

    // On affiche le motif puis on éjecte au tick suivant
    player.sendMessage(`§c[Territoires/OpenMontage] ${expiry}\n§7Motif : §f${ban.reason}§7 — par §f${ban.by}`);
    system.run(() => {
      kickPlayer(player.name, ban.reason);
    });
  });
}
