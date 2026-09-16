import { world, system, GameMode, Player } from "@minecraft/server";

/** Envoie un message à un joueur depuis un before-event (read-only) :
 *  l'écriture est interdite ici, on planifie au tick suivant. */
function safeSend(player: Player, message: string): void {
  system.run(() => {
    try {
      player.sendMessage(message);
    } catch {
      // joueur parti entre-temps : on ignore
    }
  });
}
import type { TerritoryManager } from "./manager";
import { chunkKeyFromPosition } from "./manager";
import type { ModuleManager } from "../modules/manager";

const DENY_BREAK = "§c[Territoires] Chunk protégé : destruction impossible.";
const DENY_PLACE = "§c[Territoires] Chunk protégé : construction impossible.";
const DENY_INTERACT = "§c[Territoires] Chunk protégé : interaction impossible.";
const DENY_COMBAT = "§c[Territoires] Zone protégée : ce joueur ne peut pas être attaqué ici.";
const DENY_ITEM = "§c[Territoires] Chunk protégé : objet inutilisable ici.";

/** Un joueur est-il créatif ? (les créatifs contournent la protection) */
function isCreative(playerName: string): boolean {
  const player = world.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== undefined && player.getGameMode() === GameMode.Creative;
}

/** Le bloc est-il dans un territoire où ce joueur (par id Bedrock) ne peut pas construire ? */
function isProtectedForId(
  block: { dimension: { id: string }; location: { x: number; y: number; z: number } },
  player: { id: string; name: string },
  manager: TerritoryManager,
): boolean {
  const key = chunkKeyFromPosition(block.dimension.id, block.location.x, block.location.z);
  return !manager.isAllowedFor(player.id, player.name, key);
}

/**
 * Protection totale des territoires :
 * - casse de blocs : refusée aux non-propriétaires (sauf créatifs)
 * - pose de blocs : l'API stable n'a pas d'event annulable -> rollback du bloc au tick suivant
 * - interactions (coffres, portes, leviers...) : refusées
 * - usage d'objets (seaux, œufs, perles, feux d'artifice...) : refusé
 * - interaction avec les entités (traire, nourrir, équipier...) : refusée
 * - PvP : annulé si la victime est dans un territoire dont l'attaquant n'est pas le propriétaire
 * - dégâts aux entités non-joueurs du territoire : annulés
 * - explosions : les blocs en territoire ennemi sont retirés de l'impact
 */
export function registerProtection(manager: TerritoryManager, modules?: ModuleManager): void {
  /** Le module territoires est-il actif ? (défaut : oui si pas de module manager) */
  const enabled = (): boolean => modules === undefined || modules.isEnabled("territories");

  // 1. Casse de blocs
  world.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_BREAK);
    }
  });

  // 2. Pose de blocs : pas d'event annulable en API stable -> rollback au tick suivant
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    const { block, dimension } = event;
    const key = chunkKeyFromPosition(dimension.id, block.location.x, block.location.z);
    if (manager.isAllowedFor(player.id, player.name, key)) return;

    // Rollback au tick suivant : remet le bloc remplacé (air par défaut).
    // (l'API stable n'a pas d'event playerPlaceBlock annulable)
    const location = block.location;
    const x = Math.floor(location.x);
    const y = Math.floor(location.y);
    const z = Math.floor(location.z);

    system.run(() => {
      try {
        dimension.runCommand(`setblock ${x} ${y} ${z} air`);
      } catch {
        // chunk non chargé ou commande indisponible : on ignore
      }
    });

    safeSend(player, DENY_PLACE);
  });

  // 3. Interaction avec un bloc (coffres, portes, leviers...)
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });

  // 4. Usage d'objets (seaux d'eau/lave, œufs, perles d'Ender...)
  world.beforeEvents.itemUse.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const player = event.source;
    if (isCreative(player.name)) return;

    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_ITEM);
    }
  });

  // 5. Interaction avec une entité (traire, nourrir, sellier...)
  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const player = event.player;
    if (isCreative(player.name)) return;

    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });

  // 6. Combat : la victime est-elle défendue par un territoire ?
  world.beforeEvents.entityHurt.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

    const attacker = event.damageSource.damagingEntity;
    if (!(attacker instanceof Player)) return;

    const victim = event.hurtEntity;

    // 6a. PvP : la victime est-elle dans un territoire ?
    if (victim.typeId === "minecraft:player") {
      const victimKey = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
      const territory = manager.findByChunk(victimKey);
      if (territory === undefined) return; // chunk libre : PvP autorisé

      // Autorisé si l'attaquant défend le territoire (propriétaire ou
      // membre) ou s'il combat depuis son propre territoire.
      const attackerKey = chunkKeyFromPosition(attacker.dimension.id, attacker.location.x, attacker.location.z);
      const attackerTerritory = manager.findByChunk(attackerKey);
      const defendsTerritory =
        territory.data.ownerId === attacker.id ||
        territory.data.owner === attacker.name ||
        territory.data.members.some((member) => member.playerId === attacker.id);
      const fightsFromHome =
        attackerTerritory !== undefined &&
        (attackerTerritory.data.ownerId === attacker.id || attackerTerritory.data.owner === attacker.name);
      if (defendsTerritory || fightsFromHome) return;

      event.cancel = true;
      safeSend(attacker, DENY_COMBAT);
      return;
    }

    // 6b. Entité non-joueur : protégée si elle se trouve dans un territoire
    const key = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
    if (manager.isProtected(key)) {
      event.cancel = true;
      safeSend(attacker, "§c[Territoires] Chunk protégé : les créatures ici sont sous la protection du propriétaire.");
    }
  });

  // 7. Explosions : retire les blocs protégés de l'impact
  world.beforeEvents.explosion.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;

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

