import { world, system } from "@minecraft/server";
import type { ChatSendBeforeEvent, Player } from "@minecraft/server";
import type { PermissionManager } from "./manager";
import { vanillaOpColor } from "./perms";

/**
 * Chat personnalisé OpenMontage — format :
 *   [grade] nom > message
 *
 *  - `grade` = prefix du rôle entre crochets nus (§8[ §r§6Admin §8]§r), sa couleur.
 *    Sans rôle : rien (pseudo seul). Opérateur vanilla sans rôle : [Admin].
 *  - `nom` = pseudo, couleur custom > couleur de rôle > blanc.
 *  - séparateur " > " gris, message en blanc.
 *
 * Le message vanilla est annulé et ré-émis au tick suivant
 * (world.sendMessage interdit dans un before-event).
 *
 * ⚠️ Ce handler est l'UNIQUE subscriber chatSend qui annule : il intègre la
 * vérification de mute (sanctions) — avant, enforcement annulait le message
 * d'un muet mais registerChat le ré-émettait quand même (bug).
 */

/** Infos de mute minimales requises (decouplage avec le module moderation). */
export interface MuteLike {
  reason: string;
  by: string;
  expiresAt: number;
}

export interface ChatDeps {
  permissions: PermissionManager;
  /** Renvoie le mute actif du joueur (purge des expirés), ou undefined. */
  getMute?: (playerName: string) => MuteLike | undefined;
}

/** Nettoie et borne un message de chat (espaces multiples, longueur). */
export function sanitizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 256);
}

/** La partie grade du chat : "§8[ §r<couleur><prefix> §8]§r" ou "". */
export function gradeTagFor(permissions: PermissionManager, playerName: string, isVanillaOp: boolean): string {
  const member = permissions.getMember(playerName);
  const role = permissions.roleOf(playerName);

  // Opérateur vanilla sans rôle : grade [Admin] générique.
  if (role === undefined) {
    return isVanillaOp ? `§8[ §r${vanillaOpColor()}Admin§r §8]§r` : "";
  }

  const color = member?.data.customColor ?? role.data.color;
  const prefix = member?.data.customPrefix ?? role.data.prefix;
  if (prefix === "") return ""; // rôle sans prefix : pas de crochets

  return `§8[ §r${color}${prefix}§r §8]§r`;
}

/** Couleur du nom : custom du membre > couleur du rôle > blanc. */
function nameColorFor(permissions: PermissionManager, playerName: string, isVanillaOp: boolean): string {
  if (roleExists(permissions, playerName)) {
    const member = permissions.getMember(playerName);
    const role = permissions.roleOf(playerName);
    return member?.data.customColor ?? role?.data.color ?? "§f";
  }
  return isVanillaOp ? vanillaOpColor() : "§f";
}

function roleExists(permissions: PermissionManager, playerName: string): boolean {
  return permissions.getMember(playerName) !== undefined;
}

/** Format complet d'un message de chat. */
export function formatChatMessage(
  permissions: PermissionManager,
  playerName: string,
  message: string,
  isVanillaOp = false,
): string {
  const grade = gradeTagFor(permissions, playerName, isVanillaOp);
  const nameColor = nameColorFor(permissions, playerName, isVanillaOp);
  const space = grade === "" ? "" : " ";

  // Sans rôle : pseudo blanc, message gris clair. Avec rôle : couleur du
  // rôle + message blanc.
  const hasRole = roleExists(permissions, playerName);
  const messageColor = hasRole || isVanillaOp ? "§f" : "§7";

  return `${grade}${space}${nameColor}${playerName}§r §7> ${messageColor}${message}`;
}

export function registerChat(deps: ChatDeps): void {
  const { permissions, getMute } = deps;

  world.beforeEvents.chatSend.subscribe((event: ChatSendBeforeEvent) => {
    if (!permissions.loaded) return;

    const sender = event.sender as Player;
    const isVanillaOp = sender.playerPermissionLevel >= 2;

    // Mute : bloqué ICI (unique point d'annulation chat).
    const mute = getMute?.(sender.name);
    if (mute !== undefined) {
      event.cancel = true;
      const remaining =
        mute.expiresAt === 0
          ? "permanent"
          : `${Math.max(1, Math.ceil((mute.expiresAt - Date.now()) / 60_000))} min`;
      system.run(() => {
        sender.sendMessage(
          `§c[Modération] Tu es muet (${remaining}). §7Motif : §f${mute.reason}§7 — par §f${mute.by}`,
        );
      });
      return;
    }

    // Message vanilla annulé, ré-émis formaté au tick suivant.
    event.cancel = true;
    const message = sanitizeMessage(event.message);
    const formatted = formatChatMessage(permissions, sender.name, message, isVanillaOp);

    system.run(() => {
      // Les sauts de ligne doivent être envoyés un par un (sendMessage).
      for (const line of formatted.split("\n")) {
        world.sendMessage(line);
      }
    });
  });
}
