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
import { log, logDb } from "./lib/log";
import { Timings } from "@bedrock-oss/bedrock-boost";
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
registerCommands(territories, db, modules, permissions);
registerAdminCommands({ permissions, modules, territories, sanctions, db });
registerModerationCommands({ sanctions, permissions, db });

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
  Timings.begin("worldLoad");
  db.load();
  permissions.markLoaded();
  modules.markLoaded();
  territories.markLoaded();
  sanctions.markLoaded();

  // Rôles par défaut ([Joueur], [Modo]) puis bootstrap admin :
  // le premier opérateur vanilla devient Admin si aucun admin n'existe
  permissions.bootstrapDefaultRoles();
  if (!permissions.hasAdmin()) {
    const operator = world.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
    if (operator !== undefined) {
      permissions.bootstrapAdmin(operator.name);
      log.info(`Bootstrap : ${operator.name} est promu Admin.`);
    }
  }

  // Tout joueur déjà connecté sans rôle reçoit [Joueur]
  for (const player of world.getAllPlayers()) {
    permissions.ensureDefaultRole(player.name, player.id);
  }

  // Tags de rôle pour tous les joueurs déjà connectés
  for (const player of world.getAllPlayers()) {
    applyNameTag(player.name);
  }

  // Chat custom : [grade] nom > message + mute intégré (pipeline unique)
  registerChat({
    permissions,
    getMute: (playerName) => sanctions.getMute(playerName),
  });

  registerChat({
    permissions,
    getMute: (playerName) => sanctions.getMute(playerName),
  });

  // Sanctions : éjection des bannis au spawn (mute = géré dans le chat)
  registerEnforcement(sanctions);

  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
  }

  const stats = db.stats();
  Timings.end();
  log.info(
    `worldLoad OK en ~${Math.round(Timings.lastTime)} ms : ${stats.documents} documents, ${stats.bytes} octets. Modules actifs : ${modules.enabledCount()}.`,
  );
});

// Fallback : si worldLoad n'arrive pas (ou arrive après un join), on active au 1er spawn
let worldReady = false;
let chatRegistered = false;
system.runInterval(() => {
  if (worldReady) return;
  if (world.getAllPlayers().length === 0) return;

  if (!territories.loaded) {
    db.load();
    permissions.markLoaded();
    modules.markLoaded();
    territories.markLoaded();
    sanctions.markLoaded();

    permissions.bootstrapDefaultRoles();
    if (!permissions.hasAdmin()) {
      const operator = world.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
      if (operator !== undefined) permissions.bootstrapAdmin(operator.name);
    }
    for (const player of world.getAllPlayers()) {
      permissions.ensureDefaultRole(player.name, player.id);
      applyNameTag(player.name);
    }
  }

  // Le chat et l'enforcement des bans doivent aussi marcher en fallback
  // (avant : sans worldLoad, un muet pouvait parler et un banni rester).
  if (!chatRegistered) {
    chatRegistered = true;
    registerChat({
      permissions,
      getMute: (playerName) => sanctions.getMute(playerName),
    });
    registerEnforcement(sanctions);
  }

  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    log.warn("Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);

// ---------------------------------------------------------------------------
// Joueurs : bienvenue + tracking + tag de rôle
// ---------------------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;

  const player = event.player;
  // Tout nouveau joueur reçoit le rôle [Joueur] (gris) avant le tracking.
  permissions.ensureDefaultRole(player.name, player.id);
  trackPlayerJoin(db, player.id, player.name, permissions.roleOf(player.name)?.data.name ?? "");

  // Résout les identités v3 : member (grade) + sanction par pseudo → Player.id
  const member = permissions.getMember(player.name);
  if (member !== undefined && member.data.playerId !== player.id) {
    member.data.playerId = player.id;
    member.updatedAt = Date.now();
    db.markDirty();
  }
  for (const collection of ["bans", "mutes"] as const) {
    const doc = db.findOne<{ playerId: string | null }>(collection, player.name);
    if (doc !== undefined && doc.data.playerId !== player.id) {
      doc.data.playerId = player.id;
      doc.updatedAt = Date.now();
      db.markDirty();
    }
  }

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
  logDb.info(
    `${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);
