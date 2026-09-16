import { world, system } from "@minecraft/server";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé en JavaScript vers BP/scripts/main.js,
 * qui est l'entry déclaré dans BP/manifest.json.
 */

// Message de bienvenue aux joueurs qui rejoignent le monde
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  event.player.sendMessage("§a[OpenMontage]§r Bienvenue ! Le script TypeScript est chargé ✅");
});

// Tick global : exemple simple, exécuté toutes les 20 ticks (1 seconde)
let tickCounter = 0;
system.runInterval(() => {
  tickCounter++;

  // Toutes les 30 secondes : heartbeat en console (visible avec /script profiler ou les logs)
  if (tickCounter % 30 === 0) {
    console.log(`[OpenMontage] Script actif depuis ${tickCounter * 20} ticks`);
  }
}, 20);

// Exemple : détecter les blocs cassés
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const { player, block } = event;
  console.log(`${player.name} a cassé un bloc de type ${block.typeId}`);
});
