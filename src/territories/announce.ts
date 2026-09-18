/**
 * Annonceur de clan/État : bandeau HUD quand un joueur entre dans un
 * territoire revendiqué (nom coloré du drapeau + chef) et quand il en sort.
 *
 * Le texte passe par l'actionbar du HUD vanilla : le Resource Pack
 * NaLandia (RP/) restyle cette zone via JSON UI pour afficher un
 * vrai bandeau au lieu du simple texte.
 */

import { system, world } from "@minecraft/server";
import type { TerritoryManager } from "./manager";
import { chunkKeyFromPosition } from "./manager";
import { getColor } from "./types";
import type { ModuleManager } from "../modules/manager";

const NO_TERRITORY_MESSAGE = "§7Zone libre";

/**
 * Enregistre la boucle d'annonce : pour chaque joueur en ligne, détecte le
 * changement de territoire (ou de zone libre) et affiche un bandeau.
 * À appeler après le chargement du monde.
 */
export function registerAnnouncer(
  manager: TerritoryManager,
  modules?: ModuleManager,
  intervalTicks = 10,
): void {
  /** Le module territoires est-il actif ? */
  const enabled = (): boolean => modules === undefined || modules.isEnabled("territories");

  /** Dernière clé de chunk connue de chaque joueur (détecte les changements). */
  const lastKeyByPlayer = new Map<string, string>();

  world.afterEvents.playerLeave.subscribe((event) => {
    lastKeyByPlayer.delete(event.playerName);
  });

  system.runInterval(() => {
    if (!manager.loaded || !enabled()) return;

    for (const player of world.getAllPlayers()) {
      const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
      const previous = lastKeyByPlayer.get(player.name);

      // Pas de changement : rien à annoncer.
      if (previous === key) continue;
      lastKeyByPlayer.set(player.name, key);

      const territory = manager.findByChunk(key);
      if (territory === undefined) {
        // On quitte un territoire pour une zone libre.
        if (previous !== undefined && manager.isProtected(previous)) {
          player.onScreenDisplay.setActionBar(NO_TERRITORY_MESSAGE);
        }
        continue;
      }

      const color = getColor(territory.data.color).code;
      player.onScreenDisplay.setActionBar(
        `${color}⚑ ${territory.data.name}§r §7— clan de §f${territory.data.owner}`,
      );
    }
  }, intervalTicks);
}
