import { world, system } from "@minecraft/server";
import { createBedrockStorage, JsonDatabase, registerAutosave } from "./db";
import { TerritoryManager, registerCommands, registerProtection } from "./territories";
import { trackPlayerJoin } from "./players";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 *
 * Ordre d'exécution Bedrock :
 *  1. Early execution (chargement du script) : création DB, enregistrement /sn:*
 *  2. worldLoad : marquage "chargé" + activation protection + re-lecture DB
 *  3. playerSpawn : bienvenue + tracking joueurs
 */

// ---------------------------------------------------------------------------
// Base de données locale, persistée dans les Dynamic Properties du monde
// ---------------------------------------------------------------------------
const db = new JsonDatabase(createBedrockStorage(), "openmontage");
db.load(); // lecture au plus tôt ; re-lecture au worldLoad (dynamic properties y sont fiables)

// Sauvegarde automatique toutes les 5 secondes, uniquement si la DB a changé
registerAutosave(db, 100);

// ---------------------------------------------------------------------------
// Système de territoires (revendication de chunks)
// ---------------------------------------------------------------------------
const territories = new TerritoryManager(db);

// Les commandes /sn:* doivent être enregistrées au plus tôt (early execution)
registerCommands(territories);

let protectionRegistered = false;

world.afterEvents.worldLoad.subscribe(() => {
  // Re-lecture de la DB : certaines Dynamic Properties ne sont visibles qu'après worldLoad
  db.load();

  territories.markLoaded();

  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories);
  }

  const stats = db.stats();
  console.log(
    `[OpenMontage] worldLoad OK : ${stats.documents} documents, ${stats.bytes} octets. Commandes /sn:create et /sn:info actives.`,
  );
});

// Fallback : si worldLoad n'arrive pas (ou arrive après un join), on active au 1er spawn
let worldReady = false;
system.runInterval(() => {
  if (worldReady) return;
  if (world.getAllPlayers().length === 0) return;

  if (!territories.loaded) {
    territories.markLoaded();
    db.load();
  }
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories);
    console.warn("[OpenMontage] Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);

// ---------------------------------------------------------------------------
// Joueurs : bienvenue + enregistrement en DB + diagnostic visuel
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  trackPlayerJoin(db, player.name);

  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Tape §f/sn:create§r pour revendiquer ce chunk.");

  // Diagnostic : si tu vois ce titre en jeu, le script est chargé.
  // Si le titre s'affiche mais pas le menu /sn:create -> problème de commandes (redémarre le monde).
  player.onScreenDisplay.setTitle("§aOpenMontage §f✔");
});

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);
