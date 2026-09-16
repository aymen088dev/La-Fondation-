import { world, system } from "@minecraft/server";
import { createBedrockStorage, JsonDatabase, registerAutosave } from "./db";
import { TerritoryManager, registerCommands, registerProtection } from "./territories";
import { trackPlayerJoin } from "./players";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 */

// ---------------------------------------------------------------------------
// Base de données locale, persistée dans les Dynamic Properties du monde
// ---------------------------------------------------------------------------
const db = new JsonDatabase(createBedrockStorage(), "openmontage");
db.load();

// Sauvegarde automatique toutes les 5 secondes, uniquement si la DB a changé
registerAutosave(db, 100);

// ---------------------------------------------------------------------------
// Système de territoires (revendication de chunks)
// ---------------------------------------------------------------------------
const territories = new TerritoryManager(db);

// Les commandes /sn:* doivent être enregistrées au plus tôt (early execution)
registerCommands(territories);

// La protection et le marquage "chargé" attendent que le monde soit prêt
world.afterEvents.worldLoad.subscribe(() => {
  territories.markLoaded();
  registerProtection(territories);

  const stats = db.stats();
  console.log(
    `[OpenMontage] DB chargée : ${stats.documents} documents, ${stats.bytes} octets. Commandes /sn:create et /sn:info actives.`,
  );
});

// ---------------------------------------------------------------------------
// Joueurs : bienvenue + enregistrement en DB
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  trackPlayerJoin(db, player.name);

  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Tape §f/sn:create§r pour revendiquer ce chunk.");
});

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);
