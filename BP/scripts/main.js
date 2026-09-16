// src/main.ts
import { world as world3, system as system3 } from "@minecraft/server";

// src/db/types.ts
var DB_SCHEMA_VERSION = 1;
var DB_STORAGE_PARTITION = "openmontage_db";

// src/db/storage.ts
var CHUNK_SIZE = 3e4;
function splitIntoChunks(payload) {
  const chunks = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

// src/db/database.ts
function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
var JsonDatabase = class {
  constructor(storage, name = "openmontage") {
    this.storage = storage;
    this.name = name;
    this.file = { schemaVersion: DB_SCHEMA_VERSION, name, savedAt: 0, collections: {} };
  }
  file;
  dirty = false;
  /** Passe à true après le premier load() réussi (monde chargé). */
  loaded = false;
  /**
   * Charge la base depuis le stockage. À appeler uniquement quand le monde
   * est chargé (worldLoad) : en early execution, la lecture des Dynamic
   * Properties est interdite par Bedrock.
   */
  load() {
    try {
      const raw = this.storage.read();
      if (raw === null) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || typeof parsed.collections !== "object" || parsed.collections === null) {
        throw new Error("structure inattendue");
      }
      if (parsed.schemaVersion !== DB_SCHEMA_VERSION) {
        console.warn(
          `[DB] Version de schéma ${parsed.schemaVersion} != ${DB_SCHEMA_VERSION} : migration à prévoir.`
        );
      }
      this.file = {
        schemaVersion: DB_SCHEMA_VERSION,
        name: this.name,
        savedAt: parsed.savedAt ?? 0,
        collections: parsed.collections
      };
      this.dirty = false;
      this.loaded = true;
    } catch (error) {
      console.warn(
        `[DB] Chargement impossible ("${this.name}") : ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  /**
   * Écrit la base dans le stockage si elle a été modifiée (ou si force).
   * Renvoie true si une écriture a eu lieu.
   */
  save(force = false) {
    if (!this.dirty && !force) return false;
    this.file.savedAt = Date.now();
    this.storage.write(JSON.stringify(this.file));
    this.dirty = false;
    return true;
  }
  /** Insère un document (id auto ou fourni) et le renvoie. Échoue si l'id existe. */
  insert(collection, data, id) {
    const now = Date.now();
    const doc = { id: id ?? generateId(), createdAt: now, updatedAt: now, data };
    if (this.findOne(collection, doc.id) !== void 0) {
      throw new Error(`[DB] L'id "${doc.id}" existe déjà dans "${collection}" (utilisez upsert).`);
    }
    this.ensureCollection(collection).push(doc);
    this.dirty = true;
    return doc;
  }
  /** Insère ou met à jour un document par identifiant (fusion pour la mise à jour). */
  upsert(collection, id, data) {
    const existing = this.findOne(collection, id);
    if (existing === void 0) {
      return this.insert(collection, data, id);
    }
    existing.data = { ...existing.data, ...data };
    existing.updatedAt = Date.now();
    this.dirty = true;
    return existing;
  }
  /** Renvoie les documents d'une collection, éventuellement filtrés (copie défensive). */
  find(collection, predicate) {
    const docs = this.getCollection(collection);
    return predicate ? docs.filter(predicate) : docs.slice();
  }
  /** Renvoie un document par identifiant. */
  findOne(collection, id) {
    return this.getCollection(collection).find((doc) => doc.id === id);
  }
  /** Fusionne un patch dans un document existant et le renvoie. */
  update(collection, id, patch) {
    const doc = this.findOne(collection, id);
    if (doc === void 0) return void 0;
    doc.data = { ...doc.data, ...patch };
    doc.updatedAt = Date.now();
    this.dirty = true;
    return doc;
  }
  /** Supprime un document. Renvoie true s'il existait. */
  delete(collection, id) {
    const docs = this.getCollection(collection);
    const index = docs.findIndex((doc) => doc.id === id);
    if (index === -1) return false;
    docs.splice(index, 1);
    this.dirty = true;
    return true;
  }
  /** Nombre de documents, éventuellement filtrés. */
  count(collection, predicate) {
    return predicate ? this.find(collection, predicate).length : this.getCollection(collection).length;
  }
  /** Vide une collection. Renvoie le nombre de documents supprimés. */
  clear(collection) {
    const docs = this.getCollection(collection);
    const removed = docs.length;
    if (removed > 0) {
      this.file.collections[collection] = [];
      this.dirty = true;
    }
    return removed;
  }
  /** Supprime entièrement une collection. Renvoie true si elle existait. */
  drop(collection) {
    if (this.file.collections[collection] === void 0) return false;
    delete this.file.collections[collection];
    this.dirty = true;
    return true;
  }
  /** Statistiques rapides de la base (logs, debug). */
  stats() {
    const collections = {};
    let documents = 0;
    for (const [name, docs] of Object.entries(this.file.collections)) {
      collections[name] = docs.length;
      documents += docs.length;
    }
    return {
      collections,
      documents,
      bytes: JSON.stringify(this.file).length,
      savedAt: this.file.savedAt,
      dirty: this.dirty
    };
  }
  /** Accès en lecture (ne crée pas la collection). */
  getCollection(collection) {
    const docs = this.file.collections[collection];
    return docs === void 0 ? [] : docs;
  }
  /** Accès en écriture (crée la collection si besoin). */
  ensureCollection(collection) {
    const docs = this.getCollection(collection);
    if (this.file.collections[collection] === void 0) {
      this.file.collections[collection] = docs;
    }
    return docs;
  }
};

// src/db/bedrock-storage.ts
import { world } from "@minecraft/server";
function createBedrockStorage(partition = DB_STORAGE_PARTITION) {
  const keyFor = (index) => `${partition}:${index}`;
  const countKey = `${partition}:count`;
  return {
    name: `bedrock-dynamic-properties:${partition}`,
    read() {
      const count = world.getDynamicProperty(countKey);
      if (typeof count !== "number" || count <= 0) return null;
      const chunks = [];
      for (let i = 0; i < count; i++) {
        const chunk = world.getDynamicProperty(keyFor(i));
        chunks.push(typeof chunk === "string" ? chunk : "");
      }
      return chunks.join("");
    },
    write(payload) {
      const chunks = splitIntoChunks(payload);
      const previous = world.getDynamicProperty(countKey);
      if (typeof previous === "number") {
        for (let i = chunks.length; i < previous; i++) {
          world.setDynamicProperty(keyFor(i), void 0);
        }
      }
      for (let i = 0; i < chunks.length; i++) {
        world.setDynamicProperty(keyFor(i), chunks[i]);
      }
      world.setDynamicProperty(countKey, chunks.length);
    }
  };
}

// src/db/autosave.ts
import { system } from "@minecraft/server";
function registerAutosave(db2, intervalTicks = 100) {
  const runId = system.runInterval(() => {
    if (!db2.loaded) return;
    db2.save();
  }, intervalTicks);
  return () => system.clearRun(runId);
}

// src/territories/types.ts
var TERRITORY_COLORS = [
  { id: "rouge", code: "§c" },
  { id: "vert", code: "§a" },
  { id: "bleu", code: "§9" },
  { id: "jaune", code: "§e" },
  { id: "or", code: "§6" },
  { id: "violet", code: "§5" },
  { id: "rose", code: "§d" },
  { id: "aqua", code: "§b" },
  { id: "blanc", code: "§f" },
  { id: "gris", code: "§7" }
];
function getColor(id) {
  return TERRITORY_COLORS.find((color) => color.id === id) ?? TERRITORY_COLORS[0];
}

// src/territories/manager.ts
var TERRITORY_COLLECTION = "territories";
var MAX_CHUNKS_PER_TERRITORY = 64;
var NAME_MIN = 3;
var NAME_MAX = 24;
var NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;
function chunkKey(dimensionId, cx, cz) {
  return `${dimensionId}:${cx}:${cz}`;
}
function chunkKeyFromPosition(dimensionId, x, z) {
  return chunkKey(dimensionId, Math.floor(x / 16), Math.floor(z / 16));
}
function parseChunkKey(key) {
  const parts = key.split(":");
  const cx = Number(parts[parts.length - 2]);
  const cz = Number(parts[parts.length - 1]);
  const dimensionId = parts.slice(0, -2).join(":");
  return { dimensionId, cx, cz };
}
function chunkCenter(key) {
  const { dimensionId, cx, cz } = parseChunkKey(key);
  return { dimensionId, x: cx * 16 + 8, z: cz * 16 + 8 };
}
function formatDate(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
var TerritoryManager = class {
  constructor(db2) {
    this.db = db2;
  }
  /** Passe à true après le chargement de la DB (worldLoad). */
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  /** Tous les territoires. */
  all() {
    return this.db.find(TERRITORY_COLLECTION);
  }
  /** Le territoire contrôlant ce chunk, s'il existe. */
  findByChunk(key) {
    return this.db.find(
      TERRITORY_COLLECTION,
      (doc) => doc.data.chunkKeys.includes(key)
    )[0];
  }
  /** Le territoire d'un joueur (1 territoire par joueur). */
  findByOwner(owner) {
    return this.db.find(TERRITORY_COLLECTION, (doc) => doc.data.owner === owner)[0];
  }
  /** Ce joueur peut-il interagir/bâtir dans ce chunk ? */
  isAllowed(playerName, key) {
    const territory = this.findByChunk(key);
    return territory === void 0 || territory.data.owner === playerName;
  }
  /** Ce chunk est-il revendiqué par quelqu'un ? */
  isProtected(key) {
    return this.findByChunk(key) !== void 0;
  }
  /**
   * Crée un territoire sur le chunk à la position donnée.
   * Valide : nom, 1 territoire par joueur, chunk libre.
   */
  create(owner, name, colorId, dimensionId, x, z) {
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) {
      return { ok: false, error: `Le nom doit faire entre ${NAME_MIN} et ${NAME_MAX} caractères.` };
    }
    if (!NAME_PATTERN.test(cleanName)) {
      return { ok: false, error: "Le nom ne peut contenir que lettres, chiffres, espaces, _ et -." };
    }
    if (this.db.findOne(TERRITORY_COLLECTION, cleanName) !== void 0) {
      return { ok: false, error: "Ce nom de territoire est déjà pris." };
    }
    if (this.findByOwner(owner) !== void 0) {
      return { ok: false, error: "Tu possèdes déjà un territoire." };
    }
    const key = chunkKeyFromPosition(dimensionId, x, z);
    if (this.isProtected(key)) {
      return { ok: false, error: "Ce chunk est déjà revendiqué par un autre joueur." };
    }
    const territory = this.db.insert(
      TERRITORY_COLLECTION,
      { name: cleanName, owner, color: colorId, chunkKeys: [key], createdAt: Date.now() },
      cleanName
    );
    this.db.save();
    return { ok: true, territory };
  }
  /** Ajoute un chunk à un territoire (pour /sn:claim futur). */
  addChunk(territoryId, key) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0 || territory.data.chunkKeys.includes(key)) return false;
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) return false;
    territory.data.chunkKeys.push(key);
    territory.updatedAt = Date.now();
    this.db.save();
    return true;
  }
  /** Supprime un territoire (par son propriétaire). */
  remove(territoryId, requester) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0 || territory.data.owner !== requester) return false;
    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }
};

// src/territories/commands.ts
import { CustomCommandStatus, CommandPermissionLevel, system as system2 } from "@minecraft/server";

// src/territories/ui.ts
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
function openCreateMenu(player, manager) {
  const colorItems = TERRITORY_COLORS.map((color) => `${color.code}■ ${color.id}`);
  new ModalFormData().title("Créer un territoire").header("Revendiquer ce chunk").textField("Nom du territoire (3-24 caractères)", "Ex : Forteresse du Nord").divider().label("Couleur du drapeau").dropdown("Couleur", colorItems, { defaultValueIndex: 0 }).submitButton("Revendiquer !").show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues ?? [];
    const name = String(values[0] ?? "").trim();
    const colorIndex = Number(values[1] ?? 0);
    const color = TERRITORY_COLORS[colorIndex] ?? TERRITORY_COLORS[0];
    const result = manager.create(
      player.name,
      name,
      color.id,
      player.dimension.id,
      player.location.x,
      player.location.z
    );
    if (!result.ok) {
      player.sendMessage(`§c[Territoires] ${result.error}`);
      return;
    }
    player.sendMessage(
      `§a[Territoires] Territoire §r${color.code}■ ${result.territory.data.name} §r§acrée ! Ce chunk est désormais sous ta bannière.`
    );
  }).catch((error) => {
    console.warn(`[Territoires] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`);
  });
}
function openTerritoriesMenu(player, manager) {
  const territories2 = manager.all();
  if (territories2.length === 0) {
    player.sendMessage("§7[Territoires] Aucun territoire pour l'instant. Sois le premier avec §f/sn:create§7 !");
    return;
  }
  const form = new ActionFormData().title("Territoires").body(`§7${territories2.length} territoire(s) revendiqué(s). Clique pour voir les infos.`);
  for (const territory of territories2) {
    const color = getColor(territory.data.color);
    form.button(`${color.code}■ ${territory.data.name}§r
§7par ${territory.data.owner}`);
  }
  form.button("§4Fermer");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= territories2.length) return;
    const selected = territories2[response.selection];
    if (selected !== void 0) showTerritoryInfo(player, selected, manager);
  }).catch((error) => {
    console.warn(`[Territoires] Erreur menu liste : ${error instanceof Error ? error.message : String(error)}`);
  });
}
function showTerritoryInfo(player, territory, manager) {
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");
  const body = [
    `§ePropriétaire : §f${data.owner}`,
    `§eCréé le : §f${formatDate(data.createdAt)}`,
    `§eChunks contrôlés : §f${data.chunkKeys.length}`,
    `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
    "",
    `§7Ce territoire est protégé : seuls le propriétaire`,
    `§7peut y construire, y ouvrir des conteneurs ou y combattre.`
  ].join("\n");
  new ActionFormData().title(`${color.code}■ ${data.name}`).body(body).button("§fRetour à la liste").button("§4Fermer").show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection === 0) openTerritoriesMenu(player, manager);
  }).catch((error) => {
    console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`);
  });
}

// src/territories/commands.ts
function registerCommands(manager) {
  system2.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:create",
        description: "Revendique le chunk où tu te trouves (nom + couleur de drapeau)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }
        system2.run(() => openCreateMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:info",
        description: "Affiche la liste de tous les territoires",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }
        system2.run(() => openTerritoriesMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      }
    );
  });
}

// src/territories/protection.ts
import { world as world2, GameMode, Player } from "@minecraft/server";
var DENY_BREAK = "§c[Territoires] Ce chunk appartient à un autre joueur : destruction impossible.";
var DENY_INTERACT = "§c[Territoires] Ce chunk est protégé : interaction impossible.";
var DENY_COMBAT = "§c[Territoires] Zone protégée : ce joueur ne peut pas être attaqué ici.";
function isCreative(playerName) {
  const player = world2.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== void 0 && player.getGameMode() === GameMode.Creative;
}
function registerProtection(manager) {
  world2.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(event.block.dimension.id, event.block.location.x, event.block.location.z);
    if (!manager.isAllowed(player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_BREAK);
    }
  });
  world2.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(event.block.dimension.id, event.block.location.x, event.block.location.z);
    if (!manager.isAllowed(player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_INTERACT);
    }
  });
  world2.beforeEvents.entityHurt.subscribe((event) => {
    if (!manager.loaded) return;
    const attacker = event.damageSource.damagingEntity;
    if (!(attacker instanceof Player)) return;
    if (event.hurtEntity.typeId !== "minecraft:player") return;
    const victim = event.hurtEntity;
    const key = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
    const territory = manager.findByChunk(key);
    if (territory !== void 0 && territory.data.owner !== attacker.name) {
      event.cancel = true;
      attacker.sendMessage(DENY_COMBAT);
    }
  });
  world2.beforeEvents.explosion.subscribe((event) => {
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

// src/players.ts
function trackPlayerJoin(db2, playerName) {
  const record = db2.findOne("players", playerName);
  db2.upsert("players", playerName, {
    name: playerName,
    sessions: (record?.data.sessions ?? 0) + 1
  });
}

// src/main.ts
var db = new JsonDatabase(createBedrockStorage(), "openmontage");
registerAutosave(db, 100);
var territories = new TerritoryManager(db);
registerCommands(territories);
var protectionRegistered = false;
world3.afterEvents.worldLoad.subscribe(() => {
  db.load();
  territories.markLoaded();
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories);
  }
  const stats = db.stats();
  console.log(
    `[OpenMontage] worldLoad OK : ${stats.documents} documents, ${stats.bytes} octets. Commandes /sn:create et /sn:info actives.`
  );
});
var worldReady = false;
system3.runInterval(() => {
  if (worldReady) return;
  if (world3.getAllPlayers().length === 0) return;
  if (!territories.loaded) {
    db.load();
    territories.markLoaded();
  }
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories);
    console.warn("[OpenMontage] Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);
world3.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  trackPlayerJoin(db, player.name);
  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Tape §f/sn:create§r pour revendiquer ce chunk.");
  player.onScreenDisplay.setTitle("§aOpenMontage §f✔");
});
system3.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`
  );
}, 600);
