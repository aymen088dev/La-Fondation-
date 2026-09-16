import { world, system } from "@minecraft/server";
import { createBedrockStorage, JsonDatabase, registerAutosave } from "./db";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 */

// Base de données locale, persistée dans les Dynamic Properties du monde
const db = new JsonDatabase(createBedrockStorage(), "openmontage");
db.load();

// Sauvegarde automatique toutes les 5 secondes, uniquement si la DB a changé
registerAutosave(db, 100);

interface PlayerRecord {
  name: string;
  sessions: number;
}

// Bienvenue + enregistrement des joueurs dans la DB
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  const record = db.findOne<PlayerRecord>("players", player.name);

  // Insère le joueur ou incrémente son compteur de sessions
  db.upsert<PlayerRecord>("players", player.name, {
    name: player.name,
    sessions: (record?.data.sessions ?? 0) + 1,
  });

  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Script TypeScript + DB locale chargés ✅");
});

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);

// Exemple : détecter les blocs cassés
world.afterEvents.playerBreakBlock.subscribe((event) => {
  const { player, block } = event;
  console.log(`${player.name} a cassé un bloc de type ${block.typeId}`);
});
