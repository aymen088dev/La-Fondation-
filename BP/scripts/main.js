var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/territories/types.ts
function getColor(id) {
  return TERRITORY_COLORS.find((color) => color.id === id) ?? TERRITORY_COLORS[0];
}
var TERRITORY_COLORS;
var init_types = __esm({
  "src/territories/types.ts"() {
    "use strict";
    TERRITORY_COLORS = [
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
  }
});

// src/territories/manager.ts
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
var TERRITORY_COLLECTION, MAX_CHUNKS_PER_TERRITORY, NAME_MIN, NAME_MAX, NAME_PATTERN, TerritoryManager;
var init_manager = __esm({
  "src/territories/manager.ts"() {
    "use strict";
    TERRITORY_COLLECTION = "territories";
    MAX_CHUNKS_PER_TERRITORY = 64;
    NAME_MIN = 3;
    NAME_MAX = 24;
    NAME_PATTERN = /^[A-Za-z0-9 _-]+$/;
    TerritoryManager = class {
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
      /** Le territoire d'un joueur (par son pseudo, v1/v2). */
      findByOwner(owner) {
        return this.db.find(TERRITORY_COLLECTION, (doc) => doc.data.owner === owner)[0];
      }
      /** Le territoire dont ce joueur (par id Bedrock) est propriétaire. */
      findByOwnerId(ownerId) {
        return this.db.find(TERRITORY_COLLECTION, (doc) => doc.data.ownerId === ownerId)[0];
      }
      /** Ce joueur (pseudo) peut-il interagir/bâtir dans ce chunk ? */
      isAllowed(playerName, key) {
        const territory = this.findByChunk(key);
        return territory === void 0 || territory.data.owner === playerName;
      }
      /**
       * Ce joueur (id Bedrock) peut-il construire dans ce chunk ?
       * Vrai si chunk libre, s'il est propriétaire, ou membre du territoire.
       */
      isAllowedFor(playerId, playerName, key) {
        const territory = this.findByChunk(key);
        if (territory === void 0) return true;
        if (territory.data.ownerId === playerId) return true;
        if (territory.data.owner === playerName) return true;
        return territory.data.members.some((member) => member.playerId === playerId);
      }
      /** Ce chunk est-il revendiqué par quelqu'un ? */
      isProtected(key) {
        return this.findByChunk(key) !== void 0;
      }
      /** Sauvegarde immédiate de la DB sous-jacente. */
      save() {
        this.db.save();
      }
      /**
       * Crée un territoire sur le chunk à la position donnée.
       * `ownerId` = Player.id Bedrock (identité stable) ; `owner` = pseudo.
       * Valide : nom, 1 territoire par joueur, chunk libre.
       */
      create(owner, name, colorId, dimensionId, x, z, ownerId) {
        const cleanName = name.trim().replace(/\s+/g, " ");
        const stableOwnerId = ownerId ?? `name:${owner}`;
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
          {
            name: cleanName,
            owner,
            ownerId: stableOwnerId,
            ownerName: owner,
            members: [],
            color: colorId,
            chunkKeys: [key],
            createdAt: Date.now()
          },
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
      /** Supprime un territoire sans vérification de propriétaire (usage admin). */
      removeForced(territoryId) {
        return this.db.delete(TERRITORY_COLLECTION, territoryId);
      }
    };
  }
});

// src/ui/theme.ts
function windowTitle(section) {
  return `§l§aOM §r§8» §r§l${section}`;
}
function divider() {
  return "§8─────────────────────";
}
var ICONS;
var init_theme = __esm({
  "src/ui/theme.ts"() {
    "use strict";
    ICONS = {
      sword: "textures/items/diamond_sword",
      shield: "textures/items/shield_base",
      flag: "textures/items/banner_base",
      crown: "textures/items/golden_helmet",
      book: "textures/items/book_normal",
      compass: "textures/items/compass_item",
      map: "textures/items/map_filled",
      emerald: "textures/items/emerald",
      diamond: "textures/items/diamond",
      goldIngot: "textures/items/gold_ingot",
      ironIngot: "textures/items/iron_ingot",
      clock: "textures/items/clock_item",
      door: "textures/items/door_acacia_upper",
      sign: "textures/items/sign_acacia",
      bell: "textures/items/bell",
      anvil: "textures/items/anvil",
      hammer: "textures/items/iron_pickaxe",
      lock: "textures/items/name_tag",
      paper: "textures/items/paper",
      arrow: "textures/items/arrow",
      barrier: "textures/items/barrier",
      plus: "textures/items/fire_charge",
      wrench: "textures/items/shears"
    };
  }
});

// src/territories/ui.ts
var ui_exports = {};
__export(ui_exports, {
  openCreateMenu: () => openCreateMenu,
  openTerritoriesMenu: () => openTerritoriesMenu,
  showTerritoryInfo: () => showTerritoryInfo
});
import { ActionFormData as ActionFormData2, ModalFormData as ModalFormData2 } from "@minecraft/server-ui";
function openCreateMenu(player, manager) {
  const colorItems = TERRITORY_COLORS.map((color) => `${color.code}■ ${color.id}`);
  new ModalFormData2().title("Créer un territoire").textField("Nom du territoire (3-24 caractères)", "Ex : Forteresse du Nord").dropdown("Couleur du drapeau", colorItems, { defaultValueIndex: 0 }).submitButton("Revendiquer ce chunk !").show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues ?? [];
    const strings = values.filter((value) => typeof value === "string");
    const numbers = values.filter((value) => typeof value === "number");
    const name = (strings[0] ?? "").trim();
    const colorIndex = numbers[0] ?? 0;
    const color = TERRITORY_COLORS[colorIndex] ?? TERRITORY_COLORS[0];
    const result = manager.create(
      player.name,
      name,
      color.id,
      player.dimension.id,
      player.location.x,
      player.location.z,
      player.id
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
  const form = new ActionFormData2().title(windowTitle("Territoires")).body(`§7${territories2.length} territoire(s) revendiqué(s). Clique pour voir les infos.`);
  for (const territory of territories2) {
    const color = getColor(territory.data.color);
    form.button(`${color.code}■ ${territory.data.name}§r
§7par ${territory.data.owner}`, ICONS.flag);
  }
  form.button("§4Fermer", ICONS.barrier);
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
    `§eDrapeau : §r${color.code}■ ${color.id}`,
    `§eCréé le : §f${formatDate(data.createdAt)}`,
    `§eChunks contrôlés : §f${data.chunkKeys.length}`,
    `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
    "",
    `§7Ce territoire est protégé : seuls le propriétaire`,
    `§7peut y construire, y ouvrir des conteneurs ou y combattre.`
  ].join("\n");
  new ActionFormData2().title(windowTitle(data.name)).body(body).button("§fRetour à la liste", ICONS.arrow).button("§4Fermer", ICONS.barrier).show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection === 0) openTerritoriesMenu(player, manager);
  }).catch((error) => {
    console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`);
  });
}
var init_ui = __esm({
  "src/territories/ui.ts"() {
    "use strict";
    init_theme();
    init_types();
    init_manager();
  }
});

// src/moderation/enforcement.ts
var enforcement_exports = {};
__export(enforcement_exports, {
  kickPlayer: () => kickPlayer,
  registerEnforcement: () => registerEnforcement
});
import { world as world4, system as system5 } from "@minecraft/server";
function kickPlayer(playerName, reason) {
  const player = world4.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return false;
  try {
    player.runCommand(`kick "${playerName}" ${reason}`);
    return true;
  } catch {
    return false;
  }
}
function registerEnforcement(sanctions2, onChatReady) {
  world4.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn || !sanctions2.loaded) return;
    const player = event.player;
    const ban = sanctions2.getBan(player.name);
    if (ban === void 0) return;
    const expiry = ban.expiresAt === 0 ? "§4BANNI PERMANENTLEMENT" : `§4BANNI§7 (encore ${Math.max(1, Math.ceil((ban.expiresAt - Date.now()) / 6e4))} min)`;
    player.sendMessage(`§c[Territoires/OpenMontage] ${expiry}
§7Motif : §f${ban.reason}§7 — par §f${ban.by}`);
    system5.run(() => {
      kickPlayer(player.name, ban.reason);
    });
  });
  world4.beforeEvents.chatSend.subscribe((event) => {
    if (!sanctions2.loaded) return;
    const mute = sanctions2.getMute(event.sender.name);
    if (mute === void 0) return;
    event.cancel = true;
    const sender = event.sender;
    const remaining = mute.expiresAt === 0 ? "permanent" : `${Math.max(1, Math.ceil((mute.expiresAt - Date.now()) / 6e4))} min`;
    system5.run(() => {
      sender.sendMessage(
        `§c[Modération] Tu es muet (${remaining}). §7Motif : §f${mute.reason}§7 — par §f${mute.by}`
      );
    });
  });
  onChatReady?.();
}
var init_enforcement = __esm({
  "src/moderation/enforcement.ts"() {
    "use strict";
  }
});

// src/main.ts
import { world as world7, system as system10 } from "@minecraft/server";

// src/db/types.ts
var DB_SCHEMA_VERSION = 2;
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

// src/db/migrations.ts
function migrateDatabase(file) {
  const from = typeof file.schemaVersion === "number" ? file.schemaVersion : 0;
  if (from >= DB_SCHEMA_VERSION) return file;
  if (from < 2) migrateV1ToV2(file);
  file.schemaVersion = DB_SCHEMA_VERSION;
  return file;
}
function migrateV1ToV2(file) {
  const collections = file.collections ?? {};
  const oldMembers = collections["role_members"];
  if (oldMembers !== void 0) {
    const members = collections["members"] ?? [];
    const known = new Set(members.map((doc) => doc.id));
    for (const doc of oldMembers) {
      if (!known.has(doc.id)) members.push(doc);
    }
    collections["members"] = members;
    delete collections["role_members"];
  }
  const oldPlayers = collections["players"];
  if (oldPlayers !== void 0) {
    const index = collections["players_index"] ?? [];
    const known = new Set(index.map((doc) => doc.id));
    for (const doc of oldPlayers) {
      const name = typeof doc.data?.name === "string" ? doc.data.name : doc.id;
      if (known.has(name)) continue;
      index.push({
        id: `name:${name}`,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        data: {
          playerId: null,
          // sera résolu au prochain join
          name,
          firstSeen: doc.createdAt,
          lastSeen: doc.updatedAt,
          sessions: typeof doc.data?.sessions === "number" ? doc.data.sessions : 1
        }
      });
    }
    collections["players_index"] = index;
    delete collections["players"];
  }
  const territories2 = collections["territories"];
  if (territories2 !== void 0) {
    for (const doc of territories2) {
      const data = doc?.data ?? {};
      if (typeof data.owner === "string") {
        if (typeof data.ownerName !== "string") data.ownerName = data.owner;
        if (typeof data.ownerId !== "string") data.ownerId = `name:${data.owner}`;
      }
      if (!Array.isArray(data.members)) data.members = [];
    }
  }
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
      migrateDatabase(parsed);
      if (parsed.schemaVersion !== DB_SCHEMA_VERSION) {
        console.warn(
          `[DB] Version de schéma ${parsed.schemaVersion} != ${DB_SCHEMA_VERSION} après migration.`
        );
      }
      this.file = {
        schemaVersion: DB_SCHEMA_VERSION,
        name: this.name,
        savedAt: parsed.savedAt ?? 0,
        collections: parsed.collections
      };
      this.dirty = true;
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

// src/territories/index.ts
init_types();
init_manager();

// src/territories/commands.ts
import { CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, system as system2 } from "@minecraft/server";

// src/db/menu.ts
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
var COLLECTION_LABELS = {
  players_index: "👥 Joueurs",
  territories: "🚩 Territoires",
  roles: "👑 Rôles",
  members: "🎭 Grades attribués",
  bans: "🔨 Bans",
  mutes: "🔇 Mutes",
  warns: "⚠️ Avertissements",
  infractions: "📜 Infractions",
  modules: "🧩 Modules"
};
var SECTION_ORDER = Object.keys(COLLECTION_LABELS);
function labelOf(collection) {
  return COLLECTION_LABELS[collection] ?? `📁 ${collection}`;
}
function listSections(db2) {
  const stats = db2.stats();
  const names = Object.keys(stats.collections).filter((name) => stats.collections[name] > 0);
  return names.sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
function summarize(doc) {
  const data = doc.data ?? {};
  const name = typeof data.name === "string" && data.name || typeof data.playerId === "string" && `id:${String(data.playerId).slice(0, 8)}` || doc.id;
  const extra = typeof data.role === "string" ? ` (${data.role})` : typeof data.sessions === "number" ? ` · ${data.sessions} sessions` : typeof data.enabled === "boolean" ? data.enabled ? " · ON" : " · OFF" : "";
  return `§f${name}§r§7${extra}`;
}
async function openDbMenu(db2, player) {
  const stats = db2.stats();
  const sections = listSections(db2);
  const form = new ActionFormData().title("OpenMontage » Base de données").body(
    `§7${stats.documents} documents · ${stats.bytes} octets
§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}
§7Choisis une section à explorer :`
  );
  for (const section2 of sections) {
    form.button(`${labelOf(section2)}
§8${stats.collections[section2]} doc(s)`, "textures/ui/icon_setting");
  }
  form.button("💾 Forcer la sauvegarde", "textures/ui/icon_save");
  form.button("§c« Retour", "textures/ui/icon_import");
  const response = await form.show(player);
  if (response.canceled) return;
  if (response.selection === sections.length) {
    db2.save(true);
    player.sendMessage("§a[DB] Sauvegarde forcée.");
    return;
  }
  if (response.selection === sections.length + 1) return;
  const section = sections[response.selection ?? 0];
  await openSectionMenu(db2, player, section);
}
async function openSectionMenu(db2, player, section) {
  const docs = db2.find(section);
  const form = new ActionFormData().title(`OpenMontage » ${labelOf(section)}`).body(`§7${docs.length} document(s) — clique pour inspecter/modifier :`);
  for (const doc2 of docs) form.button(summarize(doc2));
  form.button("§c🗑 Vider la section", "textures/ui/icon_missing_item");
  form.button("§7« Retour", "textures/ui/icon_import");
  const response = await form.show(player);
  if (response.canceled) return;
  if (response.selection === docs.length) {
    const removed = db2.clear(section);
    db2.save();
    player.sendMessage(`§c[DB] Section "${section}" vidée (${removed} document(s) supprimés).`);
    return;
  }
  if (response.selection === docs.length + 1) {
    await openDbMenu(db2, player);
    return;
  }
  const doc = docs[response.selection ?? 0];
  await openDocumentMenu(db2, player, section, doc.id);
}
async function openDocumentMenu(db2, player, section, docId) {
  const doc = db2.findOne(section, docId);
  if (doc === void 0) {
    player.sendMessage("§c[DB] Document introuvable (déjà supprimé ?).");
    return;
  }
  const entries = Object.entries(doc.data).filter(([key]) => key !== "chunkKeys");
  const form = new ModalFormData().title(`OpenMontage » ${docId}`);
  const editableKeys = [];
  const kinds = [];
  const readonlyLines = [];
  for (const [key, value] of entries) {
    if (typeof value === "string") {
      form.textField(`§e${key}`, value, { defaultValue: value });
      editableKeys.push(key);
      kinds.push("string");
    } else if (typeof value === "number") {
      form.textField(`§e${key} §7(nombre)`, String(value), { defaultValue: String(value) });
      editableKeys.push(key);
      kinds.push("number");
    } else {
      readonlyLines.push(`§7${key}: §f${JSON.stringify(value)}`);
    }
  }
  form.label(`§7id: §f${docId}
${readonlyLines.join("\n")}`);
  form.submitButton("💾 Appliquer");
  const response = await form.show(player);
  if (response.canceled) return;
  const values = response.formValues ?? [];
  const patch = {};
  let changed = false;
  for (let i = 0; i < editableKeys.length; i++) {
    const key = editableKeys[i];
    const raw = String(values[i] ?? "");
    if (kinds[i] === "number") {
      const num = Number(raw);
      if (!Number.isNaN(num) && num !== doc.data[key]) {
        patch[key] = num;
        changed = true;
      }
    } else if (raw !== doc.data[key]) {
      patch[key] = raw;
      changed = true;
    }
  }
  if (changed) {
    db2.update(section, docId, patch);
    db2.save();
    player.sendMessage(`§a[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
  } else {
    player.sendMessage("§7[DB] Aucun changement.");
  }
  await openSectionMenu(db2, player, section);
}

// src/territories/commands.ts
init_types();
init_ui();
function registerCommands(manager, db2, modules2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
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
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module Territoires est désactivé." };
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
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:setflag",
        description: "Change la couleur du drapeau de ton territoire",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "couleur", type: CustomCommandParamType.String }]
      },
      (origin, couleur) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        const territory = manager.findByOwner(player.name);
        if (territory === void 0) {
          return { status: CustomCommandStatus.Failure, message: "Tu ne possèdes pas de territoire (/sn:create)." };
        }
        const color = TERRITORY_COLORS.find((candidate) => candidate.id === couleur.toLowerCase());
        if (color === void 0) {
          return {
            status: CustomCommandStatus.Failure,
            message: `Couleur inconnue. Disponibles : ${TERRITORY_COLORS.map((candidate) => candidate.id).join(", ")}`
          };
        }
        territory.data.color = color.id;
        manager.save();
        return { status: CustomCommandStatus.Success, message: `Drapeau changé : ${color.code}■ ${color.id}` };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:db",
        description: "Consulte la base de données (admins)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
        mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
        optionalParameters: [
          { name: "arg1", type: CustomCommandParamType.String },
          { name: "arg2", type: CustomCommandParamType.String }
        ]
      },
      (_origin, action, arg1, arg2) => {
        if (db2 === void 0) {
          return { status: CustomCommandStatus.Failure, message: "DB indisponible." };
        }
        switch (action) {
          case "menu": {
            if (db2.loaded) {
              system2.run(() => {
                void openDbMenu(db2, _origin.sourceEntity).catch(
                  (error) => console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`)
                );
              });
              return { status: CustomCommandStatus.Success };
            }
            return { status: CustomCommandStatus.Failure, message: "§c[DB] Base pas encore chargée (worldLoad)." };
          }
          case "stats": {
            const stats = db2.stats();
            const collections = Object.entries(stats.collections).map(([name, count]) => `${name}=${count}`).join(", ");
            return {
              status: CustomCommandStatus.Success,
              message: `§a[DB] ${stats.documents} docs, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"} §7{${collections}}`
            };
          }
          case "list": {
            if (arg1 === void 0) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db list <collection>" };
            }
            const docs = db2.find(arg1);
            if (docs.length === 0) {
              return { status: CustomCommandStatus.Success, message: `§7[DB] Collection "${arg1}" vide ou inexistante.` };
            }
            const preview = docs.slice(0, 10).map((doc) => `§f${doc.id}§7(${Math.round(JSON.stringify(doc).length / 10 * 100) / 1e3}ko)`).join(", ");
            return {
              status: CustomCommandStatus.Success,
              message: `§a[DB] ${docs.length} doc(s) dans "${arg1}" : ${preview}${docs.length > 10 ? " …" : ""}`
            };
          }
          case "show": {
            if (arg1 === void 0 || arg2 === void 0) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db show <collection> <id>" };
            }
            const doc = db2.findOne(arg1, arg2);
            if (doc === void 0) {
              return { status: CustomCommandStatus.Failure, message: `§c[DB] "${arg2}" introuvable dans "${arg1}".` };
            }
            return { status: CustomCommandStatus.Success, message: `§a[DB] ${JSON.stringify(doc)}` };
          }
          case "save": {
            const wrote = db2.save(true);
            return { status: CustomCommandStatus.Success, message: wrote ? "§a[DB] Sauvegardée." : "§7[DB] Rien à sauvegarder." };
          }
          default:
            return {
              status: CustomCommandStatus.Failure,
              message: "Actions : menu, stats, list <collection>, show <collection> <id>, save"
            };
        }
      }
    );
  });
}

// src/territories/protection.ts
init_manager();
import { world as world2, system as system3, GameMode, Player } from "@minecraft/server";
var DENY_BREAK = "§c[Territoires] Chunk protégé : destruction impossible.";
var DENY_PLACE = "§c[Territoires] Chunk protégé : construction impossible.";
var DENY_INTERACT = "§c[Territoires] Chunk protégé : interaction impossible.";
var DENY_COMBAT = "§c[Territoires] Zone protégée : ce joueur ne peut pas être attaqué ici.";
var DENY_ITEM = "§c[Territoires] Chunk protégé : objet inutilisable ici.";
function isCreative(playerName) {
  const player = world2.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== void 0 && player.getGameMode() === GameMode.Creative;
}
function isProtectedForId(block, player, manager) {
  const key = chunkKeyFromPosition(block.dimension.id, block.location.x, block.location.z);
  return !manager.isAllowedFor(player.id, player.name, key);
}
function registerProtection(manager, modules2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  world2.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      player.sendMessage(DENY_BREAK);
    }
  });
  world2.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const { block, dimension } = event;
    const key = chunkKeyFromPosition(dimension.id, block.location.x, block.location.z);
    if (manager.isAllowedFor(player.id, player.name, key)) return;
    const location = block.location;
    const x = Math.floor(location.x);
    const y = Math.floor(location.y);
    const z = Math.floor(location.z);
    system3.run(() => {
      try {
        dimension.runCommand(`setblock ${x} ${y} ${z} air`);
      } catch {
      }
    });
    player.sendMessage(DENY_PLACE);
  });
  world2.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      player.sendMessage(DENY_INTERACT);
    }
  });
  world2.beforeEvents.itemUse.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.source;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_ITEM);
    }
  });
  world2.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      player.sendMessage(DENY_INTERACT);
    }
  });
  world2.beforeEvents.entityHurt.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const attacker = event.damageSource.damagingEntity;
    if (!(attacker instanceof Player)) return;
    const victim = event.hurtEntity;
    if (victim.typeId === "minecraft:player") {
      const victimKey = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
      const territory = manager.findByChunk(victimKey);
      if (territory === void 0) return;
      const attackerKey = chunkKeyFromPosition(attacker.dimension.id, attacker.location.x, attacker.location.z);
      const attackerTerritory = manager.findByChunk(attackerKey);
      const defendsTerritory = territory.data.ownerId === attacker.id || territory.data.owner === attacker.name || territory.data.members.some((member) => member.playerId === attacker.id);
      const fightsFromHome = attackerTerritory !== void 0 && (attackerTerritory.data.ownerId === attacker.id || attackerTerritory.data.owner === attacker.name);
      if (defendsTerritory || fightsFromHome) return;
      event.cancel = true;
      attacker.sendMessage(DENY_COMBAT);
      return;
    }
    const key = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
    if (manager.isProtected(key)) {
      event.cancel = true;
      attacker.sendMessage("§c[Territoires] Chunk protégé : les créatures ici sont sous la protection du propriétaire.");
    }
  });
  world2.beforeEvents.explosion.subscribe((event) => {
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

// src/territories/announce.ts
init_manager();
init_types();
import { system as system4, world as world3 } from "@minecraft/server";
var NO_TERRITORY_MESSAGE = "§7Zone libre";
function registerAnnouncer(manager, modules2, intervalTicks = 10) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  const lastKeyByPlayer = /* @__PURE__ */ new Map();
  world3.afterEvents.playerLeave.subscribe((event) => {
    lastKeyByPlayer.delete(event.playerName);
  });
  system4.runInterval(() => {
    if (!manager.loaded || !enabled()) return;
    for (const player of world3.getAllPlayers()) {
      const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
      const previous = lastKeyByPlayer.get(player.name);
      if (previous === key) continue;
      lastKeyByPlayer.set(player.name, key);
      const territory = manager.findByChunk(key);
      if (territory === void 0) {
        if (previous !== void 0 && manager.isProtected(previous)) {
          player.onScreenDisplay.setActionBar(NO_TERRITORY_MESSAGE);
        }
        continue;
      }
      const color = getColor(territory.data.color).code;
      player.onScreenDisplay.setActionBar(
        `${color}⚑ ${territory.data.name}§r §7— territoire de §f${territory.data.owner}`
      );
    }
  }, intervalTicks);
}

// src/territories/index.ts
init_ui();

// src/permissions/manager.ts
var ROLES_COLLECTION = "roles";
var MEMBERS_COLLECTION = "members";
var ROLE_COLORS = [
  { id: "rouge", code: "§c" },
  { id: "vert", code: "§a" },
  { id: "bleu", code: "§9" },
  { id: "jaune", code: "§e" },
  { id: "or", code: "§6" },
  { id: "violet", code: "§5" },
  { id: "rose", code: "§d" },
  { id: "aqua", code: "§b" },
  { id: "blanc", code: "§f" },
  { id: "gris", code: "§7" },
  { id: "noir", code: "§0" },
  { id: "vert-fonce", code: "§2" }
];
var PermissionManager = class {
  constructor(db2) {
    this.db = db2;
  }
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  // -------------------------------------------------------------------------
  // Rôles
  // -------------------------------------------------------------------------
  allRoles() {
    return this.db.find(ROLES_COLLECTION);
  }
  getRole(name) {
    return this.db.findOne(ROLES_COLLECTION, name);
  }
  /** Crée un rôle. Échoue s'il existe déjà. */
  createRole(name, color, level) {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 16) {
      return { ok: false, error: "Le nom du rôle doit faire entre 2 et 16 caractères." };
    }
    if (this.getRole(clean) !== void 0) {
      return { ok: false, error: `Le rôle "${clean}" existe déjà.` };
    }
    this.db.insert(
      ROLES_COLLECTION,
      { name: clean, color, prefix: `[${clean}]`, level },
      clean
    );
    this.db.save();
    return { ok: true };
  }
  deleteRole(name) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    if (role.data.level >= 100) return { ok: false, error: "Impossible de supprimer un rôle Admin." };
    for (const member of this.db.find(MEMBERS_COLLECTION, (doc) => doc.data.role === name)) {
      this.db.delete(MEMBERS_COLLECTION, member.id);
    }
    this.db.delete(ROLES_COLLECTION, name);
    this.db.save();
    return { ok: true };
  }
  /** Change la couleur d'un rôle. */
  setRoleColor(name, colorId) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    const color = ROLE_COLORS.find((candidate) => candidate.id === colorId);
    if (color === void 0) return { ok: false, error: "Couleur inconnue." };
    role.data.color = color.code;
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  /** Change le prefix d'un rôle ("" = revenir au défaut [Nom]). */
  setRolePrefix(name, prefix) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    role.data.prefix = prefix.trim();
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  /** Change le niveau hiérarchique d'un rôle. */
  setRoleLevel(name, level) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    role.data.level = Math.max(0, Math.min(1e3, Math.floor(level)));
    role.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------
  getMember(playerName) {
    return this.db.findOne(MEMBERS_COLLECTION, playerName);
  }
  allMembers() {
    return this.db.find(MEMBERS_COLLECTION);
  }
  membersWithRole(roleName) {
    return this.db.find(MEMBERS_COLLECTION, (doc) => doc.data.role === roleName);
  }
  /** Attribue un rôle à un joueur (upsert). */
  assignRole(playerName, roleName) {
    if (this.getRole(roleName) === void 0) {
      return { ok: false, error: `Le rôle "${roleName}" n'existe pas.` };
    }
    const existing = this.getMember(playerName);
    if (existing === void 0) {
      this.db.insert(MEMBERS_COLLECTION, { name: playerName, role: roleName }, playerName);
    } else {
      existing.data.role = roleName;
      existing.updatedAt = Date.now();
    }
    this.db.save();
    return { ok: true };
  }
  /** Retire le rôle d'un joueur. */
  removeRole(playerName) {
    return this.db.delete(MEMBERS_COLLECTION, playerName);
  }
  /** Prefix personnalisé d'un joueur ("" pour réinitialiser). */
  setCustomPrefix(playerName, prefix) {
    const member = this.getMember(playerName);
    if (member === void 0) return { ok: false, error: "Ce joueur n'a pas de rôle." };
    member.data.customPrefix = prefix.trim() || void 0;
    member.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  /** Couleur personnalisée du nom d'un joueur ("" pour réinitialiser). */
  setCustomColor(playerName, colorId) {
    const member = this.getMember(playerName);
    if (member === void 0) return { ok: false, error: "Ce joueur n'a pas de rôle." };
    if (colorId === "") {
      member.data.customColor = void 0;
    } else {
      const color = ROLE_COLORS.find((candidate) => candidate.id === colorId);
      if (color === void 0) return { ok: false, error: "Couleur inconnue." };
      member.data.customColor = color.code;
    }
    member.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  // -------------------------------------------------------------------------
  // Rendu visuel
  // -------------------------------------------------------------------------
  /** Rôle effectif d'un joueur (ou undefined si aucun). */
  roleOf(playerName) {
    const member = this.getMember(playerName);
    return member === void 0 ? void 0 : this.getRole(member.data.role);
  }
  /** Level effectif d'un joueur (0 si aucun rôle). */
  levelOf(playerName) {
    return this.roleOf(playerName)?.data.level ?? 0;
  }
  /** Le tag complet au-dessus du joueur : "§6[Admin] §fAymen". */
  nameTagFor(playerName) {
    const member = this.getMember(playerName);
    const role = this.roleOf(playerName);
    if (role === void 0) return `§f${playerName}`;
    const color = member?.data.customColor ?? role.data.color;
    const prefix = member?.data.customPrefix ?? role.data.prefix;
    const prefixPart = prefix === "" ? "" : `${color}${prefix} §r`;
    return `${prefixPart}${color}${playerName}`;
  }
  // -------------------------------------------------------------------------
  // Bootstrap : premier admin automatique
  // -------------------------------------------------------------------------
  /** Le monde a-t-il déjà un admin (quelqu'un avec level >= 100) ? */
  hasAdmin() {
    return this.allRoles().some((role) => role.data.level >= 100);
  }
  /** Crée le rôle Admin par défaut et l'attribue au premier opérateur vu. */
  bootstrapAdmin(operatorName) {
    if (this.getRole("Admin") === void 0) {
      this.db.insert(
        ROLES_COLLECTION,
        { name: "Admin", color: "§c", prefix: "[Admin]", level: 100 },
        "Admin"
      );
    }
    this.assignRole(operatorName, "Admin");
  }
};

// src/permissions/ui.ts
init_theme();
import { ActionFormData as ActionFormData3, ModalFormData as ModalFormData3 } from "@minecraft/server-ui";
function openRolesMenu(player, permissions2) {
  const roles = permissions2.allRoles();
  const form = new ActionFormData3().title(windowTitle("Rôles")).body(`§7${roles.length} rôle(s). Sélectionne pour configurer.`).button("§a+ Créer un rôle", ICONS.plus);
  for (const role of roles) {
    form.button(
      `${role.data.color}[${role.data.name}]§r
§7niveau ${role.data.level} · ${permissions2.membersWithRole(role.data.name).length} membre(s)`,
      ICONS.crown
    );
  }
  form.button("§4Fermer", ICONS.barrier);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection === 0) return void openCreateRoleMenu(player, permissions2);
    if (response.selection >= roles.length + 1) return;
    const role = roles[response.selection - 1];
    if (role !== void 0) openRoleConfigMenu(player, role, permissions2);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openCreateRoleMenu(player, permissions2) {
  const colorItems = ROLE_COLORS.map((color) => `${color.code}■ ${color.id}`);
  new ModalFormData3().title("Créer un rôle").textField("Nom du rôle (2-16 caractères)", "Ex : Modo, VIP,_builder").slider("Niveau hiérarchique", 0, 100, { valueStep: 5, defaultValue: 10 }).dropdown("Couleur", colorItems, { defaultValueIndex: 0 }).submitButton("Créer").show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues ?? [];
    const strings = values.filter((value) => typeof value === "string");
    const numbers = values.filter((value) => typeof value === "number");
    const name = (strings[0] ?? "").trim();
    const level = numbers[0] ?? 10;
    const colorIndex = numbers[1] ?? 0;
    const color = ROLE_COLORS[colorIndex]?.code ?? "§f";
    if (name === "") {
      player.sendMessage("§c[Rôles] Nom vide.");
      return;
    }
    const result = permissions2.createRole(name, color, level);
    player.sendMessage(result.ok ? `§a[Rôles] Rôle ${color}[${name}]§r§a créé.` : `§c[Rôles] ${result.error}`);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openRoleConfigMenu(player, role, permissions2) {
  new ActionFormData3().title(windowTitle(`Rôle ${role.data.color}${role.data.name}`)).body(
    `§7Niveau : §f${role.data.level}
§7Membres : §f${permissions2.membersWithRole(role.data.name).length}
§7Prefix : §f${role.data.prefix}`
  ).button("§eChanger la couleur", ICONS.diamond).button("§eChanger le prefix", ICONS.sign).button("§eChanger le niveau", ICONS.anvil).button("§bVoir les membres", ICONS.paper).button("§4Supprimer ce rôle", ICONS.barrier).button("§8← Retour", ICONS.arrow).show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    switch (response.selection) {
      case 0:
        openColorPicker(player, "Couleur du rôle", (colorId) => {
          const result = permissions2.setRoleColor(role.data.name, colorId);
          player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
        });
        break;
      case 1:
        openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
          const result = permissions2.setRolePrefix(role.data.name, prefix);
          player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
        });
        break;
      case 2:
        openLevelMenu(player, role, permissions2);
        break;
      case 3:
        openRoleMembersMenu(player, role, permissions2);
        break;
      case 4: {
        const result = permissions2.deleteRole(role.data.name);
        player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
        break;
      }
      case 5:
        openRolesMenu(player, permissions2);
        break;
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openLevelMenu(player, role, permissions2) {
  new ModalFormData3().title(`Niveau de [${role.data.name}]`).slider("Niveau (100 = admin max)", 0, 100, { valueStep: 5, defaultValue: role.data.level }).submitButton("Valider").show(player).then((response) => {
    if (response.canceled) return;
    const numbers = (response.formValues ?? []).filter((value) => typeof value === "number");
    const result = permissions2.setRoleLevel(role.data.name, numbers[0] ?? role.data.level);
    player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openRoleMembersMenu(player, role, permissions2) {
  const members = permissions2.membersWithRole(role.data.name);
  const form = new ActionFormData3().title(`Membres ${role.data.color}[${role.data.name}]`).body(members.length === 0 ? "§7Aucun membre." : "§7Clique sur un membre pour lui retirer le rôle.");
  for (const member of members) form.button(`§f${member.data.name}`);
  form.button("§8← Retour");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= members.length) return void openRoleConfigMenu(player, role, permissions2);
    const member = members[response.selection];
    if (member !== void 0) {
      permissions2.removeRole(member.data.name);
      player.sendMessage(`§a[Rôles] ${member.data.name} ne fait plus partie du rôle.`);
      openRoleMembersMenu(player, role, permissions2);
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openColorPicker(player, title, onPick) {
  const form = new ActionFormData3().title(windowTitle(title)).body("§7Choisis une couleur :").button("§8← Annuler", ICONS.arrow);
  for (const color of ROLE_COLORS) {
    form.button(`${color.code}■■■ §7${color.id}`, ICONS.diamond);
  }
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection === 0) return;
    const picked = ROLE_COLORS[response.selection - 1];
    if (picked !== void 0) onPick(picked.id);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPrefixMenu(player, title, onDone) {
  new ModalFormData3().title(title).textField("Prefix (vide = défaut [Nom])", "Ex : ★ Boss, [VIP+]").submitButton("Valider").show(player).then((response) => {
    if (response.canceled) return;
    const strings = (response.formValues ?? []).filter((value) => typeof value === "string");
    onDone(strings[0] ?? "");
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/players-ui.ts
import { ActionFormData as ActionFormData4, MessageFormData, ModalFormData as ModalFormData4 } from "@minecraft/server-ui";
init_theme();
function openPlayersMenu(player, permissions2) {
  const members = permissions2.allMembers();
  const form = new ActionFormData4().title(windowTitle("Joueurs")).body("§7Joueurs avec un rôle. Tu peux aussi gérer un joueur manuellement.").button("§a+ Gérer un joueur (saisir le pseudo)", ICONS.plus);
  for (const member of members) {
    const role = permissions2.getRole(member.data.role);
    form.button(`${role?.data.color ?? "§7"}${member.data.name}§r
§7${member.data.role}`, ICONS.paper);
  }
  form.button("§4Fermer", ICONS.barrier);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection === 0) return void openPlayerLookupMenu(player, permissions2);
    if (response.selection >= members.length + 1) return;
    const member = members[response.selection - 1];
    if (member !== void 0) openPlayerConfigMenu(player, member.data.name, permissions2);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPlayerLookupMenu(player, permissions2) {
  new ModalFormData4().title("Gérer un joueur").textField("Pseudo du joueur", "Ex : Steve").submitButton("Rechercher").show(player).then((response) => {
    if (response.canceled) return;
    const strings = (response.formValues ?? []).filter((value) => typeof value === "string");
    const name = (strings[0] ?? "").trim();
    if (name === "") return;
    openPlayerConfigMenu(player, name, permissions2);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPlayerConfigMenu(player, targetName, permissions2) {
  const member = permissions2.getMember(targetName);
  const roleLabel = member === void 0 ? "§7aucun" : `${permissions2.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const colorLabel = member?.data.customColor ?? "(défaut du rôle)";
  const form = new ActionFormData4().title(windowTitle(targetName)).body(`§7Rôle : ${roleLabel}
§7Prefix perso : §f${prefixLabel}
§7Couleur perso : §f${colorLabel}`).button("§eAttribuer / changer de rôle", ICONS.crown).button("§ePrefix personnalisé", ICONS.sign).button("§eCouleur de nom personnalisée", ICONS.diamond);
  if (member !== void 0) {
    form.button("§4Retirer tous les rôles", ICONS.barrier);
  }
  form.button("§8← Retour", ICONS.arrow);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    const removeIndex = member !== void 0 ? 3 : -1;
    const backIndex = removeIndex + 1;
    if (response.selection === 0) {
      openAssignRoleMenu(player, targetName, permissions2);
    } else if (response.selection === 1) {
      openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
        const result = permissions2.setCustomPrefix(targetName, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      });
    } else if (response.selection === 2) {
      openColorPicker(player, `Couleur de ${targetName}`, (colorId) => {
        const result = permissions2.setCustomColor(targetName, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      });
    } else if (response.selection === removeIndex && member !== void 0) {
      permissions2.removeRole(targetName);
      player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
    } else if (response.selection === backIndex) {
      openPlayersMenu(player, permissions2);
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openAssignRoleMenu(player, targetName, permissions2) {
  const roles = permissions2.allRoles();
  if (roles.length === 0) {
    player.sendMessage("§c[Rôles] Aucun rôle existant. Crée-en un d'abord (/sn:roles).");
    return;
  }
  const form = new ActionFormData4().title(`Rôle de ${targetName}`).body("§7Choisis le rôle à attribuer :");
  for (const role of roles) {
    form.button(`${role.data.color}[${role.data.name}]§r
§7niveau ${role.data.level}`);
  }
  form.button("§8← Retour");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= roles.length) return void openPlayerConfigMenu(player, targetName, permissions2);
    const role = roles[response.selection];
    if (role === void 0) return;
    const result = permissions2.assignRole(targetName, role.data.name);
    player.sendMessage(
      result.ok ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.` : `§c[Rôles] ${result.error}`
    );
    openPlayerConfigMenu(player, targetName, permissions2);
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/commands.ts
init_theme();
import { CustomCommandStatus as CustomCommandStatus2, CommandPermissionLevel as CommandPermissionLevel2, system as system7, PlayerPermissionLevel } from "@minecraft/server";
import { ActionFormData as ActionFormData8 } from "@minecraft/server-ui";

// src/modules/ui.ts
init_theme();
import { ActionFormData as ActionFormData5, MessageFormData as MessageFormData2 } from "@minecraft/server-ui";

// src/modules/manager.ts
var MODULES_COLLECTION = "modules";
var MODULE_IDS = ["territories", "moderation"];
var MODULE_CATALOG = [
  {
    id: "territories",
    name: "Territoires",
    description: "Revendication de chunks protégés (/sn:create, /sn:info)"
  },
  {
    id: "moderation",
    name: "Modération",
    description: "Bans, mutes, warns et historique (/sn:mod, /sn:ban...)"
  }
];
var ModuleManager = class {
  constructor(db2) {
    this.db = db2;
  }
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  /** Le module est-il activé ? (défaut : activé si absent de la DB) */
  isEnabled(id) {
    const state = this.db.findOne(MODULES_COLLECTION, id);
    return state === void 0 ? true : state.data.enabled;
  }
  /** Active/désactive un module. */
  setEnabled(id, enabled) {
    this.db.upsert(MODULES_COLLECTION, id, { id, enabled });
    this.db.save();
  }
  /** Nombre de modules activés (affichage). */
  enabledCount() {
    return MODULE_IDS.filter((id) => this.isEnabled(id)).length;
  }
};

// src/modules/ui.ts
function openModulesMenu(player, modules2, territories2) {
  const form = new ActionFormData5().title(windowTitle("Modules")).body(`§7${modules2.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);
  for (const info of MODULE_CATALOG) {
    const enabled = modules2.isEnabled(info.id);
    const icon = info.id === "territories" ? ICONS.flag : ICONS.shield;
    form.button(`${enabled ? "§a✔" : "§c✘"} ${info.name}§r
§7${info.description}`, icon);
  }
  form.button("§4Fermer", ICONS.barrier);
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= MODULE_CATALOG.length) return;
    const index = response.selection;
    const info = MODULE_CATALOG[index];
    if (info === void 0) return;
    openModuleConfigMenu(player, info.id, modules2, territories2);
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
function openModuleConfigMenu(player, moduleId, modules2, territories2) {
  const info = MODULE_CATALOG.find((candidate) => candidate.id === moduleId);
  if (info === void 0) return;
  const enabled = modules2.isEnabled(moduleId);
  const form = new ActionFormData5().title(windowTitle(info.name)).body(`§7${info.description}

§7État : ${enabled ? "§aactivé" : "§cdésactivé"}`).button(enabled ? "§cDésactiver le module" : "§aActiver le module", enabled ? ICONS.barrier : ICONS.plus);
  if (moduleId === "territories" && territories2 !== void 0) {
    const territoryCount = territories2.all().length;
    form.button(`§eVoir les territoires §7(${territoryCount})`);
    form.button("§4Supprimer TOUS les territoires");
  }
  form.button("§8← Retour");
  form.show(player).then(async (response) => {
    if (response.canceled || response.selection === void 0) return;
    const toggleIndex = 0;
    const isTerritoryModule = moduleId === "territories" && territories2 !== void 0;
    const listIndex = isTerritoryModule ? 1 : -1;
    const wipeIndex = isTerritoryModule ? 2 : -1;
    const backIndex = isTerritoryModule ? 3 : 1;
    if (response.selection === toggleIndex) {
      modules2.setEnabled(moduleId, !enabled);
      player.sendMessage(
        `§a[Modules] ${info.name} ${!enabled ? "§aactivé" : "§cdésactivé"}§a.`
      );
      openModulesMenu(player, modules2, territories2);
    } else if (isTerritoryModule && response.selection === listIndex) {
      const { openTerritoriesMenu: openTerritoriesMenu2 } = await Promise.resolve().then(() => (init_ui(), ui_exports));
      openTerritoriesMenu2(player, territories2);
    } else if (isTerritoryModule && response.selection === wipeIndex) {
      openWipeTerritoriesMenu(player, modules2, territories2);
    } else if (response.selection === backIndex) {
      openModulesMenu(player, modules2, territories2);
    }
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
function openWipeTerritoriesMenu(player, modules2, territories2) {
  new MessageFormData2().title("§4⚠ DANGER").body(`Supprimer §lTOUS§r§4 les territoires (${territories2.all().length}) ?

Action irréversible !`).button2("§4SUPPRIMER TOUT").button1("§aAnnuler").show(player).then((response) => {
    if (response.selection !== 1) return;
    let removed = 0;
    for (const territory of territories2.all()) {
      if (territories2.removeForced(territory.id)) removed++;
    }
    player.sendMessage(`§a[Modules] ${removed} territoire(s) supprimé(s).`);
    openModulesMenu(player, modules2, territories2);
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

// src/ui/hub.ts
init_theme();
init_ui();
import { ActionFormData as ActionFormData7 } from "@minecraft/server-ui";
import { system as system6 } from "@minecraft/server";

// src/moderation/ui.ts
init_theme();
import { ActionFormData as ActionFormData6, ModalFormData as ModalFormData5 } from "@minecraft/server-ui";

// src/moderation/manager.ts
var BANS_COLLECTION = "bans";
var MUTES_COLLECTION = "mutes";
var WARNS_COLLECTION = "warns";
var INFRACTIONS_COLLECTION = "infractions";
function formatDuration(minutes) {
  if (minutes === 0) return "permanent";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
var SanctionsManager = class {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;
  /** Accès DB (lecture pour tests et GUI avancées). */
  db;
  constructor(db2) {
    this.db = db2;
  }
  markLoaded() {
    this.loaded = true;
  }
  /** Journalise une infraction (historique). */
  log(kind, target, by, reason, durationMinutes = 0) {
    this.db.insert(
      INFRACTIONS_COLLECTION,
      { kind, target, by, reason, at: Date.now(), durationMinutes },
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    );
    this.db.save();
  }
  // -------------------------------------------------------------------------
  // Bans
  // -------------------------------------------------------------------------
  /** Banni un joueur. durationMinutes = 0 -> permanent. */
  ban(name, by, reason, durationMinutes = 0) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.upsert(BANS_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 6e4
    });
    this.db.save();
    this.log("ban", name, by, reason, durationMinutes);
    return { ok: true };
  }
  unban(name) {
    const removed = this.db.delete(BANS_COLLECTION, name);
    if (!removed) return { ok: false, error: `${name} n'est pas banni.` };
    this.db.save();
    this.log("unban", name, "—", "déban");
    return { ok: true };
  }
  /** Le joueur est-il banni ? Renvoie la raison si oui (avec purge des bans expirés). */
  getBan(name) {
    const ban = this.db.findOne(BANS_COLLECTION, name);
    if (ban === void 0) return void 0;
    if (ban.data.expiresAt !== 0 && ban.data.expiresAt <= Date.now()) {
      this.db.delete(BANS_COLLECTION, name);
      this.db.save();
      return void 0;
    }
    return ban.data;
  }
  isBanned(name) {
    return this.getBan(name) !== void 0;
  }
  allBans() {
    return this.db.find(BANS_COLLECTION);
  }
  // -------------------------------------------------------------------------
  // Mutes
  // -------------------------------------------------------------------------
  mute(name, by, reason, durationMinutes) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.upsert(MUTES_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 6e4
    });
    this.db.save();
    this.log("mute", name, by, reason, durationMinutes);
    return { ok: true };
  }
  unmute(name) {
    const removed = this.db.delete(MUTES_COLLECTION, name);
    if (!removed) return { ok: false, error: `${name} n'est pas muet.` };
    this.db.save();
    this.log("unmute", name, "—", "démute");
    return { ok: true };
  }
  /** Le joueur est-il muet ? (purge automatique des mutes expirés) */
  getMute(name) {
    const mute = this.db.findOne(MUTES_COLLECTION, name);
    if (mute === void 0) return void 0;
    if (mute.data.expiresAt !== 0 && mute.data.expiresAt <= Date.now()) {
      this.db.delete(MUTES_COLLECTION, name);
      this.db.save();
      return void 0;
    }
    return mute.data;
  }
  isMuted(name) {
    return this.getMute(name) !== void 0;
  }
  allMutes() {
    return this.db.find(MUTES_COLLECTION);
  }
  // -------------------------------------------------------------------------
  // Warns
  // -------------------------------------------------------------------------
  warn(name, by, reason) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.insert(WARNS_COLLECTION, { name, reason, by, at: Date.now() });
    this.db.save();
    this.log("warn", name, by, reason);
    return { ok: true };
  }
  warnsOf(name) {
    return this.db.find(WARNS_COLLECTION, (doc) => doc.data.name === name);
  }
  /** Retire le dernier warn d'un joueur (pardon). */
  clearLastWarn(name) {
    const warns = this.warnsOf(name);
    const last = warns[warns.length - 1];
    if (last === void 0) return false;
    this.db.delete(WARNS_COLLECTION, last.id);
    this.db.save();
    return true;
  }
  // -------------------------------------------------------------------------
  // Historique
  // -------------------------------------------------------------------------
  /** Historique des infractions d'un joueur (du plus récent au plus ancien). */
  historyOf(name, limit = 10) {
    return this.db.find(INFRACTIONS_COLLECTION, (doc) => doc.data.target === name).reverse().slice(0, limit);
  }
  stats() {
    return {
      bans: this.allBans().length,
      mutes: this.allMutes().length,
      warns: this.db.count(WARNS_COLLECTION)
    };
  }
};

// src/moderation/ui.ts
function openSanctionsMenu(player, sanctions2, permissions2) {
  const stats = sanctions2.stats();
  new ActionFormData6().title(windowTitle("Modération")).body(
    `§7Bans actifs : §f${stats.bans}
§7Mutes actifs : §f${stats.mutes}
§7Warns au total : §f${stats.warns}`
  ).button("§4Bans actifs", ICONS.lock).button("§6Mutes actifs", ICONS.bell).button("§eSanctionner un joueur", ICONS.sword).button("§bHistorique d'un joueur", ICONS.book).button("§4Fermer", ICONS.barrier).show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    switch (response.selection) {
      case 0:
        openBansList(player, sanctions2, permissions2);
        break;
      case 1:
        openMutesList(player, sanctions2, permissions2);
        break;
      case 2:
        openSanctionForm(player, sanctions2);
        break;
      case 3:
        openHistoryLookup(player, sanctions2);
        break;
    }
  }).catch((error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}
function openBansList(player, sanctions2, permissions2) {
  const bans = sanctions2.allBans();
  if (bans.length === 0) {
    player.sendMessage("§7[Modération] Aucun ban actif.");
    return;
  }
  const form = new ActionFormData6().title("§4Bans actifs").body("§7Clique sur un ban pour le lever.");
  for (const ban of bans) {
    const expiry = ban.data.expiresAt === 0 ? "§4permanent" : `§7(${formatDuration(Math.ceil((ban.data.expiresAt - Date.now()) / 6e4))})`;
    form.button(`§f${ban.data.name} ${expiry}
§7par ${ban.data.by}`);
  }
  form.button("§8← Retour");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= bans.length) return void openSanctionsMenu(player, sanctions2, permissions2);
    const ban = bans[response.selection];
    if (ban === void 0) return;
    const result = sanctions2.unban(ban.data.name);
    player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
    openBansList(player, sanctions2, permissions2);
  }).catch((error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}
function openMutesList(player, sanctions2, permissions2) {
  const mutes = sanctions2.allMutes();
  if (mutes.length === 0) {
    player.sendMessage("§7[Modération] Aucun mute actif.");
    return;
  }
  const form = new ActionFormData6().title("§6Mutes actifs").body("§7Clique sur un mute pour le lever.");
  for (const mute of mutes) {
    const expiry = mute.data.expiresAt === 0 ? "§cpermanent" : `§7(${formatDuration(Math.ceil((mute.data.expiresAt - Date.now()) / 6e4))})`;
    form.button(`§f${mute.data.name} ${expiry}
§7par ${mute.data.by}`);
  }
  form.button("§8← Retour");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    if (response.selection >= mutes.length) return void openSanctionsMenu(player, sanctions2, permissions2);
    const mute = mutes[response.selection];
    if (mute === void 0) return;
    const result = sanctions2.unmute(mute.data.name);
    player.sendMessage(result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`);
    openMutesList(player, sanctions2, permissions2);
  }).catch((error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}
function openSanctionForm(player, sanctions2) {
  new ModalFormData5().title("Sanctionner un joueur").textField("Pseudo du joueur", "Ex : Griefer_42").dropdown("Type de sanction", ["§aKick", "§4Ban", "§6Mute", "§eWarn"], { defaultValueIndex: 3 }).slider("Durée en minutes (0 = permanent)", 0, 1440, { valueStep: 15, defaultValue: 60 }).textField("Raison", "Ex : grief zone spawn").submitButton("Appliquer").show(player).then((response) => {
    if (response.canceled) return;
    const values = response.formValues ?? [];
    const strings = values.filter((value) => typeof value === "string");
    const numbers = values.filter((value) => typeof value === "number");
    const target = (strings[0] ?? "").trim();
    const typeIndex = numbers[0] ?? 3;
    const minutes = numbers[1] ?? 60;
    const reason = strings[1] ?? "non spécifiée";
    if (target === "") {
      player.sendMessage("§c[Modération] Pseudo vide.");
      return;
    }
    if (typeIndex === 0) {
      Promise.resolve().then(() => (init_enforcement(), enforcement_exports)).then(({ kickPlayer: kickPlayer2 }) => {
        const ok = kickPlayer2(target, reason);
        player.sendMessage(ok ? `§a[Modération] ${target} éjecté.` : `§c[Modération] ${target} hors ligne.`);
        if (ok) sanctions2.log("kick", target, player.name, reason);
      });
    } else if (typeIndex === 1) {
      const result = sanctions2.ban(target, player.name, reason, minutes);
      player.sendMessage(result.ok ? `§a[Modération] ${target} banni (${formatDuration(minutes)}).` : `§c[Modération] ${result.error}`);
    } else if (typeIndex === 2) {
      const result = sanctions2.mute(target, player.name, reason, minutes);
      player.sendMessage(result.ok ? `§a[Modération] ${target} muet (${formatDuration(minutes)}).` : `§c[Modération] ${result.error}`);
    } else {
      const result = sanctions2.warn(target, player.name, reason);
      player.sendMessage(result.ok ? `§a[Modération] ${target} averti.` : `§c[Modération] ${result.error}`);
    }
  }).catch((error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}
function openHistoryLookup(player, sanctions2) {
  new ModalFormData5().title("Historique").textField("Pseudo du joueur", "Ex : Steve").submitButton("Voir").show(player).then((response) => {
    if (response.canceled) return;
    const strings = (response.formValues ?? []).filter((value) => typeof value === "string");
    const target = (strings[0] ?? "").trim();
    if (target === "") return;
    const entries = sanctions2.historyOf(target, 15);
    if (entries.length === 0) {
      player.sendMessage(`§7[Modération] ${target} : casier vierge.`);
      return;
    }
    player.sendMessage(`§6[Modération] Historique de ${target} (${entries.length}) :`);
    for (const entry of entries) {
      player.sendMessage(
        `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${new Date(entry.data.at).toLocaleString()})`
      );
    }
  }).catch((error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}

// src/ui/hub.ts
function openHubMenu(player, deps) {
  const { permissions: permissions2, modules: modules2, territories: territories2, sanctions: sanctions2 } = deps;
  const isAdmin = canUseAdminPanel(player, permissions2);
  const isMod = permissions2.levelOf(player.name) >= 60 || player.playerPermissionLevel >= 2;
  const hasRole = permissions2.getMember(player.name) !== void 0;
  const form = new ActionFormData7().title(windowTitle("Menu")).body(
    `${divider()}
§7Salut §f${player.name}§7 !
` + (hasRole ? `§7Ton rôle : ${permissions2.nameTagFor(player.name)}§r
` : "") + divider()
  );
  form.button(`${ICONS.flag}`, "§lTerritoires§r\n§7créer, lister, explorer").button(`${ICONS.compass}`, "§lMon rôle§r\n§7couleur, prefix perso");
  if (isMod) {
    form.button(`${ICONS.shield}`, "§lModération§r\n§7bans, mutes, warns");
  }
  if (isAdmin) {
    form.button(`${ICONS.crown}`, "§lRôles§r\n§7créer et régler les rôles");
    form.button(`${ICONS.paper}`, "§lJoueurs§r\n§7attribuer rôles et prefixes");
    form.button(`${ICONS.wrench}`, "§lModules§r\n§7activer/désactiver les features");
  }
  form.button(`${ICONS.barrier}`, "§8Fermer");
  form.show(player).then((response) => {
    if (response.canceled || response.selection === void 0) return;
    const actions = [];
    actions.push(() => openTerritoriesMenu(player, territories2));
    actions.push(() => openSelfRoleMenu(player, permissions2));
    if (isMod) {
      actions.push(() => openSanctionsMenu(player, sanctions2, permissions2));
    }
    if (isAdmin) {
      actions.push(() => openRolesMenu(player, permissions2));
      actions.push(() => openPlayersMenu(player, permissions2));
      actions.push(() => openModulesMenu(player, modules2, territories2));
    }
    const action = actions[response.selection];
    if (action !== void 0) system6.run(() => action());
  }).catch((error) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}
function openSelfRoleMenu(player, permissions2) {
  const member = permissions2.getMember(player.name);
  if (member === void 0) {
    player.sendMessage("§7[OM] Tu n'as pas encore de rôle. Demande à un admin !");
    return;
  }
  player.sendMessage(`§a[OM] Ton rôle : ${permissions2.nameTagFor(player.name)}§r§a — choisis ta couleur :`);
  openColorPicker(player, "Ta couleur de nom", (colorId) => {
    const result = permissions2.setCustomColor(player.name, colorId);
    player.sendMessage(result.ok ? "§a[OM] Couleur mise à jour !" : `§c[OM] ${result.error}`);
  });
}

// src/permissions/commands.ts
function canUseAdminPanel(player, permissions2) {
  return permissions2.levelOf(player.name) >= 100 || player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}
function registerAdminCommands(ctx) {
  system7.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:roles",
        description: "Personnalise ton prefix et ta couleur (si tu as un rôle)",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system7.run(() => {
          if (canUseAdminPanel(player, ctx.permissions)) {
            openRolesMenu(player, ctx.permissions);
            return;
          }
          const member = ctx.permissions.getMember(player.name);
          if (member === void 0) {
            player.sendMessage("§7[Rôles] Tu n'as pas de rôle. Demande à un admin !");
            return;
          }
          player.sendMessage(
            `§a[Rôles] Ton rôle : ${ctx.permissions.nameTagFor(player.name)}§r§a — personnalisation...`
          );
          openColorPicker(player, "Ta couleur de nom", (colorId) => {
            const result = ctx.permissions.setCustomColor(player.name, colorId);
            player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour !" : `§c[Rôles] ${result.error}`);
          });
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:menu",
        description: "Ouvre le menu principal OpenMontage",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system7.run(() => openHubMenu(player, ctx));
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:admin",
        description: "Panneau d'administration (rôles, joueurs, modules)",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system7.run(() => {
          if (!canUseAdminPanel(player, ctx.permissions)) {
            player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
            return;
          }
          new ActionFormData8().title(windowTitle("Administration")).body("§7Que veux-tu gérer ?").button("§6Rôles\n§7créer, couleurs, niveaux", ICONS.crown).button("§bJoueurs\n§7attribuer rôles et prefixes", ICONS.paper).button("§aModules\n§7activer/désactiver les features", ICONS.wrench).button("§4Fermer", ICONS.barrier).show(player).then((response) => {
            if (response.canceled || response.selection === void 0) return;
            if (response.selection === 0) openRolesMenu(player, ctx.permissions);
            else if (response.selection === 1) openPlayersMenu(player, ctx.permissions);
            else if (response.selection === 2) openModulesMenu(player, ctx.modules, ctx.territories);
          }).catch((error) => console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`));
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
  });
}

// src/permissions/chat.ts
import { world as world5, system as system8 } from "@minecraft/server";
function sanitizeMessage(raw) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 256);
}
function formatChatMessage(nameTag, message) {
  return `${nameTag}§r §7> §f${message}`;
}
function registerChat(permissions2) {
  world5.beforeEvents.chatSend.subscribe((event) => {
    if (!permissions2.loaded) return;
    const sender = event.sender;
    const tag = permissions2.nameTagFor(sender.name);
    event.cancel = true;
    const message = sanitizeMessage(event.message);
    system8.run(() => {
      world5.sendMessage(formatChatMessage(tag, message));
    });
  });
}

// src/moderation/index.ts
init_enforcement();

// src/moderation/commands.ts
import {
  CustomCommandParamType as CustomCommandParamType2,
  CustomCommandStatus as CustomCommandStatus3,
  CommandPermissionLevel as CommandPermissionLevel3,
  system as system9
} from "@minecraft/server";
import { world as world6 } from "@minecraft/server";
init_enforcement();
function canModerate(player, permissions2) {
  return permissions2.levelOf(player.name) >= 60 || player.playerPermissionLevel >= 2;
}
var DENIED = "§c[Modération] Niveau de rôle insuffisant (Modo requis).";
var NOT_PLAYER = "§c[Modération] Réservé aux joueurs.";
function notifyTarget(targetName, message) {
  const target = world6.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (target !== void 0) system9.run(() => target.sendMessage(message));
}
function registerModerationCommands(deps) {
  const { sanctions: sanctions2, permissions: permissions2 } = deps;
  system9.beforeEvents.startup.subscribe((event) => {
    const guardAndRun = (origin, action) => {
      const player = origin.sourceEntity;
      if (player === void 0 || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus3.Failure, message: NOT_PLAYER };
      }
      if (!canModerate(player, permissions2)) {
        return { status: CustomCommandStatus3.Failure, message: DENIED };
      }
      system9.run(() => action(player));
      return { status: CustomCommandStatus3.Success };
    };
    const stringParam = (name) => ({ name, type: CustomCommandParamType2.String });
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mod",
        description: "Panneau de modération (bans, mutes, warns)",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false
      },
      (origin) => guardAndRun(origin, (player) => {
        openSanctionsMenu(player, sanctions2, permissions2);
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:kick",
        description: "Éjecte un joueur du monde",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")]
      },
      (origin, target, reason) => guardAndRun(origin, (player) => {
        if (target === player.name) {
          player.sendMessage("§c[Modération] Tu ne peux pas te kick toi-même.");
          return;
        }
        if (kickPlayer(target, reason)) {
          player.sendMessage(`§a[Modération] ${target} éjecté. Raison : ${reason}`);
          sanctions2.log("kick", target, player.name, reason);
        } else {
          player.sendMessage(`§c[Modération] ${target} n'est pas en ligne.`);
        }
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:ban",
        description: "Banni un joueur (durée en minutes, 0 = permanent)",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")],
        optionalParameters: [{ name: "duree_min", type: CustomCommandParamType2.Integer }]
      },
      (origin, target, reason, minutes) => guardAndRun(origin, (player) => {
        const duration = minutes ?? 0;
        const result = sanctions2.ban(target, player.name, reason, duration);
        if (!result.ok) {
          player.sendMessage(`§c[Modération] ${result.error}`);
          return;
        }
        player.sendMessage(
          `§a[Modération] ${target} banni (${formatDuration(duration)}). Raison : ${reason}`
        );
        notifyTarget(target, `§4[Modération] Tu es banni (${formatDuration(duration)}) : ${reason}`);
        system9.run(() => kickPlayer(target, reason));
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unban",
        description: "Débanni un joueur",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")]
      },
      (origin, target) => guardAndRun(origin, (player) => {
        const result = sanctions2.unban(target);
        player.sendMessage(result.ok ? `§a[Modération] ${target} débanni.` : `§c[Modération] ${result.error}`);
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mute",
        description: "Rend muet un joueur (durée en minutes, 0 = permanent)",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), { name: "duree_min", type: CustomCommandParamType2.Integer }],
        optionalParameters: [stringParam("raison")]
      },
      (origin, target, minutes, reason) => guardAndRun(origin, (player) => {
        const cleanReason = reason ?? "non spécifié";
        const result = sanctions2.mute(target, player.name, cleanReason, minutes);
        if (!result.ok) {
          player.sendMessage(`§c[Modération] ${result.error}`);
          return;
        }
        player.sendMessage(`§a[Modération] ${target} muet (${formatDuration(minutes)}).`);
        notifyTarget(target, `§c[Modération] Tu es muet (${formatDuration(minutes)}) : ${cleanReason}`);
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unmute",
        description: "Rend la parole à un joueur muet",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")]
      },
      (origin, target) => guardAndRun(origin, (player) => {
        const result = sanctions2.unmute(target);
        player.sendMessage(result.ok ? `§a[Modération] ${target} peut parler.` : `§c[Modération] ${result.error}`);
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:warn",
        description: "Avertit un joueur (historisé)",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur"), stringParam("raison")]
      },
      (origin, target, reason) => guardAndRun(origin, (player) => {
        const result = sanctions2.warn(target, player.name, reason);
        if (!result.ok) {
          player.sendMessage(`§c[Modération] ${result.error}`);
          return;
        }
        const count = sanctions2.warnsOf(target).length;
        player.sendMessage(`§a[Modération] ${target} averti (${count} warn(s) au total).`);
        notifyTarget(target, `§6[Modération] ⚠ Avertissement (${count}) : ${reason}`);
      })
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:history",
        description: "Historique des sanctions d'un joueur",
        permissionLevel: CommandPermissionLevel3.Any,
        cheatsRequired: false,
        mandatoryParameters: [stringParam("joueur")]
      },
      (origin, target) => guardAndRun(origin, (player) => {
        const entries = sanctions2.historyOf(target, 10);
        if (entries.length === 0) {
          player.sendMessage(`§7[Modération] ${target} : casier vierge.`);
          return;
        }
        player.sendMessage(`§6[Modération] Historique de ${target} :`);
        for (const entry of entries) {
          const date = new Date(entry.data.at);
          const hh = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
          player.sendMessage(
            `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${hh})`
          );
        }
      })
    );
  });
}

// src/players.ts
var PLAYERS_COLLECTION = "players_index";
function findPlayerById(db2, playerId) {
  return db2.findOne(PLAYERS_COLLECTION, playerId);
}
function findPlayerByName(db2, playerName) {
  return db2.find(
    PLAYERS_COLLECTION,
    (doc) => doc.data.name === playerName
  )[0];
}
function trackPlayerJoin(db2, playerId, playerName, grade = "") {
  const now = Date.now();
  const existing = findPlayerById(db2, playerId);
  const legacy = findPlayerByName(db2, playerName);
  if (existing !== void 0) {
    existing.data.name = playerName;
    existing.data.lastSeen = now;
    existing.data.sessions += 1;
    if (grade !== "") existing.data.grade = grade;
    existing.updatedAt = now;
    db2.save();
    return existing.id;
  }
  if (legacy !== void 0 && legacy.id.startsWith("name:")) {
    db2.delete(PLAYERS_COLLECTION, legacy.id);
    const promoted = db2.insert(
      PLAYERS_COLLECTION,
      {
        playerId,
        name: playerName,
        firstSeen: legacy.data.firstSeen,
        lastSeen: now,
        sessions: legacy.data.sessions + 1,
        grade: grade !== "" ? grade : legacy.data.grade
      },
      playerId
    );
    db2.save();
    return promoted.id;
  }
  db2.insert(
    PLAYERS_COLLECTION,
    { playerId, name: playerName, firstSeen: now, lastSeen: now, sessions: 1, grade },
    playerId
  );
  db2.save();
  return playerId;
}

// src/main.ts
var db = new JsonDatabase(createBedrockStorage(), "openmontage");
registerAutosave(db, 100);
var permissions = new PermissionManager(db);
var modules = new ModuleManager(db);
var territories = new TerritoryManager(db);
var sanctions = new SanctionsManager(db);
registerCommands(territories, db, modules);
registerAdminCommands({ permissions, modules, territories, sanctions });
registerModerationCommands({ sanctions, permissions });
var protectionRegistered = false;
function applyNameTag(playerName) {
  const player = world7.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return;
  try {
    player.nameTag = permissions.nameTagFor(playerName);
  } catch {
  }
}
world7.afterEvents.worldLoad.subscribe(() => {
  db.load();
  permissions.markLoaded();
  modules.markLoaded();
  territories.markLoaded();
  if (!permissions.hasAdmin()) {
    const operator = world7.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
    if (operator !== void 0) {
      permissions.bootstrapAdmin(operator.name);
      console.log(`[OpenMontage] Bootstrap : ${operator.name} est promu Admin.`);
    }
  }
  for (const player of world7.getAllPlayers()) {
    applyNameTag(player.name);
  }
  registerChat(permissions);
  registerEnforcement(sanctions);
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
  }
  const stats = db.stats();
  console.log(
    `[OpenMontage] worldLoad OK : ${stats.documents} documents, ${stats.bytes} octets. Modules actifs : ${modules.enabledCount()}.`
  );
});
var worldReady = false;
system10.runInterval(() => {
  if (worldReady) return;
  if (world7.getAllPlayers().length === 0) return;
  if (!territories.loaded) {
    db.load();
    permissions.markLoaded();
    modules.markLoaded();
    territories.markLoaded();
    if (!permissions.hasAdmin()) {
      const operator = world7.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
      if (operator !== void 0) permissions.bootstrapAdmin(operator.name);
    }
    for (const player of world7.getAllPlayers()) applyNameTag(player.name);
  }
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    console.warn("[OpenMontage] Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);
world7.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  trackPlayerJoin(db, player.id, player.name, permissions.roleOf(player.name)?.data.name ?? "");
  applyNameTag(player.name);
  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Menu principal : §f/sn:menu§r — territoire : §f/sn:create");
  player.onScreenDisplay.setTitle("§aOpenMontage §f✔");
});
system10.runInterval(() => {
  if (!permissions.loaded) return;
  for (const player of world7.getAllPlayers()) {
    applyNameTag(player.name);
  }
}, 100);
system10.runInterval(() => {
  const stats = db.stats();
  console.log(
    `[OpenMontage] DB : ${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`
  );
}, 600);
