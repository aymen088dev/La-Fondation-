import { world, system } from "@minecraft/server";
import type { ChatSendBeforeEvent } from "@minecraft/server";
import type { PermissionManager } from "./manager";

/**
 * Chat personnalisé : chaque message est réécrit avec le prefix coloré
 * du rôle de son auteur, ex :
 *   §6[Admin] §6Aymen§r : salut
 *
 * Nécessite la dépendance bêta @minecraft/server 2.11.0-beta
 * (expérimentation "Beta APIs" activée sur le monde).
 */
export function registerChat(permissions: PermissionManager): void {
  world.beforeEvents.chatSend.subscribe((event: ChatSendBeforeEvent) => {
    if (!permissions.loaded) return;

    const sender = event.sender;
    const tag = permissions.nameTagFor(sender.name);

    // On annule le message vanilla et on le ré-émet formaté.
    // (world.sendMessage est interdit dans un before-event : on planifie au tick suivant)
    event.cancel = true;
    const message = event.message.replace(/\s+/g, " ").slice(0, 256);

    system.run(() => {
      world.sendMessage(`${tag}§r§7: §f${message}`);
    });
  });
}

