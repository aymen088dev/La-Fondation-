import { world, system } from "@minecraft/server";
import type { ChatSendBeforeEvent } from "@minecraft/server";
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
 * Application active des sanctions :
 * - ban : éjection au spawn avec motif affiché
 * - mute : interception des messages chat avant diffusion
 * À brancher après worldLoad.
 */
export function registerEnforcement(sanctions: SanctionsManager, onChatReady?: () => void): void {
  // 1. Ban : vérifié à chaque spawn
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

  // 2. Mute : blocage des messages avant diffusion (chat bêta)
  world.beforeEvents.chatSend.subscribe((event: ChatSendBeforeEvent) => {
    if (!sanctions.loaded) return;

    const mute = sanctions.getMute(event.sender.name);
    if (mute === undefined) return;

    event.cancel = true;
    const sender = event.sender;
    const remaining =
      mute.expiresAt === 0 ? "permanent" : `${Math.max(1, Math.ceil((mute.expiresAt - Date.now()) / 60_000))} min`;

    system.run(() => {
      sender.sendMessage(
        `§c[Modération] Tu es muet (${remaining}). §7Motif : §f${mute.reason}§7 — par §f${mute.by}`,
      );
    });
  });

  onChatReady?.();
}

