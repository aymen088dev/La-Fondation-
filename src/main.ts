import { world, system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
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
import { ClassManager } from "./classes";
import { JobManager } from "./jobs";
import { MinesManager } from "./mines/manager";
import { trackPlayerJoin } from "./players";
import { log, logDb } from "./lib/log";
import { setUiDesign, RP_PACK_ID } from "./ui/theme";
import { setMinesSeed } from "./mines/manager";
import { Timings } from "@bedrock-oss/bedrock-boost";
/**
 * NaLandia (ex-OpenMontage) — point d'entrée du behavior pack (TypeScript).
 * Ce fichier est bundlé vers BP/scripts/main.js, entry déclaré dans BP/manifest.json.
 *
 * Ordre d'exécution Bedrock :
 *  1. Early execution : création DB, enregistrement des commandes /sn:*
 *  2. worldLoad : lectures DB, bootstrap admin, nameTags, protection
 *  3. playerSpawn : bienvenue + tracking joueurs
 *
 * NOTE v17 : plus AUCUN message de DB/technique dans le chat — tout passe
 * par les logs console (visibles via /scriptevent log:* uniquement).
 */

// ---------------------------------------------------------------------------
// Base de données locale, persistée dans les Dynamic Properties du monde
// ---------------------------------------------------------------------------
// ⚠️ PAS de db.load() ici : world.getDynamicProperty est interdit en early
// execution (ReferenceError au chargement du script). La lecture se fait
// au worldLoad (et en fallback au premier spawn), voir plus bas.
const db = new JsonDatabase(createBedrockStorage(), "nalania");

// Sauvegarde automatique toutes les 5 secondes, uniquement si nécessaire
registerAutosave(db, 100);

// ---------------------------------------------------------------------------
// Managers (rôles, modules, territoires) — tous adossés à la même DB
// ---------------------------------------------------------------------------
const permissions = new PermissionManager(db);
const modules = new ModuleManager(db);
const territories = new TerritoryManager(db);
const sanctions = new SanctionsManager(db);
const classes = new ClassManager(db);
const jobs = new JobManager(db);
const mines = new MinesManager();

// Les commandes /sn:* doivent être enregistrées au plus tôt (early execution)
registerCommands(territories, db, modules, permissions, mines);
registerAdminCommands({ permissions, modules, territories, sanctions, db, classes, jobs, mines });
registerModerationCommands({ sanctions, permissions, db });

let protectionRegistered = false;
let chatRegistered = false;

/**
 * Enregistre UNE SEULE FOIS le pipeline chat + éjection des bannis.
 * ⚠️ Garde partagée worldLoad/fallback : subscribe() appelé N fois =
 * chaque message de chat traité N fois (bug historique : chat ×3).
 */
function registerChatOnce(): void {
  if (chatRegistered) return;
  chatRegistered = true;
  registerChat({
    permissions,
    getMute: (playerName) => sanctions.getMute(playerName),
  });
  registerEnforcement(sanctions);
}

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
  classes.markLoaded();
  jobs.markLoaded();
  mines.markLoaded();

  // Dimension minière : check live sur le module "mines" (/sn:modules)
  // + boucles d'entretien (génération, secours anti-chute).
  mines.enabledCheck = () => modules.isEnabled("mines");
  mines.registerMaintenance();
  mines.registerFallRescue();

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

  // Chat custom : [grade] nom > message + mute intégré + éjection bannis
  // (garde unique : un seul subscribe, même si le fallback s'exécute aussi)
  registerChatOnce();

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
  // Diagnostic UI : si les héros/icônes n'apparaissent pas en jeu, la
  // première chose à vérifier est que ce pack_id (UUID) correspond bien à
  // l'UUID du RP chargé par le client (voir aussi world_resource_packs.json).
  log.info(`UI images : pack_id=${RP_PACK_ID} (doit matcher l'UUID du RP actif).`);
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
    sanctions.markLoaded();
    classes.markLoaded();
    jobs.markLoaded();
    mines.markLoaded();

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
  // registerChatOnce est idempotent : sans effet si worldLoad l'a déjà fait.
  registerChatOnce();

  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    mines.enabledCheck = () => modules.isEnabled("mines");
    mines.registerMaintenance();
    mines.registerFallRescue();
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
  trackPlayerJoin(
    db,
    player.id,
    player.name,
    permissions.roleOf(player.name)?.data.name ?? "",
    classes.classOf(player.name)?.classId ?? "",
  );

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

  // Accueil discret : une seule ligne (v17 — moins de spam au spawn).
  player.sendMessage("§6[NaLandia]§r Bienvenue ! Menu : §f/sn:menu");

  // Route de la première connexion : invite au choix de classe si absent.
  if (classes.classOf(player.name) === undefined) {
    player.sendMessage("§d[Classes]§r Choisis ta route avec §f/sn:classes§r — c'est définitif !");
  }

  // Le titre « ✔ » au spawn confirme que le script est chargé.
  player.onScreenDisplay.setTitle("§6NaLandia");
});

// Le tag est rafraîchi régulièrement (nouveaux rôles, changements de prefix...)
system.runInterval(() => {
  if (!permissions.loaded) return;
  for (const player of world.getAllPlayers()) {
    applyNameTag(player.name);
  }
}, 100);

// Toggle du design image (héros + icônes) : /scriptevent sn:ui off|on|status
// — si le client n'a pas le bon RP, les écrans restent utilisables sans image.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "sn:ui" || event.sourceEntity === undefined) return;
  if (event.sourceEntity.typeId !== "minecraft:player") return;
  const player = event.sourceEntity as Player;
  const mode = event.message.trim().toLowerCase();
  if (mode === "on" || mode === "off") {
    setUiDesign(mode === "on");
    log.info(`Design UI (héros + icônes) : ${mode.toUpperCase()}`);
    player.sendMessage(
      mode === "on"
        ? "§a[NaLandia] Design UI activé (icônes)."
        : "§e[NaLandia] Design UI désactivé (menus sans image — mode compatibilité).",
    );
  }
});

// Graine des mines : /scriptevent sn:seed <nombre> (avant la première
// génération) — les mines deviennent reproductibles d'un monde à l'autre.
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "sn:seed") return;
  const value = Number.parseInt(event.message.trim(), 10);
  if (Number.isFinite(value)) {
    setMinesSeed(value);
    log.info(`Mines : graine fixée à ${value}.`);
  }
});

// Heartbeat : état de la DB toutes les 30 secondes (600 ticks)
system.runInterval(() => {
  const stats = db.stats();
  logDb.info(
    `${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`,
  );
}, 600);
