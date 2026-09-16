import { world, system } from "@minecraft/server";
import { createBedrockStorage, JsonDatabase } from "./db";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 */

// Base de données locale, persistée dans les Dynamic Properties du monde
const db = new JsonDatabase(createBedrockStorage(), "openmontage");
db.load();

interface PlayerRecord {
  name: string;
  sessions: number;
}

// Bienvenue + enregistrement des joueurs dans la DB
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  const existing = db.findOne<PlayerRecord>("players", player.name);

  if (existing === undefined) {
    db.insert<PlayerRecord>("players", { name: player.name, sessions: 1 }, player.name);
  } else {
    db.update<PlayerRecord>("players", player.name, { sessions: existing.data.sessions + 1 });
  }
  db.save();

  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Script TypeScript + DB locale chargés ✅");
});

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  console.log(`[OpenMontage] DB locale : ${stats.documents} documents, ${stats.bytes} octets`);
}, 600);

// Exemple : détecter les blocs cassés
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const { player, block } = event;
  console.log(`${player.name} a cassé un bloc de type ${block.typeId}`);
});
