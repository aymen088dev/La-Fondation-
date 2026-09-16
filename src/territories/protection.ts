import { world, GameMode, Player } from "@minecraft/server";
import type { TerritoryManager } from "./manager";
import { chunkKeyFromPosition } from "./manager";

const DENY_BREAK = "§c[Territoires] Ce chunk appartient à un autre joueur : destruction impossible.";
const DENY_INTERACT = "§c[Territoires] Ce chunk est protégé : interaction impossible.";
const DENY_COMBAT = "§c[Territoires] Zone protégée : ce joueur ne peut pas être attaqué ici.";

/** Un joueur est-il créatif ? (les créatifs contournent la protection) */
function isCreative(playerName: string): boolean {
  const player = world.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== undefined && player.getGameMode() === GameMode.Creative;
}

/**
 * Protection des territoires :
 * - casse de blocs : refusée aux non-propriétaires (sauf créatifs)
 * - interaction (coffres, portes...) : refusée aux non-propriétaires
 * - PvP : annulé si la victime est dans un territoire dont l'attaquant n'est pas le propriétaire
 * - explosions : les blocs en territoire ennemi sont retirés de l'impact
 */
export function registerProtection(manager: TerritoryManager): void {
  // 1. Casse de blocs
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    const key = chunkKeyFromPosition(event.block.dimension.id, event.block.location.x, event.block.location.z);
    if (!manager.isAllowed(player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_BREAK);
    }
  });

  // 2. Interaction avec un bloc (coffres, portes, leviers...)
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    const key = chunkKeyFromPosition(event.block.dimension.id, event.block.location.x, event.block.location.z);
    if (!manager.isAllowed(player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_INTERACT);
    }
  });

  // 3. Combat dans les territoires ennemis
  world.beforeEvents.entityHurt.subscribe((event) => {
    if (!manager.loaded) return;

    const attacker = event.damageSource.damagingEntity;
    if (!(attacker instanceof Player)) return;
    if (event.hurtEntity.typeId !== "minecraft:player") return;

    const victim = event.hurtEntity;
    const key = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);

    const territory = manager.findByChunk(key);
    if (territory !== undefined && territory.data.owner !== attacker.name) {
      event.cancel = true;
      attacker.sendMessage(DENY_COMBAT);
    }
  });

  // 4. Explosions : retire les blocs protégés de l'impact
  world.beforeEvents.explosion.subscribe((event) => {
    if (!manager.loaded) return;

    const impacted = event.getImpactedBlocks();
    const allowed = impacted.filter((block) => {
      const key = chunkKeyFromPosition(block.dimension.id, block.location.x, block.location.z);
      return !manager.isProtected(key);
    });

    if (allowed.length !== impacted.length) {
      if (allowed.length === 0) {
        event.cancel = true;
      } else {
        event.setImpactedBlocks(allowed);
      }
    }
  });
}
