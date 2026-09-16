import { world, system } from "@minecraft/server";
import type { ChatSendBeforeEvent } from "@minecraft/server";
import type { PermissionManager } from "./manager";

/**
 * Chat personnalisé OpenMontage — format par défaut :
 *   §8[§<couleur>Joueur§8] §7> §fmessage
 *
 * Les crochets et le chevron sont gris, le pseudo prend la couleur du rôle
 * (ou la couleur personnalisée du joueur). Le message vanilla est annulé et
 * ré-émis au tick suivant (world.sendMessage est interdit dans un
 * before-event).
 *
 * Nécessite la dépendance bêta @minecraft/server 2.11.0-beta
 * (expérimentation "Beta APIs" activée sur le monde).
 */

/** Nettoie et borne un message de chat (espaces multiples, longueur). */
export function sanitizeMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 256);
}

/** Format d'un message de chat : [Joueur] > message. */
export function formatChatMessage(nameTag: string, message: string): string {
  // nameTag = "§8[§6Admin §6Aymen§8]" : les crochets externes sont déjà gris.
  return `${nameTag}§r §7> §f${message}`;
}

export function registerChat(permissions: PermissionManager): void {
  world.beforeEvents.chatSend.subscribe((event: ChatSendBeforeEvent) => {
    if (!permissions.loaded) return;

    const sender = event.sender;
    const tag = permissions.nameTagFor(sender.name);

    // On annule le message vanilla et on le ré-émet formaté.
    // (world.sendMessage est interdit dans un before-event : on planifie au tick suivant)
    event.cancel = true;
    const message = sanitizeMessage(event.message);

    system.run(() => {
      world.sendMessage(formatChatMessage(tag, message));
    });
  });
}
