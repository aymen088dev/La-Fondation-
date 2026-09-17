// src/main.ts
import { world as world14, system as system14 } from "@minecraft/server";

// src/db/types.ts
var DB_SCHEMA_VERSION = 3;
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

// src/permissions/perms.ts
var PERMS = {
  // --- Territoires ---
  "territories.create": "Créer / revendiquer un territoire",
  // --- Modération ---
  "mod.panel": "Ouvrir le panneau de modération",
  "mod.kick": "Éjecter des joueurs",
  "mod.ban": "Bannir et débannir",
  "mod.mute": "Rendre muet / redonner la parole",
  "mod.warn": "Avertir les joueurs",
  "mod.history": "Consulter l'historique des sanctions",
  // --- Chat / personnalisation ---
  "chat.color": "Personnaliser la couleur de son nom",
  "chat.prefix": "Personnaliser son prefix"
};
var ALL_PERM_IDS = Object.keys(PERMS);
function isPermId(value) {
  return Object.prototype.hasOwnProperty.call(PERMS, value);
}
function defaultPermsForLevel(level) {
  const perms = ["territories.create", "chat.color", "chat.prefix"];
  if (level >= 60) {
    perms.push("mod.panel", "mod.kick", "mod.ban", "mod.mute", "mod.warn", "mod.history");
  }
  if (level >= 100) {
    perms.push(...ALL_PERM_IDS.filter((id) => !perms.includes(id)));
  }
  return perms;
}
function vanillaOpColor() {
  return "§c";
}

// src/db/migrations.ts
function migrateDatabase(file) {
  const from = typeof file.schemaVersion === "number" ? file.schemaVersion : 0;
  if (from >= DB_SCHEMA_VERSION) return file;
  if (from < 2) migrateV1ToV2(file);
  if (from < 3) migrateV2ToV3(file);
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
function migrateV2ToV3(file) {
  const collections = file.collections ?? {};
  for (const doc of collections["roles"] ?? []) {
    const data = doc.data;
    if (!Array.isArray(data["perms"])) {
      const level = typeof data["level"] === "number" ? data["level"] : 0;
      data["perms"] = defaultPermsForLevel(level);
    }
  }
  for (const doc of collections["members"] ?? []) {
    const data = doc.data;
    if (typeof data["playerId"] !== "string") data["playerId"] = null;
    if (typeof data["firstSeen"] !== "number") data["firstSeen"] = doc.createdAt;
  }
  for (const key of ["bans", "mutes", "warns"]) {
    for (const doc of collections[key] ?? []) {
      const data = doc.data;
      if (typeof data["playerId"] !== "string") data["playerId"] = null;
    }
  }
  for (const doc of collections["players_index"] ?? []) {
    const data = doc.data;
    if (typeof data["grade"] !== "string") data["grade"] = "";
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
   *
   * Une base inexistante (monde neuf) est valide : elle devient une base
   * vide PRÊTE À L'EMPLOI (loaded = true). Une base corrompue ne l'est pas :
   * loaded reste false et l'erreur est loguée (le menu /sn:db le signale).
   */
  load() {
    try {
      const raw = this.storage.read();
      if (raw === null) {
        this.file = { schemaVersion: DB_SCHEMA_VERSION, name: this.name, savedAt: 0, collections: {} };
        this.dirty = false;
        this.loaded = true;
        return;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || typeof parsed.collections !== "object" || parsed.collections === null) {
        throw new Error("structure inattendue");
      }
      const needsMigration = parsed.schemaVersion !== DB_SCHEMA_VERSION;
      if (needsMigration) migrateDatabase(parsed);
      this.file = {
        schemaVersion: DB_SCHEMA_VERSION,
        name: this.name,
        savedAt: parsed.savedAt ?? 0,
        collections: parsed.collections
      };
      this.dirty = needsMigration;
      this.loaded = true;
      const docs = Object.values(this.file.collections).reduce((sum, docs2) => sum + docs2.length, 0);
      console.log(`[DB] "${this.name}" chargée : ${docs} document(s), schéma v${DB_SCHEMA_VERSION}.`);
    } catch (error) {
      console.warn(
        `[DB] ERREUR de chargement ("${this.name}") : ${error instanceof Error ? error.message : String(error)}. La base est laissée intacte (aucune écriture ne sera faite). Commandes /sn:db indisponibles.`
      );
    }
  }
  /**
   * Écrit la base dans le stockage si elle a été modifiée (ou si force).
   * Renvoie true si une écriture a eu lieu.
   *
   * ⚠️ Garde anti-écrasement : jamais d'écriture tant que la base n'a pas
   * été chargée (loaded = false). Sinon, un save() déclenché avant le
   * worldLoad écraserait la DB stockée avec une base vide.
   */
  save(force = false) {
    if (!this.loaded) return false;
    if (!this.dirty && !force) return false;
    this.file.savedAt = Date.now();
    try {
      this.storage.write(JSON.stringify(this.file));
    } catch (error) {
      console.warn(
        `[DB] ERREUR d'écriture : ${error instanceof Error ? error.message : String(error)}. Nouvelle tentative à l'autosave.`
      );
      return false;
    }
    this.dirty = false;
    return true;
  }
  /**
   * Lève manuellement le flag "modifiée". À utiliser après une mutation
   * EN PLACE d'un document (doc.data.x = y) récupéré via findOne()/find() :
   * sans ça, save() croirait la base à jour et la persistance serait perdue.
   */
  markDirty() {
    if (this.loaded) this.dirty = true;
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

// src/db/collections.ts
var PLAYERS_COLLECTION = "players_index";
var TERRITORY_COLLECTION = "territories";
var ROLES_COLLECTION = "roles";
var MEMBERS_COLLECTION = "members";
var BANS_COLLECTION = "bans";
var MUTES_COLLECTION = "mutes";
var WARNS_COLLECTION = "warns";
var INFRACTIONS_COLLECTION = "infractions";
var MODULES_COLLECTION = "modules";
var COLLECTION_META = {
  players_index: { label: "Joueurs", hint: "sessions, grade, première/dernière connexion" },
  territories: { label: "Territoires", hint: "chunks, drapeau, membres" },
  roles: { label: "Rôles", hint: "couleur, prefix, niveau, permissions" },
  members: { label: "Grades attribués", hint: "rôle, prefix et couleur personnalisés" },
  bans: { label: "Bans", hint: "sanctions d'exclusion actives" },
  mutes: { label: "Mutes", hint: "sanctions de chat actives" },
  warns: { label: "Avertissements", hint: "compteur d'avertissements" },
  infractions: { label: "Journal", hint: "historique de toutes les actions de modération" },
  modules: { label: "Modules", hint: "activation des fonctionnalités" }
};
var SECTION_ORDER = Object.keys(COLLECTION_META);
function collectionLabel(collection) {
  const meta = COLLECTION_META[collection];
  return meta === void 0 ? collection : `§f${meta.label}`;
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
  /** Le territoire d'un joueur (par son pseudo, v1/v2). */
  findByOwner(owner) {
    return this.db.find(TERRITORY_COLLECTION, (doc) => doc.data.owner === owner)[0];
  }
  /** Le territoire dont ce joueur (par id Bedrock) est propriétaire. */
  findByOwnerId(ownerId) {
    return this.db.find(TERRITORY_COLLECTION, (doc) => doc.data.ownerId === ownerId)[0];
  }
  /** Le territoire où ce playerId est propriétaire OU membre (rang quelconque). */
  findByMemberId(playerId) {
    return this.db.find(
      TERRITORY_COLLECTION,
      (doc) => doc.data.ownerId === playerId || doc.data.members.some((member) => member.playerId === playerId)
    )[0];
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
  /** Marque la DB dirty (mutations en place, cf. markDirty()). */
  touch() {
    this.db.markDirty();
  }
  // -------------------------------------------------------------------------
  // Membres (v3)
  // -------------------------------------------------------------------------
  /** Ajoute un membre à un territoire. Renvoie une erreur si déjà membre. */
  addMember(territoryId, playerId, playerName) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return { ok: false, error: "Territoire introuvable." };
    if (territory.data.ownerId === playerId) return { ok: false, error: "C'est le propriétaire." };
    if (territory.data.members.some((m) => m.playerId === playerId)) {
      return { ok: false, error: `${playerName} fait déjà partie du territoire.` };
    }
    territory.data.members.push({ playerId, name: playerName, rank: "member" });
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Retire un membre (par playerId) d'un territoire. */
  removeMember(territoryId, playerId) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return { ok: false, error: "Territoire introuvable." };
    const before = territory.data.members.length;
    territory.data.members = territory.data.members.filter((m) => m.playerId !== playerId);
    if (territory.data.members.length === before) return { ok: false, error: "Ce joueur n'est pas membre." };
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Change le rang d'un membre ("member" ou "officer"). */
  setMemberRank(territoryId, playerId, rank) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return { ok: false, error: "Territoire introuvable." };
    const member = territory.data.members.find((m) => m.playerId === playerId);
    if (member === void 0) return { ok: false, error: "Ce joueur n'est pas membre." };
    if (member.rank === rank) return { ok: true };
    member.rank = rank;
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
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

// src/territories/commands.ts
import { CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, system as system7 } from "@minecraft/server";

// src/ui/theme.ts
import {
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean
} from "@minecraft/server-ui";
var RP_PACK_ID = "OpenMontage UI";
var OM_ICONS = {
  flag: "flag",
  compass: "compass",
  shield: "shield",
  crown: "crown",
  scroll: "scroll",
  gear: "gear",
  database: "database",
  sword: "sword",
  ban: "ban",
  bell: "bell",
  warn: "warn",
  history: "history",
  plus: "plus",
  check: "check",
  trash: "trash",
  search: "search",
  save: "save",
  back: "back",
  close: "close",
  list: "list",
  pencil: "pencil",
  user: "user",
  tag: "tag",
  online: "online"
};
function OM_ICON(icon) {
  return `textures/ui/om_ic_${OM_ICONS[icon]}`;
}
var HEROES = {
  home: "om_hero_home",
  territories: "om_hero_territories",
  admin: "om_hero_admin",
  mod: "om_hero_mod",
  role: "om_hero_role",
  modules: "om_hero_modules",
  database: "om_hero_database"
};
function heroPath(kind) {
  return `textures/ui/${HEROES[kind]}`;
}
function windowTitle(section) {
  return `§l§aOM §r§8» §r§l${section}`;
}
function obString(initial) {
  return new ObservableString(initial);
}
function obNumber(initial) {
  return new ObservableNumber(initial);
}
function obBool(initial) {
  return new ObservableBoolean(initial);
}
function obToggle(initial, onChange) {
  const observable = new ObservableBoolean(initial);
  observable.subscribe(onChange);
  return observable;
}
function uiText(text) {
  return { rawtext: [{ text }] };
}
var OMForm = class {
  inner;
  player;
  constructor(player, title) {
    this.player = player;
    this.inner = new CustomForm(player, uiText(title));
  }
  /** Ferme ce formulaire si l'écran s'affiche encore (sinon no-op). */
  closeIfShowing() {
    try {
      if (this.inner.isShowing()) this.inner.close();
    } catch {
    }
  }
  /**
   * Bannière de héros en tête de menu (image pleine largeur du RP OM).
   * À appeler EN PREMIER : c'est l'identité graphique du menu.
   */
  hero(kind) {
    this.inner.image(heroPath(kind), RP_PACK_ID, { width: 1 });
    return this;
  }
  header(text, options) {
    this.inner.header(uiText(text), options);
    return this;
  }
  label(text, options) {
    this.inner.label(uiText(text), options);
    return this;
  }
  button(label, onClick, options, icon) {
    const imageDetails = icon === void 0 ? void 0 : { imagePackId: RP_PACK_ID, imageSrc: OM_ICON(icon) };
    this.inner.button(
      uiText(label),
      () => {
        closeOpenForm(this.player);
        onClick();
      },
      imageDetails === void 0 ? options : { ...options, imageDetails }
    );
    return this;
  }
  divider(options) {
    this.inner.divider(options);
    return this;
  }
  spacer(options) {
    this.inner.spacer(options);
    return this;
  }
  toggle(label, toggled, options) {
    this.inner.toggle(uiText(label), toggled, options);
    return this;
  }
  slider(label, value, min, max, options) {
    this.inner.slider(uiText(label), value, min, max, options);
    return this;
  }
  dropdown(label, value, items, options) {
    const data = items.map((item, index) => {
      if (typeof item === "string") return { label: uiText(item), value: index };
      return {
        ...item,
        label: typeof item.label === "string" ? uiText(item.label) : item.label
      };
    });
    this.inner.dropdown(uiText(label), value, data, options);
    return this;
  }
  textField(label, text, options) {
    this.inner.textField(uiText(label), text, options);
    return this;
  }
  image(src, pack, options) {
    this.inner.image(src, pack, options);
    return this;
  }
  closeButton() {
    this.inner.closeButton();
    return this;
  }
  show() {
    const previous = openForms.get(this.player.id);
    if (previous !== void 0 && previous !== this) previous.closeIfShowing();
    openForms.set(this.player.id, this);
    return this.inner.show().finally(() => {
      if (openForms.get(this.player.id) === this) {
        openForms.delete(this.player.id);
      }
    });
  }
  isShowing() {
    return this.inner.isShowing();
  }
};
var openForms = /* @__PURE__ */ new Map();
function closeOpenForm(player) {
  const current = openForms.get(player.id);
  if (current === void 0) return;
  openForms.delete(player.id);
  current.closeIfShowing();
}
async function openWindow(player, section, build, hero) {
  closeOpenForm(player);
  const form = new OMForm(player, windowTitle(section));
  if (hero !== void 0) form.hero(hero);
  build(form);
  form.closeButton();
  return form.show();
}
async function openWindowRaw(player, title, build) {
  closeOpenForm(player);
  const form = new OMForm(player, title);
  build(form);
  return form.show();
}

// src/db/menu.ts
function summarize(doc) {
  const data = doc.data ?? {};
  if (typeof data.name === "string" && data.name !== "") {
    const extras = [];
    if (typeof data.level === "number") extras.push(`niv. ${data.level}`);
    if (typeof data.role === "string") extras.push(String(data.role));
    if (typeof data.reason === "string") extras.push(String(data.reason).slice(0, 30));
    if (typeof data.enabled === "boolean") extras.push(data.enabled ? "ON" : "OFF");
    if (typeof data.grade === "string" && data.grade !== "") extras.push(`grade ${data.grade}`);
    if (typeof data.sessions === "number") extras.push(`${data.sessions} sessions`);
    if (Array.isArray(data.perms)) extras.push(`${data.perms.length} perms`);
    if (Array.isArray(data.members)) extras.push(`${data.members.length} membres`);
    return `§f${data.name}§r§7${extras.length > 0 ? ` — ${extras.join(" · ")}` : ""}`;
  }
  if (typeof data.playerId === "string" && data.playerId !== "") {
    return `§fid:${String(data.playerId).slice(0, 12)}…§r§7${typeof data.name === "string" ? ` ${data.name}` : ""}`;
  }
  return `§f${doc.id}`;
}
async function openDbMenu(db2, player) {
  await openWindow(player, "Base de données", (form) => {
    const stats = db2.stats();
    const sections = listSections(db2);
    form.hero("database");
    form.header(`§a■ §lBase de données`);
    form.label(
      `§7${stats.documents} documents · ${stats.bytes} octets
§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}`
    );
    form.divider();
    for (const section of sections) {
      form.button(
        `${collectionLabel(section)}
§8${stats.collections[section]} doc(s)`,
        () => {
          void openSectionMenu(db2, player, section);
        },
        void 0,
        "database"
      );
    }
    form.divider();
    form.button(`§a■ §lForcer la sauvegarde`, () => {
      db2.save(true);
      player.sendMessage("§a[DB] Sauvegarde forcée.");
    }, void 0, "save");
  }).catch(
    (error) => console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`)
  );
}
async function openSectionMenu(db2, player, section) {
  await openWindow(player, collectionLabel(section), (form) => {
    const docs = db2.find(section);
    form.label(`§7${docs.length} document(s) — clique pour inspecter/modifier :`);
    form.divider();
    for (const doc of docs) {
      form.button(summarize(doc), () => {
        void openDocumentMenu(db2, player, section, doc.id);
      });
    }
    form.divider();
    form.button(`§c■ §lVider la section`, () => {
      const removed = db2.clear(section);
      db2.save();
      player.sendMessage(`§c[DB] Section "${section}" vidée (${removed} document(s) supprimés).`);
    });
  }).catch(
    (error) => console.warn(`[DB] Erreur section : ${error instanceof Error ? error.message : String(error)}`)
  );
}
var READONLY_KEYS = /* @__PURE__ */ new Set(["chunkKeys"]);
async function openDocumentMenu(db2, player, section, docId) {
  const doc = db2.findOne(section, docId);
  if (doc === void 0) {
    player.sendMessage("§c[DB] Document introuvable (déjà supprimé ?).");
    return;
  }
  const entries = Object.entries(doc.data).filter(([key]) => !READONLY_KEYS.has(key));
  await openWindowRaw(player, windowTitle(docId), (form) => {
    form.header(`§b■ §l${docId}`);
    form.label(`§7collection : §f${section}`);
    const editableKeys = [];
    const kinds = [];
    const boolValues = {};
    const readonlyLines = [];
    for (const [key, value] of entries) {
      if (typeof value === "string") {
        form.textField(`§e${key}`, obString(value));
        editableKeys.push(key);
        kinds.push("string");
      } else if (typeof value === "number") {
        form.textField(`§e${key} §7(nombre)`, obString(String(value)));
        editableKeys.push(key);
        kinds.push("number");
      } else if (typeof value === "boolean") {
        const toggle = obBool(value);
        boolValues[key] = toggle;
        form.toggle(`§e${key}`, toggle);
        editableKeys.push(key);
        kinds.push("boolean");
      } else {
        readonlyLines.push(`§7${key}: §f${summarizeValue(value)}`);
      }
    }
    if (readonlyLines.length > 0) {
      form.divider();
      form.label(`§7— lecture seule —
${readonlyLines.join("\n")}`);
    }
    form.divider();
    form.button(`§a■ §lAppliquer`, () => {
      const patch = {};
      for (const [key, toggle] of Object.entries(boolValues)) {
        const current = doc.data[key];
        if (typeof current === "boolean" && toggle.getData() !== current) {
          patch[key] = toggle.getData();
        }
      }
      if (Object.keys(patch).length > 0) {
        db2.update(section, docId, patch);
        db2.save();
        player.sendMessage(`§a[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
      } else {
        player.sendMessage("§7[DB] Aucun changement (seuls les interrupteurs sont éditables).");
      }
    });
    form.closeButton();
  }).catch(
    (error) => console.warn(`[DB] Erreur document : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function summarizeValue(value) {
  if (Array.isArray(value)) {
    return `${value.length} élément(s) [${value.slice(0, 3).map((item) => typeof item === "object" ? JSON.stringify(item).slice(0, 40) : String(item)).join(", ")}${value.length > 3 ? ", …" : ""}]`;
  }
  if (value !== null && typeof value === "object") {
    return `${Object.keys(value).length} champ(s)`;
  }
  return JSON.stringify(value) ?? "null";
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

// node_modules/@bedrock-oss/bedrock-boost/dist/index.mjs
import {
  Direction as Direction2,
  StructureRotation as StructureRotation2
} from "@minecraft/server";
import {
  Direction,
  StructureRotation
} from "@minecraft/server";
import { system as system2, world as world2 } from "@minecraft/server";
import { Direction as Direction4 } from "@minecraft/server";
import { Direction as Direction3 } from "@minecraft/server";
import { BlockPermutation, world as world22 } from "@minecraft/server";
import { world as world3 } from "@minecraft/server";
import { Player } from "@minecraft/server";
import { system as system22 } from "@minecraft/server";
import { system as system3 } from "@minecraft/server";
import { system as system4, world as world4 } from "@minecraft/server";
import { Player as Player2, system as system5, world as world5 } from "@minecraft/server";
import { system as system6 } from "@minecraft/server";
import { Direction as Direction5 } from "@minecraft/server";
import { StructureSaveMode, world as world6 } from "@minecraft/server";
import {
  EntityEquippableComponent,
  EquipmentSlot,
  GameMode,
  ItemDurabilityComponent,
  ItemEnchantableComponent
} from "@minecraft/server";
var DIRECTION_VECTORS = {
  [Direction.Down]: [0, -1, 0],
  [Direction.Up]: [0, 1, 0],
  [Direction.North]: [0, 0, -1],
  [Direction.South]: [0, 0, 1],
  [Direction.East]: [1, 0, 0],
  [Direction.West]: [-1, 0, 0]
};
var MutVec3 = class _MutVec3 {
  x;
  y;
  z;
  constructor(x, y, z) {
    if (typeof x === "number") {
      this.x = x;
      this.y = y;
      this.z = z;
    } else if (typeof x === "string") {
      const direction = DIRECTION_VECTORS[x];
      if (!direction)
        throw new Error("Invalid vector");
      this.x = direction[0];
      this.y = direction[1];
      this.z = direction[2];
    } else if (Array.isArray(x)) {
      this.x = x[0];
      this.y = x[1];
      this.z = x[2];
    } else {
      if (!x || !x.x && x.x !== 0 || !x.y && x.y !== 0 || !x.z && x.z !== 0) {
        throw new Error("Invalid vector");
      }
      this.x = x.x;
      this.y = x.y;
      this.z = x.z;
    }
  }
  static from(x, y, z) {
    if (typeof x === "number") {
      if (y !== void 0 && z !== void 0)
        return new _MutVec3(x, y, z);
    } else if (x) {
      return new _MutVec3(x);
    }
    throw new Error("Invalid arguments");
  }
  static _from(x, y, z) {
    if (typeof x === "number") {
      if (y === void 0 && z === void 0)
        return new _MutVec3(x, x, x);
      if (y !== void 0 && z !== void 0)
        return new _MutVec3(x, y, z);
    } else if (x instanceof _MutVec3) {
      return x;
    } else if (x) {
      return new _MutVec3(x);
    }
    throw new Error("Invalid arguments");
  }
  copy() {
    return new _MutVec3(this.x, this.y, this.z);
  }
  /**
   * Adds a vector to the current vector in place. Unlike `add`, this method
   * takes only a vector and skips the argument dispatch, which makes it the
   * faster choice in code that runs every tick.
   *
   * @param v - The vector to be added.
   * @returns The updated vector.
   */
  addVec(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  /**
   * Subtracts a vector from the current vector in place. Fast-path variant of
   * `subtract`.
   *
   * @param v - The vector to be subtracted.
   * @returns The updated vector.
   */
  subtractVec(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  /**
   * Multiplies the current vector component-wise by a vector in place.
   * Fast-path variant of `multiply`; use `scale` for scalars.
   *
   * @param v - The vector multiplier.
   * @returns The updated vector.
   */
  multiplyVec(v) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }
  /**
   * Divides the current vector component-wise by a vector in place. Fast-path
   * variant of `divide`.
   *
   * @param v - The vector divisor.
   * @returns The updated vector.
   * @throws If any component of the divisor is zero.
   */
  divideVec(v) {
    if (v.x === 0 || v.y === 0 || v.z === 0)
      throw new Error("Cannot divide by zero");
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    return this;
  }
  /**
   * Computes the dot product with a vector. Fast-path variant of `dot`.
   *
   * @param v - The other vector.
   * @returns The dot product.
   */
  dotVec(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  /**
   * Replaces the current vector with its cross product with a vector.
   * Fast-path variant of `cross`.
   *
   * @param v - The other vector.
   * @returns The updated vector.
   */
  crossVec(v) {
    const cx = this.y * v.z - this.z * v.y;
    const cy = this.z * v.x - this.x * v.z;
    const cz = this.x * v.y - this.y * v.x;
    this.x = cx;
    this.y = cy;
    this.z = cz;
    return this;
  }
  /**
   * Computes the distance to a vector. Fast-path variant of `distance`.
   *
   * @param v - The other vector.
   * @returns The distance between the vectors.
   */
  distanceVec(v) {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  /**
   * Computes the squared distance to a vector. Fast-path variant of
   * `distanceSquared`.
   *
   * @param v - The other vector.
   * @returns The squared distance between the vectors.
   */
  distanceSquaredVec(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  toImmutable() {
    return new Vec3(this.x, this.y, this.z);
  }
  static fromRotation(yawOrRotation, pitch) {
    let yaw;
    if (typeof yawOrRotation === "number") {
      yaw = yawOrRotation;
      pitch = pitch;
    } else {
      yaw = yawOrRotation.y;
      pitch = yawOrRotation.x;
    }
    const psi = yaw * (Math.PI / 180);
    const theta = pitch * (Math.PI / 180);
    const x = -Math.cos(theta) * Math.sin(psi);
    const yv = -Math.sin(theta);
    const z = Math.cos(theta) * Math.cos(psi);
    return new _MutVec3(x, yv, z);
  }
  toRotation() {
    if (this.isZero())
      throw new Error("Cannot convert zero-length vector to direction");
    const dir = this.copy().normalize();
    const yaw = -Math.atan2(dir.x, dir.z) * (180 / Math.PI);
    const pitch = Math.asin(-dir.y) * (180 / Math.PI);
    return { x: pitch, y: yaw };
  }
  add(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  directionTo(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    this.subtract(v).multiply(-1).normalize();
    return this;
  }
  subtract(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  multiply(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }
  scale(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    return this;
  }
  divide(x, y, z) {
    if (typeof x === "number" && y === void 0 && z === void 0) {
      if (x === 0)
        throw new Error("Cannot divide by zero");
      this.x /= x;
      this.y /= x;
      this.z /= x;
      return this;
    }
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    if (v.x === 0 || v.y === 0 || v.z === 0)
      throw new Error("Cannot divide by zero");
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    return this;
  }
  normalize() {
    if (this.isZero())
      throw new Error("Cannot normalize zero-length vector");
    const len = this.length();
    this.x /= len;
    this.y /= len;
    this.z /= len;
    return this;
  }
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  lengthSquared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  cross(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    const cx = this.y * v.z - this.z * v.y;
    const cy = this.z * v.x - this.x * v.z;
    const cz = this.x * v.y - this.y * v.x;
    this.x = cx;
    this.y = cy;
    this.z = cz;
    return this;
  }
  distance(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    return this.copy().subtract(v).length();
  }
  distanceSquared(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    return this.copy().subtract(v).lengthSquared();
  }
  lerp(v, t) {
    if (!v || t === void 0)
      return this;
    if (t === 1) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    if (t === 0)
      return this;
    this.x = this.x + (v.x - this.x) * t;
    this.y = this.y + (v.y - this.y) * t;
    this.z = this.z + (v.z - this.z) * t;
    return this;
  }
  slerp(v, t) {
    if (!v || t === void 0)
      return this;
    if (t === 1) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    }
    if (t === 0)
      return this;
    const dot = this.dot(v);
    const theta = Math.acos(dot) * t;
    const relative = _MutVec3.from(v).subtract(this.copy().multiply(dot)).normalize();
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this.multiply(cosT);
    this.x += relative.x * sinT;
    this.y += relative.y * sinT;
    this.z += relative.z * sinT;
    return this;
  }
  dot(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  angleBetween(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    const dotProduct = this.dot(v);
    const lenSq1 = this.lengthSquared();
    if (lenSq1 === 0)
      return 0;
    const lenSq2 = v.lengthSquared();
    if (lenSq2 === 0)
      return 0;
    const denom = Math.sqrt(lenSq1 * lenSq2);
    const cosAngle = Math.min(1, Math.max(-1, dotProduct / denom));
    return Math.acos(cosAngle);
  }
  projectOnto(x, y, z) {
    const v = x instanceof _MutVec3 ? x : _MutVec3._from(x, y, z);
    if (v.isZero()) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      return this;
    }
    const denom = v.dot(v);
    if (denom === 0) {
      this.x = 0;
      this.y = 0;
      this.z = 0;
      return this;
    }
    const scale = this.dot(v) / denom;
    this.x = v.x * scale;
    this.y = v.y * scale;
    this.z = v.z * scale;
    return this;
  }
  reflect(x, y, z) {
    const normal = _MutVec3._from(x, y, z);
    const tmp = this.copy();
    const proj = tmp.projectOnto(normal);
    return this.subtract(proj.multiply(2));
  }
  rotate(axis, angle) {
    const halfAngle = angle * Math.PI / 180 / 2;
    const w = Math.cos(halfAngle);
    const x = axis.x * Math.sin(halfAngle);
    const y = axis.y * Math.sin(halfAngle);
    const z = axis.z * Math.sin(halfAngle);
    const vx = this.x, vy = this.y, vz = this.z;
    const qv_x = w * w * vx + 2 * y * w * vz - 2 * z * w * vy + x * x * vx + 2 * y * x * vy + 2 * z * x * vz - z * z * vx - y * y * vx;
    const qv_y = 2 * x * y * vx + y * y * vy + 2 * z * y * vz + 2 * w * z * vx - z * z * vy + w * w * vy - 2 * x * w * vz - x * x * vy;
    const qv_z = 2 * x * z * vx + 2 * y * z * vy + z * z * vz - 2 * w * y * vx - y * y * vz + 2 * w * x * vy - x * x * vz + w * w * vz;
    this.x = qv_x;
    this.y = qv_y;
    this.z = qv_z;
    return this;
  }
  update(x, y, z) {
    if (!x)
      x = (v) => v;
    if (!y)
      y = (v) => v;
    if (!z)
      z = (v) => v;
    this.x = x(this.x);
    this.y = y(this.y);
    this.z = z(this.z);
    return this;
  }
  setX(value) {
    if (typeof value === "number")
      this.x = value;
    else
      this.x = value(this.x);
    return this;
  }
  setY(value) {
    if (typeof value === "number")
      this.y = value;
    else
      this.y = value(this.y);
    return this;
  }
  setZ(value) {
    if (typeof value === "number")
      this.z = value;
    else
      this.z = value(this.z);
    return this;
  }
  floor() {
    return this.update(Math.floor, Math.floor, Math.floor);
  }
  floorX() {
    return this.setX(Math.floor);
  }
  floorY() {
    return this.setY(Math.floor);
  }
  floorZ() {
    return this.setZ(Math.floor);
  }
  ceil() {
    return this.update(Math.ceil, Math.ceil, Math.ceil);
  }
  ceilX() {
    return this.setX(Math.ceil);
  }
  ceilY() {
    return this.setY(Math.ceil);
  }
  ceilZ() {
    return this.setZ(Math.ceil);
  }
  round() {
    return this.update(Math.round, Math.round, Math.round);
  }
  roundX() {
    return this.setX(Math.round);
  }
  roundY() {
    return this.setY(Math.round);
  }
  roundZ() {
    return this.setZ(Math.round);
  }
  up() {
    return this.add(Direction.Up);
  }
  down() {
    return this.add(Direction.Down);
  }
  north() {
    return this.add(Direction.North);
  }
  south() {
    return this.add(Direction.South);
  }
  east() {
    return this.add(Direction.East);
  }
  west() {
    return this.add(Direction.West);
  }
  isZero() {
    return this.x === 0 && this.y === 0 && this.z === 0;
  }
  toArray() {
    return [this.x, this.y, this.z];
  }
  toDirection() {
    if (this.isZero())
      throw new Error("Cannot convert zero-length vector to direction");
    const normalized = this.copy().normalize();
    const maxValue = Math.max(
      Math.abs(normalized.x),
      Math.abs(normalized.y),
      Math.abs(normalized.z)
    );
    if (maxValue === normalized.x)
      return Direction.East;
    if (maxValue === -normalized.x)
      return Direction.West;
    if (maxValue === normalized.y)
      return Direction.Up;
    if (maxValue === -normalized.y)
      return Direction.Down;
    if (maxValue === normalized.z)
      return Direction.South;
    if (maxValue === -normalized.z)
      return Direction.North;
    throw new Error("Cannot convert vector to direction");
  }
  toStructureRotation() {
    const rotation = this.toRotation();
    let aligned = Math.round(rotation.y / 90) * 90;
    if (aligned < 0)
      aligned += 360;
    if (aligned >= 360)
      aligned -= 360;
    if (aligned === 0)
      return StructureRotation.None;
    if (aligned === 90)
      return StructureRotation.Rotate90;
    if (aligned === 180)
      return StructureRotation.Rotate180;
    if (aligned === 270)
      return StructureRotation.Rotate270;
    throw new Error("Cannot convert vector to structure rotation");
  }
  toBlockLocation() {
    this.x = (this.x << 0) - (this.x < 0 && this.x !== this.x << 0 ? 1 : 0);
    this.y = (this.y << 0) - (this.y < 0 && this.y !== this.y << 0 ? 1 : 0);
    this.z = (this.z << 0) - (this.z < 0 && this.z !== this.z << 0 ? 1 : 0);
    return this;
  }
  almostEqual(x, y, z, delta) {
    try {
      let other;
      if (typeof x !== "number" && z === void 0) {
        other = _MutVec3._from(x, void 0, void 0);
        delta = y;
      } else {
        other = _MutVec3._from(x, y, z);
      }
      return Math.abs(this.x - other.x) <= delta && Math.abs(this.y - other.y) <= delta && Math.abs(this.z - other.z) <= delta;
    } catch (e) {
      return false;
    }
  }
  equals(x, y, z) {
    try {
      const other = _MutVec3._from(x, y, z);
      return this.x === other.x && this.y === other.y && this.z === other.z;
    } catch (e) {
      return false;
    }
  }
  toString(format = "long", separator = ", ") {
    const result = `${this.x + separator + this.y + separator + this.z}`;
    return format === "long" ? `MutVec3(${result})` : result;
  }
  static fromString(str, format = "long", separator = ", ") {
    if (format === "long") {
      const match = str.match(/^MutVec3\((.*)\)$/);
      if (!match)
        throw new Error("Invalid string format");
      const components = match[1].split(separator);
      if (components.length !== 3)
        throw new Error("Invalid string format");
      return new _MutVec3(
        Number(components[0]),
        Number(components[1]),
        Number(components[2])
      );
    } else {
      const components = str.split(separator);
      if (components.length !== 3)
        throw new Error("Invalid string format");
      return new _MutVec3(
        Number(components[0]),
        Number(components[1]),
        Number(components[2])
      );
    }
  }
};
var ChatColor = class _ChatColor {
  /**
   * Class ChatColor Constructor.
   * @param code - The color code as a string.
   * @param color - The color code as a hexadecimal number. Can be undefined.
   */
  constructor(code, color) {
    this.code = code;
    this.color = color;
    if (color) {
      this.r = color >> 16 & 255;
      this.g = color >> 8 & 255;
      this.b = color & 255;
    }
  }
  /**
   * Black color code. (0)
   */
  static BLACK = /* @__PURE__ */ new _ChatColor(
    "0",
    0
  );
  /**
   * Dark blue color code. (1)
   */
  static DARK_BLUE = /* @__PURE__ */ new _ChatColor(
    "1",
    170
  );
  /**
   * Dark green color code. (2)
   */
  static DARK_GREEN = /* @__PURE__ */ new _ChatColor("2", 43520);
  /**
   * Dark aqua color code. (3)
   */
  static DARK_AQUA = /* @__PURE__ */ new _ChatColor(
    "3",
    43690
  );
  /**
   * Dark red color code. (4)
   */
  static DARK_RED = /* @__PURE__ */ new _ChatColor(
    "4",
    11141120
  );
  /**
   * Dark purple color code. (5)
   */
  static DARK_PURPLE = /* @__PURE__ */ new _ChatColor("5", 11141290);
  /**
   * Gold color code. (6)
   */
  static GOLD = /* @__PURE__ */ new _ChatColor(
    "6",
    16755200
  );
  /**
   * Gray color code. (7)
   */
  static GRAY = /* @__PURE__ */ new _ChatColor(
    "7",
    11184810
  );
  /**
   * Dark gray color code. (8)
   */
  static DARK_GRAY = /* @__PURE__ */ new _ChatColor(
    "8",
    5592405
  );
  /**
   * Blue color code. (9)
   */
  static BLUE = /* @__PURE__ */ new _ChatColor(
    "9",
    5592575
  );
  /**
   * Green color code. (a)
   */
  static GREEN = /* @__PURE__ */ new _ChatColor(
    "a",
    5635925
  );
  /**
   * Aqua color code. (b)
   */
  static AQUA = /* @__PURE__ */ new _ChatColor(
    "b",
    5636095
  );
  /**
   * Red color code. (c)
   */
  static RED = /* @__PURE__ */ new _ChatColor(
    "c",
    16733525
  );
  /**
   * Light purple color code. (d)
   */
  static LIGHT_PURPLE = /* @__PURE__ */ new _ChatColor("d", 16733695);
  /**
   * Yellow color code. (e)
   */
  static YELLOW = /* @__PURE__ */ new _ChatColor(
    "e",
    16777045
  );
  /**
   * White color code. (f)
   */
  static WHITE = /* @__PURE__ */ new _ChatColor(
    "f",
    16777215
  );
  /**
   * MineCoin gold color code. (g)
   */
  static MINECOIN_GOLD = /* @__PURE__ */ new _ChatColor("g", 14603781);
  /**
   * Material quartz color code. (h)
   */
  static MATERIAL_QUARTZ = /* @__PURE__ */ new _ChatColor("h", 14931153);
  /**
   * Material iron color code. (i)
   */
  static MATERIAL_IRON = /* @__PURE__ */ new _ChatColor("i", 13552330);
  /**
   * Material netherite color code. (j)
   */
  static MATERIAL_NETHERITE = /* @__PURE__ */ new _ChatColor("j", 4471355);
  /**
   * Material redstone color code. (m)
   */
  static MATERIAL_REDSTONE = /* @__PURE__ */ new _ChatColor("m", 9901575);
  /**
   * Material copper color code. (n)
   */
  static MATERIAL_COPPER = /* @__PURE__ */ new _ChatColor("n", 11823181);
  /**
   * Material gold color code. (p)
   */
  static MATERIAL_GOLD = /* @__PURE__ */ new _ChatColor("p", 14594349);
  /**
   * Material emerald color code. (q)
   */
  static MATERIAL_EMERALD = /* @__PURE__ */ new _ChatColor("q", 1155126);
  /**
   * Material diamond color code. (s)
   */
  static MATERIAL_DIAMOND = /* @__PURE__ */ new _ChatColor("s", 2931368);
  /**
   * Material lapis color code. (t)
   */
  static MATERIAL_LAPIS = /* @__PURE__ */ new _ChatColor("t", 2181499);
  /**
   * Material amethyst color code. (u)
   */
  static MATERIAL_AMETHYST = /* @__PURE__ */ new _ChatColor("u", 10116294);
  /**
   * Obfuscated color code. (k)
   */
  static OBFUSCATED = /* @__PURE__ */ new _ChatColor("k");
  /**
   * Bold color code. (l)
   */
  static BOLD = /* @__PURE__ */ new _ChatColor("l");
  /**
   * Italic color code. (o)
   */
  static ITALIC = /* @__PURE__ */ new _ChatColor(
    "o"
  );
  /**
   * Reset color code. (r)
   */
  static RESET = /* @__PURE__ */ new _ChatColor(
    "r"
  );
  /**
   * All available color codes.
   */
  static VALUES = [
    _ChatColor.BLACK,
    _ChatColor.DARK_BLUE,
    _ChatColor.DARK_GREEN,
    _ChatColor.DARK_AQUA,
    _ChatColor.DARK_RED,
    _ChatColor.DARK_PURPLE,
    _ChatColor.GOLD,
    _ChatColor.GRAY,
    _ChatColor.DARK_GRAY,
    _ChatColor.BLUE,
    _ChatColor.GREEN,
    _ChatColor.AQUA,
    _ChatColor.RED,
    _ChatColor.LIGHT_PURPLE,
    _ChatColor.YELLOW,
    _ChatColor.WHITE,
    _ChatColor.MINECOIN_GOLD,
    _ChatColor.MATERIAL_QUARTZ,
    _ChatColor.MATERIAL_IRON,
    _ChatColor.MATERIAL_NETHERITE,
    _ChatColor.MATERIAL_REDSTONE,
    _ChatColor.MATERIAL_COPPER,
    _ChatColor.MATERIAL_GOLD,
    _ChatColor.MATERIAL_EMERALD,
    _ChatColor.MATERIAL_DIAMOND,
    _ChatColor.MATERIAL_LAPIS,
    _ChatColor.MATERIAL_AMETHYST,
    _ChatColor.OBFUSCATED,
    _ChatColor.BOLD,
    _ChatColor.ITALIC,
    _ChatColor.RESET
  ];
  /**
   * All available color codes excluding the formatting codes.
   */
  static ALL_COLORS = [
    _ChatColor.BLACK,
    _ChatColor.DARK_BLUE,
    _ChatColor.DARK_GREEN,
    _ChatColor.DARK_AQUA,
    _ChatColor.DARK_RED,
    _ChatColor.DARK_PURPLE,
    _ChatColor.GOLD,
    _ChatColor.GRAY,
    _ChatColor.DARK_GRAY,
    _ChatColor.BLUE,
    _ChatColor.GREEN,
    _ChatColor.AQUA,
    _ChatColor.RED,
    _ChatColor.LIGHT_PURPLE,
    _ChatColor.YELLOW,
    _ChatColor.WHITE,
    _ChatColor.MINECOIN_GOLD,
    _ChatColor.MATERIAL_QUARTZ,
    _ChatColor.MATERIAL_IRON,
    _ChatColor.MATERIAL_NETHERITE,
    _ChatColor.MATERIAL_REDSTONE,
    _ChatColor.MATERIAL_COPPER,
    _ChatColor.MATERIAL_GOLD,
    _ChatColor.MATERIAL_EMERALD,
    _ChatColor.MATERIAL_DIAMOND,
    _ChatColor.MATERIAL_LAPIS,
    _ChatColor.MATERIAL_AMETHYST
  ];
  r;
  g;
  b;
  /**
   * PREFIX is the section sign (§) used in Minecraft color codes.
   */
  static PREFIX = "§";
  /**
   * Returns the string representation of the ChatColor instance,
   * which includes the PREFIX followed by the color code.
   * @returns A string representing the ChatColor instance
   */
  toString() {
    return _ChatColor.PREFIX + this.code;
  }
  /**
   * Returns the color code of the ChatColor instance.
   * @returns The color code of this ChatColor instance.
   */
  toRGB() {
    return this.color;
  }
  /**
   * Returns the hexadecimal string representation of the color code
   * @returns {string | undefined} The hexadecimal representation of the color.
   */
  toHex() {
    return this.color?.toString(16);
  }
  /**
   * Retrieve the value of the red component.
   *
   * @returns {number | undefined} The value of the red component, or undefined if it is not set.
   */
  getRed() {
    return this.r;
  }
  /**
   * Retrieves the green value of the current color.
   *
   * @returns {number | undefined} The green value of the color, or undefined if it is not set.
   */
  getGreen() {
    return this.g;
  }
  /**
   * Retrieves the blue value of a color.
   *
   * @returns The blue value of the color.
   * @type {number | undefined}
   */
  getBlue() {
    return this.b;
  }
  /**
   * Retrieves the format code associated with the chat color.
   *
   * @returns {string} The format code of the chat color.
   */
  getCode() {
    return this.code;
  }
  /**
   * Removes color codes from the specified string
   * @param str - The string from which color codes will be removed.
   * @returns The string cleared from color codes.
   */
  static stripColor(str) {
    return str.replace(/§[0-9a-u]/g, "");
  }
  /**
   * Finds the closest ChatColor code for the given RGB values
   * @param r - Red part of the color.
   * @param g - Green part of the color.
   * @param b - Blue part of the color.
   * @returns The closest ChatColor for the given RGB values.
   */
  static findClosestColor(r, g, b) {
    let minDistance = Number.MAX_VALUE;
    let closestColor = _ChatColor.WHITE;
    for (const color of _ChatColor.ALL_COLORS) {
      if (color.r && color.g && color.b) {
        const distance = Math.sqrt(
          Math.pow(color.r - r, 2) + Math.pow(color.g - g, 2) + Math.pow(color.b - b, 2)
        );
        if (distance < minDistance) {
          minDistance = distance;
          closestColor = color;
        }
      }
    }
    return closestColor;
  }
};
var ColorJSON = class _ColorJSON {
  // Tokens
  OpenObject = "{";
  CloseObject = "}";
  OpenArray = "[";
  CloseArray = "]";
  Comma = ",";
  KeyValueSeparator = ":";
  StringDelimiter = '"';
  KeyDelimiter = "";
  Indent = "  ";
  NewLine = "\n";
  Space = " ";
  // Threshold for inline representation
  InlineThreshold = 60;
  // Maximum depth to which objects will be traversed
  MaxDepth = 1;
  // Whether to include class names
  IncludeClassNames = true;
  // Values
  FunctionValue = "ƒ";
  NullValue = "null";
  UndefinedValue = "undefined";
  TrueValue = "true";
  FalseValue = "false";
  CycleValue = "[...cycle...]";
  TruncatedObjectValue = "{...}";
  // Colors
  OpenCloseObjectColor = ChatColor.YELLOW;
  OpenCloseArrayColor = ChatColor.AQUA;
  NumberColor = ChatColor.DARK_AQUA;
  StringColor = ChatColor.DARK_GREEN;
  BooleanColor = ChatColor.GOLD;
  NullColor = ChatColor.GOLD;
  KeyColor = ChatColor.GRAY;
  EscapeColor = ChatColor.GOLD;
  FunctionColor = ChatColor.GRAY;
  ClassColor = ChatColor.GRAY;
  ClassStyle = ChatColor.BOLD;
  CycleColor = ChatColor.DARK_RED;
  /**
   * The default ColorJSON instance
   */
  static DEFAULT = /* @__PURE__ */ new _ColorJSON();
  static createPlain() {
    const plain = new _ColorJSON();
    plain.OpenCloseObjectColor = "";
    plain.OpenCloseArrayColor = "";
    plain.NumberColor = "";
    plain.StringColor = "";
    plain.BooleanColor = "";
    plain.NullColor = "";
    plain.KeyColor = "";
    plain.EscapeColor = "";
    plain.FunctionColor = "";
    plain.ClassColor = "";
    plain.ClassStyle = "";
    plain.CycleColor = "";
    return plain;
  }
  /**
   * A ColorJSON instance that does not colorize anything.
   */
  static PLAIN = /* @__PURE__ */ this.createPlain();
  /**
   * Transforms a value into a chat-friendly, colored JSON representation.
   * @param value - The value to transform.
   */
  stringify(value) {
    return this.stringifyValue(value, {
      indentLevel: 0,
      visited: /* @__PURE__ */ new WeakSet()
    });
  }
  /**
   * Transforms a string into a JSON representation.
   * @param value - The string to transform.
   */
  stringifyString(value) {
    return this.StringColor + this.StringDelimiter + this.escapeString(value) + this.StringDelimiter + ChatColor.RESET;
  }
  /**
   * Transforms a number into a JSON representation.
   * @param value - The number to transform.
   */
  stringifyNumber(value) {
    return this.NumberColor + value.toString() + ChatColor.RESET;
  }
  /**
   * Transforms a boolean into a JSON representation.
   * @param value - The boolean to transform.
   */
  stringifyBoolean(value) {
    return this.BooleanColor + (value ? this.TrueValue : this.FalseValue) + ChatColor.RESET;
  }
  /**
   * Transforms a function into a JSON representation.
   * @param value - The function to transform.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  stringifyFunction(value) {
    return this.FunctionColor + this.FunctionValue + ChatColor.RESET;
  }
  /**
   * Returns a null JSON representation.
   */
  stringifyNull() {
    return this.NullColor + this.NullValue + ChatColor.RESET;
  }
  /**
   * Returns an undefined JSON representation.
   */
  stringifyUndefined() {
    return this.NullColor + this.UndefinedValue + ChatColor.RESET;
  }
  /**
   * Returns a cycle JSON representation.
   */
  stringifyCycle() {
    return this.CycleColor + this.CycleValue + ChatColor.RESET;
  }
  /**
   * Transforms an array into a JSON representation.
   * @param value - The array to transform.
   * @param indentLevel - The indentation level for pretty-printing.
   */
  stringifyArray(value, ctx) {
    const indentSpace = this.Indent.repeat(ctx.indentLevel);
    if (value.length === 0) {
      return this.OpenCloseArrayColor + this.OpenArray + this.CloseArray + ChatColor.RESET;
    }
    let result = this.OpenCloseArrayColor + this.OpenArray + ChatColor.RESET + this.NewLine;
    let compactResult = this.OpenCloseArrayColor + this.OpenArray + ChatColor.RESET;
    value.forEach((item, index) => {
      result += indentSpace + this.Indent + this.stringifyValue(item, this.indent(ctx));
      result += index < value.length - 1 ? this.Comma + this.NewLine : this.NewLine;
      compactResult += this.stringifyValue(item, this.indent(ctx));
      compactResult += index < value.length - 1 ? this.Comma + this.Space : "";
    });
    result += indentSpace + this.OpenCloseArrayColor + this.CloseArray + ChatColor.RESET;
    compactResult += this.OpenCloseArrayColor + this.CloseArray + ChatColor.RESET;
    if (compactResult.length < this.InlineThreshold) {
      return compactResult;
    }
    return result;
  }
  /**
   * Transforms an object into a truncated JSON representation.
   * @param value - The object to transform.
   * @param className - Class Name of the object.
   * @param indentLevel - The indentation level for pretty-printing.
   */
  stringifyTruncatedObject(value, className, ctx) {
    return (this.IncludeClassNames ? this.ClassColor + "" + this.ClassStyle + className + ChatColor.RESET + this.Space : "") + this.TruncatedObjectValue;
  }
  /**
   * Transforms an object into a JSON representation.
   * @param value - The object to transform.
   * @param className - Class Name of the object.
   * @param entries - Entries of the object to transform.
   * @param indentLevel - The indentation level for pretty-printing.
   */
  stringifyObject(value, className, entries, ctx) {
    const indentSpace = this.Indent.repeat(ctx.indentLevel);
    const prefix = this.IncludeClassNames && className !== "Object" ? this.ClassColor + "" + this.ClassStyle + className + ChatColor.RESET + this.Space : "";
    if (entries.length === 0) {
      return prefix + this.OpenCloseObjectColor + this.OpenObject + this.CloseObject + ChatColor.RESET;
    }
    let result = prefix + this.OpenCloseObjectColor + this.OpenObject + ChatColor.RESET + this.NewLine;
    let compactResult = prefix + this.OpenCloseObjectColor + this.OpenObject + ChatColor.RESET;
    entries.forEach(([key, val], index) => {
      const compactVal = this.stringifyValue(val, this.indent(ctx));
      result += indentSpace + this.Indent + this.KeyColor + this.KeyDelimiter + key + this.KeyDelimiter + ChatColor.RESET + this.KeyValueSeparator + this.Space + compactVal;
      result += index < entries.length - 1 ? this.Comma + this.NewLine : this.NewLine;
      compactResult += this.KeyColor + key + ChatColor.RESET + this.KeyValueSeparator + this.Space + compactVal;
      compactResult += index < entries.length - 1 ? this.Comma + this.Space : "";
    });
    result += indentSpace + this.OpenCloseObjectColor + this.CloseObject + ChatColor.RESET;
    compactResult += this.OpenCloseObjectColor + this.CloseObject + ChatColor.RESET;
    if (compactResult.length < this.InlineThreshold) {
      return compactResult;
    }
    return result;
  }
  shouldTruncateObject(value, className, ctx) {
    return !(className === "Object" || ctx.indentLevel <= this.MaxDepth || this.MaxDepth <= 0);
  }
  /**
   * Transforms a value of any type into a JSON representation. This function is not meant to be overridden.
   * @param value - The value to transform.
   * @param indentLevel - The indentation level for pretty-printing.
   */
  stringifyValue(value, ctx) {
    if (value === null)
      return this.stringifyNull();
    if (value === void 0)
      return this.stringifyUndefined();
    if (typeof value === "number")
      return this.stringifyNumber(value);
    if (typeof value === "string")
      return this.stringifyString(value);
    if (typeof value === "boolean")
      return this.stringifyBoolean(value);
    if (typeof value === "function")
      return this.stringifyFunction(value);
    if (this.isCycle(value, ctx)) {
      return this.stringifyCycle();
    }
    this.markCycle(value, ctx);
    if (Array.isArray(value)) {
      const result = this.stringifyArray(
        value,
        ctx.indentLevel ? this.indent(ctx) : ctx
      );
      this.clearCycle(value, ctx);
      return result;
    }
    if (typeof value === "object") {
      const name = value.constructor.name;
      if (!this.shouldTruncateObject(value, name, ctx)) {
        const keySet = /* @__PURE__ */ new Set();
        let prototype = Object.getPrototypeOf(value);
        let keys = Object.keys(prototype);
        while (keys.length > 0) {
          keys.forEach((key) => keySet.add(key));
          prototype = Object.getPrototypeOf(prototype);
          keys = Object.keys(prototype);
        }
        Object.keys(value).forEach((key) => keySet.add(key));
        keySet.delete("__cycleDetection__");
        const allKeys = [...keySet].sort();
        const entries = allKeys.map((key) => {
          try {
            return [key, value[key] ?? void 0];
          } catch (e) {
            return [key, void 0];
          }
        }).filter(
          ([, val]) => typeof val !== "function" && val !== void 0
        );
        const result = this.stringifyObject(value, name, entries, ctx);
        this.clearCycle(value, ctx);
        return result;
      } else {
        const result = this.stringifyTruncatedObject(value, name, ctx);
        this.clearCycle(value, ctx);
        return result;
      }
    }
    this.clearCycle(value, ctx);
    return ChatColor.RESET + value.toString();
  }
  /**
   * Escapes a string for JSON.
   * @param str - The string to escape.
   */
  escapeString(str) {
    return str.replace(/\\/g, this.EscapeColor + "\\\\" + this.StringColor).replace(/"/g, this.EscapeColor + '\\"' + this.StringColor).replace(/\n/g, this.EscapeColor + "\\n" + this.StringColor).replace(/\r/g, this.EscapeColor + "\\r" + this.StringColor).replace(/\t/g, this.EscapeColor + "\\t" + this.StringColor);
  }
  markCycle(value, ctx) {
    ctx.visited.add(value);
  }
  isCycle(value, ctx) {
    return ctx.visited.has(value);
  }
  clearCycle(value, ctx) {
    ctx.visited.delete(value);
  }
  indent(ctx) {
    return { ...ctx, indentLevel: ctx.indentLevel + 1 };
  }
};
var sourceMapping = void 0;
try {
  sourceMapping = globalSourceMapping;
} catch (e) {
}
var LogLevel = class _LogLevel {
  /**
   * The constructor for each log level.
   *
   * @param {number} level - The numerical level for this logger.
   * @param {string} name - The string name for this logger.
   * @param {ChatColor} color - The color to use for this logger. Defaults to `ChatColor.RESET`.
   */
  constructor(level, name, color = ChatColor.RESET) {
    this.level = level;
    this.name = name;
    this.color = color;
  }
  static All = /* @__PURE__ */ new _LogLevel(-2, "all");
  static Trace = /* @__PURE__ */ new _LogLevel(
    -2,
    "trace",
    ChatColor.DARK_AQUA
  );
  static Debug = /* @__PURE__ */ new _LogLevel(
    -1,
    "debug",
    ChatColor.AQUA
  );
  static Info = /* @__PURE__ */ new _LogLevel(
    0,
    "info",
    ChatColor.GREEN
  );
  static Warn = /* @__PURE__ */ new _LogLevel(
    1,
    "warn",
    ChatColor.GOLD
  );
  static Error = /* @__PURE__ */ new _LogLevel(
    2,
    "error",
    ChatColor.RED
  );
  static Fatal = /* @__PURE__ */ new _LogLevel(
    3,
    "fatal",
    ChatColor.DARK_RED
  );
  static Off = /* @__PURE__ */ new _LogLevel(100, "off");
  /**
   * The list of all available log levels.
   */
  static values = [
    _LogLevel.All,
    _LogLevel.Trace,
    _LogLevel.Debug,
    _LogLevel.Info,
    _LogLevel.Warn,
    _LogLevel.Error,
    _LogLevel.Fatal,
    _LogLevel.Off
  ];
  /**
   * Return the logging level as a string.
   *
   * @returns {string} The string representation of the logging level.
   */
  toString() {
    return this.color + this.name.toUpperCase() + ChatColor.RESET;
  }
  /**
   * Parse a string to get the corresponding `LogLevel`.
   *
   * @param {string} str - The string to parse.
   * @returns {LogLevel} The corresponding `LogLevel`, or `undefined` if none was found.
   */
  static parse(str) {
    str = str.toLowerCase();
    for (const level of _LogLevel.values) {
      if (level.name === str)
        return level;
    }
    const num = parseInt(str);
    if (!isNaN(num)) {
      for (const level of _LogLevel.values) {
        if (level.level === num)
          return level;
      }
    }
    return void 0;
  }
};
function starMatch(pattern, str) {
  if (pattern === "*")
    return true;
  if (pattern.includes("*")) {
    if (pattern.startsWith("*")) {
      return str.endsWith(pattern.substring(1));
    }
    if (pattern.endsWith("*")) {
      return str.startsWith(pattern.substring(0, pattern.length - 1));
    }
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return regex.test(str);
  }
  return pattern === str;
}
var loggingSettings = {
  level: LogLevel.Info,
  filter: ["*"],
  outputTags: false,
  timestampFormatter: (timestamp) => {
    return "";
  },
  formatFunction: (level, logger, message, timestamp, tags = void 0) => {
    const _tags = tags !== void 0 ? `§7${tags.map((tag) => `[${tag}]`).join("")}§r` : "";
    const time = timestamp ? `[${timestamp}]` : "";
    return `${time}[${level}][${ChatColor.MATERIAL_EMERALD}${logger.name}${ChatColor.RESET}]${_tags} ${message}`;
  },
  messagesJoinFunction: (messages) => {
    return messages.join(" ");
  },
  jsonFormatter: ColorJSON.DEFAULT,
  outputConfig: {
    [LogLevel.Trace.level]: [
      0,
      1
      /* ConsoleInfo */
    ],
    [LogLevel.Debug.level]: [
      0,
      1
      /* ConsoleInfo */
    ],
    [LogLevel.Info.level]: [
      0,
      1
      /* ConsoleInfo */
    ],
    [LogLevel.Warn.level]: [
      0,
      1,
      2
      /* ConsoleWarn */
    ],
    [LogLevel.Error.level]: [
      0,
      1,
      3
      /* ConsoleError */
    ],
    [LogLevel.Fatal.level]: [
      0,
      1,
      3
      /* ConsoleError */
    ]
  }
};
var Logger = class _Logger {
  /**
   * Construct a new Logger
   *
   * @param {string} name - The name of the Logger.
   * @param {string[]} tags - The tags for the logger as strings.
   */
  constructor(name, tags = []) {
    this.name = name;
    this.tags = tags;
  }
  static initialized = false;
  /**
   *  Initialize logger class
   */
  static init() {
    LOGGING: {
      if (_Logger.initialized)
        return;
      _Logger.initialized = true;
      system2.beforeEvents.startup.subscribe(() => {
        system2.afterEvents.scriptEventReceive.subscribe((ev) => {
          if (ev.id === "logging:level" || ev.id === "log:level") {
            if (!ev.message) {
              loggingSettings.level = LogLevel.Info;
              world2.sendMessage(
                `${ChatColor.AQUA}Logging level set to ${ChatColor.BOLD}${loggingSettings.level}`
              );
            } else {
              const level = LogLevel.parse(ev.message);
              if (level) {
                loggingSettings.level = level;
                world2.sendMessage(
                  `${ChatColor.AQUA}Logging level set to ${ChatColor.BOLD}${loggingSettings.level}`
                );
              } else {
                world2.sendMessage(
                  `${ChatColor.DARK_RED}Invalid logging level: ${ev.message}`
                );
              }
            }
          } else if (ev.id === "logging:filter" || ev.id === "log:filter") {
            if (!ev.message) {
              loggingSettings.filter = ["*"];
            } else {
              loggingSettings.filter = ev.message.split(",");
            }
            world2.sendMessage(
              `${ChatColor.AQUA}Logging filter set to ${ChatColor.BOLD}${loggingSettings.filter.join(", ")}`
            );
          }
        });
      });
    }
  }
  /**
   * @param {LogLevel} level - The level to set.
   */
  static setLevel(level) {
    loggingSettings.level = level;
  }
  /**
   * Filter the loggers by the given tags. Tags can use the `*` wildcard.
   * @param {'*' | string[]} filter - The filter to set.
   */
  static setFilter(filter) {
    loggingSettings.filter = filter;
  }
  /**
   * Set the format function for the logger.
   * @param {function} func - The function to set.
   */
  static setFormatFunction(func) {
    loggingSettings.formatFunction = func;
  }
  /**
   * Set the function, that joins multiple messages into one for the logger.
   * @param {function} func - The function to set.
   */
  static setMessagesJoinFunction(func) {
    loggingSettings.messagesJoinFunction = func;
  }
  /**
   * Set the tag visibility for the logger. When true, tags will be printed in the log. Disabled by default.
   * @param visible
   */
  static setTagsOutputVisibility(visible) {
    loggingSettings.outputTags = visible;
  }
  /**
   * Set the timestamp formatter for the logger.
   * @param formatter - The function used to format the timestamp.
   */
  static setTimestampFormatter(formatter) {
    loggingSettings.timestampFormatter = formatter;
  }
  /**
   * Set the basic timestamp formatter for the logger in HH:mm:ss.SS format.
   */
  static setBasicTimestampFormatter() {
    loggingSettings.timestampFormatter = (timestamp) => {
      const hours = timestamp.getHours().toString().padStart(2, "0");
      const minutes = timestamp.getMinutes().toString().padStart(2, "0");
      const seconds = timestamp.getSeconds().toString().padStart(2, "0");
      const centiseconds = Math.floor(timestamp.getMilliseconds() / 10).toString().padStart(2, "0");
      return `${hours}:${minutes}:${seconds}.${centiseconds}`;
    };
  }
  /**
   * Set the JSON formatter for the logger.
   * @param {ColorJSON} formatter - The json formatter to set.
   */
  static setJsonFormatter(formatter) {
    loggingSettings.jsonFormatter = formatter;
  }
  /**
   * Get the output configuration for the logger.
   * @returns {OutputConfig} The output configuration.
   */
  static getOutputConfig() {
    return loggingSettings.outputConfig;
  }
  /**
   * Returns a new Logger.
   *
   * @param {string} name - The name of the Logger.
   * @param {string[]} tags - The tags for the Logger as strings.
   *
   * @returns {Logger} A new Logger.
   */
  static getLogger(name, ...tags) {
    LOGGING: {
      if (!_Logger.initialized) {
        _Logger.init();
      }
    }
    return new _Logger(name, tags);
  }
  /**
   * Log messages with the level set.
   *
   * @param {LogLevel} level - The LogLevel to log the messages at.
   * @param {array} message - An array of the messages to log.
   */
  log(level, ...message) {
    LOGGING: {
      if (level.level < loggingSettings.level.level)
        return;
      if (loggingSettings.filter.length === 0 || this.tags.length === 0) {
        this.logRaw(level, ...message);
        return;
      }
      for (const filter of loggingSettings.filter) {
        if (filter.startsWith("!")) {
          if (starMatch(filter.substring(1), this.name) || this.tags.some(
            (tag) => starMatch(filter.substring(1), tag)
          )) {
            return;
          }
        }
        if (starMatch(filter, this.name) || this.tags.some((tag) => starMatch(filter, tag))) {
          this.logRaw(level, ...message);
          return;
        }
      }
    }
  }
  stringifyError(x) {
    let stack = x.stack ?? "";
    if (sourceMapping) {
      const stackLineRegex = /\(([^)]+\.js):(\d+)(?::(\d+))?\)/;
      stack = stack.split("\n").map((line) => {
        const match = stackLineRegex.exec(line);
        if (match) {
          const filePath = match[1];
          const lineNumber = parseInt(match[2], 10) - sourceMapping.metadata.offset;
          if (filePath.includes(sourceMapping.metadata.filePath)) {
            const mappingEntry = globalSourceMapping[lineNumber];
            if (mappingEntry) {
              const replacement = `(${mappingEntry.source}:${mappingEntry.originalLine})`;
              return line.replace(
                stackLineRegex,
                replacement
              );
            }
          }
        }
        return line;
      }).join("\n");
    }
    return `${ChatColor.DARK_RED}${ChatColor.BOLD}${x.message}
${ChatColor.RESET}${ChatColor.GRAY}${ChatColor.ITALIC}${stack}${ChatColor.RESET}`;
  }
  /**
   * Internal function to log messages with the level set, that bypasses the filters.
   *
   * @param {LogLevel} level - The LogLevel to log the messages at.
   * @param {array} message - An array of the messages to log.
   */
  logRaw(level, ...message) {
    LOGGING: {
      const msgs = message.map((x) => {
        if (x === void 0) {
          return ChatColor.GOLD + "undefined" + ChatColor.RESET;
        }
        if (x === null) {
          return ChatColor.GOLD + "null" + ChatColor.RESET;
        }
        if (x && x instanceof Error) {
          return this.stringifyError(x);
        }
        if (typeof x === "object" || Array.isArray(x)) {
          return loggingSettings.jsonFormatter.stringify(x) + ChatColor.RESET;
        }
        return x.toString() + ChatColor.RESET;
      });
      const now = /* @__PURE__ */ new Date();
      const formattedTimestamp = loggingSettings.timestampFormatter(now);
      const formatted = loggingSettings.formatFunction(
        level,
        this,
        loggingSettings.messagesJoinFunction(msgs),
        formattedTimestamp,
        loggingSettings.outputTags ? this.tags : void 0
      );
      const outputs = loggingSettings.outputConfig[level.level] || [
        0,
        1
        /* ConsoleInfo */
      ];
      if (outputs.includes(
        0
        /* Chat */
      )) {
        try {
          world2.sendMessage(formatted);
        } catch (_) {
          system2.run(() => {
            world2.sendMessage(formatted);
          });
        }
      }
      if (outputs.includes(
        1
        /* ConsoleInfo */
      )) {
        if (console.originalLog) {
          console.originalLog(
            ChatColor.stripColor(formatted)
          );
        } else {
          console.log(ChatColor.stripColor(formatted));
        }
      }
      if (outputs.includes(
        2
        /* ConsoleWarn */
      )) {
        console.warn(formatted);
      }
      if (outputs.includes(
        3
        /* ConsoleError */
      )) {
        console.error(formatted);
      }
    }
  }
  /**
   * Logs a trace message.
   *
   * @param {...unknown} message - The message(s) to be logged.
   */
  trace(...message) {
    LOGGING:
      this.log(LogLevel.Trace, ...message);
  }
  /**
   * Logs debug message.
   *
   * @param {...unknown[]} message - The message(s) to be logged.
   */
  debug(...message) {
    LOGGING:
      this.log(LogLevel.Debug, ...message);
  }
  /**
   * Logs an informational message.
   *
   * @param {...unknown[]} message - The message(s) to be logged.
   */
  info(...message) {
    LOGGING:
      this.log(LogLevel.Info, ...message);
  }
  /**
   * Logs a warning message.
   *
   * @param {...unknown[]} message - The warning message or messages to be logged.
   */
  warn(...message) {
    LOGGING:
      this.log(LogLevel.Warn, ...message);
  }
  /**
   * Logs an error message.
   *
   * @param {...unknown[]} message - The error message(s) to log.
   */
  error(...message) {
    LOGGING:
      this.log(LogLevel.Error, ...message);
  }
  /**
   * Logs a fatal error.
   *
   * @param {unknown[]} message - The error message to log.
   */
  fatal(...message) {
    LOGGING:
      this.log(LogLevel.Fatal, ...message);
  }
};
var DIRECTION_VECTORS2 = {
  [Direction2.Down]: [0, -1, 0],
  [Direction2.Up]: [0, 1, 0],
  [Direction2.North]: [0, 0, -1],
  [Direction2.South]: [0, 0, 1],
  [Direction2.East]: [1, 0, 0],
  [Direction2.West]: [-1, 0, 0]
};
var Vec3 = class _Vec3 {
  static log = /* @__PURE__ */ Logger.getLogger(
    "vec3",
    "vec3",
    "bedrock-boost"
  );
  /**
   * Zero vector
   */
  static Zero = /* @__PURE__ */ new _Vec3(0, 0, 0);
  /**
   * Down vector, negative towards Y
   */
  static Down = /* @__PURE__ */ new _Vec3(Direction2.Down);
  /**
   * Up vector, positive towards Y
   */
  static Up = /* @__PURE__ */ new _Vec3(Direction2.Up);
  /**
   * North vector, negative towards Z
   */
  static North = /* @__PURE__ */ new _Vec3(Direction2.North);
  /**
   * South vector, positive towards Z
   */
  static South = /* @__PURE__ */ new _Vec3(Direction2.South);
  /**
   * East vector, positive towards X
   */
  static East = /* @__PURE__ */ new _Vec3(Direction2.East);
  /**
   * West vector, negative towards X
   */
  static West = /* @__PURE__ */ new _Vec3(Direction2.West);
  x;
  y;
  z;
  constructor(x, y, z) {
    if (typeof x === "number") {
      this.x = x;
      this.y = y;
      this.z = z;
    } else if (x instanceof _Vec3) {
      this.x = x.x;
      this.y = x.y;
      this.z = x.z;
    } else if (typeof x === "string") {
      const direction = DIRECTION_VECTORS2[x];
      if (!direction) {
        _Vec3.log.error(new Error("Invalid vector"), x);
        throw new Error("Invalid vector");
      }
      this.x = direction[0];
      this.y = direction[1];
      this.z = direction[2];
    } else if (Array.isArray(x)) {
      this.x = x[0];
      this.y = x[1];
      this.z = x[2];
    } else {
      if (!x || !x.x && x.x !== 0 || !x.y && x.y !== 0 || !x.z && x.z !== 0) {
        _Vec3.log.error(new Error("Invalid vector"), x);
        throw new Error("Invalid vector");
      }
      this.x = x.x;
      this.y = x.y;
      this.z = x.z;
    }
  }
  static from(x, y, z) {
    if (typeof x === "number") {
      if (y !== void 0 && z !== void 0)
        return new _Vec3(x, y, z);
    } else if (x instanceof _Vec3) {
      return x;
    } else if (typeof x === "string") {
      const direction = _Vec3.fromDirection(x);
      if (direction)
        return direction;
    } else if (x) {
      return new _Vec3(x);
    }
    _Vec3.log.error(new Error("Invalid arguments"), x, y, z);
    throw new Error("Invalid arguments");
  }
  /**
   * Returns the shared constant vector for the given direction, or undefined.
   */
  static fromDirection(direction) {
    switch (direction) {
      case Direction2.Down:
        return _Vec3.Down;
      case Direction2.Up:
        return _Vec3.Up;
      case Direction2.North:
        return _Vec3.North;
      case Direction2.South:
        return _Vec3.South;
      case Direction2.East:
        return _Vec3.East;
      case Direction2.West:
        return _Vec3.West;
    }
    return void 0;
  }
  static _from(x, y, z) {
    if (typeof x === "number") {
      if (y === void 0 && z === void 0)
        return new _Vec3(x, x, x);
      if (y !== void 0 && z !== void 0)
        return new _Vec3(x, y, z);
    } else if (x instanceof _Vec3) {
      return x;
    } else if (typeof x === "string") {
      const direction = _Vec3.fromDirection(x);
      if (direction)
        return direction;
    } else if (x) {
      return new _Vec3(x);
    }
    _Vec3.log.error(new Error("Invalid arguments"), x, y, z);
    throw new Error("Invalid arguments");
  }
  /**
   * Creates a copy of the current vector.
   *
   * @returns A new vector with the same values as the current vector.
   */
  copy() {
    return new _Vec3(this.x, this.y, this.z);
  }
  /**
   * Adds a vector to the current vector. Unlike `add`, this method takes only
   * a vector and skips the argument dispatch, which makes it the faster choice in
   * code that runs every tick.
   *
   * @param v - The vector to be added.
   * @returns The resulting vector.
   */
  addVec(v) {
    return new _Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  /**
   * Subtracts a vector from the current vector. Fast-path variant of `subtract`.
   *
   * @param v - The vector to be subtracted.
   * @returns The resulting vector.
   */
  subtractVec(v) {
    return new _Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  /**
   * Multiplies the current vector component-wise by a vector. Fast-path variant
   * of `multiply`; use `scale` for scalars.
   *
   * @param v - The vector multiplier.
   * @returns The resulting vector.
   */
  multiplyVec(v) {
    return new _Vec3(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  /**
   * Divides the current vector component-wise by a vector. Fast-path variant of
   * `divide`.
   *
   * @param v - The vector divisor.
   * @returns The resulting vector.
   * @throws If any component of the divisor is zero.
   */
  divideVec(v) {
    if (v.x === 0 || v.y === 0 || v.z === 0)
      throw new Error("Cannot divide by zero");
    return new _Vec3(this.x / v.x, this.y / v.y, this.z / v.z);
  }
  /**
   * Computes the dot product with a vector. Fast-path variant of `dot`.
   *
   * @param v - The other vector.
   * @returns The dot product.
   */
  dotVec(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  /**
   * Computes the cross product with a vector. Fast-path variant of `cross`.
   *
   * @param v - The other vector.
   * @returns The cross product.
   */
  crossVec(v) {
    return new _Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  /**
   * Computes the distance to a vector. Fast-path variant of `distance`.
   *
   * @param v - The other vector.
   * @returns The distance between the vectors.
   */
  distanceVec(v) {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  /**
   * Computes the squared distance to a vector. Fast-path variant of
   * `distanceSquared`.
   *
   * @param v - The other vector.
   * @returns The squared distance between the vectors.
   */
  distanceSquaredVec(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  /**
   * Converts this immutable vector to a new mutable vector.
   */
  toMutable() {
    return new MutVec3(this.x, this.y, this.z);
  }
  static fromRotation(yawOrRotation, pitch) {
    let yaw;
    if (typeof yawOrRotation === "number") {
      yaw = yawOrRotation;
      pitch = pitch;
    } else {
      yaw = yawOrRotation.y;
      pitch = yawOrRotation.x;
    }
    const psi = yaw * (Math.PI / 180);
    const theta = pitch * (Math.PI / 180);
    const x = -Math.cos(theta) * Math.sin(psi);
    const y = -Math.sin(theta);
    const z = Math.cos(theta) * Math.cos(psi);
    return new _Vec3(x, y, z);
  }
  /**
   * Converts the normal vector to yaw and pitch values.
   *
   * @returns A Vector2 containing the yaw and pitch values.
   */
  toRotation() {
    if (this.isZero()) {
      _Vec3.log.error(
        new Error("Cannot convert zero-length vector to direction")
      );
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const direction = this.normalize();
    const yaw = -Math.atan2(direction.x, direction.z) * (180 / Math.PI);
    const pitch = Math.asin(-direction.y) * (180 / Math.PI);
    return {
      x: pitch,
      y: yaw
    };
  }
  add(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return new _Vec3(v.x + this.x, v.y + this.y, v.z + this.z);
  }
  directionTo(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return v.subtract(this).normalize();
  }
  subtract(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return new _Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  multiply(x, y, z) {
    if (typeof x === "number" && y === void 0 && z === void 0) {
      return new _Vec3(this.x * x, this.y * x, this.z * x);
    }
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return new _Vec3(v.x * this.x, v.y * this.y, v.z * this.z);
  }
  /**
   * Scales the current vector by a scalar.
   *
   * @param scalar - The scalar to scale the vector by.
   * @returns The updated vector after scaling.
   */
  scale(scalar) {
    return new _Vec3(this.x * scalar, this.y * scalar, this.z * scalar);
  }
  divide(x, y, z) {
    if (typeof x === "number" && y === void 0 && z === void 0) {
      if (x === 0)
        throw new Error("Cannot divide by zero");
      return new _Vec3(this.x / x, this.y / x, this.z / x);
    }
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    if (v.x === 0 || v.y === 0 || v.z === 0)
      throw new Error("Cannot divide by zero");
    return new _Vec3(this.x / v.x, this.y / v.y, this.z / v.z);
  }
  /**
   * Normalizes the vector to have a length (magnitude) of 1.
   * Normalized vectors are often used as a direction vectors.
   *
   * @returns The normalized vector.
   */
  normalize() {
    if (this.isZero()) {
      _Vec3.log.error(new Error("Cannot normalize zero-length vector"));
      throw new Error("Cannot normalize zero-length vector");
    }
    const len = this.length();
    return new _Vec3(this.x / len, this.y / len, this.z / len);
  }
  /**
   * Computes the length (magnitude) of the vector.
   *
   * @returns The length of the vector.
   */
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  /**
   * Computes the squared length of the vector.
   * This is faster than computing the actual length and can be useful for comparison purposes.
   *
   * @returns The squared length of the vector.
   */
  lengthSquared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  cross(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return _Vec3.from(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  distance(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  distanceSquared(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  /**
   * Computes the linear interpolation between the current vector and another vector, when t is in the range [0, 1].
   * Computes the extrapolation when t is outside this range.
   *
   * @param v - The other vector.
   * @param t - The interpolation factor.
   * @returns A new vector after performing the lerp operation.
   */
  lerp(v, t) {
    if (!v || !t)
      return _Vec3.from(this);
    if (t === 1)
      return _Vec3.from(v);
    if (t === 0)
      return _Vec3.from(this);
    return _Vec3.from(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }
  /**
   * Computes the spherical linear interpolation between the current vector and another vector, when t is in the range [0, 1].
   * Computes the extrapolation when t is outside this range.
   *
   * @param v - The other vector.
   * @param t - The interpolation factor.
   * @returns A new vector after performing the slerp operation.
   */
  slerp(v, t) {
    if (!v || !t)
      return _Vec3.from(this);
    if (t === 1)
      return _Vec3.from(v);
    if (t === 0)
      return _Vec3.from(this);
    const dot = this.dot(v);
    const theta = Math.acos(dot) * t;
    const relative = _Vec3.from(v).subtract(this.multiply(dot)).normalize();
    return this.multiply(Math.cos(theta)).add(
      relative.multiply(Math.sin(theta))
    );
  }
  dot(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  angleBetween(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    const dotProduct = this.dot(v);
    const lenSq1 = this.lengthSquared();
    if (lenSq1 === 0) {
      return 0;
    }
    const lenSq2 = v.lengthSquared();
    if (lenSq2 === 0) {
      return 0;
    }
    const denom = Math.sqrt(lenSq1 * lenSq2);
    const cosAngle = Math.min(1, Math.max(-1, dotProduct / denom));
    return Math.acos(cosAngle);
  }
  projectOnto(x, y, z) {
    const v = x instanceof _Vec3 ? x : _Vec3._from(x, y, z);
    if (v.isZero()) {
      return _Vec3.Zero;
    }
    const denom = v.dot(v);
    if (denom === 0) {
      return _Vec3.Zero;
    }
    const scale = this.dot(v) / denom;
    return new _Vec3(v.x * scale, v.y * scale, v.z * scale);
  }
  reflect(x, y, z) {
    const normal = _Vec3._from(x, y, z);
    const proj = this.projectOnto(normal);
    return this.subtract(proj.multiply(2));
  }
  /**
   * Rotates the current normalized vector by a given angle around a given axis.
   *
   * @param axis - The axis of rotation.
   * @param angle - The angle of rotation in degrees.
   * @returns The rotated vector.
   */
  rotate(axis, angle) {
    const halfAngle = angle * Math.PI / 180 / 2;
    const w = Math.cos(halfAngle);
    const x = axis.x * Math.sin(halfAngle);
    const y = axis.y * Math.sin(halfAngle);
    const z = axis.z * Math.sin(halfAngle);
    const v = this;
    const qv_x = w * w * v.x + 2 * y * w * v.z - 2 * z * w * v.y + x * x * v.x + 2 * y * x * v.y + 2 * z * x * v.z - z * z * v.x - y * y * v.x;
    const qv_y = 2 * x * y * v.x + y * y * v.y + 2 * z * y * v.z + 2 * w * z * v.x - z * z * v.y + w * w * v.y - 2 * x * w * v.z - x * x * v.y;
    const qv_z = 2 * x * z * v.x + 2 * y * z * v.y + z * z * v.z - 2 * w * y * v.x - y * y * v.z + 2 * w * x * v.y - x * x * v.z + w * w * v.z;
    return new _Vec3(qv_x, qv_y, qv_z);
  }
  /**
   * Updates the X, Y, and Z components of the vector.
   *
   * @param x - The function to use to update the X value.
   * @param y - The function to use to update the Y value.
   * @param z - The function to use to update the Z value.
   * @returns The updated vector with the new values.
   */
  update(x, y, z) {
    if (!x) {
      x = (value) => value;
    }
    if (!y) {
      y = (value) => value;
    }
    if (!z) {
      z = (value) => value;
    }
    return new _Vec3(x(this.x), y(this.y), z(this.z));
  }
  setX(value) {
    if (typeof value === "number") {
      return new _Vec3(value, this.y, this.z);
    }
    return new _Vec3(value(this.x), this.y, this.z);
  }
  setY(value) {
    if (typeof value === "number") {
      return new _Vec3(this.x, value, this.z);
    }
    return new _Vec3(this.x, value(this.y), this.z);
  }
  setZ(value) {
    if (typeof value === "number") {
      return new _Vec3(this.x, this.y, value);
    }
    return new _Vec3(this.x, this.y, value(this.z));
  }
  /**
   * Calculates the shortest distance between a point (represented by this Vector3 instance) and a line segment.
   *
   * This method finds the perpendicular projection of the point onto the line defined by the segment. If this
   * projection lies outside the line segment, then the method calculates the distance from the point to the
   * nearest segment endpoint.
   *
   * @param start - The starting point of the line segment.
   * @param end - The ending point of the line segment.
   * @returns The shortest distance between the point and the line segment.
   */
  distanceToLineSegment(start, end) {
    const lineDirection = _Vec3.from(end).subtract(start);
    if (lineDirection.lengthSquared() === 0) {
      return this.subtract(start).length();
    }
    const t = Math.max(
      0,
      Math.min(
        1,
        this.subtract(start).dot(lineDirection) / lineDirection.dot(lineDirection)
      )
    );
    const projection = _Vec3.from(start).add(lineDirection.multiply(t));
    return this.subtract(projection).length();
  }
  /**
   * Floors the X, Y, and Z components of the vector.
   * @returns A new vector with the floored components.
   */
  floor() {
    return this.update(Math.floor, Math.floor, Math.floor);
  }
  /**
   * Floors the X component of the vector.
   * @returns A new vector with the floored X component.
   */
  floorX() {
    return this.setX(Math.floor);
  }
  /**
   * Floors the Y component of the vector.
   * @returns A new vector with the floored Y component.
   */
  floorY() {
    return this.setY(Math.floor);
  }
  /**
   * Floors the Z component of the vector.
   * @returns A new vector with the floored Z component.
   */
  floorZ() {
    return this.setZ(Math.floor);
  }
  /**
   * Ceils the X, Y, and Z components of the vector.
   * @returns A new vector with the ceiled components.
   */
  ceil() {
    return new _Vec3(
      Math.ceil(this.x),
      Math.ceil(this.y),
      Math.ceil(this.z)
    );
  }
  /**
   * Ceils the X component of the vector.
   * @returns A new vector with the ceiled X component.
   */
  ceilX() {
    return this.setX(Math.ceil);
  }
  /**
   * Ceils the Y component of the vector.
   * @returns A new vector with the ceiled Y component.
   */
  ceilY() {
    return this.setY(Math.ceil);
  }
  /**
   * Ceils the Z component of the vector.
   * @returns A new vector with the ceiled Z component.
   */
  ceilZ() {
    return this.setZ(Math.ceil);
  }
  /**
   * Rounds the X, Y, and Z components of the vector.
   * @returns A new vector with the rounded components.
   */
  round() {
    return this.update(Math.round, Math.round, Math.round);
  }
  /**
   * Rounds the X component of the vector.
   * @returns A new vector with the rounded X component.
   */
  roundX() {
    return this.setX(Math.round);
  }
  /**
   * Rounds the Y component of the vector.
   * @returns A new vector with the rounded Y component.
   */
  roundY() {
    return this.setY(Math.round);
  }
  /**
   * Rounds the Z component of the vector.
   * @returns A new vector with the rounded Z component.
   */
  roundZ() {
    return this.setZ(Math.round);
  }
  /**
   * Returns a new vector offset from the current vector up by 1 block.
   * @returns A new vector offset from the current vector up by 1 block.
   */
  up() {
    return this.add(_Vec3.Up);
  }
  /**
   * Returns a new vector offset from the current vector down by 1 block.
   * @returns A new vector offset from the current vector down by 1 block.
   */
  down() {
    return this.add(_Vec3.Down);
  }
  /**
   * Returns a new vector offset from the current vector north by 1 block.
   * @returns A new vector offset from the current vector north by 1 block.
   */
  north() {
    return this.add(_Vec3.North);
  }
  /**
   * Returns a new vector offset from the current vector south by 1 block.
   * @returns A new vector offset from the current vector south by 1 block.
   */
  south() {
    return this.add(_Vec3.South);
  }
  /**
   * Returns a new vector offset from the current vector east by 1 block.
   * @returns A new vector offset from the current vector east by 1 block.
   */
  east() {
    return this.add(_Vec3.East);
  }
  /**
   * Returns a new vector offset from the current vector west by 1 block.
   * @returns A new vector offset from the current vector west by 1 block.
   */
  west() {
    return this.add(_Vec3.West);
  }
  /**
   * Checks if the current vector is equal to the zero vector.
   * @returns true if the vector is equal to the zero vector, else returns false.
   */
  isZero() {
    return this.x === 0 && this.y === 0 && this.z === 0;
  }
  /**
   * Converts the vector to an array containing the X, Y, and Z components of the vector.
   * @returns An array containing the X, Y, and Z components of the vector.
   */
  toArray() {
    return [this.x, this.y, this.z];
  }
  /**
   * Converts the vector to a direction.
   * If the vector is not a unit vector, then it will be normalized and rounded to the nearest direction.
   */
  toDirection() {
    if (this.isZero()) {
      _Vec3.log.error(
        new Error("Cannot convert zero-length vector to direction")
      );
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const normalized = this.normalize();
    const maxValue = Math.max(
      Math.abs(normalized.x),
      Math.abs(normalized.y),
      Math.abs(normalized.z)
    );
    if (maxValue === normalized.x)
      return Direction2.East;
    if (maxValue === -normalized.x)
      return Direction2.West;
    if (maxValue === normalized.y)
      return Direction2.Up;
    if (maxValue === -normalized.y)
      return Direction2.Down;
    if (maxValue === normalized.z)
      return Direction2.South;
    if (maxValue === -normalized.z)
      return Direction2.North;
    _Vec3.log.error(new Error("Cannot convert vector to direction"), this);
    throw new Error("Cannot convert vector to direction");
  }
  /**
   * Converts the vector to a structure rotation.
   * If the vector is not a unit vector, then it will be normalized and rounded to the nearest 90 degrees rotation.
   */
  toStructureRotation() {
    const rotation = this.toRotation();
    let aligned = Math.round(rotation.y / 90) * 90;
    if (aligned < 0) {
      aligned += 360;
    }
    if (aligned >= 360) {
      aligned -= 360;
    }
    if (aligned === 0)
      return StructureRotation2.None;
    if (aligned === 90)
      return StructureRotation2.Rotate90;
    if (aligned === 180)
      return StructureRotation2.Rotate180;
    if (aligned === 270)
      return StructureRotation2.Rotate270;
    _Vec3.log.error(
      new Error("Cannot convert vector to structure rotation"),
      this
    );
    throw new Error("Cannot convert vector to structure rotation");
  }
  /**
   * Returns a new vector with the X, Y, and Z components rounded to the nearest block location.
   */
  toBlockLocation() {
    return _Vec3.from(
      (this.x << 0) - (this.x < 0 && this.x !== this.x << 0 ? 1 : 0),
      (this.y << 0) - (this.y < 0 && this.y !== this.y << 0 ? 1 : 0),
      (this.z << 0) - (this.z < 0 && this.z !== this.z << 0 ? 1 : 0)
    );
  }
  almostEqual(x, y, z, delta) {
    try {
      let other;
      if (typeof x !== "number" && z === void 0) {
        other = _Vec3._from(x, void 0, void 0);
        delta = y;
      } else {
        other = _Vec3._from(x, y, z);
      }
      return Math.abs(this.x - other.x) <= delta && Math.abs(this.y - other.y) <= delta && Math.abs(this.z - other.z) <= delta;
    } catch (e) {
      return false;
    }
  }
  equals(x, y, z) {
    try {
      const other = _Vec3._from(x, y, z);
      return this.x === other.x && this.y === other.y && this.z === other.z;
    } catch (e) {
      return false;
    }
  }
  /**
   * Converts the vector to a string representation.
   *
   * @param format - The format of the string representation. Defaults to "long".
   * @param separator - The separator to use between components. Defaults to ", ".
   * @returns The string representation of the vector.
   * @remarks
   * The "long" format is "Vec3(x, y, z)".
   * The "short" format is "x, y, z".
   */
  toString(format = "long", separator = ", ") {
    const result = `${this.x + separator + this.y + separator + this.z}`;
    return format === "long" ? `Vec3(${result})` : result;
  }
  /**
   * Parses a string representation of a vector.
   *
   * @param str - The string representation of the vector.
   * @param format - The format of the string representation. Defaults to "long".
   * @param separator - The separator to use between components. Defaults to ", ".
   * @returns The vector parsed from the string.
   * @throws {Error} If the string format is invalid.
   */
  static fromString(str, format = "long", separator = ", ") {
    if (format === "long") {
      const match = str.match(/^Vec3\((.*)\)$/);
      if (!match) {
        throw new Error("Invalid string format");
      }
      const components = match[1].split(separator);
      if (components.length !== 3) {
        throw new Error("Invalid string format");
      }
      return _Vec3.from(
        Number(components[0]),
        Number(components[1]),
        Number(components[2])
      );
    } else {
      const components = str.split(separator);
      if (components.length !== 3) {
        throw new Error("Invalid string format");
      }
      return _Vec3.from(
        Number(components[0]),
        Number(components[1]),
        Number(components[2])
      );
    }
  }
};
var MutVec2 = class _MutVec2 {
  x;
  y;
  constructor(x, y) {
    if (x === Direction3.Down || x === Direction3.Up) {
      throw new Error("Invalid direction");
    } else if (x === Direction3.North) {
      this.x = 0;
      this.y = 1;
    } else if (x === Direction3.South) {
      this.x = 0;
      this.y = -1;
    } else if (x === Direction3.East) {
      this.x = 1;
      this.y = 0;
    } else if (x === Direction3.West) {
      this.x = -1;
      this.y = 0;
    } else if (typeof x === "number") {
      if (y === void 0) {
        throw new Error("Invalid vector");
      }
      this.x = x;
      this.y = y;
    } else if (Array.isArray(x)) {
      this.x = x[0];
      this.y = x[1];
    } else if (x instanceof _MutVec2 || x instanceof Vec2) {
      this.x = x.x;
      this.y = x.y;
    } else {
      const anyX = x;
      if (!anyX || !anyX.x && anyX.x !== 0 || !anyX.y && anyX.y !== 0 && !anyX.z && anyX.z !== 0) {
        throw new Error("Invalid vector");
      }
      this.x = anyX.x;
      if (anyX.y || anyX.y === 0) {
        this.y = anyX.y;
      } else if (anyX.z || anyX.z === 0) {
        this.y = anyX.z;
      } else {
        throw new Error("Invalid vector");
      }
    }
  }
  static from(x, y) {
    if (x instanceof _MutVec2)
      return new _MutVec2(x);
    if (x instanceof Vec2)
      return new _MutVec2(x);
    if (typeof x === "number" && y !== void 0)
      return new _MutVec2(x, y);
    if (Array.isArray(x))
      return new _MutVec2(x);
    if (x === Direction3.Down || x === Direction3.Up) {
      throw new Error("Invalid direction");
    }
    if (x === Direction3.North)
      return new _MutVec2(Direction3.North);
    if (x === Direction3.South)
      return new _MutVec2(Direction3.South);
    if (x === Direction3.East)
      return new _MutVec2(Direction3.East);
    if (x === Direction3.West)
      return new _MutVec2(Direction3.West);
    return new _MutVec2(x, y);
  }
  static _from(x, y) {
    if (typeof x === "number" && y === void 0) {
      return new _MutVec2(x, x);
    }
    if (x instanceof _MutVec2)
      return x;
    if (x instanceof Vec2)
      return new _MutVec2(x);
    if (typeof x === "number" && y !== void 0)
      return new _MutVec2(x, y);
    if (Array.isArray(x))
      return new _MutVec2(x);
    if (x === Direction3.Down || x === Direction3.Up) {
      throw new Error("Invalid direction");
    }
    if (x === Direction3.North)
      return new _MutVec2(Direction3.North);
    if (x === Direction3.South)
      return new _MutVec2(Direction3.South);
    if (x === Direction3.East)
      return new _MutVec2(Direction3.East);
    if (x === Direction3.West)
      return new _MutVec2(Direction3.West);
    return new _MutVec2(x, y);
  }
  copy() {
    return new _MutVec2(this.x, this.y);
  }
  toImmutable() {
    return new Vec2(this.x, this.y);
  }
  static fromYaw(yaw) {
    const psi = yaw * (Math.PI / 180);
    const x = Math.sin(psi);
    const z = Math.cos(psi);
    return new _MutVec2(x, z);
  }
  toYaw() {
    if (this.isZero()) {
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const direction = this.copy().normalize();
    return Math.atan2(direction.x, direction.y) * (180 / Math.PI);
  }
  add(x, y) {
    const v = _MutVec2._from(x, y);
    this.x += v.x;
    this.y += v.y;
    return this;
  }
  directionTo(x, y) {
    const v = _MutVec2._from(x, y);
    v.subtract(this).normalize();
    return this;
  }
  subtract(x, y) {
    const v = _MutVec2._from(x, y);
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }
  multiply(x, y) {
    if (typeof x === "number" && y === void 0) {
      this.x *= x;
      this.y *= x;
      return this;
    }
    const v = _MutVec2._from(x, y);
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }
  scale(scalar) {
    this.x *= scalar;
    this.y *= scalar;
    return this;
  }
  divide(x, y) {
    if (typeof x === "number" && y === void 0) {
      if (x === 0)
        throw new Error("Cannot divide by zero");
      this.x /= x;
      this.y /= x;
      return this;
    }
    const v = _MutVec2._from(x, y);
    if (v.x === 0 || v.y === 0)
      throw new Error("Cannot divide by zero");
    this.x /= v.x;
    this.y /= v.y;
    return this;
  }
  normalize() {
    if (this.isZero()) {
      throw new Error("Cannot normalize zero-length vector");
    }
    const len = this.length();
    this.x /= len;
    this.y /= len;
    return this;
  }
  length() {
    return Math.hypot(this.x, this.y);
  }
  lengthSquared() {
    return this.x * this.x + this.y * this.y;
  }
  distance(x, y) {
    const v = _MutVec2._from(x, y);
    return this.copy().subtract(v).length();
  }
  distanceSquared(x, y) {
    const v = _MutVec2._from(x, y);
    return this.copy().subtract(v).lengthSquared();
  }
  lerp(v, t) {
    if (!v || t === void 0)
      return this;
    if (t === 1) {
      this.x = v.x;
      this.y = v.y;
      return this;
    }
    if (t === 0)
      return this;
    this.x = this.x + (v.x - this.x) * t;
    this.y = this.y + (v.y - this.y) * t;
    return this;
  }
  slerp(v, t) {
    if (!v || t === void 0)
      return this;
    if (t === 1) {
      this.x = v.x;
      this.y = v.y;
      return this;
    }
    if (t === 0)
      return this;
    const dot = this.dot(v);
    const theta = Math.acos(dot) * t;
    const relative = _MutVec2.from(v).subtract(this.copy().multiply(dot)).normalize();
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this.multiply(cosT);
    this.x += relative.x * sinT;
    this.y += relative.y * sinT;
    return this;
  }
  dot(x, y) {
    const v = _MutVec2._from(x, y);
    return this.x * v.x + this.y * v.y;
  }
  angleBetween(x, y) {
    const v = _MutVec2._from(x, y);
    const dotProduct = this.dot(v);
    const lengths = this.length() * v.length();
    if (lengths === 0) {
      return 0;
    }
    return Math.acos(dotProduct / lengths);
  }
  projectOnto(x, y) {
    const v = _MutVec2._from(x, y);
    if (v.isZero()) {
      this.x = 0;
      this.y = 0;
      return this;
    }
    const scale = this.dot(v) / v.dot(v);
    this.x = v.x * scale;
    this.y = v.y * scale;
    return this;
  }
  reflect(x, y) {
    const normal = _MutVec2._from(x, y);
    const projection = this.copy().projectOnto(normal);
    return this.subtract(projection.multiply(2));
  }
  toVec3(z) {
    return new Vec3(this.x, this.y, z || 0);
  }
  setX(value) {
    if (typeof value === "number") {
      this.x = value;
    } else {
      this.x = value(this.x);
    }
    return this;
  }
  setY(value) {
    if (typeof value === "number") {
      this.y = value;
    } else {
      this.y = value(this.y);
    }
    return this;
  }
  update(x, y) {
    if (!x)
      x = (v) => v;
    if (!y)
      y = (v) => v;
    this.x = x(this.x);
    this.y = y(this.y);
    return this;
  }
  floor() {
    return this.update(Math.floor, Math.floor);
  }
  floorX() {
    return this.setX(Math.floor);
  }
  floorY() {
    return this.setY(Math.floor);
  }
  ceil() {
    return this.update(Math.ceil, Math.ceil);
  }
  ceilX() {
    return this.setX(Math.ceil);
  }
  ceilY() {
    return this.setY(Math.ceil);
  }
  round() {
    return this.update(Math.round, Math.round);
  }
  roundX() {
    return this.setX(Math.round);
  }
  roundY() {
    return this.setY(Math.round);
  }
  north() {
    return this.add(Direction3.North);
  }
  south() {
    return this.add(Direction3.South);
  }
  east() {
    return this.add(Direction3.East);
  }
  west() {
    return this.add(Direction3.West);
  }
  isZero() {
    return this.x === 0 && this.y === 0;
  }
  toArray() {
    return [this.x, this.y];
  }
  toDirection() {
    if (this.isZero()) {
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const normalized = this.copy().normalize();
    const maxValue = Math.max(
      Math.abs(normalized.x),
      Math.abs(normalized.y)
    );
    if (maxValue === normalized.x)
      return Direction3.East;
    if (maxValue === -normalized.x)
      return Direction3.West;
    if (maxValue === normalized.y)
      return Direction3.North;
    if (maxValue === -normalized.y)
      return Direction3.South;
    throw new Error("Cannot convert vector to direction");
  }
  toBlockLocation() {
    const blockX = (this.x << 0) - (this.x < 0 && this.x !== this.x << 0 ? 1 : 0);
    const blockY = (this.y << 0) - (this.y < 0 && this.y !== this.y << 0 ? 1 : 0);
    this.x = blockX;
    this.y = blockY;
    return this;
  }
  almostEqual(x, y, delta) {
    try {
      let other;
      if (typeof x !== "number" && delta === void 0) {
        other = _MutVec2._from(x, void 0);
        delta = y;
      } else {
        other = _MutVec2._from(x, y);
      }
      return Math.abs(this.x - other.x) <= delta && Math.abs(this.y - other.y) <= delta;
    } catch (e) {
      return false;
    }
  }
  equals(x, y) {
    try {
      const other = _MutVec2._from(x, y);
      return this.x === other.x && this.y === other.y;
    } catch (e) {
      return false;
    }
  }
  toString(format = "long", separator = ", ") {
    const result = `${this.x + separator + this.y}`;
    return format === "long" ? `MutVec2(${result})` : result;
  }
};
var Vec2 = class _Vec2 {
  static log = /* @__PURE__ */ Logger.getLogger(
    "vec2",
    "vec2",
    "bedrock-boost"
  );
  static Zero = /* @__PURE__ */ new _Vec2(0, 0);
  static North = /* @__PURE__ */ new _Vec2(Direction4.North);
  static South = /* @__PURE__ */ new _Vec2(Direction4.South);
  static East = /* @__PURE__ */ new _Vec2(Direction4.East);
  static West = /* @__PURE__ */ new _Vec2(Direction4.West);
  x;
  y;
  constructor(x, y) {
    if (x === Direction4.Down || x === Direction4.Up) {
      _Vec2.log.error(new Error("Invalid direction"), x);
      throw new Error("Invalid direction");
    } else if (x === Direction4.North) {
      this.x = 0;
      this.y = 1;
    } else if (x === Direction4.South) {
      this.x = 0;
      this.y = -1;
    } else if (x === Direction4.East) {
      this.x = 1;
      this.y = 0;
    } else if (x === Direction4.West) {
      this.x = -1;
      this.y = 0;
    } else if (typeof x === "number") {
      this.x = x;
      this.y = y;
    } else if (Array.isArray(x)) {
      this.x = x[0];
      this.y = x[1];
    } else if (x instanceof _Vec2) {
      this.x = x.x;
      this.y = x.y;
    } else if (x instanceof MutVec2) {
      this.x = x.x;
      this.y = x.y;
    } else if (x instanceof Vec3) {
      this.x = x.x;
      this.y = x.y;
    } else {
      const anyX = x;
      if (!anyX || !anyX.x && anyX.x !== 0 || !anyX.y && anyX.y !== 0 && !anyX.z && anyX.z !== 0) {
        _Vec2.log.error(new Error("Invalid vector"), x);
        throw new Error("Invalid vector");
      }
      this.x = x.x;
      if (anyX.y || anyX.y === 0) {
        this.y = anyX.y;
      } else if (anyX.z || anyX.z === 0) {
        this.y = anyX.z;
      } else {
        _Vec2.log.error(new Error("Invalid vector"), x);
        throw new Error("Invalid vector");
      }
    }
  }
  static from(x, y) {
    if (x instanceof _Vec2)
      return x;
    if (x instanceof MutVec2)
      return new _Vec2(x.x, x.y);
    if (typeof x === "number" && y !== void 0) {
      return new _Vec2(x, y);
    }
    if (Array.isArray(x)) {
      return new _Vec2(x);
    }
    if (x === Direction4.Down || x === Direction4.Up) {
      _Vec2.log.error(new Error("Invalid direction"), x);
      throw new Error("Invalid direction");
    }
    if (x === Direction4.North)
      return _Vec2.North;
    if (x === Direction4.South)
      return _Vec2.South;
    if (x === Direction4.East)
      return _Vec2.East;
    if (x === Direction4.West)
      return _Vec2.West;
    return new _Vec2(x, y);
  }
  static _from(x, y) {
    if (typeof x === "number" && y === void 0) {
      return new _Vec2(x, x);
    }
    if (x instanceof _Vec2)
      return x;
    if (x instanceof MutVec2)
      return new _Vec2(x.x, x.y);
    if (typeof x === "number" && y !== void 0) {
      return new _Vec2(x, y);
    }
    if (Array.isArray(x)) {
      return new _Vec2(x);
    }
    if (x === Direction4.Down || x === Direction4.Up) {
      _Vec2.log.error(new Error("Invalid direction"), x);
      throw new Error("Invalid direction");
    }
    if (x === Direction4.North)
      return _Vec2.North;
    if (x === Direction4.South)
      return _Vec2.South;
    if (x === Direction4.East)
      return _Vec2.East;
    if (x === Direction4.West)
      return _Vec2.West;
    return new _Vec2(x, y);
  }
  /**
   * Creates a copy of the current vector.
   *
   * @returns A new vector with the same values as the current vector.
   */
  copy() {
    return new _Vec2(this.x, this.y);
  }
  /**
   * Creates a mutable copy of the current vector.
   *
   * @returns A mutable vector with the same values as the current vector.
   */
  toMutable() {
    return new MutVec2(this.x, this.y);
  }
  /**
   * Creates a new direction vector from yaw rotation.
   *
   * @param yaw - The yaw value in degrees.
   * @returns A new vector representing the direction.
   */
  static fromYaw(yaw) {
    const psi = yaw * (Math.PI / 180);
    const x = Math.sin(psi);
    const z = Math.cos(psi);
    return new _Vec2(x, z);
  }
  /**
   * Converts the normal vector to yaw and pitch values.
   *
   * @returns A Vector2 containing the yaw and pitch values.
   */
  toYaw() {
    if (this.isZero()) {
      _Vec2.log.error(
        new Error("Cannot convert zero-length vector to direction")
      );
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const direction = this.normalize();
    const yaw = Math.atan2(direction.x, direction.y) * (180 / Math.PI);
    return yaw;
  }
  add(x, y) {
    const v = _Vec2._from(x, y);
    return _Vec2.from(v.x + this.x, v.y + this.y);
  }
  directionTo(x, y) {
    const v = _Vec2._from(x, y);
    return v.subtract(this).normalize();
  }
  subtract(x, y) {
    const v = _Vec2._from(x, y);
    return _Vec2.from(this.x - v.x, this.y - v.y);
  }
  multiply(x, y) {
    const v = _Vec2._from(x, y);
    return _Vec2.from(v.x * this.x, v.y * this.y);
  }
  /**
   * Scales the current vector by a scalar.
   *
   * @param v - The scalar to scale by.
   * @returns The updated vector after scaling.
   */
  scale(scalar) {
    return _Vec2.from(this.x * scalar, this.y * scalar);
  }
  divide(x, y) {
    const v = _Vec2._from(x, y);
    if (v.x === 0 || v.y === 0)
      throw new Error("Cannot divide by zero");
    return _Vec2.from(this.x / v.x, this.y / v.y);
  }
  /**
   * Normalizes the vector to have a length (magnitude) of 1.
   * Normalized vectors are often used as a direction vectors.
   *
   * @returns The normalized vector.
   */
  normalize() {
    if (this.isZero()) {
      _Vec2.log.error(new Error("Cannot normalize zero-length vector"));
      throw new Error("Cannot normalize zero-length vector");
    }
    const len = this.length();
    return _Vec2.from(this.x / len, this.y / len);
  }
  /**
   * Computes the length (magnitude) of the vector.
   *
   * @returns The length of the vector.
   */
  length() {
    return Math.sqrt(this.lengthSquared());
  }
  /**
   * Computes the squared length of the vector.
   * This is faster than computing the actual length and can be useful for comparison purposes.
   *
   * @returns The squared length of the vector.
   */
  lengthSquared() {
    return this.x * this.x + this.y * this.y;
  }
  distance(x, y) {
    const v = _Vec2._from(x, y);
    return Math.sqrt(this.distanceSquared(v));
  }
  distanceSquared(x, y) {
    const v = _Vec2._from(x, y);
    return this.subtract(v).lengthSquared();
  }
  /**
   * Computes the linear interpolation between the current vector and another vector, when t is in the range [0, 1].
   * Computes the extrapolation when t is outside this range.
   *
   * @param v - The other vector.
   * @param t - The interpolation factor.
   * @returns A new vector after performing the lerp operation.
   */
  lerp(v, t) {
    if (!v || !t)
      return _Vec2.from(this);
    if (t === 1)
      return _Vec2.from(v);
    if (t === 0)
      return _Vec2.from(this);
    return _Vec2.from(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t
    );
  }
  /**
   * Computes the spherical linear interpolation between the current vector and another vector, when t is in the range [0, 1].
   * Computes the extrapolation when t is outside this range.
   *
   * @param v - The other vector.
   * @param t - The interpolation factor.
   * @returns A new vector after performing the slerp operation.
   */
  slerp(v, t) {
    if (!v || !t)
      return _Vec2.from(this);
    if (t === 1)
      return _Vec2.from(v);
    if (t === 0)
      return _Vec2.from(this);
    const dot = this.dot(v);
    const theta = Math.acos(dot) * t;
    const relative = _Vec2.from(v).subtract(this.multiply(dot)).normalize();
    return this.multiply(Math.cos(theta)).add(
      relative.multiply(Math.sin(theta))
    );
  }
  dot(x, y) {
    const v = _Vec2._from(x, y);
    return this.x * v.x + this.y * v.y;
  }
  angleBetween(x, y) {
    const v = _Vec2._from(x, y);
    const dotProduct = this.dot(v);
    const lengths = this.length() * v.length();
    if (lengths === 0) {
      return 0;
    }
    return Math.acos(dotProduct / lengths);
  }
  projectOnto(x, y) {
    const v = _Vec2._from(x, y);
    if (v.isZero()) {
      return _Vec2.Zero;
    }
    return v.scale(this.dot(v) / v.dot(v));
  }
  reflect(x, y) {
    const normal = _Vec2._from(x, y);
    const proj = this.projectOnto(normal);
    return this.subtract(proj.multiply(2));
  }
  /**
   * Converts the current vector to a 3d vetor with the given y-value.
   *
   * @param z - The optional z value for the 3d vetor.
   * @returns The converted vector.
   */
  toVec3(z) {
    return new Vec3(this.x, this.y, z || 0);
  }
  /**
   * Sets the X component of the vector.
   *
   * @param value - The new X value.
   * @returns The updated vector with the new X value.
   */
  setX(value) {
    return new _Vec2(value, this.y);
  }
  /**
   * Sets the Y component of the vector.
   *
   * @param value - The new Y value.
   * @returns The updated vector with the new Y value.
   */
  setY(value) {
    return new _Vec2(this.x, value);
  }
  /**
   * Calculates the shortest distance between a point (represented by this Vector3 instance) and a line segment.
   *
   * This method finds the perpendicular projection of the point onto the line defined by the segment. If this
   * projection lies outside the line segment, then the method calculates the distance from the point to the
   * nearest segment endpoint.
   *
   * @param start - The starting point of the line segment.
   * @param end - The ending point of the line segment.
   * @returns The shortest distance between the point and the line segment.
   */
  distanceToLineSegment(start, end) {
    const lineDirection = _Vec2.from(end).subtract(start);
    if (lineDirection.lengthSquared() === 0) {
      return this.subtract(start).length();
    }
    const t = Math.max(
      0,
      Math.min(
        1,
        this.subtract(start).dot(lineDirection) / lineDirection.dot(lineDirection)
      )
    );
    const projection = _Vec2.from(start).add(lineDirection.multiply(t));
    return this.subtract(projection).length();
  }
  /**
   * Floors the X, Y, and Z components of the vector.
   * @returns A new vector with the floored components.
   */
  floor() {
    return new _Vec2(Math.floor(this.x), Math.floor(this.y));
  }
  /**
   * Floors the X component of the vector.
   * @returns A new vector with the floored X component.
   */
  floorX() {
    return new _Vec2(Math.floor(this.x), this.y);
  }
  /**
   * Floors the Y component of the vector.
   * @returns A new vector with the floored Y component.
   */
  floorY() {
    return new _Vec2(this.x, Math.floor(this.y));
  }
  /**
   * Ceils the X, Y, and Z components of the vector.
   * @returns A new vector with the ceiled components.
   */
  ceil() {
    return new _Vec2(Math.ceil(this.x), Math.ceil(this.y));
  }
  /**
   * Ceils the X component of the vector.
   * @returns A new vector with the ceiled X component.
   */
  ceilX() {
    return new _Vec2(Math.ceil(this.x), this.y);
  }
  /**
   * Ceils the Y component of the vector.
   * @returns A new vector with the ceiled Y component.
   */
  ceilY() {
    return new _Vec2(this.x, Math.ceil(this.y));
  }
  /**
   * Rounds the X, Y, and Z components of the vector.
   * @returns A new vector with the rounded components.
   */
  round() {
    return new _Vec2(Math.round(this.x), Math.round(this.y));
  }
  /**
   * Rounds the X component of the vector.
   * @returns A new vector with the rounded X component.
   */
  roundX() {
    return new _Vec2(Math.round(this.x), this.y);
  }
  /**
   * Rounds the Y component of the vector.
   * @returns A new vector with the rounded Y component.
   */
  roundY() {
    return new _Vec2(this.x, Math.round(this.y));
  }
  /**
   * Returns a new vector offset from the current vector north by 1 block.
   * @returns A new vector offset from the current vector north by 1 block.
   */
  north() {
    return this.add(_Vec2.North);
  }
  /**
   * Returns a new vector offset from the current vector south by 1 block.
   * @returns A new vector offset from the current vector south by 1 block.
   */
  south() {
    return this.add(_Vec2.South);
  }
  /**
   * Returns a new vector offset from the current vector east by 1 block.
   * @returns A new vector offset from the current vector east by 1 block.
   */
  east() {
    return this.add(_Vec2.East);
  }
  /**
   * Returns a new vector offset from the current vector west by 1 block.
   * @returns A new vector offset from the current vector west by 1 block.
   */
  west() {
    return this.add(_Vec2.West);
  }
  /**
   * Checks if the current vector is equal to the zero vector.
   * @returns true if the vector is equal to the zero vector, else returns false.
   */
  isZero() {
    return this.x === 0 && this.y === 0;
  }
  /**
   * Converts the vector to an array containing the X, Y, and Z components of the vector.
   * @returns An array containing the X, Y, and Z components of the vector.
   */
  toArray() {
    return [this.x, this.y];
  }
  /**
   * Converts the vector to a direction.
   * If the vector is not a unit vector, then it will be normalized and rounded to the nearest direction.
   */
  toDirection() {
    if (this.isZero()) {
      _Vec2.log.error(
        new Error("Cannot convert zero-length vector to direction")
      );
      throw new Error("Cannot convert zero-length vector to direction");
    }
    const normalized = this.normalize();
    const maxValue = Math.max(
      Math.abs(normalized.x),
      Math.abs(normalized.y)
    );
    if (maxValue === normalized.x)
      return Direction4.East;
    if (maxValue === -normalized.x)
      return Direction4.West;
    if (maxValue === normalized.y)
      return Direction4.North;
    if (maxValue === -normalized.y)
      return Direction4.South;
    _Vec2.log.error(new Error("Cannot convert vector to direction"), this);
    throw new Error("Cannot convert vector to direction");
  }
  /**
   * Returns a new vector with the X, Y, and Z components rounded to the nearest block location.
   */
  toBlockLocation() {
    return _Vec2.from(
      (this.x << 0) - (this.x < 0 && this.x !== this.x << 0 ? 1 : 0),
      (this.y << 0) - (this.y < 0 && this.y !== this.y << 0 ? 1 : 0)
    );
  }
  almostEqual(x, y, delta) {
    try {
      let other;
      if (typeof x !== "number" && delta === void 0) {
        other = _Vec2._from(x, void 0);
        delta = y;
      } else {
        other = _Vec2._from(x, y);
      }
      return Math.abs(this.x - other.x) <= delta && Math.abs(this.y - other.y) <= delta;
    } catch (e) {
      return false;
    }
  }
  equals(x, y) {
    try {
      const other = _Vec2._from(x, y);
      return this.x === other.x && this.y === other.y;
    } catch (e) {
      return false;
    }
  }
  toString(format = "long", separator = ", ") {
    const result = `${this.x + separator + this.y}`;
    return format === "long" ? `Vec2(${result})` : result;
  }
};
var Timings = class _Timings {
  static log = /* @__PURE__ */ Logger.getLogger(
    "Timings",
    "timings"
  );
  static lastTime = -1;
  static lastOperation = "";
  /**
   * Begin measuring the time it takes to perform an operation.
   * @remarks
   * If another operation is already being measured, the measurement will be ended.
   *
   * @param operation The name of the operation.
   */
  static begin(operation) {
    this.end();
    this.lastTime = (/* @__PURE__ */ new Date()).getTime();
    this.lastOperation = operation;
  }
  /**
   * End measuring the time it takes to perform an operation and log the result.
   * @remarks
   * If no operation is being measured, this method will do nothing.
   */
  static end() {
    const time = (/* @__PURE__ */ new Date()).getTime();
    if (this.lastTime > 0) {
      _Timings.log.debug(
        `Operation ${this.lastOperation} took ${time - this.lastTime}ms`
      );
    }
    this.lastTime = -1;
  }
};
var log = Logger.getLogger("jobUtils", "bedrock-boost", "jobUtils");
var DirectionUtils = class {
  /**
   * The opposite directions of the given directions.
   */
  static Opposites = {
    [Direction5.Down]: Direction5.Up,
    [Direction5.Up]: Direction5.Down,
    [Direction5.North]: Direction5.South,
    [Direction5.South]: Direction5.North,
    [Direction5.East]: Direction5.West,
    [Direction5.West]: Direction5.East
  };
  /**
   * The positive perpendicular directions of the given directions.
   */
  static PositivePerpendiculars = {
    [Direction5.Down]: [Direction5.East, Direction5.North],
    [Direction5.Up]: [Direction5.East, Direction5.North],
    [Direction5.North]: [Direction5.East, Direction5.Up],
    [Direction5.South]: [Direction5.East, Direction5.Up],
    [Direction5.East]: [Direction5.North, Direction5.Up],
    [Direction5.West]: [Direction5.North, Direction5.Up]
  };
  /**
   * The negative perpendicular directions of the given directions.
   */
  static NegativePerpendiculars = {
    [Direction5.Down]: [Direction5.West, Direction5.South],
    [Direction5.Up]: [Direction5.West, Direction5.South],
    [Direction5.North]: [Direction5.West, Direction5.Down],
    [Direction5.South]: [Direction5.West, Direction5.Down],
    [Direction5.East]: [Direction5.South, Direction5.Down],
    [Direction5.West]: [Direction5.South, Direction5.Down]
  };
  /**
   * The clockwise perpendicular directions of the given directions.
   */
  static ClockwisePerpendiculars = {
    [Direction5.North]: Direction5.East,
    [Direction5.East]: Direction5.South,
    [Direction5.South]: Direction5.West,
    [Direction5.West]: Direction5.North,
    // Not sure what should be here
    [Direction5.Up]: Direction5.Down,
    [Direction5.Down]: Direction5.Up
  };
  /**
   * The counter-clockwise perpendicular directions of the given directions.
   */
  static CounterClockwisePerpendiculars = {
    [Direction5.North]: Direction5.West,
    [Direction5.East]: Direction5.North,
    [Direction5.South]: Direction5.East,
    [Direction5.West]: Direction5.South,
    // Not sure what should be here
    [Direction5.Up]: Direction5.Down,
    [Direction5.Down]: Direction5.Up
  };
  /**
   * The same axis directions of the given directions.
   */
  static SameAxis = {
    [Direction5.North]: Direction5.North,
    [Direction5.South]: Direction5.North,
    [Direction5.East]: Direction5.East,
    [Direction5.West]: Direction5.East,
    [Direction5.Up]: Direction5.Up,
    [Direction5.Down]: Direction5.Up
  };
  /**
   * Directions by their string representation.
   */
  static FromString = {
    north: Direction5.North,
    east: Direction5.East,
    south: Direction5.South,
    west: Direction5.West,
    up: Direction5.Up,
    down: Direction5.Down
  };
  /**
   * Strings by their direction representation.
   */
  static ToString = {
    [Direction5.North]: "north",
    [Direction5.East]: "east",
    [Direction5.South]: "south",
    [Direction5.West]: "west",
    [Direction5.Up]: "up",
    [Direction5.Down]: "down"
  };
  /**
   * All directions.
   */
  static Values = [
    Direction5.Down,
    Direction5.Up,
    Direction5.North,
    Direction5.South,
    Direction5.East,
    Direction5.West
  ];
};
var log2 = Logger.getLogger("itemUtils", "bedrock-boost", "itemUtils");

// src/territories/ui.ts
function openCreateMenu(player, manager) {
  const name = obString("");
  const colorIndex = obNumber(0);
  void openWindowRaw(player, windowTitle("Créer un territoire"), (form) => {
    form.header(`§a■ §lRevendiquer ce chunk`);
    form.label(`§7Tu es en §fx=${Math.floor(player.location.x)}§7, §fz=${Math.floor(player.location.z)}§7 (§f${player.dimension.id}§7).`);
    form.divider();
    form.textField("§eNom du territoire (3-24 caractères)", name);
    form.dropdown(
      "§eCouleur du drapeau",
      colorIndex,
      TERRITORY_COLORS.map((color, value) => ({ label: `${color.code}■ ${color.id}`, value }))
    );
    form.divider();
    form.button(`§a■ §lRevendiquer ce chunk !`, () => {
      const cleanName = name.getData().trim().replace(/\s+/g, " ");
      const color = TERRITORY_COLORS[colorIndex.getData()] ?? TERRITORY_COLORS[0];
      const result = manager.create(
        player.name,
        cleanName,
        color?.id ?? "rouge",
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
        `§a[Territoires] Territoire §r${color?.code}■ ${result.territory.data.name} §r§acrée ! Ce chunk est sous ta bannière.`
      );
    });
    form.closeButton();
  }).catch(
    (error) => console.warn(`[Territoires] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openTerritoriesMenu(player, manager) {
  const territories2 = manager.all();
  if (territories2.length === 0) {
    player.sendMessage("§7[Territoires] Aucun territoire pour l'instant. Sois le premier avec §f/sn:create§7 !");
    return;
  }
  void openWindow(player, "Territoires", (form) => {
    form.hero("territories");
    form.label(`§7${territories2.length} territoire(s) revendiqué(s) :`);
    form.divider();
    for (const territory of territories2) {
      const color = getColor(territory.data.color);
      form.button(
        `${color.code}■ ${territory.data.name}§r
§7par ${territory.data.owner}`,
        () => showTerritoryInfo(player, territory, manager),
        void 0,
        "flag"
      );
    }
  }).catch(
    (error) => console.warn(`[Territoires] Erreur menu liste : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function showTerritoryInfo(player, territory, manager) {
  void manager;
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  void openWindowRaw(player, windowTitle(data.name), (form) => {
    form.header(`${color.code}■ §l${data.name}`);
    form.label(
      [
        `§ePropriétaire : §f${data.owner}${isOwner ? " §a(toi)" : ""}`,
        `§eDrapeau : §r${color.code}■ ${color.id}`,
        `§eCréé le : §f${formatDate(data.createdAt)}`,
        `§eChunks contrôlés : §f${data.chunkKeys.length}`,
        `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
        `§eMembres : §f${data.members.length}`
      ].join("\n")
    );
    form.divider();
    form.label("§7Seuls le propriétaire et ses membres peuvent y construire, y ouvrir des conteneurs ou y combattre.");
    if (isOwner) {
      form.spacer();
      form.button(`§6■ §lChanger le drapeau (/sn:setflag)`, () => {
        player.sendMessage(
          `§7[Territoires] Couleurs : ${TERRITORY_COLORS.map((c) => `${c.code}${c.id}`).join("§7, ")}`
        );
      });
      form.button(`§c■ §lSupprimer ce territoire`, () => {
        const ok = manager.remove(data.name, player.name);
        player.sendMessage(
          ok ? `§a[Territoires] ${data.name} supprimé.` : "§c[Territoires] Suppression impossible."
        );
      }, void 0, "trash");
    }
  }).catch(
    (error) => console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`)
  );
}

// src/territories/commands.ts
function registerCommands(manager, db2, modules2, permissions2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  const allowed = (player, perm) => {
    if (permissions2 === void 0) return true;
    return permissions2.can(player.name, perm, player.playerPermissionLevel >= 2);
  };
  system7.beforeEvents.startup.subscribe((event) => {
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
        if (!allowed(player, "territories.create")) {
          return { status: CustomCommandStatus.Failure, message: "§c[Territoires] Tu n'as pas la permission de créer un territoire." };
        }
        system7.run(() => openCreateMenu(player, manager));
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
        system7.run(() => openTerritoriesMenu(player, manager));
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
        territory.updatedAt = Date.now();
        db2?.markDirty();
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
              system7.run(() => {
                void openDbMenu(db2, _origin.sourceEntity).catch(
                  (error) => console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`)
                );
              });
              return { status: CustomCommandStatus.Success };
            }
            return {
              status: CustomCommandStatus.Failure,
              message: "§c[DB] Base non chargée : lecture impossible (monde pas encore prêt ou base corrompue). §7Quitte et relance le monde ; si l'erreur persiste, regarde le content log pour le message d'erreur exact."
            };
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
            const preview = docs.slice(0, 10).map((doc) => `§f${doc.id}§7(${Math.round(JSON.stringify(doc).length / 1024 * 10) / 10}ko)`).join(", ");
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
            return { status: CustomCommandStatus.Success, message: ColorJSON.DEFAULT.stringify(doc) };
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
import { world as world7, system as system8, GameMode as GameMode2, Player as Player3 } from "@minecraft/server";
function safeSend(player, message) {
  system8.run(() => {
    try {
      player.sendMessage(message);
    } catch {
    }
  });
}
var DENY_BREAK = "§c[Territoires] Chunk protégé : destruction impossible.";
var DENY_PLACE = "§c[Territoires] Chunk protégé : construction impossible.";
var DENY_INTERACT = "§c[Territoires] Chunk protégé : interaction impossible.";
var DENY_COMBAT = "§c[Territoires] Zone protégée : ce joueur ne peut pas être attaqué ici.";
var DENY_ITEM = "§c[Territoires] Chunk protégé : objet inutilisable ici.";
function isCreative(playerName) {
  const player = world7.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== void 0 && player.getGameMode() === GameMode2.Creative;
}
function isProtectedForId(block, player, manager) {
  const key = chunkKeyFromPosition(block.dimension.id, block.location.x, block.location.z);
  return !manager.isAllowedFor(player.id, player.name, key);
}
function registerProtection(manager, modules2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  world7.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_BREAK);
    }
  });
  world7.afterEvents.playerPlaceBlock.subscribe((event) => {
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
    system8.run(() => {
      try {
        dimension.runCommand(`setblock ${x} ${y} ${z} air`);
      } catch {
      }
    });
    safeSend(player, DENY_PLACE);
  });
  world7.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });
  world7.beforeEvents.itemUse.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.source;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_ITEM);
    }
  });
  world7.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });
  world7.beforeEvents.entityHurt.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const attacker = event.damageSource.damagingEntity;
    if (!(attacker instanceof Player3)) return;
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
      safeSend(attacker, DENY_COMBAT);
      return;
    }
    const key = chunkKeyFromPosition(victim.dimension.id, victim.location.x, victim.location.z);
    if (manager.isProtected(key)) {
      event.cancel = true;
      safeSend(attacker, "§c[Territoires] Chunk protégé : les créatures ici sont sous la protection du propriétaire.");
    }
  });
  world7.beforeEvents.explosion.subscribe((event) => {
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
import { system as system9, world as world8 } from "@minecraft/server";
var NO_TERRITORY_MESSAGE = "§7Zone libre";
function registerAnnouncer(manager, modules2, intervalTicks = 10) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  const lastKeyByPlayer = /* @__PURE__ */ new Map();
  world8.afterEvents.playerLeave.subscribe((event) => {
    lastKeyByPlayer.delete(event.playerName);
  });
  system9.runInterval(() => {
    if (!manager.loaded || !enabled()) return;
    for (const player of world8.getAllPlayers()) {
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

// src/permissions/manager.ts
var DEFAULT_ROLE_NAME = "Joueur";
var DEFAULT_ROLE_COLOR = "§8";
var DEFAULT_ROLE_PREFIX = "[Joueur]";
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
      { name: clean, color, prefix: `[${clean}]`, level, perms: defaultPermsForLevel(level) },
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
      member.data.role = "";
      member.updatedAt = Date.now();
    }
    this.db.delete(ROLES_COLLECTION, name);
    this.touch();
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
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Change le prefix d'un rôle ("" = revenir au défaut [Nom]). */
  setRolePrefix(name, prefix) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    role.data.prefix = prefix.trim();
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Change le niveau hiérarchique d'un rôle. */
  setRoleLevel(name, level) {
    const role = this.getRole(name);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    role.data.level = Math.max(0, Math.min(1e3, Math.floor(level)));
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /**
   * Remplace la liste des permissions explicites d'un rôle.
   * Seuls les ids connus du catalogue sont retenus (garde-fou).
   */
  setRolePermissions(roleName, permIds) {
    const role = this.getRole(roleName);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    const clean = permIds.filter((id) => isPermId(id));
    role.data.perms = [...new Set(clean)];
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Ajoute une permission à un rôle (idempotent). */
  grantPermission(roleName, permId) {
    const role = this.getRole(roleName);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    if (role.data.perms.includes(permId)) return { ok: true };
    role.data.perms.push(permId);
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  /** Retire une permission explicite d'un rôle. */
  revokePermission(roleName, permId) {
    const role = this.getRole(roleName);
    if (role === void 0) return { ok: false, error: "Rôle introuvable." };
    const before = role.data.perms.length;
    role.data.perms = role.data.perms.filter((id) => id !== permId);
    if (role.data.perms.length === before) return { ok: true };
    role.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return { ok: true };
  }
  // -------------------------------------------------------------------------
  // Membres
  // -------------------------------------------------------------------------
  getMember(playerName) {
    return this.db.findOne(MEMBERS_COLLECTION, playerName);
  }
  /** Le membre par id Bedrock (résolu au join). */
  getMemberById(playerId) {
    return this.db.find(MEMBERS_COLLECTION, (doc) => doc.data.playerId === playerId)[0];
  }
  /** Le membre par pseudo OU playerId (les deux sont cherchés). */
  getMemberAny(playerName, playerId) {
    if (playerId !== void 0) {
      const byId = this.getMemberById(playerId);
      if (byId !== void 0) return byId;
    }
    return this.getMember(playerName);
  }
  allMembers() {
    return this.db.find(MEMBERS_COLLECTION);
  }
  membersWithRole(roleName) {
    return this.db.find(MEMBERS_COLLECTION, (doc) => doc.data.role === roleName);
  }
  /**
   * Attribue le rôle par défaut [Joueur] si le joueur n'a AUCUN rôle.
   * Utilisé à chaque join : tout le monde a au minimum ce rôle (gris).
   */
  ensureDefaultRole(playerName, playerId) {
    if (this.getMember(playerName) !== void 0) return;
    if (this.getRole(DEFAULT_ROLE_NAME) === void 0) return;
    this.assignRole(playerName, DEFAULT_ROLE_NAME, playerId);
  }
  /**
   * Attribue un rôle à un joueur (upsert). `playerId` (id Bedrock) est
   * stocké quand connu : identité stable même si le pseudo change.
   */
  assignRole(playerName, roleName, playerId) {
    if (this.getRole(roleName) === void 0) {
      return { ok: false, error: `Le rôle "${roleName}" n'existe pas.` };
    }
    const existing = this.getMember(playerName);
    if (existing === void 0) {
      this.db.insert(
        MEMBERS_COLLECTION,
        { name: playerName, role: roleName, playerId: playerId ?? null, firstSeen: Date.now() },
        playerName
      );
    } else {
      existing.data.role = roleName;
      existing.data.name = playerName;
      if (playerId !== void 0) existing.data.playerId = playerId;
      existing.updatedAt = Date.now();
      this.touch();
    }
    this.db.save();
    return { ok: true };
  }
  /** Retire le rôle d'un joueur. */
  removeRole(playerName) {
    const removed = this.db.delete(MEMBERS_COLLECTION, playerName);
    if (removed) this.touch();
    return removed;
  }
  /** Prefix personnalisé d'un joueur ("" pour réinitialiser). */
  setCustomPrefix(playerName, prefix) {
    const member = this.getMember(playerName);
    if (member === void 0) return { ok: false, error: "Ce joueur n'a pas de rôle." };
    member.data.customPrefix = prefix.trim() || void 0;
    member.updatedAt = Date.now();
    this.touch();
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
    this.touch();
    this.db.save();
    return { ok: true };
  }
  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------
  /**
   * Le porteur de ce rôle a-t-il la permission `permId` ?
   * Sémantique additive : perms par défaut du niveau UNION perms explicites.
   */
  roleCan(role, permId) {
    if (role.level >= 100) return true;
    return defaultPermsForLevel(role.level).includes(permId) || role.perms.includes(permId);
  }
  /** Le joueur a-t-il la permission `permId` ? (opérateur vanilla = toujours oui) */
  can(playerName, permId, isVanillaOp = false) {
    if (isVanillaOp) return true;
    const role = this.roleOf(playerName);
    return role !== void 0 && this.roleCan(role.data, permId);
  }
  // -------------------------------------------------------------------------
  // Rendu visuel
  // -------------------------------------------------------------------------
  /** Rôle effectif d'un joueur (ou undefined si aucun). */
  roleOf(playerName) {
    const member = this.getMember(playerName);
    return member === void 0 ? void 0 : this.getRole(member.data.role);
  }
  /** Rôle effectif par id Bedrock (résolu au join, plus fiable que le pseudo). */
  roleOfId(playerId) {
    const member = this.getMemberById(playerId);
    return member === void 0 ? void 0 : this.getRole(member.data.role);
  }
  /** Level effectif d'un joueur (0 si aucun rôle). */
  levelOf(playerName) {
    return this.roleOf(playerName)?.data.level ?? 0;
  }
  /** Le tag complet au-dessus du joueur : "§6[Admin] §fAymen". */
  nameTagFor(playerName) {
    const member = this.getMemberAny(playerName);
    const role = this.roleOf(playerName) ?? (member !== void 0 ? this.getRole(member.data.role) : void 0);
    if (role === void 0) return `§f${playerName}`;
    const color = member?.data.customColor ?? role.data.color;
    const prefix = member?.data.customPrefix ?? role.data.prefix;
    const prefixPart = prefix === "" ? "" : `${color}${prefix} §r`;
    return `${prefixPart}${color}${playerName}`;
  }
  /**
   * Marque la DB dirty après une MUTATION EN PLACE d'un document (role.data.x
   * = y) : db.update() n'est pas passé par là, donc le flag ne serait pas
   * levé et la sauvegarde écrirait l'ancien état. (Bug de perte de données.)
   */
  touch() {
    this.db.markDirty();
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
        { name: "Admin", color: "§c", prefix: "[Admin]", level: 100, perms: defaultPermsForLevel(100) },
        "Admin"
      );
    }
    this.assignRole(operatorName, "Admin");
  }
  /**
   * Crée les rôles par défaut du monde s'ils n'existent pas :
   * [Joueur] (gris foncé, niveau 0, tout le monde) et [Modo] (niveau 60).
   * À appeler au worldLoad, avant la promotion du premier admin.
   */
  bootstrapDefaultRoles() {
    if (this.getRole(DEFAULT_ROLE_NAME) === void 0) {
      this.db.insert(
        ROLES_COLLECTION,
        {
          name: DEFAULT_ROLE_NAME,
          color: DEFAULT_ROLE_COLOR,
          prefix: DEFAULT_ROLE_PREFIX,
          level: 0,
          perms: defaultPermsForLevel(0)
        },
        DEFAULT_ROLE_NAME
      );
    }
    if (this.getRole("Modo") === void 0) {
      this.db.insert(
        ROLES_COLLECTION,
        { name: "Modo", color: "§9", prefix: "[Modo]", level: 60, perms: defaultPermsForLevel(60) },
        "Modo"
      );
    }
  }
};

// src/permissions/ui.ts
function openRolesMenu(player, permissions2) {
  const roles = permissions2.allRoles();
  void openWindow(player, "Rôles", (form) => {
    form.hero("admin");
    form.label(`§7${roles.length} rôle(s). Clique pour configurer :`);
    form.divider();
    form.button(`§a■ §lCréer un rôle`, () => openCreateRoleMenu(player, permissions2), void 0, "plus");
    for (const role of roles) {
      form.button(
        `${role.data.color}[${role.data.name}]§r
§7niveau ${role.data.level} · ${permissions2.membersWithRole(role.data.name).length} membre(s)`,
        () => openRoleConfigMenu(player, role, permissions2),
        void 0,
        "crown"
      );
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openCreateRoleMenu(player, permissions2) {
  const name = obString("");
  const colorIndex = obNumber(0);
  const level = obNumber(10);
  void openWindowRaw(player, windowTitle("Créer un rôle"), (form) => {
    form.header(`§a■ §lNouveau rôle`);
    form.divider();
    form.textField("§eNom (2-16 caractères)", name);
    form.dropdown(
      "§eCouleur",
      colorIndex,
      ROLE_COLORS.map((color, value) => ({ label: `${color.code}■ ${color.id}`, value }))
    );
    form.slider("§eNiveau hiérarchique (100 = admin max)", level, 0, 100, { step: 5 });
    form.divider();
    form.button(`§a■ §lCréer le rôle`, () => {
      const clean = name.getData().trim();
      const color = ROLE_COLORS[colorIndex.getData()] ?? ROLE_COLORS[0];
      if (clean === "") {
        player.sendMessage("§c[Rôles] Nom vide.");
        return;
      }
      const result = permissions2.createRole(clean, color?.code ?? "§f", level.getData());
      player.sendMessage(
        result.ok ? `§a[Rôles] Rôle ${color?.code}[${clean}]§r§a créé.` : `§c[Rôles] ${result.error}`
      );
    });
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openRoleConfigMenu(player, role, permissions2) {
  void openWindow(player, `Rôle ${role.data.color}${role.data.name}`, (form) => {
    form.hero("role");
    form.header(`${role.data.color}■ §l${role.data.name}§r §7(niveau ${role.data.level})`);
    form.label(
      `§7Membres : §f${permissions2.membersWithRole(role.data.name).length}
§7Prefix : §f${role.data.prefix}`
    );
    form.divider();
    form.button(
      `§e■ §lChanger la couleur`,
      () => openColorPicker(player, "Couleur du rôle", (colorId) => {
        const result = permissions2.setRoleColor(role.data.name, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      }),
      void 0,
      "pencil"
    );
    form.button(
      `§e■ §lChanger le prefix`,
      () => openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
        const result = permissions2.setRolePrefix(role.data.name, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }),
      void 0,
      "tag"
    );
    form.button(`§e■ §lChanger le niveau (actuel : ${role.data.level})`, () => openLevelMenu(player, role, permissions2), void 0, "list");
    form.button(`§b■ §lVoir les membres`, () => openRoleMembersMenu(player, role, permissions2), void 0, "user");
    form.button(`§c■ §lSupprimer ce rôle`, () => {
      const result = permissions2.deleteRole(role.data.name);
      player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
    }, void 0, "trash");
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openLevelMenu(player, role, permissions2) {
  const level = obNumber(role.data.level);
  void openWindowRaw(player, windowTitle(`Niveau de [${role.data.name}]`), (form) => {
    form.slider("§eNiveau (100 = admin max)", level, 0, 100, { step: 5 });
    form.button(`§a■ §lValider`, () => {
      const result = permissions2.setRoleLevel(role.data.name, level.getData());
      player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
    }, void 0, "check");
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openRoleMembersMenu(player, role, permissions2) {
  void openWindow(player, `Membres ${role.data.color}[${role.data.name}]`, (form) => {
    const members = permissions2.membersWithRole(role.data.name);
    if (members.length === 0) {
      form.label("§7Aucun membre dans ce rôle.");
    } else {
      form.label("§7Clique sur un membre pour lui retirer le rôle :");
      for (const member of members) {
        form.button(`§f${member.data.name}`, () => {
          permissions2.removeRole(member.data.name);
          player.sendMessage(`§a[Rôles] ${member.data.name} ne fait plus partie du rôle.`);
          openRoleMembersMenu(player, role, permissions2);
        }, void 0, "user");
      }
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openColorPicker(player, title, onPick) {
  void openWindow(player, title, (form) => {
    form.label("§7Choisis une couleur :");
    for (const color of ROLE_COLORS) {
      form.button(`${color.code}■■■ §7${color.id}`, () => onPick(color.id), void 0, "pencil");
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPrefixMenu(player, title, onDone) {
  const prefix = obString("");
  void openWindowRaw(player, windowTitle(title), (form) => {
    form.textField("§ePrefix (vide = défaut [Nom])", prefix);
    form.button(`§a■ §lValider`, () => onDone(prefix.getData()), void 0, "check");
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/players-ui.ts
import { world as world9 } from "@minecraft/server";

// src/players.ts
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
function resolvePlayer(db2, playerName) {
  return findPlayerByName(db2, playerName);
}
function allKnownPlayers(db2) {
  return db2.find(PLAYERS_COLLECTION).sort((a, b) => b.data.lastSeen - a.data.lastSeen);
}

// src/permissions/players-ui.ts
function openPlayersMenu(player, permissions2, db2) {
  void openWindow(player, "Joueurs", (form) => {
    form.hero("admin");
    const online = world9.getAllPlayers();
    form.header(`§b■ §lJoueurs`);
    form.label(
      `§a● En ligne : §f${online.length}
§7● Connus (DB) : §f${db2 !== void 0 ? allKnownPlayers(db2).length : "?"}`
    );
    form.divider();
    form.label(`§a§l● En ligne§r §7(${online.length})`);
    if (online.length === 0) {
      form.label("§7Personne d'autre n'est connecté.");
    }
    for (const target of online) {
      const member = permissions2.getMember(target.name);
      const role = permissions2.getRole(member?.data.role ?? "");
      form.button(
        `${role?.data.color ?? "§7"}${target.name}§r
§7${member?.data.role ?? "aucun rôle"}`,
        () => openPlayerConfigMenu(player, target.name, permissions2, db2),
        void 0,
        "user"
      );
    }
    form.divider();
    form.label(`§7§l● Hors ligne / historique§r §7(index complet)`);
    form.button(
      `§a■ §lGérer un joueur hors ligne (saisir le pseudo)`,
      () => openPlayerLookupMenu(player, permissions2, db2),
      void 0,
      "search"
    );
    if (db2 !== void 0) {
      const known = allKnownPlayers(db2).filter(
        (record) => !online.some((target) => target.name === record.data.name)
      );
      for (const record of known.slice(0, 15)) {
        const role = permissions2.getRole(record.data.grade);
        const lastSeen = new Date(record.data.lastSeen);
        const hh = `${String(lastSeen.getHours()).padStart(2, "0")}:${String(lastSeen.getMinutes()).padStart(2, "0")}`;
        form.button(
          `§8${record.data.name}§r
§7${record.data.grade !== "" ? role?.data.color + record.data.grade + "§7 · " : ""}${record.data.sessions} session(s) · vu à ${hh}`,
          () => openPlayerConfigMenu(player, record.data.name, permissions2, db2),
          void 0,
          "history"
        );
      }
      if (known.length > 15) form.label(`§8… et ${known.length - 15} autres (recherche par pseudo)`);
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPlayerLookupMenu(player, permissions2, db2) {
  const name = obString("");
  void openWindowRaw(player, windowTitle("Gérer un joueur"), (form) => {
    form.label("§7Fonctionne même si le joueur n'est pas connecté.");
    form.textField("§ePseudo du joueur", name);
    form.button(`§b■ §lRechercher`, () => {
      const target = name.getData().trim();
      if (target !== "") openPlayerConfigMenu(player, target, permissions2, db2);
    }, void 0, "search");
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPlayerConfigMenu(player, targetName, permissions2, db2) {
  const member = permissions2.getMember(targetName);
  const roleLabel = member === void 0 ? "§7aucun" : `${permissions2.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const colorLabel = member?.data.customColor ?? "(défaut du rôle)";
  const isOnline = world9.getAllPlayers().some((candidate) => candidate.name === targetName);
  void openWindow(player, targetName, (form) => {
    form.header(`§b■ §l${targetName}§r ${isOnline ? "§a●" : "§8●"}`);
    form.label(`§7Rôle : ${roleLabel}
§7Prefix perso : §f${prefixLabel}
§7Couleur perso : §f${colorLabel}`);
    form.divider();
    form.button(
      `§e■ §lAttribuer / changer de rôle`,
      () => openAssignRoleMenu(player, targetName, permissions2, db2),
      void 0,
      "crown"
    );
    form.button(
      `§e■ §lPrefix personnalisé`,
      () => openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
        const result = permissions2.setCustomPrefix(targetName, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }),
      void 0,
      "tag"
    );
    form.button(
      `§e■ §lCouleur de nom personnalisée`,
      () => openColorPicker(player, `Couleur de ${targetName}`, (colorId) => {
        const result = permissions2.setCustomColor(targetName, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      }),
      void 0,
      "pencil"
    );
    if (member !== void 0) {
      form.button(`§c■ §lRetirer tous les rôles`, () => {
        permissions2.removeRole(targetName);
        player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
      }, void 0, "trash");
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openAssignRoleMenu(player, targetName, permissions2, db2) {
  const roles = permissions2.allRoles();
  if (roles.length === 0) {
    player.sendMessage("§c[Rôles] Aucun rôle existant. Crée-en un d'abord (/sn:roles).");
    return;
  }
  void openWindow(player, `Rôle de ${targetName}`, (form) => {
    form.label("§7Choisis le rôle à attribuer :");
    for (const role of roles) {
      form.button(`${role.data.color}[${role.data.name}]§r
§7niveau ${role.data.level}`, () => {
        const result = permissions2.assignRole(targetName, role.data.name);
        player.sendMessage(
          result.ok ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.` : `§c[Rôles] ${result.error}`
        );
      }, void 0, "crown");
    }
    void db2;
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/commands.ts
import { CustomCommandStatus as CustomCommandStatus2, CommandPermissionLevel as CommandPermissionLevel2, system as system11, PlayerPermissionLevel } from "@minecraft/server";

// src/modules/manager.ts
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
  void openWindow(player, "Modules", (form) => {
    form.hero("modules");
    form.header(`§6■ §lModules`);
    form.label(`§7${modules2.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);
    form.divider();
    for (const info of MODULE_CATALOG) {
      const enabled = modules2.isEnabled(info.id);
      form.toggle(
        `${enabled ? "§a✔" : "§c✘"} §l${info.name}§r
§7${info.description}`,
        obToggle(enabled, (value) => {
          modules2.setEnabled(info.id, value);
          player.sendMessage(`§a[Modules] ${info.name} ${value ? "§aactivé" : "§cdésactivé"}§a.`);
        })
      );
    }
    if (MODULE_CATALOG.some((info) => info.id === "territories")) {
      form.divider();
      form.button(`§e■ §lVoir les territoires`, () => {
        if (territories2 !== void 0) openTerritoriesMenu(player, territories2);
      }, void 0, "flag");
      form.button(`§c■ §lSupprimer TOUS les territoires`, () => {
        if (territories2 !== void 0) openWipeTerritoriesMenu(player, modules2, territories2);
      }, void 0, "trash");
    }
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
function openWipeTerritoriesMenu(player, modules2, territories2) {
  void openWindowRaw(player, windowTitle("Supprimer les territoires"), (form) => {
    form.header(`§4⚠ §lDANGER`);
    form.label(
      `Supprimer §lTOUS§r§4 les territoires (${territories2.all().length}) ?

§7Action irréversible !`
    );
    form.divider();
    form.hero("modules");
    form.button(`§4■ §lSUPPRIMER TOUT`, () => {
      let removed = 0;
      for (const territory of territories2.all()) {
        if (territories2.removeForced(territory.id)) removed++;
      }
      player.sendMessage(`§a[Modules] ${removed} territoire(s) supprimé(s).`);
      openModulesMenu(player, modules2, territories2);
    });
    form.button(`§a■ §lAnnuler`, () => openModulesMenu(player, modules2, territories2), void 0, "back");
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

// src/moderation/ui.ts
import { world as world11 } from "@minecraft/server";

// src/moderation/manager.ts
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
  /** Banni un joueur. durationMinutes = 0 -> permanent. playerId = Player.id si connu. */
  ban(name, by, reason, durationMinutes = 0, playerId) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.upsert(BANS_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 6e4,
      playerId: playerId ?? null
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
  mute(name, by, reason, durationMinutes, playerId) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.upsert(MUTES_COLLECTION, name, {
      name,
      reason,
      by,
      at: Date.now(),
      expiresAt: durationMinutes === 0 ? 0 : Date.now() + durationMinutes * 6e4,
      playerId: playerId ?? null
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
  warn(name, by, reason, playerId) {
    if (name.trim() === "") return { ok: false, error: "Pseudo vide." };
    this.db.insert(WARNS_COLLECTION, { name, reason, by, at: Date.now(), playerId: playerId ?? null });
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

// src/moderation/enforcement.ts
import { world as world10, system as system10 } from "@minecraft/server";
function kickPlayer(playerName, reason) {
  const player = world10.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return false;
  try {
    player.dimension.runCommand(`kick "${playerName}" ${reason.replace(/"/g, "")}`);
    return true;
  } catch {
    return false;
  }
}
function registerEnforcement(sanctions2) {
  world10.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn || !sanctions2.loaded) return;
    const player = event.player;
    const ban = sanctions2.getBan(player.name);
    if (ban === void 0) return;
    const expiry = ban.expiresAt === 0 ? "§4BANNI PERMANENTLEMENT" : `§4BANNI§7 (encore ${Math.max(1, Math.ceil((ban.expiresAt - Date.now()) / 6e4))} min)`;
    player.sendMessage(`§c[OpenMontage] ${expiry}
§7Motif : §f${ban.reason}§7 — par §f${ban.by}`);
    system10.run(() => {
      kickPlayer(player.name, ban.reason);
    });
  });
}

// src/moderation/ui.ts
function resolveTargetId(targetName) {
  const online = world11.getAllPlayers().find((candidate) => candidate.name === targetName);
  return online?.id ?? null;
}
function openSanctionsMenu(player, sanctions2, permissions2) {
  const stats = sanctions2.stats();
  void openWindow(player, "Modération", (form) => {
    form.hero("mod");
    form.header(`§4■ §lModération`);
    form.label(
      `§7Bans actifs : §f${stats.bans}
§7Mutes actifs : §f${stats.mutes}
§7Warns au total : §f${stats.warns}`
    );
    form.divider();
    form.button(`§4■ §lBans actifs`, () => openBansList(player, sanctions2, permissions2), void 0, "ban");
    form.button(`§6■ §lMutes actifs`, () => openMutesList(player, sanctions2, permissions2), void 0, "bell");
    form.button(`§e■ §lSanctionner un joueur`, () => openSanctionForm(player, sanctions2), void 0, "sword");
    form.button(`§b■ §lHistorique d'un joueur`, () => openHistoryLookup(player, sanctions2), void 0, "history");
  }).catch(
    (error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openBansList(player, sanctions2, permissions2) {
  const bans = sanctions2.allBans();
  void openWindow(player, "Bans actifs", (form) => {
    if (bans.length === 0) {
      form.label("§7Aucun ban actif.");
      return;
    }
    form.label("§7Clique sur un ban pour le lever :");
    for (const ban of bans) {
      const expiry = ban.data.expiresAt === 0 ? "§4permanent" : `§7(${formatDuration(Math.ceil((ban.data.expiresAt - Date.now()) / 6e4))})`;
      form.button(`§f${ban.data.name} ${expiry}
§7par ${ban.data.by}`, () => {
        const result = sanctions2.unban(ban.data.name);
        player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
        openBansList(player, sanctions2, permissions2);
      }, void 0, "ban");
    }
  }).catch(
    (error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openMutesList(player, sanctions2, permissions2) {
  const mutes = sanctions2.allMutes();
  void openWindow(player, "Mutes actifs", (form) => {
    if (mutes.length === 0) {
      form.label("§7Aucun mute actif.");
      return;
    }
    form.label("§7Clique sur un mute pour le lever :");
    for (const mute of mutes) {
      const expiry = mute.data.expiresAt === 0 ? "§cpermanent" : `§7(${formatDuration(Math.ceil((mute.data.expiresAt - Date.now()) / 6e4))})`;
      form.button(`§f${mute.data.name} ${expiry}
§7par ${mute.data.by}`, () => {
        const result = sanctions2.unmute(mute.data.name);
        player.sendMessage(
          result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`
        );
        openMutesList(player, sanctions2, permissions2);
      }, void 0, "bell");
    }
  }).catch(
    (error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openSanctionForm(player, sanctions2) {
  const target = obString("");
  const typeIndex = obNumber(3);
  const minutes = obNumber(60);
  const reason = obString("");
  void openWindowRaw(player, windowTitle("Sanctionner un joueur"), (form) => {
    form.header(`§e■ §lSanctionner`);
    form.textField("§ePseudo du joueur", target);
    form.dropdown(
      "§eType de sanction",
      typeIndex,
      [
        { label: "§aKick", value: 0 },
        { label: "§4Ban", value: 1 },
        { label: "§6Mute", value: 2 },
        { label: "§eWarn", value: 3 }
      ]
    );
    form.slider("§eDurée en minutes (0 = permanent)", minutes, 0, 1440, { step: 15 });
    form.textField("§eRaison", reason);
    form.divider();
    form.button(`§e■ §lAppliquer la sanction`, () => {
      const name = target.getData().trim();
      const cleanReason = reason.getData().trim() || "non spécifiée";
      if (name === "") {
        player.sendMessage("§c[Modération] Pseudo vide.");
        return;
      }
      switch (typeIndex.getData()) {
        case 0: {
          const ok = kickPlayer(name, cleanReason);
          player.sendMessage(ok ? `§a[Modération] ${name} éjecté.` : `§c[Modération] ${name} hors ligne.`);
          if (ok) sanctions2.log("kick", name, player.name, cleanReason);
          break;
        }
        case 1: {
          const result = sanctions2.ban(name, player.name, cleanReason, minutes.getData(), resolveTargetId(name));
          player.sendMessage(
            result.ok ? `§a[Modération] ${name} banni (${formatDuration(minutes.getData())}).` : `§c[Modération] ${result.error}`
          );
          break;
        }
        case 2: {
          const result = sanctions2.mute(name, player.name, cleanReason, minutes.getData(), resolveTargetId(name));
          player.sendMessage(
            result.ok ? `§a[Modération] ${name} muet (${formatDuration(minutes.getData())}).` : `§c[Modération] ${result.error}`
          );
          break;
        }
        default: {
          const result = sanctions2.warn(name, player.name, cleanReason, resolveTargetId(name));
          player.sendMessage(result.ok ? `§a[Modération] ${name} averti.` : `§c[Modération] ${result.error}`);
        }
      }
    });
    form.closeButton();
  }).catch(
    (error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openHistoryLookup(player, sanctions2) {
  const target = obString("");
  void openWindowRaw(player, windowTitle("Historique"), (form) => {
    form.textField("§ePseudo du joueur", target);
    form.button(`§b■ §lVoir l'historique`, () => {
      const name = target.getData().trim();
      if (name === "") return;
      const entries = sanctions2.historyOf(name, 15);
      if (entries.length === 0) {
        player.sendMessage(`§7[Modération] ${name} : casier vierge.`);
        return;
      }
      player.sendMessage(`§6[Modération] Historique de ${name} (${entries.length}) :`);
      for (const entry of entries) {
        player.sendMessage(
          `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${formatDate(entry.data.at)})`
        );
      }
    });
    form.closeButton();
  }).catch(
    (error) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`)
  );
}

// src/ui/hub.ts
function openHubMenu(player, deps) {
  const { permissions: permissions2, modules: modules2, territories: territories2, sanctions: sanctions2 } = deps;
  const isOp = player.playerPermissionLevel >= 2;
  const isAdmin = canUseAdminPanel(player, permissions2);
  const isMod = permissions2.can(player.name, "mod.panel", isOp);
  const canCreate = permissions2.can(player.name, "territories.create", isOp);
  const hasRole = permissions2.getMember(player.name) !== void 0;
  const canSelfColor = permissions2.can(player.name, "chat.color", isOp) || hasRole;
  void openWindow(player, "Menu", (form) => {
    form.hero("home");
    form.header(`§a■ §lOpenMontage`);
    form.divider();
    form.label(
      hasRole ? `§7Salut §f${player.name}§7 ! Ton rôle : ${permissions2.nameTagFor(player.name)}§r` : `§7Salut §f${player.name}§7 ! Tu n'as pas encore de rôle.`
    );
    form.spacer();
    form.button(
      `§a■ §lTerritoires§r
§7${canCreate ? "créer, lister, explorer" : "lister, explorer"}`,
      () => openTerritoriesMenu(player, territories2),
      { tooltip: "Revendique et explore les territoires" },
      "flag"
    );
    if (canSelfColor) {
      form.button(
        `§b■ §lMon rôle§r
§7couleur, prefix perso`,
        () => openSelfRoleMenu(player, permissions2),
        void 0,
        "tag"
      );
    }
    if (isMod) {
      form.button(
        `§4■ §lModération§r
§7bans, mutes, warns`,
        () => openSanctionsMenu(player, sanctions2, permissions2),
        void 0,
        "shield"
      );
    }
    if (isAdmin) {
      form.header(`§6§lAdministration`);
      form.button(`§6■ §lRôles§r
§7créer et régler les rôles`, () => openRolesMenu(player, permissions2), void 0, "crown");
      form.button(
        `§b■ §lJoueurs§r
§7en ligne + hors ligne`,
        () => openPlayersMenu(player, permissions2, deps.db),
        void 0,
        "user"
      );
      form.button(
        `§d■ §lModules§r
§7activer/désactiver les features`,
        () => openModulesMenu(player, modules2, territories2),
        void 0,
        "gear"
      );
    }
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
  system11.beforeEvents.startup.subscribe((event) => {
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
        system11.run(() => {
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
        system11.run(() => openHubMenu(player, ctx));
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
        system11.run(() => {
          if (!canUseAdminPanel(player, ctx.permissions)) {
            player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
            return;
          }
          void openWindow(player, "Administration", (form) => {
            form.header(`§6■ §lAdministration`);
            form.label("§7Que veux-tu gérer ?");
            form.divider();
            form.button(
              `§6■ Rôles
§7créer, couleurs, niveaux, permissions`,
              () => openRolesMenu(player, ctx.permissions)
            );
            form.button(
              `§b■ Joueurs
§7en ligne + hors ligne`,
              () => openPlayersMenu(player, ctx.permissions, ctx.db)
            );
            form.button(
              `§a■ Modules
§7activer/désactiver les features`,
              () => openModulesMenu(player, ctx.modules, ctx.territories)
            );
          }).catch(
            (error) => console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`)
          );
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
  });
}

// src/permissions/chat.ts
import { world as world12, system as system12 } from "@minecraft/server";
function stripFormatting(raw) {
  return raw.replace(/§/g, "");
}
function sanitizeMessage(raw) {
  return stripFormatting(raw).replace(/\s+/g, " ").trim().slice(0, 256);
}
function gradeTagFor(permissions2, playerName, isVanillaOp) {
  const member = permissions2.getMember(playerName);
  const role = permissions2.roleOf(playerName);
  if (role === void 0) {
    return isVanillaOp ? `§8[ §r${vanillaOpColor()}Admin§r §8]§r` : "";
  }
  const color = member?.data.customColor ?? role.data.color;
  const prefix = member?.data.customPrefix ?? role.data.prefix;
  if (prefix === "") return "";
  return `§8[ §r${color}${prefix}§r §8]§r`;
}
function nameColorFor(permissions2, playerName, isVanillaOp) {
  if (roleExists(permissions2, playerName)) {
    const member = permissions2.getMember(playerName);
    const role = permissions2.roleOf(playerName);
    return member?.data.customColor ?? role?.data.color ?? "§f";
  }
  return isVanillaOp ? vanillaOpColor() : "§f";
}
function roleExists(permissions2, playerName) {
  return permissions2.getMember(playerName) !== void 0;
}
function formatChatMessage(permissions2, playerName, message, isVanillaOp = false) {
  const grade = gradeTagFor(permissions2, playerName, isVanillaOp);
  const nameColor = nameColorFor(permissions2, playerName, isVanillaOp);
  const space = grade === "" ? "" : " ";
  const hasRole = roleExists(permissions2, playerName);
  const messageColor = hasRole || isVanillaOp ? "§f" : "§7";
  return `${grade}${space}${nameColor}${playerName}§r §7> ${messageColor}${message}`;
}
function registerChat(deps) {
  const { permissions: permissions2, getMute } = deps;
  world12.beforeEvents.chatSend.subscribe((event) => {
    if (!permissions2.loaded) return;
    const sender = event.sender;
    const isVanillaOp = sender.playerPermissionLevel >= 2;
    const mute = getMute?.(sender.name);
    if (mute !== void 0) {
      event.cancel = true;
      const remaining = mute.expiresAt === 0 ? "permanent" : `${Math.max(1, Math.ceil((mute.expiresAt - Date.now()) / 6e4))} min`;
      system12.run(() => {
        sender.sendMessage(
          `§c[Modération] Tu es muet (${remaining}). §7Motif : §f${mute.reason}§7 — par §f${mute.by}`
        );
      });
      return;
    }
    event.cancel = true;
    const message = sanitizeMessage(event.message);
    const formatted = formatChatMessage(permissions2, sender.name, message, isVanillaOp);
    system12.run(() => {
      for (const line of formatted.split("\n")) {
        world12.sendMessage(line);
      }
    });
  });
}

// src/moderation/commands.ts
import {
  CustomCommandParamType as CustomCommandParamType2,
  CustomCommandStatus as CustomCommandStatus3,
  CommandPermissionLevel as CommandPermissionLevel3,
  system as system13
} from "@minecraft/server";
import { world as world13 } from "@minecraft/server";
var NOT_PLAYER = "§c[Modération] Réservé aux joueurs.";
function requires(player, permissions2, perm) {
  return permissions2.can(player.name, perm, player.playerPermissionLevel >= 2);
}
function notifyTarget(targetName, message) {
  const target = world13.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (target !== void 0) system13.run(() => target.sendMessage(message));
}
function resolveTargetId2(targetName, db2) {
  const online = world13.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (online !== void 0) return online.id;
  if (db2 !== void 0) return resolvePlayer(db2, targetName)?.data.playerId ?? null;
  return null;
}
function registerModerationCommands(deps) {
  const { sanctions: sanctions2, permissions: permissions2, db: db2 } = deps;
  system13.beforeEvents.startup.subscribe((event) => {
    const guardAndRun = (origin, action) => {
      const player = origin.sourceEntity;
      if (player === void 0 || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus3.Failure, message: NOT_PLAYER };
      }
      if (!requires(player, permissions2, "mod.panel")) {
        return { status: CustomCommandStatus3.Failure, message: "§c[Modération] Permission manquante (mod.panel)." };
      }
      system13.run(() => action(player));
      return { status: CustomCommandStatus3.Success };
    };
    const guardPerm = (origin, perm, action) => {
      const player = origin.sourceEntity;
      if (player === void 0 || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus3.Failure, message: NOT_PLAYER };
      }
      if (!requires(player, permissions2, perm)) {
        return { status: CustomCommandStatus3.Failure, message: `§c[Modération] Permission manquante (${perm}).` };
      }
      system13.run(() => action(player));
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
      (origin, target, reason) => guardPerm(origin, "mod.kick", (player) => {
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
      (origin, target, reason, minutes) => guardPerm(origin, "mod.ban", (player) => {
        const duration = minutes ?? 0;
        const result = sanctions2.ban(target, player.name, reason, duration, resolveTargetId2(target, db2));
        if (!result.ok) {
          player.sendMessage(`§c[Modération] ${result.error}`);
          return;
        }
        player.sendMessage(
          `§a[Modération] ${target} banni (${formatDuration(duration)}). Raison : ${reason}`
        );
        notifyTarget(target, `§4[Modération] Tu es banni (${formatDuration(duration)}) : ${reason}`);
        system13.run(() => kickPlayer(target, reason));
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
      (origin, target) => guardPerm(origin, "mod.ban", (player) => {
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
      (origin, target, minutes, reason) => guardPerm(origin, "mod.mute", (player) => {
        const cleanReason = reason ?? "non spécifié";
        const result = sanctions2.mute(target, player.name, cleanReason, minutes, resolveTargetId2(target, db2));
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
      (origin, target) => guardPerm(origin, "mod.mute", (player) => {
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
      (origin, target, reason) => guardPerm(origin, "mod.warn", (player) => {
        const result = sanctions2.warn(target, player.name, reason, resolveTargetId2(target, db2));
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
      (origin, target) => guardPerm(origin, "mod.history", (player) => {
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

// src/lib/log.ts
var log3 = Logger.getLogger("OpenMontage");
var logDb = Logger.getLogger("OpenMontage", "db");
var logTerr = Logger.getLogger("OpenMontage", "territories");
var logMod = Logger.getLogger("OpenMontage", "moderation");
var logPerm = Logger.getLogger("OpenMontage", "permissions");

// src/main.ts
var db = new JsonDatabase(createBedrockStorage(), "openmontage");
registerAutosave(db, 100);
var permissions = new PermissionManager(db);
var modules = new ModuleManager(db);
var territories = new TerritoryManager(db);
var sanctions = new SanctionsManager(db);
registerCommands(territories, db, modules, permissions);
registerAdminCommands({ permissions, modules, territories, sanctions, db });
registerModerationCommands({ sanctions, permissions, db });
var protectionRegistered = false;
var chatRegistered = false;
function registerChatOnce() {
  if (chatRegistered) return;
  chatRegistered = true;
  registerChat({
    permissions,
    getMute: (playerName) => sanctions.getMute(playerName)
  });
  registerEnforcement(sanctions);
}
function applyNameTag(playerName) {
  const player = world14.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return;
  try {
    player.nameTag = permissions.nameTagFor(playerName);
  } catch {
  }
}
world14.afterEvents.worldLoad.subscribe(() => {
  Timings.begin("worldLoad");
  db.load();
  permissions.markLoaded();
  modules.markLoaded();
  territories.markLoaded();
  sanctions.markLoaded();
  permissions.bootstrapDefaultRoles();
  if (!permissions.hasAdmin()) {
    const operator = world14.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
    if (operator !== void 0) {
      permissions.bootstrapAdmin(operator.name);
      log3.info(`Bootstrap : ${operator.name} est promu Admin.`);
    }
  }
  for (const player of world14.getAllPlayers()) {
    permissions.ensureDefaultRole(player.name, player.id);
  }
  for (const player of world14.getAllPlayers()) {
    applyNameTag(player.name);
  }
  registerChatOnce();
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
  }
  const stats = db.stats();
  Timings.end();
  log3.info(
    `worldLoad OK en ~${Math.round(Timings.lastTime)} ms : ${stats.documents} documents, ${stats.bytes} octets. Modules actifs : ${modules.enabledCount()}.`
  );
});
var worldReady = false;
system14.runInterval(() => {
  if (worldReady) return;
  if (world14.getAllPlayers().length === 0) return;
  if (!territories.loaded) {
    db.load();
    permissions.markLoaded();
    modules.markLoaded();
    territories.markLoaded();
    sanctions.markLoaded();
    permissions.bootstrapDefaultRoles();
    if (!permissions.hasAdmin()) {
      const operator = world14.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
      if (operator !== void 0) permissions.bootstrapAdmin(operator.name);
    }
    for (const player of world14.getAllPlayers()) {
      permissions.ensureDefaultRole(player.name, player.id);
      applyNameTag(player.name);
    }
  }
  registerChatOnce();
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    log3.warn("Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);
world14.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  permissions.ensureDefaultRole(player.name, player.id);
  trackPlayerJoin(db, player.id, player.name, permissions.roleOf(player.name)?.data.name ?? "");
  const member = permissions.getMember(player.name);
  if (member !== void 0 && member.data.playerId !== player.id) {
    member.data.playerId = player.id;
    member.updatedAt = Date.now();
    db.markDirty();
  }
  for (const collection of ["bans", "mutes"]) {
    const doc = db.findOne(collection, player.name);
    if (doc !== void 0 && doc.data.playerId !== player.id) {
      doc.data.playerId = player.id;
      doc.updatedAt = Date.now();
      db.markDirty();
    }
  }
  applyNameTag(player.name);
  player.sendMessage("§a[OpenMontage]§r Bienvenue ! Menu principal : §f/sn:menu§r — territoire : §f/sn:create");
  player.onScreenDisplay.setTitle("§aOpenMontage §f✔");
});
system14.runInterval(() => {
  if (!permissions.loaded) return;
  for (const player of world14.getAllPlayers()) {
    applyNameTag(player.name);
  }
}, 100);
system14.runInterval(() => {
  const stats = db.stats();
  logDb.info(
    `${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`
  );
}, 600);
