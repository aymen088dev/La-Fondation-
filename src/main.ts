import { world, system } from "@minecraft/server";
import { createBedrockStorage, JsonDatabase, registerAutosave } from "./db";
import { TerritoryManager, registerCommands, registerProtection, registerAnnouncer } from "./territories";
import { PermissionManager, canUseAdminPanel, registerChat } from "./permissions";
import { registerAdminCommands } from "./permissions/commands";
import { ModuleManager } from "./modules";
import {
  SanctionsManager,
  registerModerationCommands,
  registerEnforcement,
} from "./moderation";
import { trackPlayerJoin } from "./players";

/**
 * OpenMontage — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 *
 * Ordre d'exécution Bedrock :
 *  1. Early execution : création DB, enregistrement des commandes /sn:*
 *  2. worldLoad : lectures DB, bootstrap admin, nameTags, protection
 *  3. playerSpawn : bienvenue + tracking joueurs
 */

// ---------------------------------------------------------------------------
// Base de données locale, persistée dans les Dynamic Properties du monde
// ---------------------------------------------------------------------------
// ⚠️ PAS de db.load() ici : world.getDynamicProperty est interdit en early
// execution (ReferenceError au chargement du script). La lecture se fait
// au worldLoad (et en fallback au premier spawn), voir plus bas.
const db = new JsonDatabase(createBedrockStorage(), "openmontage");

// Sauvegarde automatique toutes les 5 secondes, uniquement si nécessaire
registerAutosave(db, 100);

// ---------------------------------------------------------------------------
// Managers (rôles, modules, territoires) — tous adossés à la même DB
// ---------------------------------------------------------------------------
const permissions = new PermissionManager(db);
const modules = new ModuleManager(db);
const territories = new TerritoryManager(db);
const sanctions = new SanctionsManager(db);

// Les commandes /sn:* doivent être enregistrées au plus tôt (early execution)
registerCommands(territories, db, modules);
registerAdminCommands({ permissions, modules, territories, sanctions });
registerModerationCommands({ sanctions, permissions });

let protectionRegistered = false;

/** Applique le tag coloré (rôle + prefix) au-dessus de la tête d'un joueur. */
function applyNameTag(playerName: string): void {
  const player = world.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === undefined) return;

  try {
    player.nameTag = permissions.nameTagFor(playerName);
  } catch {
    // nameTag indisponible dans certains contextes restreints : on ignore
  }
}

world.afterEvents.worldLoad.subscribe(() => {
  // Lecture de la DB : getDynamicProperty n'est autorisé qu'après worldLoad
  db.load();
  permissions.markLoaded();
  modules.markLoaded();
  territories.markLoaded();

  // Bootstrap admin : le premier opérateur vanilla devient Admin si aucun admin n'existe
  if (!permissions.hasAdmin()) {
    const operator = world.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
    if (operator !== undefined) {
      permissions.bootstrapAdmin(operator.name);
      console.log(`[OpenMontage] Bootstrap : ${operator.name} est promu Admin.`);
    }
  }

  // Tags de rôle pour tous les joueurs déjà connectés
  for (const player of world.getAllPlayers()) {
    applyNameTag(player.name);
  }

  // Chat custom : prefix coloré du rôle sur chaque message
  registerChat(permissions);

  // Sanctions : éjection des bannis au spawn + blocage des muets dans le chat
  registerEnforcement(sanctions);

  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
  }

  const stats = db.stats();
  console.log(
    `[OpenMontage] worldLoad OK : ${stats.documents} documents, ${stats.bytes} octets. Modules actifs : ${modules.enabledCount()}.`,
  );
});

// Fallback : si worldLoad n'arrive pas (ou arrive après un join), on active au 1er spawn
let worldReady = false;
system.runInterval(() => {
  if (worldReady) return;
  if (world.getAllPlayers().length === 0) return;

  if (!territories.loaded) {
    db.load();
    permissions.markLoaded();
    modules.markLoaded();
    territories.markLoaded();

    if (!permissions.hasAdmin()) {
      const operator = world.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
      if (operator !== undefined) permissions.bootstrapAdmin(operator.name);
    }
    for (const player of world.getAllPlayers()) applyNameTag(player.name);
  }
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    console.warn("[OpenMontage] Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);

// ---------------------------------------------------------------------------
// Joueurs : bienvenue + tracking + tag de rôle
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  trackPlayerJoin(db, player.name);
  applyNameTag(player.name);

  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Menu principal : §f/sn:menu§r — territoire : §f/sn:create");

  // Diagnostic : si tu vois ce titre en jeu, le script est chargé.
  player.onScreenDisplay.setTitle("§aOpenMontage §f✔");
});

// Le tag est rafraîchi régulièrement (nouveaux rôles, changements de prefix...)
system.runInterval(() => {
  if (!permissions.loaded) return;
  for (const player of world.getAllPlayers()) {
    applyNameTag(player.name);
  }
}, 100);

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);
