// src/main.ts
import { world as world19, system as system16 } from "@minecraft/server";

// src/db/types.ts
var DB_SCHEMA_VERSION = 4;
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
  "territories.create": "Fonder un clan (État)",
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
  if (from < 4) migrateV3ToV4(file);
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
function migrateV3ToV4(file) {
  for (const doc of file.collections["territories"] ?? []) {
    const data = doc.data;
    if (typeof data["description"] !== "string") data["description"] = "Un nouvel État prend forme.";
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
var CLASSES_COLLECTION = "classes";
var JOBS_COLLECTION = "jobs";
var QUESTS_COLLECTION = "quests";
var COLLECTION_META = {
  players_index: { label: "Joueurs", hint: "sessions, grade, première/dernière connexion" },
  territories: { label: "États (clans)", hint: "chunks, drapeau, membres" },
  roles: { label: "Rôles", hint: "couleur, prefix, niveau, permissions" },
  members: { label: "Grades attribués", hint: "rôle, prefix et couleur personnalisés" },
  bans: { label: "Bans", hint: "sanctions d'exclusion actives" },
  mutes: { label: "Mutes", hint: "sanctions de chat actives" },
  warns: { label: "Avertissements", hint: "compteur d'avertissements" },
  infractions: { label: "Journal", hint: "historique de toutes les actions de modération" },
  modules: { label: "Modules", hint: "activation des fonctionnalités" },
  classes: { label: "Classes", hint: "route choisie par le joueur (définitive) + XP" },
  jobs: { label: "Métiers", hint: "métiers exercés et leur progression" },
  quests: { label: "Quêtes", hint: "objectifs, progression et récompenses" }
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
var CLAN_RADIUS = 1;
var MAX_CHUNKS_PER_TERRITORY = (CLAN_RADIUS * 2 + 1) ** 2;
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
function isWithinRadius(foundation, dimensionId, cx, cz) {
  const f = parseChunkKey(foundation);
  if (f.dimensionId !== dimensionId) return false;
  return Math.abs(cx - f.cx) <= CLAN_RADIUS && Math.abs(cz - f.cz) <= CLAN_RADIUS;
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
  /** Un clan par son identifiant (relecture fraîche pour les menus). */
  findOne(territoryId) {
    return this.db.findOne(TERRITORY_COLLECTION, territoryId);
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
  /** La clé est-elle dans le carré d'extension 3×3 de ce clan ? */
  withinBounds(territory, key) {
    const foundation = territory.data.chunkKeys[0];
    if (foundation === void 0) return false;
    const { dimensionId, cx, cz } = parseChunkKey(key);
    return isWithinRadius(foundation, dimensionId, cx, cz);
  }
  /** Ce joueur (id Bedrock) peut-il REVENDIQUER (étendre) ce chunk ? (usage : gestionnaire) */
  canClaim(playerId, playerName, key) {
    if (this.isProtected(key)) return { ok: false, reason: "Ce chunk appartient déjà à un autre clan." };
    const territory = this.findByMemberId(playerId) ?? this.findByOwner(playerName);
    if (territory === void 0) return { ok: false, reason: "Tu n'as pas de clan : fonde-le avec /sn:create." };
    if (!this.withinBounds(territory, key)) {
      const side = CLAN_RADIUS * 2 + 1;
      return { ok: false, reason: `Extension limitée au carré ${side}×${side} autour du chunk fondateur.` };
    }
    if (territory.data.chunkKeys.includes(key)) {
      return { ok: false, reason: "Ce chunk fait déjà partie de ton clan." };
    }
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) {
      return { ok: false, reason: `Limite d'extension atteinte (${MAX_CHUNKS_PER_TERRITORY} chunks, carré ${CLAN_RADIUS * 2 + 1}×${CLAN_RADIUS * 2 + 1}).` };
    }
    return { ok: true };
  }
  /** Met à jour la bio publique du clan. */
  updateDescription(territoryId, description) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return false;
    territory.data.description = description.trim().slice(0, 140);
    territory.updatedAt = Date.now();
    this.touch();
    this.db.save();
    return true;
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
   * Crée un clan sur le chunk à la position donnée : `ownerId` = Player.id
   * Bedrock (identité stable) ; `owner` = pseudo. Valide : nom, 1 clan par
   * joueur, chunk libre.
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
      return { ok: false, error: "Ce nom de clan est déjà pris." };
    }
    if (this.findByOwner(owner) !== void 0) {
      return { ok: false, error: "Tu possèdes déjà un clan." };
    }
    const key = chunkKeyFromPosition(dimensionId, x, z);
    if (this.isProtected(key)) {
      return { ok: false, error: "Ce chunk est déjà revendiqué par un autre clan." };
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
        description: "Un nouvel État prend forme.",
        chunkKeys: [key],
        createdAt: Date.now()
      },
      cleanName
    );
    this.db.save();
    return { ok: true, territory };
  }
  /** Ajoute un chunk à un clan : libre + dans le carré 3×3 du fondateur. */
  addChunk(territoryId, key) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return { ok: false, reason: "Clan introuvable." };
    if (this.isProtected(key)) return { ok: false, reason: "Ce chunk appartient déjà à un autre clan." };
    if (territory.data.chunkKeys.includes(key)) return { ok: false, reason: "Ce chunk fait déjà partie de ton clan." };
    if (!this.withinBounds(territory, key)) {
      const side = CLAN_RADIUS * 2 + 1;
      return { ok: false, reason: `Extension limitée au carré ${side}×${side} autour du chunk fondateur.` };
    }
    if (territory.data.chunkKeys.length >= MAX_CHUNKS_PER_TERRITORY) {
      return { ok: false, reason: `Limite d'extension atteinte (${MAX_CHUNKS_PER_TERRITORY} chunks).` };
    }
    territory.data.chunkKeys.push(key);
    territory.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  /** Retire un chunk d'un clan (jamais le chunk fondateur). */
  removeChunk(territoryId, key) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return { ok: false, reason: "Clan introuvable." };
    if (territory.data.chunkKeys[0] === key) {
      return { ok: false, reason: "Impossible : c'est le chunk fondateur du clan." };
    }
    const index = territory.data.chunkKeys.indexOf(key);
    if (index === -1) return { ok: false, reason: "Ce chunk n'appartient pas à ton clan." };
    territory.data.chunkKeys.splice(index, 1);
    territory.updatedAt = Date.now();
    this.db.save();
    return { ok: true };
  }
  /** Dissout un clan (propriétaire uniquement, par id Bedrock ou pseudo compat v1). */
  remove(territoryId, requester, requesterId) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return false;
    const isOwner = territory.data.ownerId === requesterId || territory.data.owner === requester;
    if (!isOwner) return false;
    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }
  /** Un membre (non propriétaire) quitte son clan. */
  leave(territoryId, playerId) {
    const territory = this.db.findOne(TERRITORY_COLLECTION, territoryId);
    if (territory === void 0) return false;
    const before = territory.data.members.length;
    territory.data.members = territory.data.members.filter((m) => m.playerId !== playerId);
    if (territory.data.members.length === before) return false;
    territory.updatedAt = Date.now();
    this.db.save();
    return true;
  }
  /** Supprime un territoire sans vérification de propriétaire (usage admin). */
  removeForced(territoryId) {
    return this.db.delete(TERRITORY_COLLECTION, territoryId);
  }
};

// src/territories/commands.ts
import { CustomCommandParamType, CustomCommandStatus, CommandPermissionLevel, system as system9, world as world9 } from "@minecraft/server";

// src/ui/theme.tsx
import { system as system7 } from "@minecraft/server";

// node_modules/@bedrock-core/ui-runtime/src/components/stateBackground.ts
function resolveStateBackgrounds(props) {
  const background = props.background ?? UNSTYLED_TEXTURE;
  return {
    background,
    backgroundHover: props.backgroundHover ?? background,
    backgroundPressed: props.backgroundPressed ?? background,
    backgroundLocked: props.backgroundLocked ?? background
  };
}

// node_modules/@bedrock-core/ui-runtime/src/components/control.ts
var UNSTYLED_TEXTURE = "textures/ui/unstyled";
function withControl(props) {
  const {
    visible: visible2,
    enabled,
    background,
    // Layout props
    width,
    height,
    display,
    flexDirection,
    justifyContent,
    alignItems,
    alignContent,
    wrap,
    gap,
    padding,
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    flexGrow,
    flexShrink,
    flexBasis,
    flex,
    alignSelf,
    margin,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    aspectRatio,
    // Positioning
    position,
    top,
    right,
    bottom,
    left,
    zIndex
  } = props;
  return {
    // Defaults, computed by layout phase
    jsonUIWidth: 100,
    jsonUIHeight: 100,
    jsonUIx: 0,
    jsonUIy: 0,
    // Control props
    visible: visible2 ?? true,
    enabled: enabled ?? true,
    background: background ?? "",
    // [440-522] optional background texture path
    // [523-605] region/scroll index. Defaults to 0 (single-region screens). For
    // multi-region screens the region-propagation pass overwrites this in place
    // (keeping the canonical key order) with the nearest slot ancestor's index.
    region: 0,
    // [606-688] the cell's font alias, read by the merged label cell for EVERY cell
    // type. Must always be a valid engine alias (see the byte map above); Text
    // overwrites it IN PLACE — re-assigning an existing key keeps its position, so the
    // value stays at [606] and never lands in the component-specific region.
    fontType: "default",
    $reserved: { bytes: 335 },
    // Reserve space for future expansion (v0008: 335 bytes, carved 83 for fontType)
    // Layout props (not serialized, used by layout phase) - stored with __ prefix
    __layout: {
      display,
      width,
      height,
      flexDirection,
      justifyContent,
      alignItems,
      alignContent,
      wrap,
      gap,
      padding,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      alignSelf,
      margin,
      marginTop,
      marginRight,
      marginBottom,
      marginLeft,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      aspectRatio,
      position,
      top,
      right,
      bottom,
      left,
      zIndex
    }
  };
}
function isControlled(props) {
  return typeof props.jsonUIx === "number" && typeof props.jsonUIy === "number" && typeof props.jsonUIWidth === "number" && typeof props.jsonUIHeight === "number";
}

// node_modules/@bedrock-core/ui-runtime/src/components/Background.ts
var BACKGROUND_SLOT_TYPE = "background";
var Background = ({ texture }) => ({
  type: BACKGROUND_SLOT_TYPE,
  props: { __background: texture }
});

// node_modules/@bedrock-core/ui-runtime/src/core/guards.ts
var isFunction = (value) => typeof value === "function";
function isElement(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && "type" in value;
}
function isActionForm(form) {
  return "button" in form;
}
function isModalForm(form) {
  return "toggle" in form;
}
function isActionContext(ctx) {
  return ctx.mode === "action";
}
function isModalContext(ctx) {
  return ctx.mode === "modal";
}
function isSerializablePrimitive(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "object" && value !== null && value !== void 0 && ("bytes" in value || "tail" in value)) {
    return true;
  }
  return false;
}

// node_modules/@bedrock-core/ui-runtime/src/core/types.ts
var SerializationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SerializationError";
  }
};
var ScrollLimitError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ScrollLimitError";
  }
};
var ModalFormError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ModalFormError";
  }
};

// node_modules/@bedrock-core/ui-runtime/src/core/writers.ts
function emitButton(payload, form, ctx, callbacks, icon) {
  if (!isActionForm(form)) {
    throw new ModalFormError(
      "emitButton(): a button-slot control reached the modal form path. Modal forms accept only toggle/slider/dropdown/input/label plus the hardcoded submit/esc buttons — move interactive `Button`s out of the `<ModalForm>`."
    );
  }
  if (ctx && isActionContext(ctx)) {
    if (callbacks.onPress) {
      ctx.buttonCallbacks.set(ctx.buttonIndex, callbacks.onPress);
    }
    ctx.buttonIndex++;
  }
  form.button(payload, icon);
}
function emitLabel(payload, form, ctx) {
  if (ctx && isModalContext(ctx)) {
    ctx.modalControlIndex++;
  }
  form.label(payload);
}
function emitHeader(payload, form, ctx) {
  if (!isActionForm(form)) {
    emitLabel(payload, form, ctx);
    return;
  }
  form.header(payload);
}
function recordModalOrdinal(ctx, name) {
  if (ctx && isModalContext(ctx)) {
    ctx.modalControls.set(ctx.modalControlIndex, { name });
    ctx.modalControlIndex++;
  }
}
function emitToggle(payload, form, ctx, name, defaultValue) {
  recordModalOrdinal(ctx, name);
  form.toggle(payload, { defaultValue });
}
function emitSlider(payload, form, ctx, name, min, max, defaultValue, valueStep) {
  recordModalOrdinal(ctx, name);
  form.slider(payload, min, max, { defaultValue, valueStep });
}
function emitDropdown(payload, form, ctx, name, options, defaultValueIndex) {
  recordModalOrdinal(ctx, name);
  form.dropdown(payload, options, { defaultValueIndex });
}
function emitInput(payload, form, ctx, name, placeholder, defaultValue) {
  recordModalOrdinal(ctx, name);
  form.textField(payload, placeholder, { defaultValue });
}

// node_modules/@bedrock-core/ui-runtime/src/components/Button.ts
var Button = ({ onPress, backgroundHover, backgroundPressed, backgroundLocked, children, ...rest }) => {
  const states = resolveStateBackgrounds({ background: rest.background, backgroundHover, backgroundPressed, backgroundLocked });
  return {
    type: "button",
    props: {
      ...withControl({ ...rest, background: states.background }),
      backgroundHover: states.backgroundHover,
      backgroundPressed: states.backgroundPressed,
      backgroundLocked: states.backgroundLocked,
      onPress: onPress ?? (() => {
      }),
      children
    }
  };
};
var buttonWriter = (payload, form, ctx, callbacks) => {
  emitButton(payload, form, ctx, callbacks);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/controlPayload.ts
var FONT_SIZE_BASE = 0.5;
var FONT_TYPE_MAP = {
  mojangles: "default",
  minecraftTen: "MinecraftTen"
};
function labelFontFields(style = {}) {
  return {
    fontType: FONT_TYPE_MAP[style.font ?? "mojangles"],
    fontScaleFactor: (style.scale ?? 1) / FONT_SIZE_BASE
  };
}
function labelPayloadFields(prefix, opts = {}) {
  const font = labelFontFields(opts);
  return {
    [`${prefix}FontType`]: font.fontType,
    [`${prefix}FontScale`]: font.fontScaleFactor,
    [`${prefix}X`]: opts.x ?? 0,
    [`${prefix}Y`]: opts.y ?? 0,
    [`${prefix}Text`]: opts.text ?? ""
  };
}

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormOption.ts
var MODAL_OPTION_SLOT_TYPE = "modal-option";
var FormOption = ({
  value,
  label,
  background,
  backgroundHover,
  backgroundSelected,
  bullet,
  bulletSelected,
  bulletHover,
  bulletSelectedHover,
  bulletWidth,
  bulletHeight,
  font,
  scale,
  align,
  ...layout
}) => {
  const fontFields = font !== void 0 || scale !== void 0 ? labelFontFields({ font, scale }) : void 0;
  return {
    type: MODAL_OPTION_SLOT_TYPE,
    props: {
      ...withControl(layout),
      value,
      label,
      background,
      backgroundHover,
      backgroundSelected,
      bullet,
      bulletSelected,
      bulletHover,
      bulletSelectedHover,
      bulletWidth,
      bulletHeight,
      align,
      // Resolved font fields (or undefined → inherit the group's), so the writer needn't re-map.
      __optionFontType: fontFields?.fontType,
      __optionFontScale: fontFields?.fontScaleFactor
    }
  };
};

// node_modules/@bedrock-core/ui-runtime/src/components/Scroll.ts
var SCROLL_SLOT_TYPE = "scroll-slot";
var MAX_SCROLLS = 4;
var MAX_POOLED_SCROLLS = 2;
var Scroll = ({ children, ...rest }) => ({
  type: SCROLL_SLOT_TYPE,
  props: {
    // Viewport laid out like any other control: control props flow through withControl into
    // __layout. `__axis` is fixed to 'y' so the title still carries the axis field (protocol
    // unchanged); horizontal scrolling isn't exposed yet.
    ...withControl(rest),
    __axis: "y",
    children
  }
});

// node_modules/@bedrock-core/i18n/src/interpolate.ts
var VAR_RE = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}/g;
var SLOT_RE = /%(?:(\d+)\$)?s/g;
function isNamedArgs(args) {
  return !Array.isArray(args);
}
function interpolate(template, args) {
  if (args === void 0) {
    return template;
  }
  if (isNamedArgs(args)) {
    return template.replace(VAR_RE, (marker, name) => name in args ? String(args[name]) : marker);
  }
  let auto = 0;
  return template.replace(SLOT_RE, (marker, index) => {
    const i = index === void 0 ? auto++ : Number(index) - 1;
    return i >= 0 && i < args.length ? String(args[i]) : marker;
  });
}

// node_modules/@bedrock-core/i18n/src/createI18n.ts
var defaultInstance;
function currentI18n() {
  return defaultInstance;
}
var PATH = Symbol("i18n.path");

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/context.ts
function createContext(defaultValue) {
  const Ctx = (props) => ({
    type: "context-provider",
    props: {
      __context: Ctx,
      value: props.value,
      children: props.children
    }
  });
  Ctx.defaultValue = defaultValue;
  return Ctx;
}

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/registry.ts
var FiberRegistry = /* @__PURE__ */ new Map();
var currentFiber = void 0;
var currentDispatcher = void 0;
function setCurrentFiber(fiber, dispatcher) {
  currentFiber = fiber;
  currentDispatcher = dispatcher;
}
function getCurrentFiber() {
  return [currentFiber, currentDispatcher];
}

// node_modules/@bedrock-core/ui-runtime/src/hooks/useEffect.ts
function useEffect(effect, deps) {
  const [, d] = getCurrentFiber();
  invariant(d, "useEffect");
  return d.useEffect(effect, deps);
}

// node_modules/@bedrock-core/ui-runtime/src/hooks/useContext.ts
function useContext(ctx) {
  const [, d] = getCurrentFiber();
  invariant(d, "useContext");
  return d.useContext(ctx);
}

// node_modules/@bedrock-core/ui-runtime/src/hooks/useExit.ts
function useExit() {
  const [, d] = getCurrentFiber();
  invariant(d, "useExit");
  return d.useExit();
}

// node_modules/@bedrock-core/ui-runtime/src/data/Translation.ts
var TranslationContext = createContext(null);
function defaultResolverFor(getPlayer) {
  const instance = currentI18n();
  return instance ? instance.forPlayer(getPlayer()).resolve : null;
}
var DefaultTranslations = ({ player, children }) => TranslationContext({ value: defaultResolverFor(() => player), children });
function useTranslationResolver() {
  const [fiber] = getCurrentFiber();
  if (!fiber) {
    return null;
  }
  return useContext(TranslationContext);
}

// node_modules/@bedrock-core/ui-runtime/src/components/Text.ts
var TEXT_SHADOW_TYPE = "text_shadow";
var TEXT_WRAP_TYPE = "text_wrap";
var TEXT_SHADOW_WRAP_TYPE = "text_shadow_wrap";
function isTextElementType(type) {
  return type === "text" || type === TEXT_SHADOW_TYPE || type === TEXT_WRAP_TYPE || type === TEXT_SHADOW_WRAP_TYPE;
}
function safeLabelText(text) {
  return /^[\d-]/.test(text) ? `§r${text}` : text;
}
var Text = ({
  children,
  font,
  scale,
  wordBreak,
  overflow,
  maxLines,
  offsetX,
  offsetY,
  shadow,
  ...rest
}) => {
  const resolvedScale = scale ?? 1;
  const labelFont = labelFontFields({ font, scale });
  if (Array.isArray(children)) {
    throw new Error("Text accepts a single string or RawMessage child — compose inside a RawMessage or use sibling <Text> elements.");
  }
  const rawChild = typeof children === "object" && children !== null ? children : void 0;
  const stringChild = typeof children === "string" ? children : void 0;
  const resolver = useTranslationResolver();
  const translateKey = rawChild?.translate;
  const withArgs = rawChild?.with;
  const hasArgs = withArgs !== void 0 && !(Array.isArray(withArgs) && withArgs.length === 0);
  let isLocalized;
  let resolvedText;
  if (rawChild !== void 0) {
    isLocalized = true;
    resolvedText = translateKey !== void 0 ? resolver?.(translateKey) ?? translateKey : rawChild.text ?? "";
    if (translateKey !== void 0 && hasArgs && withArgs !== void 0) {
      const params = Array.isArray(withArgs) ? withArgs : (withArgs.rawtext ?? []).map((param) => param.text ?? (param.translate !== void 0 ? resolver?.(param.translate) ?? param.translate : ""));
      resolvedText = interpolate(resolvedText, params);
    }
  } else {
    const candidate = stringChild ?? "";
    const hit = candidate === "" ? void 0 : resolver?.(candidate);
    isLocalized = hit !== void 0;
    resolvedText = hit ?? candidate;
  }
  const tail = rawChild !== void 0 ? translateKey !== void 0 && !hasArgs ? translateKey : { rawtext: [{ text: "§r" }, rawChild] } : isLocalized && stringChild !== void 0 ? stringChild : safeLabelText(resolvedText);
  const rpWraps = isLocalized && (wordBreak === "break-word" || overflow === "ellipsis" || maxLines !== void 0);
  return {
    // Shadow picks the component TYPE (see TEXT_SHADOW_TYPE): all types share this
    // writer and payload; the RP routers gate them apart with the standard type gate.
    type: shadow ? rpWraps ? TEXT_SHADOW_WRAP_TYPE : TEXT_SHADOW_TYPE : rpWraps ? TEXT_WRAP_TYPE : "text",
    props: {
      ...withControl(rest),
      // The COMMON font slot at [606-688]. Assigning an existing key does not move
      // it, so this overwrites withControl's 'default' in place rather than
      // appending — the RP's label leaves read the font from here for every cell
      // type, which is what keeps texture paths out of #font_type.
      fontType: labelFont.fontType,
      // The label GROUP contract (v0008, decoded sequentially from [1024]):
      // labelFontType, fontScale, x, y, text — text LAST, as the payload's variable
      // tail. Field ORDER is what the RP reads. `labelFontType` is the group's
      // original font slot; the cell label now sources [606] instead, but the slot
      // stays so every later group offset (labelX [1190], labelY [1273], tail) and
      // every sub-element group that still reads its own slot 1 are unchanged.
      labelFontType: labelFont.fontType,
      fontScaleFactor: labelFont.fontScaleFactor,
      labelX: offsetX ?? 0,
      // [1190] → label anchored X offset
      labelY: offsetY ?? 0,
      // [1273] → label anchored Y offset
      value: { tail },
      __textMetrics: {
        font,
        fontSize: resolvedScale,
        wordBreak,
        overflow,
        maxLines,
        // Resolved display string used by the layout phase for metrics.
        // For raw text this equals the tail; for localized text it's the
        // server-side resolution (the client paints its own).
        resolvedText,
        // True for localized texts: the tail holds a key or RawMessage the
        // client resolves, so the layout phase must never rewrite it with
        // processed display text. Raw text DOES get its wrapped/truncated
        // string committed — a JSON UI label is content-sized and never wraps
        // on its own, so the `\n`s must be in the string.
        isKey: isLocalized
      }
    }
  };
};
var textWriter = (payload, form, ctx) => {
  emitLabel(payload, form, ctx);
};

// node_modules/@bedrock-core/ui-runtime/src/core/componentRegistry.ts
var registry = /* @__PURE__ */ new Map();
function registerComponent(type, descriptor) {
  if (registry.has(type)) {
    throw new SerializationError(
      `registerComponent(): type "${type}" is already registered. Pick a unique, namespaced type for your custom component.`
    );
  }
  if (!descriptor.transparent && !descriptor.writer) {
    throw new SerializationError(
      `registerComponent(): descriptor for "${type}" must provide a writer or be transparent.`
    );
  }
  registry.set(type, descriptor);
}
function getComponentDescriptor(type) {
  return registry.get(type);
}
function isTransparentType(type) {
  return registry.get(type)?.transparent ?? false;
}
function getRegisteredTypes() {
  return [...registry.keys()].sort();
}

// node_modules/@bedrock-core/ui-runtime/src/core/serializer.ts
var FIELD_MARKERS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".split("");
var PAD_CHAR = ";";
var VERSION = "v0008";
var PROTOCOL_HEADER = `bcui${VERSION}`;
var TYPE_WIDTH = {
  s: 80,
  n: 80,
  b: 5,
  r: 0
  // variable
};
var PREFIX_WIDTH = {
  s: 2,
  n: 2,
  b: 2,
  r: 0
};
var MARKER_WIDTH = 1;
var FULL_WIDTH = {
  s: PREFIX_WIDTH.s + TYPE_WIDTH.s + MARKER_WIDTH,
  n: PREFIX_WIDTH.n + TYPE_WIDTH.n + MARKER_WIDTH,
  b: PREFIX_WIDTH.b + TYPE_WIDTH.b + MARKER_WIDTH,
  r: TYPE_WIDTH.r
};
var TYPE_PREFIX = {
  s: "s",
  n: "n",
  b: "b",
  r: "r"
};
function utf8ByteLength(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 127) {
      bytes += 1;
    } else if (code <= 2047) {
      bytes += 2;
    } else if (code >= 55296 && code <= 56319) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 56320 && next <= 57343) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else if (code >= 56320 && code <= 57343) {
      bytes += 3;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
function getFieldMarker(index, key) {
  if (index >= FIELD_MARKERS.length) {
    throw new SerializationError(`serialize(): exceeded maximum number of 64 props in an element. Key: "${key}" and following do not fit`);
  }
  return FIELD_MARKERS[index];
}
function padToByteLength(str, length) {
  const currentLength = utf8ByteLength(str);
  if (currentLength > length) {
    throw new SerializationError(`serialize(): string ${str} exceeds maximum byte length of ${length} bytes, actual ${currentLength} bytes. Prefer to use translate keys for long texts.`);
  }
  return str + PAD_CHAR.repeat(length - currentLength);
}
function serialize({ type, props: { children, ...rest }, nativeArgs }, form, context) {
  if (typeof type === "function") {
    throw new SerializationError(
      `serialize(): Encountered unresolved function component "${type.name || "anonymous"}". This is a bug - buildTree() should have called all function components before serialization.`
    );
  }
  if (rest.visible === false) {
    return;
  }
  if (type === MODAL_OPTION_SLOT_TYPE) {
    return;
  }
  if (isTransparentType(type)) {
    if (children) {
      const childArray = Array.isArray(children) ? children : [children];
      childArray.filter(isElement).forEach((child) => {
        serialize(child, form, context);
      });
    }
    return;
  }
  if (type === "panel") {
    const childElements = (Array.isArray(children) ? children : children !== void 0 ? [children] : []).filter(isElement);
    const panelBackground = rest.background;
    if (typeof panelBackground !== "string" || panelBackground === "") {
      childElements.forEach((child) => {
        serialize(child, form, context);
      });
      return;
    }
    if (childElements.length === 1) {
      const [child] = childElements;
      const childProps = child.props;
      if ((child.type === "text" || child.type === TEXT_SHADOW_TYPE) && childProps.visible !== false && (childProps.background === void 0 || childProps.background === "") && typeof childProps.jsonUIx === "number" && typeof childProps.jsonUIy === "number" && typeof rest.jsonUIx === "number" && typeof rest.jsonUIy === "number") {
        const { children: _textContent, ...childRest } = childProps;
        const merged = {
          type: child.type,
          props: {
            ...childRest,
            jsonUIWidth: rest.jsonUIWidth,
            jsonUIHeight: rest.jsonUIHeight,
            jsonUIx: rest.jsonUIx,
            jsonUIy: rest.jsonUIy,
            background: panelBackground,
            labelX: (typeof childProps.labelX === "number" ? childProps.labelX : 0) + childProps.jsonUIx - rest.jsonUIx,
            labelY: (typeof childProps.labelY === "number" ? childProps.labelY : 0) + childProps.jsonUIy - rest.jsonUIy
          }
        };
        serialize(merged, form, context);
        return;
      }
    }
  }
  const serializableProps = {};
  const invalidProps = [];
  const callbacks = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key.startsWith("__")) {
      continue;
    }
    if (isSerializablePrimitive(value)) {
      serializableProps[key] = value;
    } else if (isFunction(value)) {
      callbacks[key] = value;
    } else {
      invalidProps.push(`${key} (type: ${typeof value}, value: ${JSON.stringify(value)})`);
    }
  }
  if (invalidProps.length > 0) {
    throw new SerializationError(
      `Component "${type}" has non-serializable props. All props must be primitives (string, number, boolean) or ReservedBytes. Invalid props: ${invalidProps.join(", ")}. Ensure all optional props have default values in the component definition.`
    );
  }
  const [payload] = serializeProps({ type, ...serializableProps });
  const descriptor = getComponentDescriptor(type);
  if (!descriptor?.writer) {
    const known = getRegisteredTypes().join(", ");
    throw new SerializationError(`Unknown native component type: ${type}. Known types: ${known}`);
  }
  descriptor.writer(payload, form, context, callbacks, serializableProps, nativeArgs, children);
  if (children) {
    const childArray = Array.isArray(children) ? children : [children];
    childArray.filter(isElement).forEach((child) => {
      serialize(child, form, context);
    });
  }
}
function serializeProps({ type, ...props }) {
  let totalBytes = 0;
  let rawTail;
  const entries = Object.entries({ type, ...props });
  const segments = entries.map(([key, value], index) => {
    let core;
    let widthBytes;
    let rawStr;
    if (typeof value === "object" && value !== null && "tail" in value) {
      if (index !== entries.length - 1) {
        throw new SerializationError(`serialize(): tail property "${key}" must be the last field of the payload`);
      }
      if (typeof value.tail === "string") {
        totalBytes += utf8ByteLength(value.tail);
        return value.tail;
      }
      rawTail = value.tail;
      return "";
    } else if (typeof value === "boolean") {
      rawStr = value ? "true" : "false";
      core = `${TYPE_PREFIX.b}:${padToByteLength(rawStr, TYPE_WIDTH.b)}`;
      widthBytes = FULL_WIDTH.b;
    } else if (typeof value === "number") {
      rawStr = value.toString();
      core = `${TYPE_PREFIX.n}:${padToByteLength(rawStr, TYPE_WIDTH.n)}`;
      widthBytes = FULL_WIDTH.n;
    } else if (typeof value === "object" && value.bytes !== void 0) {
      core = `${PAD_CHAR.repeat(value.bytes - 1)}`;
      widthBytes = value.bytes;
    } else if (typeof value === "string") {
      rawStr = value;
      core = `${TYPE_PREFIX.s}:${padToByteLength(rawStr, TYPE_WIDTH.s)}`;
      widthBytes = FULL_WIDTH.s;
    } else {
      throw new SerializationError(`serialize(): unsupported type for property "${key}": ${typeof value} (value: ${JSON.stringify(value)})`);
    }
    totalBytes += widthBytes;
    const marker = getFieldMarker(index, key);
    return core + marker;
  });
  const prefix = PROTOCOL_HEADER;
  const result = prefix + segments.join("");
  const finalBytes = totalBytes + utf8ByteLength(prefix);
  if (rawTail !== void 0) {
    return [{ rawtext: [{ text: result }, rawTail] }, finalBytes];
  }
  return [result, finalBytes];
}
function asStaticPayload(payload) {
  if (typeof payload !== "string") {
    throw new SerializationError("serialize(): tail payloads are not valid in title/metadata fields");
  }
  return payload;
}
var SCROLL_FIELD_COUNT = 6;
var SCROLL_BLOCK_BYTES = SCROLL_FIELD_COUNT * FULL_WIDTH.n;
var FLOW_BUTTON_BLOCK_BYTES = 4 * FULL_WIDTH.n + 2 * FULL_WIDTH.b + 5 * FULL_WIDTH.s;
var BACKGROUND_TITLE_SKIP = FULL_WIDTH.s + (MAX_SCROLLS + 1) * SCROLL_BLOCK_BYTES;
function serializeScrollMetadata(scrolls, background = "") {
  const fields = {};
  scrolls.forEach((scroll, index) => {
    fields[`axis${index}`] = scroll.axis;
    fields[`x${index}`] = Math.round(scroll.x);
    fields[`y${index}`] = Math.round(scroll.y);
    fields[`width${index}`] = Math.round(scroll.width);
    fields[`height${index}`] = Math.round(scroll.height);
    fields[`extent${index}`] = Math.round(scroll.extent);
  });
  if (background !== "") {
    const emptySlots = MAX_SCROLLS + 1 - scrolls.length;
    if (emptySlots > 0) {
      fields.pad = { bytes: emptySlots * SCROLL_BLOCK_BYTES };
    }
    fields.bg = background;
  }
  const [payload] = serializeProps({ type: "scrolls", ...fields });
  return asStaticPayload(payload);
}
function serializeModalTitle(scrolls, extraFields, background = "") {
  if (scrolls.length !== 1) {
    throw new ModalFormError(
      `A modal <Form> must have exactly the root scroll (got ${scrolls.length}). <Scroll> regions are ActionForm-only; the title field offsets depend on a single scroll block.`
    );
  }
  const modalFieldsEnd = FULL_WIDTH.s + SCROLL_BLOCK_BYTES + 2 * FLOW_BUTTON_BLOCK_BYTES;
  const backgroundFields = background !== "" ? { pad: { bytes: BACKGROUND_TITLE_SKIP - modalFieldsEnd }, bg: background } : {};
  const [scroll] = scrolls;
  const [payload] = serializeProps({
    type: "scrolls",
    axis0: scroll.axis,
    x0: Math.round(scroll.x),
    y0: Math.round(scroll.y),
    width0: Math.round(scroll.width),
    height0: Math.round(scroll.height),
    extent0: Math.round(scroll.extent),
    ...extraFields,
    ...backgroundFields
  });
  return asStaticPayload(payload);
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/lifecycle.ts
import { uiManager as uiManager2 } from "@minecraft/server-ui";

// node_modules/@bedrock-core/ui-runtime/src/util/inputLock.ts
import { InputPermissionCategory } from "@minecraft/server";
var inputLocks = /* @__PURE__ */ new Map();
function startInputLock(player) {
  if (inputLocks.has(player.id)) {
    return;
  }
  const previousCameraPermission = player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Camera);
  const previousMovementPermission = player.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.Movement);
  inputLocks.set(player.id, {
    camera: previousCameraPermission,
    movement: previousMovementPermission
  });
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, false);
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, false);
}
function stopInputLock(player) {
  const previousPermissions = inputLocks.get(player.id);
  if (!previousPermissions) {
    return;
  }
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, previousPermissions.camera);
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, previousPermissions.movement);
  inputLocks.delete(player.id);
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/presenters/presentAction.ts
import { ActionFormData } from "@minecraft/server-ui";

// node_modules/@bedrock-core/flexbox/src/constants.ts
var SCREEN = {
  POCKET: { width: 320, height: 210 },
  DESKTOP: { width: 376, height: 250 }
};
var CANONICAL_SCREEN = SCREEN.POCKET;

// node_modules/@bedrock-core/flexbox/src/utils.ts
function isPercent(value) {
  return typeof value === "string" && value.endsWith("%");
}
function resolveSize(value, parentSize) {
  if (value === void 0 || value === "auto") {
    return void 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return parseFloat(value) / 100 * parentSize;
}
function resolveSpacing(value, base) {
  if (value === void 0) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return parseFloat(value) / 100 * base;
}
function resolvePadding(style, parentWidth) {
  const base = style.padding;
  return {
    top: resolveSpacing(style.paddingTop ?? base, parentWidth),
    right: resolveSpacing(style.paddingRight ?? base, parentWidth),
    bottom: resolveSpacing(style.paddingBottom ?? base, parentWidth),
    left: resolveSpacing(style.paddingLeft ?? base, parentWidth)
  };
}
function resolveMargin(style, parentWidth) {
  const base = style.margin;
  return {
    top: resolveSpacing(style.marginTop ?? base, parentWidth),
    right: resolveSpacing(style.marginRight ?? base, parentWidth),
    bottom: resolveSpacing(style.marginBottom ?? base, parentWidth),
    left: resolveSpacing(style.marginLeft ?? base, parentWidth)
  };
}
function resolveRowGap(style, containerWidth) {
  return resolveSpacing(style.rowGap ?? style.gap, containerWidth);
}
function resolveColumnGap(style, containerHeight) {
  return resolveSpacing(style.columnGap ?? style.gap, containerHeight);
}
function resolveFlexGrow(style) {
  if (style.flexGrow !== void 0) {
    return style.flexGrow;
  }
  if (style.flex !== void 0) {
    return style.flex;
  }
  return 0;
}
function resolveFlexShrink(style) {
  return style.flexShrink ?? 1;
}
function resolveFlexBasisMain(style, measuredMain) {
  if (typeof style.flexBasis === "number") {
    return style.flexBasis;
  }
  if (style.flexBasis !== void 0 && style.flexBasis !== "auto") {
    return measuredMain;
  }
  if (style.flexBasis === void 0 && resolveFlexGrow(style) > 0) {
    return 0;
  }
  return measuredMain;
}
function resolveAlignSelf(childStyle, parentAlignItems) {
  const as = childStyle.alignSelf ?? "auto";
  if (as !== "auto") {
    return as;
  }
  return parentAlignItems;
}

// node_modules/@bedrock-core/flexbox/src/layout.ts
function visible(node) {
  return node.style.display !== "none";
}
function relative(node) {
  return (node.style.position ?? "relative") === "relative";
}
function mainAxis(style) {
  const d = style.flexDirection ?? "column";
  return d === "row" || d === "row-reverse" ? "row" : "column";
}
function applyAspectRatio(node) {
  const ratio = node.style.aspectRatio;
  if (ratio === void 0 || ratio <= 0 || node.measure) {
    return;
  }
  const widthExplicit = node.style.width !== void 0;
  const heightExplicit = node.style.height !== void 0;
  if (widthExplicit && heightExplicit) {
    return;
  }
  const widthDefinite = typeof node.style.width === "number" || isPercent(node.style.width) && node.layout.width > 0;
  const heightDefinite = typeof node.style.height === "number" || isPercent(node.style.height) && node.layout.height > 0;
  if (heightExplicit) {
    if (heightDefinite) {
      node.layout.width = node.layout.height * ratio;
    }
    return;
  }
  if (widthExplicit && !widthDefinite) {
    return;
  }
  node.layout.height = node.layout.width / ratio;
}
function clamp(node, parentW, parentH) {
  const s = node.style;
  const minW = resolveSize(s.minWidth, parentW);
  const maxW = resolveSize(s.maxWidth, parentW);
  const minH = resolveSize(s.minHeight, parentH);
  const maxH = resolveSize(s.maxHeight, parentH);
  if (minW !== void 0) {
    node.layout.width = Math.max(node.layout.width, minW);
  }
  if (maxW !== void 0) {
    node.layout.width = Math.min(node.layout.width, maxW);
  }
  if (minH !== void 0) {
    node.layout.height = Math.max(node.layout.height, minH);
  }
  if (maxH !== void 0) {
    node.layout.height = Math.min(node.layout.height, maxH);
  }
}
function deriveSize(node, axis, parentWidth) {
  const s = node.style;
  const dir = mainAxis(s);
  const isMainAxis = axis === "width" === (dir === "row");
  const pad = resolvePadding(s, parentWidth);
  const paddingMain = axis === "width" ? pad.left + pad.right : pad.top + pad.bottom;
  const gap = axis === "width" ? resolveRowGap(s, 0) : resolveColumnGap(s, 0);
  const kids = node.children.filter((c) => visible(c) && relative(c));
  if (isMainAxis) {
    const isWrap = (s.wrap ?? "nowrap") !== "nowrap";
    if (isWrap) {
      let max = paddingMain;
      for (const child of kids) {
        const styleSize = axis === "width" ? child.style.width : child.style.height;
        if (isPercent(styleSize)) {
          continue;
        }
        const childSize = axis === "width" ? child.layout.width : child.layout.height;
        const cm = resolveMargin(child.style, parentWidth);
        const childMargin = axis === "width" ? cm.left + cm.right : cm.top + cm.bottom;
        max = Math.max(max, paddingMain + childSize + childMargin);
      }
      return max;
    }
    let total = paddingMain;
    let count = 0;
    for (const child of kids) {
      const styleSize = axis === "width" ? child.style.width : child.style.height;
      if (isPercent(styleSize)) {
        continue;
      }
      const childSize = axis === "width" ? child.layout.width : child.layout.height;
      const cm = resolveMargin(child.style, parentWidth);
      const childMargin = axis === "width" ? cm.left + cm.right : cm.top + cm.bottom;
      total += childSize + childMargin;
      count++;
    }
    if (count > 1) {
      total += (count - 1) * gap;
    }
    return total;
  } else {
    const isWrap = (s.wrap ?? "nowrap") !== "nowrap";
    if (isWrap) {
      const wrapMainAvail = dir === "row" ? node.layout.width - pad.left - pad.right : node.layout.height - pad.top - pad.bottom;
      if (wrapMainAvail > 0) {
        const wrapMainGap = dir === "row" ? resolveRowGap(s, 0) : resolveColumnGap(s, 0);
        const wrapCrossGap = dir === "row" ? resolveColumnGap(s, 0) : resolveRowGap(s, 0);
        const lineCrossSizes = [];
        let lineMainUsed = 0;
        let lineCrossMax = 0;
        let lineHasChild = false;
        for (const child of kids) {
          const styleMainSize = dir === "row" ? child.style.width : child.style.height;
          if (isPercent(styleMainSize)) {
            continue;
          }
          const cm = resolveMargin(child.style, parentWidth);
          const childMain = dir === "row" ? child.layout.width + cm.left + cm.right : child.layout.height + cm.top + cm.bottom;
          const childCross = dir === "row" ? child.layout.height + cm.top + cm.bottom : child.layout.width + cm.left + cm.right;
          const gapOffset = lineHasChild ? wrapMainGap : 0;
          if (lineHasChild && lineMainUsed + gapOffset + childMain > wrapMainAvail + 1e-3) {
            lineCrossSizes.push(lineCrossMax);
            lineMainUsed = childMain;
            lineCrossMax = childCross;
          } else {
            lineMainUsed += gapOffset + childMain;
            lineCrossMax = Math.max(lineCrossMax, childCross);
            lineHasChild = true;
          }
        }
        if (lineHasChild) {
          lineCrossSizes.push(lineCrossMax);
        }
        if (lineCrossSizes.length > 0) {
          const totalCross = lineCrossSizes.reduce((a, b) => a + b, 0) + Math.max(0, lineCrossSizes.length - 1) * wrapCrossGap;
          return totalCross + paddingMain;
        }
      }
    }
    let max = 0;
    for (const child of kids) {
      const styleSize = axis === "width" ? child.style.width : child.style.height;
      if (isPercent(styleSize)) {
        continue;
      }
      const childSize = axis === "width" ? child.layout.width : child.layout.height;
      const cm = resolveMargin(child.style, parentWidth);
      const childMargin = axis === "width" ? cm.left + cm.right : cm.top + cm.bottom;
      max = Math.max(max, childSize + childMargin);
    }
    return max + paddingMain;
  }
}
function applyCrossAlign(child, pad, parent, dir, effectiveAlign) {
  const cm = resolveMargin(child.style, parent.layout.width);
  if (dir === "row") {
    const crossStart = parent.layout.y + pad.top;
    const crossAvail = parent.layout.height - pad.top - pad.bottom;
    if (effectiveAlign === "flex-start" || effectiveAlign === "stretch") {
      child.layout.y = crossStart + cm.top;
    } else if (effectiveAlign === "center") {
      child.layout.y = crossStart + (crossAvail - child.layout.height) / 2;
    } else if (effectiveAlign === "flex-end") {
      child.layout.y = crossStart + crossAvail - child.layout.height - cm.bottom;
    }
  } else {
    const crossStart = parent.layout.x + pad.left;
    const crossAvail = parent.layout.width - pad.left - pad.right;
    if (effectiveAlign === "flex-start" || effectiveAlign === "stretch") {
      child.layout.x = crossStart + cm.left;
    } else if (effectiveAlign === "center") {
      child.layout.x = crossStart + (crossAvail - child.layout.width) / 2;
    } else if (effectiveAlign === "flex-end") {
      child.layout.x = crossStart + crossAvail - child.layout.width - cm.right;
    }
  }
}
var MAX_MEASURE_ROUNDS = 2;
function collectMeasured(node, out) {
  if (node.measure) {
    out.set(node, node.measure(Number.POSITIVE_INFINITY));
  }
  for (const child of node.children) {
    collectMeasured(child, out);
  }
}
function computeLayout(root, refWidth = CANONICAL_SCREEN.width, refHeight = CANONICAL_SCREEN.height) {
  const measured = /* @__PURE__ */ new Map();
  collectMeasured(root, measured);
  solve(root, refWidth, refHeight, measured);
  for (let round = 0; round < MAX_MEASURE_ROUNDS && measured.size > 0; round++) {
    let dirty = false;
    for (const [node, size] of measured) {
      const granted = node.layout.width;
      if (granted <= 0) {
        continue;
      }
      const next = node.measure(granted);
      if (next.width !== size.width || next.height !== size.height) {
        measured.set(node, next);
        dirty = true;
      }
    }
    if (!dirty) {
      break;
    }
    solve(root, refWidth, refHeight, measured);
  }
}
function solve(root, refWidth, refHeight, measured) {
  const explicitRootWidth = resolveSize(root.style.width, refWidth);
  const explicitRootHeight = resolveSize(root.style.height, refHeight);
  const hasVisibleRootChildren = root.children.some(visible);
  root.layout.x = 0;
  root.layout.y = 0;
  root.layout.width = explicitRootWidth ?? refWidth;
  root.layout.height = explicitRootHeight ?? (hasVisibleRootChildren ? 0 : refHeight);
  root.layout.zIndex = root.style.zIndex ?? 0;
  clamp(root, refWidth, refHeight);
  const levelOrder = [];
  const parentOf = /* @__PURE__ */ new Map();
  const bfsQueue = [root];
  while (bfsQueue.length > 0) {
    const node = bfsQueue.shift();
    levelOrder.push(node);
    for (const child of node.children) {
      parentOf.set(child, node);
      if (visible(child)) {
        bfsQueue.push(child);
      }
    }
  }
  for (let iteration = 0; iteration < 3; iteration++) {
    for (let i = levelOrder.length - 1; i >= 1; i--) {
      const node = levelOrder[i];
      const parent = parentOf.get(node);
      const pW = parent.layout.width;
      const pH = parent.layout.height;
      const s = node.style;
      if (typeof s.width === "number") {
        node.layout.width = s.width;
      } else if (isPercent(s.width)) {
        node.layout.width = 0;
      } else if (node.measure) {
        node.layout.width = measured.get(node)?.width ?? 0;
      } else {
        const derived = deriveSize(node, "width", pW);
        node.layout.width = iteration === 0 ? derived : Math.max(node.layout.width, derived);
      }
      const isWrapMainRow = mainAxis(s) === "row" && (s.wrap ?? "nowrap") !== "nowrap";
      if (typeof s.height === "number") {
        node.layout.height = s.height;
      } else if (isPercent(s.height)) {
        node.layout.height = 0;
      } else if (node.measure) {
        node.layout.height = measured.get(node)?.height ?? 0;
      } else if (isWrapMainRow && iteration === 0) {
        node.layout.height = 0;
      } else {
        const derived = deriveSize(node, "height", pW);
        node.layout.height = iteration === 0 ? derived : Math.max(node.layout.height, derived);
      }
      applyAspectRatio(node);
      clamp(node, pW, pH);
    }
    for (const node of levelOrder) {
      if (!visible(node)) {
        continue;
      }
      if ((node.style.wrap ?? "nowrap") !== "nowrap") {
        continue;
      }
      const dir = mainAxis(node.style);
      const pad = resolvePadding(node.style, parentOf.get(node)?.layout.width ?? node.layout.width);
      const contentW = Math.max(0, node.layout.width - pad.left - pad.right);
      const contentH = Math.max(0, node.layout.height - pad.top - pad.bottom);
      const alignItems = node.style.alignItems ?? "stretch";
      for (const child of node.children) {
        if (!visible(child) || !relative(child)) {
          continue;
        }
        const eff = resolveAlignSelf(child.style, alignItems);
        if (eff !== "stretch") {
          continue;
        }
        const cm = resolveMargin(child.style, node.layout.width);
        if (dir === "row" && child.style.height === void 0) {
          child.layout.height = Math.max(child.layout.height, Math.max(0, contentH - cm.top - cm.bottom));
        } else if (dir === "column" && child.style.width === void 0) {
          child.layout.width = Math.max(child.layout.width, Math.max(0, contentW - cm.left - cm.right));
        }
      }
    }
  }
  if (root.style.height === void 0) {
    const derivedRootHeight = deriveSize(root, "height", refWidth);
    root.layout.height = Math.max(derivedRootHeight, refHeight);
    clamp(root, refWidth, refHeight);
  }
  for (const node of levelOrder) {
    const parent = parentOf.get(node);
    const pW = parent?.layout.width ?? refWidth;
    const pH = parent?.layout.height ?? refHeight;
    const parentPad = parent ? resolvePadding(parent.style, pW) : null;
    const contentPW = parentPad ? Math.max(0, pW - parentPad.left - parentPad.right) : pW;
    const contentPH = parentPad ? Math.max(0, pH - parentPad.top - parentPad.bottom) : pH;
    const s = node.style;
    if (isPercent(s.width)) {
      node.layout.width = parseFloat(s.width) / 100 * contentPW;
    }
    if (isPercent(s.height)) {
      node.layout.height = parseFloat(s.height) / 100 * contentPH;
    }
    applyAspectRatio(node);
    clamp(node, pW, pH);
    node.layout.zIndex = s.zIndex ?? (parent?.layout.zIndex ?? 0);
    const pad = resolvePadding(s, pW);
    const dir = mainAxis(s);
    const ownContentW = Math.max(0, node.layout.width - pad.left - pad.right);
    const ownContentH = Math.max(0, node.layout.height - pad.top - pad.bottom);
    const mainGap = dir === "row" ? resolveRowGap(s, ownContentW) : resolveColumnGap(s, ownContentH);
    const alignItems = s.alignItems ?? "stretch";
    const jc = s.justifyContent ?? "flex-start";
    const isSpaced = jc === "space-between" || jc === "space-around" || jc === "space-evenly";
    const relKids = node.children.filter((c) => visible(c) && relative(c));
    const absKids = node.children.filter((c) => visible(c) && !relative(c));
    const contentW = Math.max(0, node.layout.width - pad.left - pad.right);
    const contentH = Math.max(0, node.layout.height - pad.top - pad.bottom);
    for (const child of node.children) {
      if (!visible(child)) {
        continue;
      }
      if (isPercent(child.style.width)) {
        child.layout.width = parseFloat(child.style.width) / 100 * contentW;
      }
      if (isPercent(child.style.height)) {
        child.layout.height = parseFloat(child.style.height) / 100 * contentH;
      }
      if (child.measure !== void 0 && child.style.width === void 0) {
        const cm = resolveMargin(child.style, node.layout.width);
        child.layout.width = Math.min(child.layout.width, Math.max(0, contentW - cm.left - cm.right));
      }
      applyAspectRatio(child);
      clamp(child, node.layout.width, node.layout.height);
    }
    const flexWrap = s.wrap ?? "nowrap";
    if (flexWrap === "nowrap") {
      const crossAvail = dir === "row" ? node.layout.height - pad.top - pad.bottom : node.layout.width - pad.left - pad.right;
      for (const child of relKids) {
        const eff = resolveAlignSelf(child.style, alignItems);
        const cm = resolveMargin(child.style, node.layout.width);
        if (eff === "stretch") {
          if (dir === "row" && child.style.height === void 0) {
            child.layout.height = Math.max(0, crossAvail - cm.top - cm.bottom);
          } else if (dir === "column" && child.style.width === void 0) {
            child.layout.width = Math.max(0, crossAvail - cm.left - cm.right);
          }
        }
      }
      const containerMain = dir === "row" ? node.layout.width - pad.left - pad.right : node.layout.height - pad.top - pad.bottom;
      let totalFlex = 0;
      let totalShrinkWeight = 0;
      let usedMain = 0;
      let flowCount = 0;
      for (const child of relKids) {
        const cm = resolveMargin(child.style, node.layout.width);
        const flex = resolveFlexGrow(child.style);
        const shrink = resolveFlexShrink(child.style);
        const childMargin = dir === "row" ? cm.left + cm.right : cm.top + cm.bottom;
        const measuredMain = dir === "row" ? child.layout.width : child.layout.height;
        const childBasis = resolveFlexBasisMain(child.style, measuredMain);
        if (childBasis !== measuredMain) {
          if (dir === "row") {
            child.layout.width = childBasis;
          } else {
            child.layout.height = childBasis;
          }
        }
        flowCount++;
        usedMain += childBasis + childMargin;
        if (flex > 0) {
          totalFlex += flex;
        }
        if (shrink > 0) {
          totalShrinkWeight += shrink * childBasis;
        }
      }
      if (!isSpaced && flowCount > 1) {
        usedMain += (flowCount - 1) * mainGap;
      }
      const freeSpace = containerMain - usedMain;
      if (freeSpace > 0 && totalFlex > 0) {
        for (const child of relKids) {
          const flex = resolveFlexGrow(child.style);
          if (flex > 0) {
            const grow = flex / totalFlex * freeSpace;
            const basis = dir === "row" ? child.layout.width : child.layout.height;
            const next = Math.max(0, basis + grow);
            if (dir === "row") {
              child.layout.width = next;
            } else {
              child.layout.height = next;
            }
          }
        }
      } else if (freeSpace < 0 && totalShrinkWeight > 0) {
        const deficit = -freeSpace;
        for (const child of relKids) {
          const shrink = resolveFlexShrink(child.style);
          if (shrink <= 0) {
            continue;
          }
          const basis = dir === "row" ? child.layout.width : child.layout.height;
          const weight = shrink * basis;
          if (weight === 0) {
            continue;
          }
          const reduction = weight / totalShrinkWeight * deficit;
          const next = Math.max(0, basis - reduction);
          if (dir === "row") {
            child.layout.width = next;
          } else {
            child.layout.height = next;
          }
        }
      }
      let mainAvail = containerMain;
      for (const child of relKids) {
        const cm = resolveMargin(child.style, node.layout.width);
        const childMargin = dir === "row" ? cm.left + cm.right : cm.top + cm.bottom;
        const childSize = dir === "row" ? child.layout.width : child.layout.height;
        mainAvail -= childSize + childMargin;
      }
      if (!isSpaced && flowCount > 1) {
        mainAvail -= (flowCount - 1) * mainGap;
      }
      let cursor = dir === "row" ? node.layout.x + pad.left : node.layout.y + pad.top;
      let spacingGap = 0;
      if (isSpaced && flowCount > 0) {
        let totalChildSize = 0;
        for (const child of relKids) {
          const cm = resolveMargin(child.style, node.layout.width);
          const childSize = dir === "row" ? child.layout.width : child.layout.height;
          const childMargin = dir === "row" ? cm.left + cm.right : cm.top + cm.bottom;
          totalChildSize += childSize + childMargin;
        }
        const containerMain2 = dir === "row" ? node.layout.width - pad.left - pad.right : node.layout.height - pad.top - pad.bottom;
        const freeSpace2 = Math.max(0, containerMain2 - totalChildSize);
        if (jc === "space-between") {
          spacingGap = flowCount > 1 ? freeSpace2 / (flowCount - 1) : 0;
        } else if (jc === "space-around") {
          spacingGap = flowCount > 0 ? freeSpace2 / flowCount : 0;
          cursor += spacingGap / 2;
        } else {
          spacingGap = flowCount > 0 ? freeSpace2 / (flowCount + 1) : 0;
          cursor += spacingGap;
        }
      } else {
        if (jc === "center") {
          cursor += Math.max(0, mainAvail) / 2;
        } else if (jc === "flex-end") {
          cursor += Math.max(0, mainAvail);
        }
      }
      if (relKids.some((c) => resolveFlexGrow(c.style) > 0 || resolveFlexShrink(c.style) > 0)) {
        const boundaries = [cursor];
        let bc = cursor;
        for (const child of relKids) {
          const cm = resolveMargin(child.style, node.layout.width);
          const childMargin = dir === "row" ? cm.left + cm.right : cm.top + cm.bottom;
          const childSize = dir === "row" ? child.layout.width : child.layout.height;
          bc += childMargin + childSize + (isSpaced ? spacingGap : mainGap);
          boundaries.push(bc);
        }
        const rb = boundaries.map((b) => Math.round(b));
        for (let i = 0; i < relKids.length; i++) {
          const child = relKids[i];
          if (resolveFlexGrow(child.style) <= 0 && resolveFlexShrink(child.style) <= 0) {
            continue;
          }
          const cm = resolveMargin(child.style, node.layout.width);
          const childMargin = dir === "row" ? cm.left + cm.right : cm.top + cm.bottom;
          const gap = isSpaced ? spacingGap : mainGap;
          const snapped = Math.max(0, rb[i + 1] - rb[i] - childMargin - gap);
          if (dir === "row") {
            child.layout.width = snapped;
          } else {
            child.layout.height = snapped;
          }
        }
      }
      for (const child of relKids) {
        applyAspectRatio(child);
      }
      for (const child of relKids) {
        const cm = resolveMargin(child.style, node.layout.width);
        if (dir === "row") {
          child.layout.x = cursor + cm.left;
          cursor += child.layout.width + cm.left + cm.right;
        } else {
          child.layout.y = cursor + cm.top;
          cursor += child.layout.height + cm.top + cm.bottom;
        }
        cursor += isSpaced ? spacingGap : mainGap;
        const eff = resolveAlignSelf(child.style, alignItems);
        applyCrossAlign(child, pad, node, dir, eff);
      }
    } else {
      const wrapMainAvail = dir === "row" ? node.layout.width - pad.left - pad.right : node.layout.height - pad.top - pad.bottom;
      const crossGap = dir === "row" ? resolveColumnGap(s, ownContentH) : resolveRowGap(s, ownContentW);
      const lines = [];
      let currentLine = [];
      let currentLineMainSize = 0;
      for (const child of relKids) {
        const cm = resolveMargin(child.style, node.layout.width);
        const childMain = dir === "row" ? child.layout.width + cm.left + cm.right : child.layout.height + cm.top + cm.bottom;
        const gapOffset = currentLine.length > 0 ? mainGap : 0;
        if (currentLine.length > 0 && currentLineMainSize + gapOffset + childMain > wrapMainAvail + 1e-3) {
          lines.push(currentLine);
          currentLine = [child];
          currentLineMainSize = childMain;
        } else {
          currentLine.push(child);
          currentLineMainSize += gapOffset + childMain;
        }
      }
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
      let crossCursor = dir === "row" ? node.layout.y + pad.top : node.layout.x + pad.left;
      for (const line of lines) {
        let lineCrossSize = 0;
        for (const child of line) {
          const cm = resolveMargin(child.style, node.layout.width);
          const childCross = dir === "row" ? child.layout.height + cm.top + cm.bottom : child.layout.width + cm.left + cm.right;
          lineCrossSize = Math.max(lineCrossSize, childCross);
        }
        for (const child of line) {
          const eff = resolveAlignSelf(child.style, alignItems);
          const cm = resolveMargin(child.style, node.layout.width);
          if (eff === "stretch") {
            if (dir === "row" && child.style.height === void 0) {
              child.layout.height = Math.max(0, lineCrossSize - cm.top - cm.bottom);
            } else if (dir === "column" && child.style.width === void 0) {
              child.layout.width = Math.max(0, lineCrossSize - cm.left - cm.right);
            }
          }
        }
        let lineMainUsed = 0;
        for (const child of line) {
          const cm = resolveMargin(child.style, node.layout.width);
          lineMainUsed += dir === "row" ? child.layout.width + cm.left + cm.right : child.layout.height + cm.top + cm.bottom;
        }
        if (line.length > 1) {
          lineMainUsed += (line.length - 1) * mainGap;
        }
        const lineFree = Math.max(0, wrapMainAvail - lineMainUsed);
        let lineSpacingGap = 0;
        let lineCursor = dir === "row" ? node.layout.x + pad.left : node.layout.y + pad.top;
        if (isSpaced && line.length > 0) {
          if (jc === "space-between") {
            lineSpacingGap = line.length > 1 ? lineFree / (line.length - 1) : 0;
          } else if (jc === "space-around") {
            lineSpacingGap = lineFree / line.length;
            lineCursor += lineSpacingGap / 2;
          } else {
            lineSpacingGap = lineFree / (line.length + 1);
            lineCursor += lineSpacingGap;
          }
        } else {
          if (jc === "center") {
            lineCursor += lineFree / 2;
          } else if (jc === "flex-end") {
            lineCursor += lineFree;
          }
        }
        for (const child of line) {
          const cm = resolveMargin(child.style, node.layout.width);
          const eff = resolveAlignSelf(child.style, alignItems);
          if (dir === "row") {
            child.layout.x = lineCursor + cm.left;
            lineCursor += child.layout.width + cm.left + cm.right + (isSpaced ? lineSpacingGap : mainGap);
            const childCross = child.layout.height + cm.top + cm.bottom;
            if (eff === "flex-start" || eff === "stretch") {
              child.layout.y = crossCursor + cm.top;
            } else if (eff === "center") {
              child.layout.y = crossCursor + (lineCrossSize - childCross) / 2 + cm.top;
            } else if (eff === "flex-end") {
              child.layout.y = crossCursor + lineCrossSize - childCross + cm.top;
            }
          } else {
            child.layout.y = lineCursor + cm.top;
            lineCursor += child.layout.height + cm.top + cm.bottom + (isSpaced ? lineSpacingGap : mainGap);
            const childCross = child.layout.width + cm.left + cm.right;
            if (eff === "flex-start" || eff === "stretch") {
              child.layout.x = crossCursor + cm.left;
            } else if (eff === "center") {
              child.layout.x = crossCursor + (lineCrossSize - childCross) / 2 + cm.left;
            } else if (eff === "flex-end") {
              child.layout.x = crossCursor + lineCrossSize - childCross + cm.left;
            }
          }
        }
        crossCursor += lineCrossSize + crossGap;
      }
      if (lines.length > 0) {
        const initialCross = dir === "row" ? node.layout.y + pad.top : node.layout.x + pad.left;
        const contentCross = crossCursor - initialCross - crossGap;
        if (dir === "row" && node.style.height === void 0) {
          node.layout.height = pad.top + contentCross + pad.bottom;
        } else if (dir === "column" && node.style.width === void 0) {
          node.layout.width = pad.left + contentCross + pad.right;
        }
      }
    }
    for (const child of absKids) {
      const cs = child.style;
      const cm = resolveMargin(cs, node.layout.width);
      child.layout.x = node.layout.x + pad.left + cm.left;
      child.layout.y = node.layout.y + pad.top + cm.top;
      if (cs.left !== void 0 && cs.right !== void 0 && cs.width === void 0) {
        child.layout.x = node.layout.x + cs.left;
        child.layout.width = node.layout.width - cs.left - cs.right;
      } else if (cs.left !== void 0) {
        child.layout.x = node.layout.x + cs.left + cm.left;
      } else if (cs.right !== void 0) {
        child.layout.x = node.layout.x + node.layout.width - cs.right - child.layout.width - cm.right;
      }
      applyAspectRatio(child);
      if (cs.top !== void 0 && cs.bottom !== void 0 && cs.height === void 0) {
        child.layout.y = node.layout.y + cs.top;
        child.layout.height = node.layout.height - cs.top - cs.bottom;
        if (cs.aspectRatio !== void 0 && cs.aspectRatio > 0 && cs.width === void 0 && !(cs.left !== void 0 && cs.right !== void 0)) {
          child.layout.width = child.layout.height * cs.aspectRatio;
          if (cs.right !== void 0 && cs.left === void 0) {
            child.layout.x = node.layout.x + node.layout.width - cs.right - child.layout.width - cm.right;
          }
        }
      } else if (cs.top !== void 0) {
        child.layout.y = node.layout.y + cs.top + cm.top;
      } else if (cs.bottom !== void 0) {
        child.layout.y = node.layout.y + node.layout.height - cs.bottom - child.layout.height - cm.bottom;
      }
    }
    node.layout.x = Math.round(node.layout.x);
    node.layout.y = Math.round(node.layout.y);
    node.layout.width = Math.round(node.layout.width);
    node.layout.height = Math.round(node.layout.height);
  }
}

// node_modules/@bedrock-core/flexbox/src/node.ts
function zeroLayout() {
  return { x: 0, y: 0, width: 0, height: 0, zIndex: 0 };
}
function createNode(style = {}, children = [], measure) {
  return measure !== void 0 ? { style, children, layout: zeroLayout(), measure } : { style, children, layout: zeroLayout() };
}

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormButton.ts
var MODAL_FORM_BUTTON_SLOT_TYPE = "modal-form-button";
function safeLabelText2(text) {
  return /^[\d-]/.test(text) ? `§r${text}` : text;
}
var FormButton = ({
  type,
  label,
  backgroundHover,
  backgroundPressed,
  backgroundLocked,
  ...layout
}) => {
  const states = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
  const sized = layout.width !== void 0 || layout.flex !== void 0 || layout.flexGrow !== void 0 || layout.flexBasis !== void 0;
  return {
    type: MODAL_FORM_BUTTON_SLOT_TYPE,
    props: {
      // withControl so the layout phase computes jsonUIx/y/Width/Height like any control.
      ...withControl({ ...sized ? {} : { width: "100%" }, ...layout, background: states.background }),
      backgroundHover: states.backgroundHover,
      backgroundPressed: states.backgroundPressed,
      backgroundLocked: states.backgroundLocked,
      buttonKind: type,
      label: safeLabelText2(label ?? (type === "submit" ? "Submit" : "Close"))
    }
  };
};
var formButtonWriter = () => {
};
function collectFormButtons(tree) {
  const found = {};
  walkButtons(tree, found);
  if (!found.submit) {
    throw new ModalFormError(
      'A <Form> must declare exactly one `Form.Button type="submit"` — the modal has no built-in submit button; place it anywhere in the form flow.'
    );
  }
  return { submit: found.submit, exit: found.exit };
}
function walkButtons(node, found) {
  if (Array.isArray(node)) {
    node.forEach((child) => walkButtons(child, found));
    return;
  }
  if (!isElement(node)) {
    return;
  }
  if (node.type === MODAL_FORM_BUTTON_SLOT_TYPE) {
    const kind = node.props.buttonKind === "exit" ? "exit" : "submit";
    if (found[kind]) {
      throw new ModalFormError(
        `A <Form> may declare at most ONE \`Form.Button type="${kind}"\` — found a second one. The RP renders a single control per kind from the title payload.`
      );
    }
    found[kind] = node;
  }
  walkButtons(node.props.children, found);
}
function formButtonTitleFields(prefix, element) {
  const props = element?.props;
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  const str = (v) => typeof v === "string" ? v : "";
  return {
    [`${prefix}W`]: num(props?.jsonUIWidth),
    [`${prefix}H`]: num(props?.jsonUIHeight),
    [`${prefix}X`]: num(props?.jsonUIx),
    [`${prefix}Y`]: num(props?.jsonUIy),
    [`${prefix}Visible`]: element !== void 0 && props?.visible !== false,
    [`${prefix}Enabled`]: element !== void 0 && props?.enabled !== false,
    [`${prefix}Label`]: str(props?.label),
    [`${prefix}Bg`]: str(props?.background),
    [`${prefix}Hover`]: str(props?.backgroundHover),
    [`${prefix}Pressed`]: str(props?.backgroundPressed),
    [`${prefix}Locked`]: str(props?.backgroundLocked)
  };
}

// node_modules/@bedrock-core/ui-runtime/src/util/font-metrics.generated.json
var font_metrics_generated_default = {
  generatedAt: "2026-07-14T06:45:08.235Z",
  aliases: {},
  profiles: {
    mojangles: {
      lineHeight: 10,
      fallbackWidth: 6,
      boldOffset: 1,
      glyphWidths: {
        "32": 5,
        "33": 2,
        "34": 4,
        "35": 6,
        "36": 6,
        "37": 6,
        "38": 6,
        "39": 3,
        "40": 5,
        "41": 5,
        "42": 5,
        "43": 6,
        "44": 2,
        "45": 6,
        "46": 2,
        "47": 6,
        "48": 6,
        "49": 6,
        "50": 6,
        "51": 6,
        "52": 6,
        "53": 6,
        "54": 6,
        "55": 6,
        "56": 6,
        "57": 6,
        "58": 2,
        "59": 2,
        "60": 5,
        "61": 6,
        "62": 5,
        "63": 6,
        "64": 7,
        "65": 6,
        "66": 6,
        "67": 6,
        "68": 6,
        "69": 6,
        "70": 6,
        "71": 6,
        "72": 6,
        "73": 4,
        "74": 6,
        "75": 6,
        "76": 6,
        "77": 6,
        "78": 6,
        "79": 6,
        "80": 6,
        "81": 6,
        "82": 6,
        "83": 6,
        "84": 6,
        "85": 6,
        "86": 6,
        "87": 6,
        "88": 6,
        "89": 6,
        "90": 6,
        "91": 4,
        "92": 6,
        "93": 4,
        "94": 6,
        "95": 6,
        "96": 3,
        "97": 6,
        "98": 6,
        "99": 6,
        "100": 6,
        "101": 6,
        "102": 6,
        "103": 6,
        "104": 6,
        "105": 2,
        "106": 6,
        "107": 6,
        "108": 4,
        "109": 6,
        "110": 6,
        "111": 6,
        "112": 6,
        "113": 6,
        "114": 6,
        "115": 6,
        "116": 4,
        "117": 6,
        "118": 6,
        "119": 6,
        "120": 6,
        "121": 6,
        "122": 6,
        "123": 5,
        "124": 2,
        "125": 5,
        "126": 7,
        "127": 6,
        "128": 6,
        "129": 6,
        "130": 6,
        "131": 6,
        "132": 6,
        "133": 6,
        "134": 6,
        "135": 6,
        "136": 6,
        "137": 6,
        "138": 6,
        "139": 6,
        "140": 6,
        "141": 6,
        "142": 6,
        "143": 6,
        "144": 6,
        "145": 6,
        "146": 6,
        "147": 6,
        "148": 6,
        "149": 6,
        "150": 6,
        "151": 6,
        "152": 6,
        "153": 6,
        "154": 6,
        "155": 6,
        "156": 6,
        "157": 6,
        "158": 6,
        "159": 6,
        "160": 5,
        "161": 2,
        "162": 6,
        "163": 6,
        "164": 6,
        "165": 6,
        "166": 2,
        "167": 6,
        "168": 4,
        "169": 8,
        "170": 5,
        "171": 7,
        "172": 6,
        "173": 5,
        "174": 8,
        "175": 6,
        "176": 5,
        "177": 6,
        "178": 4,
        "179": 4,
        "180": 3,
        "181": 6,
        "182": 6,
        "183": 2,
        "184": 3,
        "185": 4,
        "186": 5,
        "187": 7,
        "188": 6,
        "189": 7,
        "190": 6,
        "191": 6,
        "192": 6,
        "193": 6,
        "194": 6,
        "195": 6,
        "196": 6,
        "197": 6,
        "198": 6,
        "199": 6,
        "200": 6,
        "201": 6,
        "202": 6,
        "203": 6,
        "204": 4,
        "205": 4,
        "206": 4,
        "207": 4,
        "208": 6,
        "209": 6,
        "210": 6,
        "211": 6,
        "212": 6,
        "213": 6,
        "214": 6,
        "215": 4,
        "216": 6,
        "217": 6,
        "218": 6,
        "219": 6,
        "220": 6,
        "221": 6,
        "222": 5,
        "223": 6,
        "224": 6,
        "225": 6,
        "226": 6,
        "227": 6,
        "228": 6,
        "229": 6,
        "230": 8,
        "231": 6,
        "232": 6,
        "233": 6,
        "234": 6,
        "235": 6,
        "236": 3,
        "237": 3,
        "238": 4,
        "239": 4,
        "240": 6,
        "241": 6,
        "242": 6,
        "243": 6,
        "244": 6,
        "245": 6,
        "246": 6,
        "247": 6,
        "248": 6,
        "249": 6,
        "250": 6,
        "251": 6,
        "252": 6,
        "253": 6,
        "254": 6,
        "255": 6,
        "8364": 6,
        "8482": 9,
        "8592": 6,
        "8593": 6,
        "8594": 6,
        "8595": 6
      }
    },
    minecraftTen: {
      lineHeight: 12.4,
      fallbackWidth: 6,
      boldOffset: 1,
      glyphWidths: {
        "32": 2,
        "33": 3,
        "34": 6,
        "35": 7,
        "36": 6,
        "37": 7,
        "38": 7,
        "39": 3,
        "40": 6,
        "41": 6,
        "42": 5,
        "43": 5,
        "44": 3,
        "45": 5,
        "46": 3,
        "47": 7,
        "48": 6,
        "49": 5,
        "50": 6,
        "51": 6,
        "52": 6,
        "53": 6,
        "54": 6,
        "55": 6,
        "56": 6,
        "57": 6,
        "58": 3,
        "59": 3,
        "60": 6,
        "61": 5,
        "62": 6,
        "63": 7,
        "64": 9,
        "65": 6,
        "66": 6,
        "67": 5,
        "68": 6,
        "69": 6,
        "70": 6,
        "71": 6,
        "72": 6,
        "73": 3,
        "74": 6,
        "75": 6,
        "76": 5,
        "77": 8,
        "78": 7,
        "79": 6,
        "80": 6,
        "81": 6,
        "82": 6,
        "83": 6,
        "84": 6,
        "85": 6,
        "86": 6,
        "87": 8,
        "88": 6,
        "89": 6,
        "90": 6,
        "91": 5,
        "92": 7,
        "93": 5,
        "94": 5,
        "95": 8,
        "96": 3,
        "97": 6,
        "98": 6,
        "99": 5,
        "100": 6,
        "101": 6,
        "102": 6,
        "103": 6,
        "104": 6,
        "105": 3,
        "106": 6,
        "107": 6,
        "108": 5,
        "109": 8,
        "110": 7,
        "111": 6,
        "112": 6,
        "113": 6,
        "114": 6,
        "115": 6,
        "116": 6,
        "117": 6,
        "118": 6,
        "119": 8,
        "120": 6,
        "121": 6,
        "122": 6,
        "123": 5,
        "124": 3,
        "125": 5,
        "126": 5,
        "127": 6,
        "128": 6,
        "129": 6,
        "130": 6,
        "131": 6,
        "132": 6,
        "133": 6,
        "134": 6,
        "135": 6,
        "136": 6,
        "137": 6,
        "138": 6,
        "139": 6,
        "140": 6,
        "141": 6,
        "142": 6,
        "143": 6,
        "144": 6,
        "145": 6,
        "146": 6,
        "147": 6,
        "148": 6,
        "149": 6,
        "150": 6,
        "151": 6,
        "152": 6,
        "153": 6,
        "154": 6,
        "155": 6,
        "156": 6,
        "157": 6,
        "158": 6,
        "159": 6,
        "160": 5,
        "161": 3,
        "162": 5,
        "163": 6,
        "164": 6,
        "165": 6,
        "166": 3,
        "167": 6,
        "168": 5,
        "169": 8,
        "170": 6,
        "171": 8,
        "172": 5,
        "173": 5,
        "174": 7,
        "175": 5,
        "176": 5,
        "177": 5,
        "178": 6,
        "179": 6,
        "180": 3,
        "181": 6,
        "182": 8,
        "183": 3,
        "184": 3,
        "185": 6,
        "186": 6,
        "187": 8,
        "188": 6,
        "189": 6,
        "190": 6,
        "191": 7,
        "192": 6,
        "193": 6,
        "194": 6,
        "195": 6,
        "196": 6,
        "197": 6,
        "198": 9,
        "199": 5,
        "200": 6,
        "201": 6,
        "202": 6,
        "203": 6,
        "204": 3,
        "205": 3,
        "206": 3,
        "207": 3,
        "208": 8,
        "209": 7,
        "210": 6,
        "211": 6,
        "212": 6,
        "213": 6,
        "214": 6,
        "215": 6,
        "216": 6,
        "217": 6,
        "218": 6,
        "219": 6,
        "220": 6,
        "221": 6,
        "222": 6,
        "223": 6,
        "224": 6,
        "225": 6,
        "226": 6,
        "227": 6,
        "228": 6,
        "229": 6,
        "230": 9,
        "231": 5,
        "232": 6,
        "233": 6,
        "234": 6,
        "235": 6,
        "236": 3,
        "237": 3,
        "238": 3,
        "239": 3,
        "240": 8,
        "241": 7,
        "242": 6,
        "243": 6,
        "244": 6,
        "245": 6,
        "246": 6,
        "247": 7,
        "248": 6,
        "249": 6,
        "250": 6,
        "251": 6,
        "252": 6,
        "253": 6,
        "254": 6,
        "255": 6,
        "8364": 6,
        "8482": 10,
        "8592": 6,
        "8593": 6,
        "8594": 6,
        "8595": 6
      }
    }
  }
};

// node_modules/@bedrock-core/ui-runtime/src/util/textMetrics.ts
var typedFontMetrics = font_metrics_generated_default;
var BASE_METRICS = typedFontMetrics.profiles;
var FONT_ALIASES = typedFontMetrics.aliases;
function isProfileName(name) {
  return name in BASE_METRICS;
}
function normalizeFont(font) {
  const name = font ?? "mojangles";
  if (isProfileName(name)) {
    return name;
  }
  return FONT_ALIASES[name] ?? "mojangles";
}
function isColorCode(code) {
  return /^[0-9a-f]$/i.test(code);
}
var FIT_TOLERANCE = 0.5;
function baseGlyphWidth(codePoint, profile) {
  const metrics = BASE_METRICS[profile];
  const width = metrics.glyphWidths[String(codePoint)];
  return width ?? metrics.fallbackWidth;
}
function ellipsizeText(text, maxWidth, font, fontSize = 1) {
  const profile = normalizeFont(font);
  const metrics = BASE_METRICS[profile];
  const scaledMax = (maxWidth + FIT_TOLERANCE) / fontSize;
  const ELLIPSIS = "...";
  let ellipsisWidth = 0;
  const eBold = false;
  for (let i = 0; i < ELLIPSIS.length; i++) {
    const cp = ELLIPSIS.codePointAt(i);
    const w = baseGlyphWidth(cp, profile);
    ellipsisWidth += eBold ? w + metrics.boldOffset : w;
  }
  let lineWidth = 0;
  let bold = false;
  let visibleEnd = 0;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "§" && i + 1 < text.length) {
      const lower = text[i + 1].toLowerCase();
      if (isColorCode(lower) || lower === "r") {
        bold = false;
      } else if (lower === "l") {
        bold = true;
      }
      i += 2;
      continue;
    }
    const cp = text.codePointAt(i);
    const adv = baseGlyphWidth(cp, profile) + (bold ? metrics.boldOffset : 0);
    if (lineWidth + adv > scaledMax) {
      return text.slice(0, visibleEnd) + ELLIPSIS;
    }
    if (lineWidth + adv + ellipsisWidth <= scaledMax) {
      visibleEnd = i + (cp > 65535 ? 2 : 1);
    }
    lineWidth += adv;
    i += cp > 65535 ? 2 : 1;
  }
  return text;
}
function wrapText(text, maxWidth, font, fontSize = 1) {
  const profile = normalizeFont(font);
  const metrics = BASE_METRICS[profile];
  const scaledMax = (maxWidth + FIT_TOLERANCE) / fontSize;
  let result = "";
  let lineWidth = 0;
  let bold = false;
  const pending = [];
  let pendingWidth = 0;
  function glyphAdv(cp) {
    const w = baseGlyphWidth(cp, profile);
    return bold ? w + metrics.boldOffset : w;
  }
  function flushPending() {
    if (pending.length === 0) {
      return;
    }
    if (lineWidth + pendingWidth <= scaledMax) {
      for (const t of pending) {
        result += t.ch;
      }
      lineWidth += pendingWidth;
    } else if (pendingWidth <= scaledMax) {
      result += "\n";
      lineWidth = 0;
      for (const t of pending) {
        result += t.ch;
      }
      lineWidth += pendingWidth;
    } else {
      const hypAdv = glyphAdv(45);
      for (const { ch, advance } of pending) {
        if (advance === 0) {
          result += ch;
          continue;
        }
        if (lineWidth + advance + hypAdv > scaledMax && lineWidth > 0) {
          result += "-\n";
          lineWidth = 0;
        }
        result += ch;
        lineWidth += advance;
      }
    }
    pending.length = 0;
    pendingWidth = 0;
  }
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") {
      flushPending();
      result += "\n";
      lineWidth = 0;
      i++;
      continue;
    }
    if (ch === "§" && i + 1 < text.length) {
      const code = text[i + 1];
      const lower = code.toLowerCase();
      if (isColorCode(lower) || lower === "r") {
        bold = false;
      } else if (lower === "l") {
        bold = true;
      }
      pending.push({ ch: "§" + code, advance: 0 });
      i += 2;
      continue;
    }
    if (ch === " ") {
      flushPending();
      const spaceAdv = glyphAdv(32);
      if (lineWidth === 0 && result.endsWith("\n")) {
      } else if (lineWidth + spaceAdv <= scaledMax) {
        result += " ";
        lineWidth += spaceAdv;
      } else {
        result += "\n";
        lineWidth = 0;
      }
      i++;
      continue;
    }
    const cp = text.codePointAt(i);
    const adv = glyphAdv(cp);
    const charStr = cp > 65535 ? text.slice(i, i + 2) : ch;
    pending.push({ ch: charStr, advance: adv });
    pendingWidth += adv;
    i += cp > 65535 ? 2 : 1;
  }
  flushPending();
  return result;
}
function measureText({
  text,
  font,
  fontSize = 1
}) {
  const profile = normalizeFont(font);
  const metrics = BASE_METRICS[profile];
  let lineWidth = 0;
  let maxLineWidth = 0;
  let lineCount = 1;
  let bold = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      maxLineWidth = Math.max(maxLineWidth, lineWidth);
      lineWidth = 0;
      lineCount++;
      continue;
    }
    if (ch === "§" && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      i++;
      if (isColorCode(code) || code === "r") {
        bold = false;
      } else if (code === "l") {
        bold = true;
      }
      continue;
    }
    const codePoint = text.codePointAt(i);
    if (codePoint === void 0) {
      continue;
    }
    if (codePoint > 65535) {
      i++;
    }
    let advance = baseGlyphWidth(codePoint, profile);
    if (bold) {
      advance += metrics.boldOffset;
    }
    lineWidth += advance;
  }
  maxLineWidth = Math.max(maxLineWidth, lineWidth);
  return {
    width: Math.max(1, Math.round(maxLineWidth * fontSize)),
    height: Math.max(1, Math.round(metrics.lineHeight * lineCount * fontSize))
  };
}

// node_modules/@bedrock-core/ui-runtime/src/components/Form/optionPayload.ts
var DROPDOWN_OPTION_TYPE = "dropdown-option";
var NO_OPTION_GEOMETRY = { x: 0, y: 0, width: 0, height: 0 };
function isGroupDefaults(v) {
  return typeof v === "object" && v !== null && "background" in v && "fontType" in v;
}
function readNumber(v, fallback = 0) {
  return typeof v === "number" ? v : fallback;
}
function readString(v, fallback) {
  return typeof v === "string" ? v : fallback;
}
function readAlign(v, fallback) {
  return v === "left" || v === "center" || v === "right" ? v : fallback;
}
function isOptionElement(node) {
  return typeof node === "object" && node !== null && "type" in node && (node.type === MODAL_OPTION_SLOT_TYPE || node.type === FormOption);
}
function optionElements(children) {
  const arr = Array.isArray(children) ? children.flat(Infinity) : children === void 0 ? [] : [children];
  return arr.filter(isOptionElement);
}
function readOption(el, defaults, groupX = 0, groupY = 0) {
  const p = el.props;
  return {
    value: readString(p.value, ""),
    text: readString(p.label, ""),
    style: {
      fontType: readString(p.__optionFontType, defaults.fontType),
      fontScaleFactor: readNumber(p.__optionFontScale, defaults.fontScaleFactor),
      align: readAlign(p.align, defaults.align),
      // Legacy flow-height slot is unused (rows size from geometry / the fixed popup row).
      height: 0,
      background: readString(p.background, defaults.background),
      backgroundHover: readString(p.backgroundHover, defaults.backgroundHover),
      backgroundSelected: readString(p.backgroundSelected, defaults.backgroundSelected),
      bulletTexture: readString(p.bullet, defaults.bulletTexture),
      bulletSelectedTexture: readString(p.bulletSelected, defaults.bulletSelectedTexture),
      bulletWidth: readNumber(p.bulletWidth, defaults.bulletWidth),
      bulletHeight: readNumber(p.bulletHeight, defaults.bulletHeight),
      bulletHoverTexture: readString(p.bulletHover, defaults.bulletHoverTexture),
      bulletSelectedHoverTexture: readString(p.bulletSelectedHover, defaults.bulletSelectedHoverTexture)
    },
    geometry: {
      x: readNumber(p.jsonUIx) - groupX,
      y: readNumber(p.jsonUIy) - groupY,
      width: readNumber(p.jsonUIWidth),
      height: readNumber(p.jsonUIHeight)
    }
  };
}
function fallbackGroupDefaults() {
  return {
    background: "",
    backgroundHover: "",
    backgroundSelected: "",
    bulletTexture: "",
    bulletSelectedTexture: "",
    bulletWidth: 12,
    bulletHeight: 12,
    bulletHoverTexture: "",
    bulletSelectedHoverTexture: "",
    ...labelFontFields(),
    align: "left"
  };
}
function optionLabelPosition(text, style, rowWidth, rowHeight, leftInset) {
  const font = style.fontType === "MinecraftTen" ? "minecraftTen" : "mojangles";
  const m = measureText({ text, font, fontSize: style.fontScaleFactor * 0.5 });
  const x = style.align === "center" ? Math.round((rowWidth - m.width) / 2) : style.align === "right" ? Math.round(rowWidth - 4 - m.width) : leftInset;
  return { x, y: Math.round((rowHeight - m.height) / 2) };
}
function serializeSelectOption(text, style, geometry = NO_OPTION_GEOMETRY, label = { x: 4, y: 0 }) {
  const [payload] = serializeProps({
    type: DROPDOWN_OPTION_TYPE,
    // --- the label GROUP (label contract, v0008 order): fontType, fontScale, x, y, text ---
    fontType: style.fontType,
    // [92]
    fontScaleFactor: style.fontScaleFactor,
    // [175]
    labelX: label.x,
    // [258] → option_label anchored X (TS-computed alignment)
    labelY: label.y,
    // [341] → option_label anchored Y (vertical centering)
    text,
    // [424] → #custom_radio_text (visible label; fixed cell — mid-payload group)
    // --- row fields ---
    height: style.height,
    // [507] (legacy flow row height, unused)
    background: style.background,
    // [590] idle option face
    backgroundHover: style.backgroundHover,
    // [673]
    backgroundSelected: style.backgroundSelected,
    // [756]
    bulletTexture: style.bulletTexture,
    // [839] unselected bullet glyph
    bulletSelectedTexture: style.bulletSelectedTexture,
    // [922] selected bullet glyph
    // Per-option flex geometry (px) — the inline row self-positions from these via
    // use_anchored_offset (x/y) at this size (w/h). Dropdown popup rows pass zeros.
    optionX: geometry.x,
    // [1005] → row #anchored_offset_value_x
    optionY: geometry.y,
    // [1088] → row #anchored_offset_value_y
    optionWidth: geometry.width,
    // [1171] → row #size_binding_x
    optionHeight: geometry.height,
    // [1254] → row #size_binding_y
    bulletWidth: style.bulletWidth,
    // [1337] bullet glyph width px
    bulletHeight: style.bulletHeight,
    // [1420] bullet glyph height px
    bulletHoverTexture: style.bulletHoverTexture,
    // [1503] unselected bullet on hover
    bulletSelectedHoverTexture: style.bulletSelectedHoverTexture
    // [1586] selected bullet on hover
  });
  if (typeof payload !== "string") {
    throw new Error("serializeSelectOption(): option payloads never carry tails");
  }
  return payload;
}

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormDropdown.ts
var OPTION_ROW_HEIGHT = 17;
var OPTION_ROW_OVERLAP = 1;
var POPUP_PADDING = 1;
var POPUP_MAX_HEIGHT = CANONICAL_SCREEN.height / 2;
var MODAL_DROPDOWN_SLOT_TYPE = "modal-dropdown";
var FormDropdown = ({
  name,
  defaultValue,
  backgroundHover,
  backgroundPressed,
  backgroundLocked,
  popupBackground,
  optionBackground,
  optionHover,
  optionSelected,
  optionFont,
  optionScale,
  optionAlign,
  currentColor,
  currentFont,
  currentScale,
  currentInsetX,
  currentInsetY,
  children,
  ...layout
}) => {
  const optionLabelFont = labelFontFields({ font: optionFont, scale: optionScale });
  const currentLabelFont = labelFontFields({ font: currentFont, scale: currentScale });
  const closedBox = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
  const optionBase = optionBackground ?? UNSTYLED_TEXTURE;
  const groupDefaults = {
    background: optionBase,
    backgroundHover: optionHover ?? optionBase,
    backgroundSelected: optionSelected ?? optionBase,
    bulletTexture: "",
    bulletSelectedTexture: "",
    bulletHoverTexture: "",
    bulletSelectedHoverTexture: "",
    bulletWidth: 12,
    bulletHeight: 12,
    fontType: optionLabelFont.fontType,
    fontScaleFactor: optionLabelFont.fontScaleFactor,
    align: optionAlign ?? "left"
  };
  const optionCount = optionElements(children).length;
  return {
    type: MODAL_DROPDOWN_SLOT_TYPE,
    props: {
      // Control block first so the closed-box state textures land at the SAME byte
      // offsets as `Button`'s ([1024-1272], right after the reserved block) — the RP
      // closed-box faces are literal copies of the button's state decode blocks.
      ...withControl({ ...layout, background: closedBox.background }),
      backgroundHover: closedBox.backgroundHover,
      // [1024-1106] like Button
      backgroundPressed: closedBox.backgroundPressed,
      // [1107-1189]
      backgroundLocked: closedBox.backgroundLocked,
      // [1190-1272]
      popupBackground: popupBackground ?? UNSTYLED_TEXTURE,
      // [1273-1355] dropdown-specific
      // [1356-1438] computed popup height (px): the fused option column (rows × height +
      // the 1px border overlap, cap at half the screen) + top and bottom padding. The RP
      // decodes it into popup_shift's #size_binding_y; the centering (half above / half below
      // the pinned middle line) is done geometrically by popup_card's bottom_left→left_middle
      // anchoring.
      popupHeight: Math.min(optionCount * OPTION_ROW_HEIGHT + OPTION_ROW_OVERLAP, POPUP_MAX_HEIGHT) + 2 * POPUP_PADDING,
      // Closed-box current-value label fields (RP-decoded, appended right after popupHeight so
      // they keep FIXED offsets: currentColor [1439], currentFontType [1522], currentFontScale
      // [1605], currentX [1688], currentY [1771]). The RP decodes the selected option TEXT out
      // of #dropdown_option_text, then styles it with these cell-level fields — color rides as
      // a §-code prefix (system convention), font/scale drive the label, and x/y position it
      // from the closed box's left-middle frame ([1,1] + top_left anchored offset).
      currentColor: currentColor ?? "",
      currentFontType: currentLabelFont.fontType,
      currentFontScale: currentLabelFont.fontScaleFactor,
      currentX: currentInsetX ?? 8,
      currentY: currentInsetY ?? -Math.round(measureText({ text: "Ag", font: currentFont, fontSize: currentScale ?? 1 }).height / 2),
      // Option children ride props like the inline select's: laid out (harmlessly — popup
      // rows flow at the fixed height), never serialized as controls (the walk skips
      // MODAL_OPTION_SLOT_TYPE), read by the writer below.
      children
    },
    // Group defaults ride the writer-only side channel (never serialized). The writer combines
    // them with each option child's own overrides to build the blobs.
    nativeArgs: {
      name,
      defaultValue: defaultValue ?? "",
      groupDefaults
    }
  };
};
var formDropdownWriter = (payload, form, ctx, _callbacks, props, nativeArgs, children) => {
  if (!isModalForm(form)) {
    throw new ModalFormError("Form.Dropdown must be rendered inside a `<Form>`.");
  }
  const name = typeof nativeArgs?.name === "string" ? nativeArgs.name : "";
  const defaultValue = typeof nativeArgs?.defaultValue === "string" ? nativeArgs.defaultValue : "";
  const defaults = isGroupDefaults(nativeArgs?.groupDefaults) ? nativeArgs.groupDefaults : { ...fallbackGroupDefaults(), background: UNSTYLED_TEXTURE, backgroundHover: UNSTYLED_TEXTURE, backgroundSelected: UNSTYLED_TEXTURE };
  const opts = optionElements(children).map((el) => readOption(el, defaults));
  const defaultIndex = Math.max(0, opts.findIndex((o) => o.value === defaultValue));
  const rowWidth = typeof props?.jsonUIWidth === "number" ? props.jsonUIWidth : 0;
  const encodedOptions = opts.map((o) => serializeSelectOption(
    o.text,
    o.style,
    NO_OPTION_GEOMETRY,
    // Center the label in the VISIBLE face (flow slot + the 1px border overlap): the face
    // center is also the center of the interior between the two shared border lines.
    optionLabelPosition(o.text, o.style, rowWidth, OPTION_ROW_HEIGHT + OPTION_ROW_OVERLAP, 4)
  ));
  emitDropdown(payload, form, ctx, name, encodedOptions, defaultIndex);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormInlineSelect.ts
var MODAL_INLINE_SELECT_SLOT_TYPE = "modal-inline-select";
var FormInlineSelect = ({
  name,
  defaultValue,
  optionBackground,
  optionHover,
  optionSelected,
  bullet,
  bulletSelected,
  bulletHover,
  bulletSelectedHover,
  bulletWidth,
  bulletHeight,
  optionFont,
  optionScale,
  optionAlign,
  children,
  ...layout
}) => {
  const optionBase = optionBackground ?? UNSTYLED_TEXTURE;
  const groupFont = labelFontFields({ font: optionFont, scale: optionScale });
  const groupDefaults = {
    background: optionBase,
    backgroundHover: optionHover ?? optionBase,
    backgroundSelected: optionSelected ?? optionBase,
    bulletTexture: bullet ?? "",
    bulletSelectedTexture: bulletSelected ?? "",
    bulletHoverTexture: bulletHover ?? bullet ?? "",
    bulletSelectedHoverTexture: bulletSelectedHover ?? bulletSelected ?? "",
    bulletWidth: bulletWidth ?? 12,
    bulletHeight: bulletHeight ?? 12,
    fontType: groupFont.fontType,
    fontScaleFactor: groupFont.fontScaleFactor,
    align: optionAlign ?? "left"
  };
  return {
    type: MODAL_INLINE_SELECT_SLOT_TYPE,
    // The Form.Option children ride here so the layout phase lays them out (each gets its own
    // jsonUIx/y/w/h). They are NOT serialized as controls — the writer reads their geometry and
    // the serialize walk skips MODAL_OPTION_SLOT_TYPE nodes.
    props: {
      // Full-size top-left container: the cell reserves the group's flow box (from the caller's
      // layout); options position absolutely inside it from their own blob geometry.
      ...withControl(layout),
      children
    },
    // Group defaults ride the writer-only side channel (never serialized). The writer combines
    // them with each option child's own overrides + post-layout geometry to build the blobs.
    nativeArgs: {
      name,
      defaultValue: defaultValue ?? "",
      groupDefaults
    }
  };
};
var formInlineSelectWriter = (payload, form, ctx, _callbacks, props, nativeArgs, children) => {
  if (!isModalForm(form)) {
    throw new ModalFormError("Form.Radio / Form.ToggleButton must be rendered inside a `<Form>`.");
  }
  const name = typeof nativeArgs?.name === "string" ? nativeArgs.name : "";
  const defaultValue = typeof nativeArgs?.defaultValue === "string" ? nativeArgs.defaultValue : "";
  const defaults = isGroupDefaults(nativeArgs?.groupDefaults) ? nativeArgs.groupDefaults : { ...fallbackGroupDefaults(), background: UNSTYLED_TEXTURE, backgroundHover: UNSTYLED_TEXTURE, backgroundSelected: UNSTYLED_TEXTURE };
  const groupX = typeof props?.jsonUIx === "number" ? props.jsonUIx : 0;
  const groupY = typeof props?.jsonUIy === "number" ? props.jsonUIy : 0;
  const opts = optionElements(children).map((el) => readOption(el, defaults, groupX, groupY));
  const defaultIndex = Math.max(0, opts.findIndex((o) => o.value === defaultValue));
  const encodedOptions = opts.map((o) => serializeSelectOption(
    o.text,
    o.style,
    o.geometry,
    optionLabelPosition(
      o.text,
      o.style,
      o.geometry.width,
      o.geometry.height,
      o.style.bulletTexture !== "" ? o.style.bulletWidth + 4 : 4
    )
  ));
  emitDropdown(payload, form, ctx, name, encodedOptions, defaultIndex);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormInput.ts
var MODAL_INPUT_SLOT_TYPE = "modal-input";
var FIELD_TEXT_INSET_X = 8;
var FormInput = ({
  name,
  placeholder,
  defaultValue,
  font,
  scale,
  textOffsetX,
  textOffsetY,
  placeholderOffsetX,
  placeholderOffsetY,
  backgroundHover,
  backgroundPressed,
  backgroundLocked,
  ...layout
}) => {
  const box = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
  const lineHeight = measureText({ text: "Ag", font, fontSize: scale ?? 1 }).height;
  const centeredY = -Math.round(lineHeight / 2);
  return {
    type: MODAL_INPUT_SLOT_TYPE,
    props: {
      // Control block first so the state textures land at BUTTON-IDENTICAL byte
      // offsets ([1024-1272] right after the reserved block). The writer calls
      // `form.textField()` directly from `nativeArgs` (no `build` closure).
      ...withControl({ ...layout, background: box.background }),
      backgroundHover: box.backgroundHover,
      // [1024-1106] like Button
      backgroundPressed: box.backgroundPressed,
      // [1107-1189] focused/pressed box
      backgroundLocked: box.backgroundLocked,
      // [1190-1272]
      // Two label GROUPS (see labelPayloadFields): value at [1273-1687], placeholder at
      // [1688-2102]. Text slots stay '' — both labels read their text from the native
      // edit-box channel; the groups carry font + position only.
      ...labelPayloadFields("value", {
        font,
        scale,
        x: textOffsetX ?? FIELD_TEXT_INSET_X,
        y: textOffsetY ?? centeredY
      }),
      ...labelPayloadFields("placeholder", {
        font,
        scale,
        x: placeholderOffsetX ?? FIELD_TEXT_INSET_X,
        y: placeholderOffsetY ?? centeredY
      })
    },
    // Native args ride the writer-only side channel: never serialized, so they cost no
    // payload bytes and can't shift RP-read offsets. placeholder/defaultValue stay raw —
    // they render inside the native edit box, where decode styling does not apply.
    nativeArgs: {
      name,
      placeholder: placeholder ?? "",
      defaultValue: defaultValue ?? ""
    }
  };
};
var formInputWriter = (payload, form, ctx, _callbacks, _props, nativeArgs) => {
  if (!isModalForm(form)) {
    throw new ModalFormError("Form.Input must be rendered inside a `<Form>`.");
  }
  const name = typeof nativeArgs?.name === "string" ? nativeArgs.name : "";
  const placeholder = typeof nativeArgs?.placeholder === "string" ? nativeArgs.placeholder : "";
  const defaultValue = typeof nativeArgs?.defaultValue === "string" ? nativeArgs.defaultValue : "";
  emitInput(payload, form, ctx, name, placeholder, defaultValue);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormSlider.ts
var MODAL_SLIDER_SLOT_TYPE = "modal-slider";
var DEFAULT_TRACK_HEIGHT = 10;
var DEFAULT_THUMB_WIDTH = 16;
var DEFAULT_THUMB_HEIGHT = 16;
var FormSlider = ({
  name,
  min,
  max,
  step,
  defaultValue,
  backgroundHover,
  backgroundPressed,
  backgroundLocked,
  progress,
  progressHover,
  thumb,
  thumbHover,
  thumbPressed,
  thumbLocked,
  trackHeight,
  thumbWidth,
  thumbHeight,
  ...layout
}) => {
  const track = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
  const progressBase = progress ?? track.background;
  const thumbBase = thumb ?? track.background;
  return {
    type: MODAL_SLIDER_SLOT_TYPE,
    props: {
      // Control block first so the state textures land at BUTTON-IDENTICAL byte
      // offsets ([1024-1272] right after the reserved block), slider-specific
      // fields after. `name` is appended LAST so it survives to the writer without
      // disturbing the RP-read offsets; `build` is a function → routed to
      // callbacks, not encoded. Default width to '100%' so the track fills whatever
      // container wraps it regardless of the wrapper's flex direction — but ONLY
      // when the caller gave no sizing (explicit width or flex sizing must win).
      ...withControl({
        ...layout.width !== void 0 || layout.flex !== void 0 || layout.flexGrow !== void 0 || layout.flexBasis !== void 0 ? {} : { width: "100%" },
        ...layout,
        background: track.background
      }),
      backgroundHover: track.backgroundHover,
      // [1024-1106] like Button
      backgroundPressed: track.backgroundPressed,
      // [1107-1189] reserved (no bar state)
      backgroundLocked: track.backgroundLocked,
      // [1190-1272] reserved (no bar state)
      progress: progressBase,
      // [1273-1355] slider-specific
      progressHover: progressHover ?? progressBase,
      // [1356-1438]
      thumb: thumbBase,
      // [1439-1521]
      thumbHover: thumbHover ?? thumbBase,
      // [1522-1604]
      thumbPressed: thumbPressed ?? thumbBase,
      // [1605-1687] engine "indent" state
      thumbLocked: thumbLocked ?? thumbBase,
      // [1688-1770]
      // Geometry: track spans the full control width (RP), these size the rest.
      trackHeight: trackHeight ?? DEFAULT_TRACK_HEIGHT,
      // [1771-1853]
      thumbWidth: thumbWidth ?? DEFAULT_THUMB_WIDTH,
      // [1854-1936]
      thumbHeight: thumbHeight ?? DEFAULT_THUMB_HEIGHT,
      // [1937-2019]
      // [2020-2102] thumb-travel width = control width - thumbWidth, so the thumb's
      // EDGE (not center) meets the track ends at min/max. Placeholder here; the
      // layout phase fills it in-place once jsonUIWidth is known (like `region`).
      // This MUST stay the last SERIALIZED field — the RP decodes it at [2020].
      travelWidth: 0
    },
    // Native args ride the writer-only side channel: never serialized, so they cost no
    // payload bytes and (crucially) leave travelWidth as the last field at [2020].
    // `defaultValue` resolves `?? min` here so the writer stays a pure reader.
    nativeArgs: {
      name,
      min,
      max,
      step: step ?? 0,
      // 0 → "no step" (native valueStep undefined); see writer.
      defaultValue: defaultValue ?? min
    }
  };
};
var formSliderWriter = (payload, form, ctx, _callbacks, _props, nativeArgs) => {
  if (!isModalForm(form)) {
    throw new ModalFormError("Form.Slider must be rendered inside a `<Form>`.");
  }
  const name = typeof nativeArgs?.name === "string" ? nativeArgs.name : "";
  const min = typeof nativeArgs?.min === "number" ? nativeArgs.min : 0;
  const max = typeof nativeArgs?.max === "number" ? nativeArgs.max : 0;
  const step = typeof nativeArgs?.step === "number" ? nativeArgs.step : 0;
  const defaultValue = typeof nativeArgs?.defaultValue === "number" ? nativeArgs.defaultValue : min;
  emitSlider(payload, form, ctx, name, min, max, defaultValue, step === 0 ? void 0 : step);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/FormToggle.ts
var MODAL_TOGGLE_SLOT_TYPE = "modal-toggle";
var FormToggle = ({
  name,
  defaultValue,
  backgroundHover,
  backgroundPressed,
  backgroundLocked,
  checkedBackground,
  checkedHover,
  checkedLocked,
  ...layout
}) => {
  const unchecked = resolveStateBackgrounds({ background: layout.background, backgroundHover, backgroundPressed, backgroundLocked });
  const checkedBase = checkedBackground ?? unchecked.background;
  return {
    type: MODAL_TOGGLE_SLOT_TYPE,
    props: {
      // Control block first so the state textures land at BUTTON-IDENTICAL byte
      // offsets ([1024-1272] right after the reserved block), toggle-specific
      // fields after. The writer calls `form.toggle()` directly from `nativeArgs`
      // (no `build` closure).
      ...withControl({ ...layout, background: unchecked.background }),
      backgroundHover: unchecked.backgroundHover,
      // [1024-1106] like Button
      backgroundPressed: unchecked.backgroundPressed,
      // [1107-1189] reserved (no pressed state)
      backgroundLocked: unchecked.backgroundLocked,
      // [1190-1272]
      checkedBackground: checkedBase,
      // [1273-1355] toggle-specific
      checkedHover: checkedHover ?? checkedBase,
      // [1356-1438]
      checkedLocked: checkedLocked ?? checkedBase
      // [1439-1521]
    },
    // Native args ride the writer-only side channel: never serialized, so they cost no
    // payload bytes and can't shift RP-read offsets.
    nativeArgs: {
      name,
      defaultValue: defaultValue ?? false
    }
  };
};
var formToggleWriter = (payload, form, ctx, _callbacks, _props, nativeArgs) => {
  if (!isModalForm(form)) {
    throw new ModalFormError("Form.Toggle must be rendered inside a `<Form>`.");
  }
  const name = typeof nativeArgs?.name === "string" ? nativeArgs.name : "";
  const defaultValue = nativeArgs?.defaultValue === true;
  emitToggle(payload, form, ctx, name, defaultValue);
};

// node_modules/@bedrock-core/ui-runtime/src/components/Form/Form.ts
var MODAL_FORM_SLOT_TYPE = "modal-form";
var ModalContext = createContext(null);
var FormRoot = ({
  onSubmit,
  onCancel,
  children
}) => {
  const config = { onSubmit, onCancel };
  return ModalContext({
    value: config,
    children: {
      type: MODAL_FORM_SLOT_TYPE,
      props: {
        __formConfig: config,
        children
      }
    }
  });
};
var Form = Object.assign(FormRoot, {
  Toggle: FormToggle,
  Slider: FormSlider,
  Dropdown: FormDropdown,
  InlineSelect: FormInlineSelect,
  Option: FormOption,
  Input: FormInput,
  Button: FormButton
});

// node_modules/@bedrock-core/ui-runtime/src/core/render/session.ts
import { uiManager } from "@minecraft/server-ui";

// node_modules/@bedrock-core/ui-runtime/src/core/render/traversal.ts
function generateComponentId(player, component, key, parentPath) {
  const componentName = component.name || "anonymous";
  const pathSegment = key ? `${componentName}:${key}` : componentName;
  const fullPath = [...parentPath, pathSegment].join("/");
  return `${player.id}:${fullPath}`;
}
function createInitialContext() {
  return {
    parentPath: [],
    idCounters: /* @__PURE__ */ new Map(),
    currentContext: /* @__PURE__ */ new Map(),
    parentFiber: void 0
  };
}
function createRootContext(initialContext) {
  return {
    ...initialContext,
    parentState: {
      visible: true,
      enabled: true,
      x: 0,
      y: 0,
      width: CANONICAL_SCREEN.width,
      height: CANONICAL_SCREEN.height,
      position: "relative"
    }
  };
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/phases/expand.ts
function expandAndResolveContexts(element, context, player) {
  if (typeof element.type === "function") {
    const componentFn = element.type;
    const componentName = componentFn.name || "anonymous";
    const keyProp = typeof element.props.key === "string" ? element.props.key : void 0;
    let effectiveKey = keyProp;
    if (!effectiveKey) {
      const pathKey = [...context.parentPath, componentName].join("/");
      const count = context.idCounters.get(pathKey) ?? 0;
      effectiveKey = `__auto_${count}`;
      context.idCounters.set(pathKey, count + 1);
    }
    const componentId = generateComponentId(
      player,
      componentFn,
      effectiveKey,
      context.parentPath
    );
    const fiber = getFiber(componentId) ?? createFiber(componentId, player);
    const parentFiber = context.parentFiber;
    if (parentFiber) {
      fiber.parent = parentFiber;
      if (!parentFiber.child) {
        parentFiber.child = fiber;
        fiber.index = 0;
      } else {
        let tail = parentFiber.child;
        while (tail.sibling) {
          tail = tail.sibling;
        }
        tail.sibling = fiber;
        fiber.index = (tail.index ?? -1) + 1;
      }
    } else {
      fiber.parent = void 0;
      fiber.index = 0;
    }
    fiber.contextSnapshot = context.currentContext;
    const renderedElement = activateFiber(fiber, () => componentFn(element.props));
    const childContext = {
      ...context,
      parentPath: [...context.parentPath, componentName],
      parentFiber: fiber
    };
    return expandAndResolveContexts(renderedElement, childContext, player);
  }
  if (isContextProvider(element)) {
    const { __context: ctxObj, value, children: children2 } = element.props;
    const nextContext = new Map(context.currentContext);
    nextContext.set(ctxObj, value);
    const childContext = {
      ...context,
      currentContext: nextContext
    };
    const childrenArray = toChildrenArray(children2);
    const resolvedChildren = childrenArray.length ? processChildren(childrenArray, childContext, player) : [];
    return {
      type: "fragment",
      props: { children: resolvedChildren }
    };
  }
  const children = element.props.children;
  if (Array.isArray(children)) {
    const processedChildren = processChildren(children, context, player);
    return {
      type: element.type,
      nativeArgs: element.nativeArgs,
      props: {
        ...element.props,
        children: processedChildren
      }
    };
  }
  if (isElement(children)) {
    const processed = expandAndResolveContexts(children, context, player);
    return {
      type: element.type,
      nativeArgs: element.nativeArgs,
      props: {
        ...element.props,
        children: [processed]
        // normalize to array
      }
    };
  }
  return {
    type: element.type,
    nativeArgs: element.nativeArgs,
    props: {
      ...element.props,
      children: []
    }
  };
}
function processChildren(children, context, player) {
  return children.map((child) => {
    if (!isElement(child)) {
      return void 0;
    }
    return expandAndResolveContexts(child, context, player);
  }).filter((child) => child !== void 0);
}
function toChildrenArray(children) {
  if (Array.isArray(children)) {
    return children;
  }
  if (isElement(children)) {
    return [children];
  }
  return [];
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/phases/inherit.ts
function toPocketUnit(value) {
  return Math.round(value);
}
function applyInheritance(element, context) {
  const parentState = context.parentState ?? {
    visible: true,
    enabled: true,
    x: 0,
    y: 0,
    width: CANONICAL_SCREEN.width,
    height: CANONICAL_SCREEN.height,
    position: "relative"
  };
  const props = element.props;
  if (typeof element.type === "string" && isTransparentType(element.type)) {
    const childContext = {
      ...context,
      parentState
      // Pass parent state through transparent components
    };
    const newProps2 = { ...props };
    if (props.children) {
      if (Array.isArray(props.children)) {
        newProps2.children = props.children.filter(isElement).map((child) => applyInheritance(child, childContext));
      } else if (isElement(props.children)) {
        newProps2.children = applyInheritance(props.children, childContext);
      } else {
        newProps2.children = props.children;
      }
    }
    return {
      type: element.type,
      nativeArgs: element.nativeArgs,
      props: newProps2
    };
  }
  let newProps = { ...props };
  if (isControlled(props)) {
    newProps = { ...props };
    if (!parentState.visible) {
      newProps.visible = false;
    }
    if (!parentState.enabled) {
      newProps.enabled = false;
    }
    const xValue = props.jsonUIx ?? 0;
    const yValue = props.jsonUIy ?? 0;
    const widthValue = props.jsonUIWidth ?? 100;
    const heightValue = props.jsonUIHeight ?? 100;
    newProps.jsonUIx = toPocketUnit(xValue);
    newProps.jsonUIy = toPocketUnit(yValue);
    newProps.jsonUIWidth = toPocketUnit(widthValue);
    newProps.jsonUIHeight = toPocketUnit(heightValue);
    const childParentState = {
      visible: newProps.visible ?? true,
      enabled: newProps.enabled ?? true,
      x: xValue,
      y: yValue,
      width: widthValue,
      height: heightValue,
      position: "relative"
    };
    const childContext = {
      ...context,
      parentState: childParentState
    };
    if (newProps.children) {
      if (Array.isArray(newProps.children)) {
        newProps.children = newProps.children.filter(isElement).map((child) => applyInheritance(child, childContext));
      } else if (isElement(newProps.children)) {
        newProps.children = applyInheritance(newProps.children, childContext);
      }
    }
  }
  return {
    type: element.type,
    nativeArgs: element.nativeArgs,
    props: newProps
  };
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/phases/layout.ts
var DEBUG_LAYOUT = false;
function isTransparent(el) {
  return typeof el.type === "string" && isTransparentType(el.type);
}
function collectConcrete(element) {
  if (!isElement(element)) {
    return [];
  }
  if (element.type === SCROLL_SLOT_TYPE) {
    return [element];
  }
  if (isTransparent(element)) {
    const ch = element.props.children;
    if (!ch) {
      return [];
    }
    if (Array.isArray(ch)) {
      return ch.flatMap(collectConcrete);
    }
    if (typeof ch === "string") {
      return [];
    }
    return collectConcrete(ch);
  }
  return [element];
}
function valueText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && "tail" in value) {
    const tail = value.tail;
    return typeof tail === "string" ? tail : "";
  }
  return "";
}
function extractTextMetrics(props) {
  const metrics = props.__textMetrics;
  const isMetricsObject = metrics && typeof metrics === "object" && !Array.isArray(metrics);
  if (!isMetricsObject) {
    return { text: valueText(props.value) };
  }
  const resolvedText = Reflect.get(metrics, "resolvedText");
  const text = typeof resolvedText === "string" ? resolvedText : valueText(props.value);
  const font = Reflect.get(metrics, "font");
  const scale = Reflect.get(metrics, "fontSize");
  const wordBreak = Reflect.get(metrics, "wordBreak");
  const overflow = Reflect.get(metrics, "overflow");
  const maxLines = Reflect.get(metrics, "maxLines");
  return {
    text,
    font: font === "mojangles" || font === "minecraftTen" ? font : void 0,
    scale: typeof scale === "number" ? scale : void 0,
    wordBreak: wordBreak === "break-word" ? wordBreak : void 0,
    overflow: overflow === "ellipsis" ? overflow : void 0,
    maxLines: typeof maxLines === "number" ? maxLines : void 0
  };
}
function hasOverflowProps(td) {
  return td.wordBreak === "break-word" || td.overflow === "ellipsis" || td.maxLines !== void 0;
}
function processOverflowText(td, availableWidth) {
  let displayText = td.text;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return displayText;
  }
  if (td.wordBreak === "break-word") {
    displayText = wrapText(displayText, availableWidth, td.font, td.scale);
  }
  if (td.maxLines !== void 0) {
    const lines = displayText.split("\n");
    if (lines.length > td.maxLines) {
      const kept = lines.slice(0, td.maxLines);
      kept[kept.length - 1] = ellipsizeText(
        kept[kept.length - 1],
        availableWidth,
        td.font,
        td.scale
      );
      displayText = kept.join("\n");
    }
  }
  if (td.overflow === "ellipsis" && td.wordBreak !== "break-word") {
    displayText = displayText.split("\n").map((line) => ellipsizeText(line, availableWidth, td.font, td.scale)).join("\n");
  }
  return displayText;
}
function makeTextMeasure(element) {
  if (!isTextElementType(element.type)) {
    return void 0;
  }
  const style = element.props.__layout ?? {};
  if (typeof style.width === "number" && typeof style.height === "number") {
    return void 0;
  }
  const td = extractTextMetrics(element.props);
  if (!hasOverflowProps(td)) {
    return void 0;
  }
  return (availableWidth) => measureText({
    text: processOverflowText(td, availableWidth),
    font: td.font,
    fontSize: td.scale
  });
}
var MODAL_CONTROL_DEFAULT_HEIGHT = {
  [MODAL_TOGGLE_SLOT_TYPE]: 24,
  [MODAL_SLIDER_SLOT_TYPE]: 32,
  [MODAL_DROPDOWN_SLOT_TYPE]: 24,
  // Inline select is content-sized: the component sets an explicit height (rows × row height +
  // chrome), so this is only a one-row floor for a degenerate empty-option list.
  [MODAL_INLINE_SELECT_SLOT_TYPE]: 17,
  [MODAL_INPUT_SLOT_TYPE]: 24,
  [MODAL_FORM_BUTTON_SLOT_TYPE]: 24
};
function hasChildElements(element) {
  const kids = element.props.children;
  const arr = Array.isArray(kids) ? kids : kids === void 0 ? [] : [kids];
  return arr.some((k) => typeof k === "object" && k !== null && "type" in k);
}
function withIntrinsicSize(element, style) {
  const modalDefaultHeight = typeof element.type === "string" ? MODAL_CONTROL_DEFAULT_HEIGHT[element.type] : void 0;
  if (modalDefaultHeight !== void 0) {
    const next2 = { ...style };
    const contentSized = element.type === MODAL_INLINE_SELECT_SLOT_TYPE && hasChildElements(element);
    if (next2.height === void 0 && !contentSized) {
      next2.height = modalDefaultHeight;
    }
    const flexSized = next2.flex !== void 0 || next2.flexGrow !== void 0 || next2.flexBasis !== void 0;
    if (next2.width === void 0 && !flexSized) {
      next2.width = "100%";
    }
    return next2;
  }
  if (!isTextElementType(element.type)) {
    return style;
  }
  if (typeof style.width === "number" && typeof style.height === "number") {
    return style;
  }
  const td = extractTextMetrics(element.props);
  if (hasOverflowProps(td)) {
    return style;
  }
  const dims = measureText({
    text: td.text,
    font: td.font,
    fontSize: td.scale
  });
  const next = { ...style };
  if (next.width === void 0) {
    next.width = dims.width;
  }
  if (next.height === void 0) {
    next.height = dims.height;
  }
  return next;
}
function buildNode(element) {
  if (element.type === SCROLL_SLOT_TYPE) {
    return createNode(scrollFlexStyle(element), []);
  }
  const baseStyle = element.props.__layout ?? {};
  const style = withIntrinsicSize(element, baseStyle);
  const rawChildren = element.props.children;
  let childElements = [];
  if (Array.isArray(rawChildren)) {
    childElements = rawChildren.flatMap(collectConcrete);
  } else if (isElement(rawChildren)) {
    childElements = collectConcrete(rawChildren);
  }
  return createNode(style, childElements.map((c) => buildNode(c)), makeTextMeasure(element));
}
function applyToTree(element, parentNode, cursor, regionIndex = 0) {
  if (element.type === SCROLL_SLOT_TYPE) {
    const node2 = parentNode.children[cursor.index++];
    if (node2) {
      element.props.jsonUIx = node2.layout.x;
      element.props.jsonUIy = node2.layout.y;
      element.props.jsonUIWidth = node2.layout.width;
      element.props.jsonUIHeight = node2.layout.height;
    }
    return;
  }
  if (isTransparent(element)) {
    const ch2 = element.props.children;
    if (Array.isArray(ch2)) {
      ch2.filter(isElement).forEach((c) => {
        applyToTree(c, parentNode, cursor, regionIndex);
      });
    } else if (isElement(ch2)) {
      applyToTree(ch2, parentNode, cursor, regionIndex);
    }
    return;
  }
  const node = parentNode.children[cursor.index++];
  if (!node) {
    return;
  }
  element.props.jsonUIx = node.layout.x;
  element.props.jsonUIy = node.layout.y;
  element.props.jsonUIWidth = node.layout.width;
  element.props.jsonUIHeight = node.layout.height;
  element.props.region = regionIndex;
  const ch = element.props.children;
  const childCursor = { index: 0 };
  if (Array.isArray(ch)) {
    ch.filter(isElement).forEach((c) => {
      applyToTree(c, node, childCursor, regionIndex);
    });
  } else if (isElement(ch)) {
    applyToTree(ch, node, childCursor, regionIndex);
  }
}
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function scrollAxis(slot) {
  return slot.props.__axis === "x" ? "x" : "y";
}
var HORIZONTAL_EXTENT_BOUND = CANONICAL_SCREEN.width * 64;
function scrollFlexStyle(slot) {
  const style = { ...slot.props.__layout ?? {} };
  const positioned = style.position === "absolute";
  const sized = style.width !== void 0 || style.height !== void 0;
  const grows = style.flex !== void 0 || style.flexGrow !== void 0 || style.flexShrink !== void 0 || style.flexBasis !== void 0;
  if (!positioned && !sized && !grows) {
    style.flexGrow = 1;
  }
  return style;
}
function findScrolls(element, out) {
  if (Array.isArray(element)) {
    element.forEach((c) => findScrolls(c, out));
    return;
  }
  if (!isElement(element)) {
    return;
  }
  if (element.type === SCROLL_SLOT_TYPE) {
    out.push(element);
    return;
  }
  findScrolls(element.props.children, out);
}
function layoutScrollContent(slot, axis, viewportWidth, viewportHeight, index) {
  const rawChildren = slot.props.children;
  const roots = Array.isArray(rawChildren) ? rawChildren.flatMap((c) => collectConcrete(c)) : collectConcrete(rawChildren);
  let syntheticRoot;
  let extent;
  if (axis === "x") {
    const childNodes = roots.map((r) => buildNode(r));
    syntheticRoot = createNode(
      { flexDirection: "row", width: HORIZONTAL_EXTENT_BOUND, height: viewportHeight },
      childNodes
    );
    computeLayout(syntheticRoot, viewportWidth, viewportHeight);
    extent = syntheticRoot.children.reduce((max, c) => Math.max(max, c.layout.x + c.layout.width), 0);
  } else {
    const childNodes = roots.map((r) => buildNode(r));
    syntheticRoot = createNode({ flexDirection: "column", width: viewportWidth }, childNodes);
    computeLayout(syntheticRoot, viewportWidth, viewportHeight);
    extent = syntheticRoot.layout.height;
  }
  const cursor = { index: 0 };
  roots.forEach((r) => {
    applyToTree(r, syntheticRoot, cursor, index);
  });
  return extent;
}
function dumpLayoutTree(element, depth = 0) {
  if (!isElement(element)) {
    return;
  }
  const p = element.props;
  const indent = "  ".repeat(depth);
  const type = typeof element.type === "string" ? element.type : element.type.name;
  const text = valueText(p.value) !== "" ? ` "${valueText(p.value).slice(0, 20)}"` : "";
  console.warn(`${indent}[${type}${text}] x=${p.jsonUIx} y=${p.jsonUIy} w=${p.jsonUIWidth} h=${p.jsonUIHeight}`);
  const ch = p.children;
  if (Array.isArray(ch)) {
    ch.forEach((c) => dumpLayoutTree(c, depth + 1));
  } else if (isElement(ch)) {
    dumpLayoutTree(ch, depth + 1);
  }
}
function dumpLayoutNode(node, depth = 0) {
  const indent = "  ".repeat(depth);
  const s = node.style;
  const styleHints = [
    s.flexDirection ? `dir=${s.flexDirection}` : "",
    s.wrap ? `wrap=${s.wrap}` : "",
    s.width !== void 0 ? `sw=${s.width}` : "",
    s.height !== void 0 ? `sh=${s.height}` : ""
  ].filter(Boolean).join(" ");
  console.warn(`${indent}node [${styleHints}] → x=${node.layout.x} y=${node.layout.y} w=${node.layout.width} h=${node.layout.height}`);
  for (const child of node.children) {
    dumpLayoutNode(child, depth + 1);
  }
}
function resolveDerivedProps(element) {
  if (Array.isArray(element)) {
    element.forEach(resolveDerivedProps);
    return;
  }
  if (!isElement(element)) {
    return;
  }
  if (element.type === MODAL_SLIDER_SLOT_TYPE) {
    const width = asNumber(element.props.jsonUIWidth) ?? 0;
    const thumbWidth = asNumber(element.props.thumbWidth) ?? 0;
    element.props.travelWidth = Math.max(0, width - thumbWidth);
  }
  if (isTextElementType(element.type)) {
    const td = extractTextMetrics(element.props);
    const width = asNumber(element.props.jsonUIWidth) ?? 0;
    if (hasOverflowProps(td) && width > 0) {
      const metrics = element.props.__textMetrics;
      const isLocalizationKey = metrics && typeof metrics === "object" && !Array.isArray(metrics) && Reflect.get(metrics, "isKey") === true;
      if (!isLocalizationKey) {
        element.props.value = { tail: safeLabelText(processOverflowText(td, width)) };
      }
    }
  }
  resolveDerivedProps(element.props.children);
}
function computeLayout2(tree) {
  const slots = [];
  findScrolls(tree, slots);
  if (slots.length > MAX_POOLED_SCROLLS) {
    throw new ScrollLimitError(
      `Too many <Scroll>s: found ${slots.length}, but a render supports at most ${MAX_POOLED_SCROLLS} (plus the implicit root scroll). Scrolls beyond the ${MAX_POOLED_SCROLLS}th would not render.`
    );
  }
  const concreteRoots = collectConcrete(tree);
  let mainContentHeight;
  if (concreteRoots.length > 1) {
    const root = createNode(
      { flexDirection: "column", width: CANONICAL_SCREEN.width },
      concreteRoots.map((c) => buildNode(c))
    );
    computeLayout(root);
    if (DEBUG_LAYOUT) {
      dumpLayoutNode(root);
    }
    tree.props.jsonUIx = 0;
    tree.props.jsonUIy = 0;
    tree.props.jsonUIWidth = root.layout.width;
    tree.props.jsonUIHeight = root.layout.height;
    mainContentHeight = root.layout.height;
    const rootCursor = { index: 0 };
    concreteRoots.forEach((c) => applyToTree(c, root, rootCursor, 0));
  } else {
    const concreteTree = concreteRoots[0] ?? tree;
    const root = buildNode(concreteTree);
    computeLayout(root);
    if (DEBUG_LAYOUT) {
      dumpLayoutNode(root);
    }
    mainContentHeight = root.layout.height;
    concreteTree.props.jsonUIx = root.layout.x;
    concreteTree.props.jsonUIy = root.layout.y;
    concreteTree.props.jsonUIWidth = root.layout.width;
    concreteTree.props.jsonUIHeight = root.layout.height;
    if (concreteTree !== tree) {
      tree.props.jsonUIx = root.layout.x;
      tree.props.jsonUIy = root.layout.y;
      tree.props.jsonUIWidth = root.layout.width;
      tree.props.jsonUIHeight = root.layout.height;
    }
    const ch = concreteTree.props.children;
    const cursor = { index: 0 };
    if (Array.isArray(ch)) {
      ch.filter(isElement).forEach((c) => {
        applyToTree(c, root, cursor, 0);
      });
    } else if (isElement(ch)) {
      applyToTree(ch, root, cursor, 0);
    }
  }
  const scrolls = [{
    axis: "y",
    x: 0,
    y: 0,
    width: CANONICAL_SCREEN.width,
    height: CANONICAL_SCREEN.height,
    extent: mainContentHeight
  }];
  slots.forEach((slot, k) => {
    const index = k + 1;
    const axis = scrollAxis(slot);
    const x = asNumber(slot.props.jsonUIx) ?? 0;
    const y = asNumber(slot.props.jsonUIy) ?? 0;
    const width = asNumber(slot.props.jsonUIWidth) ?? CANONICAL_SCREEN.width;
    const height = asNumber(slot.props.jsonUIHeight) ?? CANONICAL_SCREEN.height;
    const extent = layoutScrollContent(slot, axis, width, height, index);
    scrolls[index] = { axis, x, y, width, height, extent };
  });
  tree.props.jsonUIScrolls = scrolls;
  tree.props.jsonUIHeight = scrolls[0].height;
  resolveDerivedProps(tree);
  if (DEBUG_LAYOUT) {
    dumpLayoutTree(tree);
  }
  return tree;
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/validateForm.ts
var ACTION_ONLY_INTERACTIVE_TYPES = /* @__PURE__ */ new Set(["button", "item_renderer"]);
var MODAL_CONTROL_TYPE_SET = /* @__PURE__ */ new Set([
  MODAL_TOGGLE_SLOT_TYPE,
  MODAL_SLIDER_SLOT_TYPE,
  MODAL_DROPDOWN_SLOT_TYPE,
  MODAL_INLINE_SELECT_SLOT_TYPE,
  MODAL_INPUT_SLOT_TYPE,
  MODAL_FORM_BUTTON_SLOT_TYPE
]);
function validateForm(tree) {
  walk(tree, false);
}
function walk(node, insideModal) {
  if (!isElement(node)) {
    return;
  }
  const type = node.type;
  if (typeof type === "string") {
    if (type === MODAL_FORM_SLOT_TYPE) {
      if (insideModal) {
        throw new ModalFormError(
          "A `<Form>` cannot be nested inside another `<Form>`. A screen renders a single modal; compose multiple forms across separate render() calls (e.g. via navigation) instead of nesting them."
        );
      }
      visitChildren(node, true);
      return;
    }
    if (insideModal && ACTION_ONLY_INTERACTIVE_TYPES.has(type)) {
      throw new ModalFormError(
        `\`${describe(type)}\` is not allowed inside a \`<Form>\`. A modal form accepts only the Form.* field controls (Toggle/Slider/Dropdown/Input) plus decorative nodes (Image/Panel/Text); its only buttons are the hardcoded submit + esc, surfaced as Form's onSubmit / onCancel.`
      );
    }
    if (!insideModal && MODAL_CONTROL_TYPE_SET.has(type)) {
      throw new ModalFormError(
        `\`${describe(type)}\` is a modal-only control and must be rendered inside a \`<Form>\`. For an ActionForm screen use the standard Button / Input / Slider / Dropdown components.`
      );
    }
  }
  visitChildren(node, insideModal);
}
function visitChildren(node, insideModal) {
  const { children } = node.props;
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    walk(child, insideModal);
  }
}
function describe(type) {
  switch (type) {
    case "button":
      return "Button";
    case "item_renderer":
      return "ItemRenderer";
    case "modal-toggle":
      return "Form.Toggle";
    case "modal-slider":
      return "Form.Slider";
    case "modal-dropdown":
      return "Form.Dropdown";
    case "modal-inline-select":
      return "Form.Radio / Form.ToggleButton";
    case "modal-input":
      return "Form.Input";
    case "modal-form-button":
      return "Form.Button";
    default:
      return type;
  }
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/tree.ts
function buildTree(element, player) {
  const context = createInitialContext();
  const existing = getFibersForPlayer(player);
  for (const f of existing) {
    f.parent = void 0;
    f.child = void 0;
    f.sibling = void 0;
    f.index = -1;
  }
  let result = expandAndResolveContexts(element, context, player);
  result = computeLayout2(result);
  const rootContext = createRootContext(context);
  result = applyInheritance(result, rootContext);
  validateForm(result);
  return result;
}
function cleanupComponentTree(player) {
  const fiberIds = getFibersForPlayer(player);
  const sortedFibers = fiberIds.sort((a, b) => {
    const depthA = (a.id.match(/\//g) || []).length;
    const depthB = (b.id.match(/\//g) || []).length;
    return depthB - depthA;
  });
  for (const fiber of sortedFibers) {
    deleteFiber(fiber.id);
  }
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/session.ts
var sessions = /* @__PURE__ */ new Map();
var nextChainId = 1;
function getOrCreate(player) {
  const id = player.id;
  let session = sessions.get(id);
  if (!session) {
    session = { pending: false, suppress: false, swapPending: false };
    sessions.set(id, session);
  }
  return session;
}
function setPlayerRoot(player, root) {
  const session = getOrCreate(player);
  session.root = root;
}
function getPlayerRoot(player) {
  return sessions.get(player.id)?.root;
}
function setBuildRunner(player, runBuild) {
  const session = getOrCreate(player);
  session.runBuild = runBuild;
}
function clearPlayerRoot(player) {
  const session = sessions.get(player.id);
  if (!session) {
    return;
  }
  session.root = void 0;
  session.runBuild = void 0;
  session.pending = false;
  session.suppress = false;
  session.activeChain = void 0;
  session.swapPending = false;
}
function beginPresentChain(player) {
  const session = getOrCreate(player);
  const token = nextChainId++;
  session.activeChain = token;
  session.swapPending = false;
  return token;
}
function isChainCurrent(player, token) {
  return sessions.get(player.id)?.activeChain === token;
}
function endPresentChain(player, token) {
  const session = sessions.get(player.id);
  if (session?.activeChain === token) {
    session.activeChain = void 0;
    session.swapPending = false;
  }
}
function hasLiveChain(player) {
  return sessions.get(player.id)?.activeChain !== void 0;
}
function requestSwap(player) {
  const session = sessions.get(player.id);
  if (session?.activeChain !== void 0) {
    session.swapPending = true;
  }
}
function consumeSwap(player) {
  const session = sessions.get(player.id);
  if (session?.swapPending) {
    session.swapPending = false;
    return true;
  }
  return false;
}
function isSwapPending(player) {
  return sessions.get(player.id)?.swapPending ?? false;
}
function scheduleLogicPass(player) {
  const session = getOrCreate(player);
  if (session.suppress) {
    return;
  }
  if (session.swapPending) {
    return;
  }
  if (session.pending) {
    return;
  }
  if (!session.root || !session.runBuild) {
    return;
  }
  const exiting = getFibersForPlayer(player).some((f) => !f.shouldRender);
  if (exiting) {
    return;
  }
  session.pending = true;
  Promise.resolve().then(() => {
    session.pending = false;
    const state = sessions.get(player.id);
    if (!(state?.root && state?.runBuild)) {
      return;
    }
    if (state.suppress) {
      return;
    }
    if (state.swapPending) {
      return;
    }
    const exitingNow = getFibersForPlayer(player).some((f) => !f.shouldRender);
    if (exitingNow) {
      return;
    }
    try {
      state.runBuild();
    } catch (err) {
      console.warn(`[ui-runtime] background build error: ${String(err)}`);
    }
  });
}
function beginInteractiveTransaction(player) {
  const session = getOrCreate(player);
  session.suppress = true;
  session.pending = false;
}
function endInteractiveTransaction(player) {
  const session = getOrCreate(player);
  session.suppress = false;
}
function isInInteractiveTransaction(player) {
  const session = sessions.get(player.id);
  return session?.suppress ?? false;
}
function triggerCleanup(player, shouldClose = false) {
  stopInputLock(player);
  cleanupComponentTree(player);
  clearPlayerRoot(player);
  if (shouldClose) {
    uiManager.closeAllForms(player);
  }
}

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/utils.ts
function invariant(condition, message) {
  if (!condition) {
    throw new Error(`[fiber] ${message} called outside an active fiber`);
  }
}
function nextHookSlot(fiber, tag) {
  const idx = fiber.hookIndex++;
  let slot = fiber.hookStates[idx];
  if (!slot) {
    slot = { value: void 0, tag };
    fiber.hookStates[idx] = slot;
  } else if (slot.tag !== tag) {
    slot.tag = tag;
  }
  return slot;
}

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/dispatcher.ts
var MountDispatcher = {
  useState(initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useState");
    const slot = nextHookSlot(fiber, "state");
    const value = isFunction(initial) ? initial() : initial;
    slot.value = value;
    slot.initial = value;
    slot.resolved = false;
    const setter = (v) => {
      const prevVal = slot.value;
      const nextVal = isFunction(v) ? v(prevVal) : v;
      if (!Object.is(nextVal, prevVal)) {
        slot.value = nextVal;
        if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
          slot.resolved = true;
        }
        scheduleLogicPass(fiber.player);
      }
    };
    return [slot.value, setter];
  },
  useEffect(effect, deps) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useEffect");
    const slotIndex = fiber.hookIndex;
    const slot = nextHookSlot(fiber, "effect");
    slot.deps = deps;
    fiber.pendingEffects.push({ slotIndex, effect, deps });
  },
  useRef(initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useRef");
    const slot = nextHookSlot(fiber, "ref");
    if (!slot.value) {
      slot.value = { current: initial };
    }
    return slot.value;
  },
  useContext(ctx) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useContext");
    const slot = nextHookSlot(fiber, "context");
    const value = fiber.contextSnapshot?.get(ctx) ?? ctx.defaultValue;
    slot.value = value;
    return value;
  },
  useReducer(reducer, initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useReducer");
    const slot = nextHookSlot(fiber, "reducer");
    slot.value = initial;
    slot.initial = initial;
    slot.resolved = false;
    const dispatch = (action) => {
      const prevVal = slot.value;
      const nextVal = reducer(prevVal, action);
      if (!Object.is(nextVal, prevVal)) {
        slot.value = nextVal;
        if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
          slot.resolved = true;
        }
        scheduleLogicPass(fiber.player);
      }
    };
    return [slot.value, dispatch];
  },
  usePlayer() {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "usePlayer");
    return fiber.player;
  },
  useExit() {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useExit");
    return () => {
      fiber.shouldRender = false;
      if (!isInInteractiveTransaction(fiber.player)) {
        triggerCleanup(fiber.player, true);
      }
    };
  },
  useEvent(signal, callback, options, deps) {
    const allDeps = deps ? [...deps, signal, callback, options] : [signal, callback, options];
    return this.useEffect(() => {
      signal.subscribe(callback, options);
      return () => {
        signal.unsubscribe(callback);
      };
    }, allDeps);
  }
};
var UpdateDispatcher = {
  useState(initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useState");
    const slot = nextHookSlot(fiber, "state");
    if (slot.value === void 0) {
      slot.value = isFunction(initial) ? initial() : initial;
      if (slot.initial === void 0) {
        slot.initial = slot.value;
        slot.resolved = false;
      }
    }
    const setter = (v) => {
      const prevVal = slot.value;
      const nextVal = isFunction(v) ? v(prevVal) : v;
      if (!Object.is(nextVal, prevVal)) {
        slot.value = nextVal;
        if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
          slot.resolved = true;
        }
        scheduleLogicPass(fiber.player);
      }
    };
    return [slot.value, setter];
  },
  useEffect(effect, deps) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useEffect");
    const slotIndex = fiber.hookIndex;
    const slot = nextHookSlot(fiber, "effect");
    if (deps === void 0) {
      slot.deps = void 0;
      fiber.pendingEffects.push({ slotIndex, effect, deps });
      return;
    }
    const prevDeps = slot.deps;
    let changed = false;
    if (!prevDeps) {
      changed = true;
    } else if (prevDeps.length !== deps.length) {
      changed = true;
    } else {
      for (let i = 0; i < deps.length; i++) {
        if (!Object.is(prevDeps[i], deps[i])) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      slot.deps = deps;
      fiber.pendingEffects.push({ slotIndex, effect, deps });
    }
  },
  useRef(initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useRef");
    const slot = nextHookSlot(fiber, "ref");
    if (!slot.value) {
      slot.value = { current: initial };
    }
    return slot.value;
  },
  useContext(ctx) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useContext");
    const slot = nextHookSlot(fiber, "context");
    const value = fiber.contextSnapshot?.get(ctx) ?? ctx.defaultValue;
    slot.value = value;
    return value;
  },
  useReducer(reducer, initial) {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useReducer");
    const slot = nextHookSlot(fiber, "reducer");
    if (slot.value === void 0) {
      slot.value = initial;
      if (slot.initial === void 0) {
        slot.initial = slot.value;
        slot.resolved = false;
      }
    }
    const dispatch = (action) => {
      const prevVal = slot.value;
      const nextVal = reducer(prevVal, action);
      if (!Object.is(nextVal, prevVal)) {
        slot.value = nextVal;
        if (!slot.resolved && !Object.is(nextVal, slot.initial)) {
          slot.resolved = true;
        }
        scheduleLogicPass(fiber.player);
      }
    };
    return [slot.value, dispatch];
  },
  usePlayer() {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "usePlayer");
    return fiber.player;
  },
  useExit() {
    const [fiber] = getCurrentFiber();
    invariant(fiber, "useExit");
    return () => {
      fiber.shouldRender = false;
      if (!isInInteractiveTransaction(fiber.player)) {
        triggerCleanup(fiber.player, true);
      }
    };
  },
  useEvent(signal, callback, options, deps) {
    const allDeps = deps ? [...deps, signal, callback, options] : [signal, callback, options];
    return this.useEffect(() => {
      signal.subscribe(callback, options);
      return () => {
        signal.unsubscribe(callback);
      };
    }, allDeps);
  }
};

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/fiber.ts
function createFiber(id, player) {
  const fiber = {
    id,
    hookStates: [],
    hookIndex: 0,
    dispatcher: MountDispatcher,
    player,
    pendingEffects: [],
    shouldRender: true,
    parent: void 0,
    child: void 0,
    sibling: void 0,
    index: -1
  };
  FiberRegistry.set(id, fiber);
  return fiber;
}
function getFiber(id) {
  return FiberRegistry.get(id);
}
function deleteFiber(id) {
  const fiber = FiberRegistry.get(id);
  if (!fiber) {
    return;
  }
  const parent = fiber.parent;
  if (parent) {
    if (parent.child === fiber) {
      parent.child = fiber.sibling;
    } else {
      let prev = parent.child;
      while (prev?.sibling && prev.sibling !== fiber) {
        prev = prev.sibling;
      }
      if (prev?.sibling === fiber) {
        prev.sibling = fiber.sibling;
      }
    }
  }
  fiber.parent = void 0;
  fiber.sibling = void 0;
  for (let i = 0; i < fiber.hookStates.length; i++) {
    const slot = fiber.hookStates[i];
    if (slot.cleanup) {
      try {
        slot.cleanup();
      } catch {
      }
      slot.cleanup = void 0;
    }
  }
  FiberRegistry.delete(id);
}
function getFibersForPlayer(player) {
  const fibers = [];
  FiberRegistry.forEach((element) => {
    if (element.player.id === player.id) {
      fibers.push(element);
    }
  });
  return fibers;
}
function activateFiber(fiber, fn) {
  const [prevFiber, prevDispatcher] = getCurrentFiber();
  fiber.hookIndex = 0;
  fiber.pendingEffects = [];
  setCurrentFiber(fiber, fiber.dispatcher);
  try {
    const result = fn();
    fiber.dispatcher = UpdateDispatcher;
    flushPendingEffects(fiber);
    return result;
  } finally {
    setCurrentFiber(prevFiber, prevDispatcher);
  }
}
function flushPendingEffects(fiber) {
  const pending = fiber.pendingEffects.splice(0, fiber.pendingEffects.length);
  for (const { slotIndex, effect } of pending) {
    const slot = fiber.hookStates[slotIndex];
    if (slot.cleanup) {
      try {
        slot.cleanup();
      } catch {
      }
      slot.cleanup = void 0;
    }
    let cleanup = void 0;
    try {
      cleanup = effect();
    } catch {
      cleanup = void 0;
    }
    if (typeof cleanup === "function") {
      slot.cleanup = cleanup;
    }
  }
}

// node_modules/@bedrock-core/ui-runtime/src/core/fabric/guards.ts
function isContextProvider(element) {
  return element.type === "context-provider" && element.props && "__context" in element.props;
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/presenters/shared.ts
function findModalConfig(node) {
  if (!isElement(node)) {
    return void 0;
  }
  if (node.type === MODAL_FORM_SLOT_TYPE) {
    const config = node.props.__formConfig;
    return config && typeof config === "object" ? config : void 0;
  }
  const { children } = node.props;
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    const found = findModalConfig(child);
    if (found) {
      return found;
    }
  }
  return void 0;
}
function findBackground(node) {
  if (!isElement(node)) {
    return "";
  }
  if (node.type === BACKGROUND_SLOT_TYPE) {
    const texture = node.props.__background;
    return typeof texture === "string" ? texture : "";
  }
  const { children } = node.props;
  const childArray = Array.isArray(children) ? children : [children];
  for (const child of childArray) {
    const found = findBackground(child);
    if (found !== "") {
      return found;
    }
  }
  return "";
}
async function runInteractiveCallback(player, callback) {
  beginInteractiveTransaction(player);
  return Promise.resolve().then(() => callback()).finally(() => {
    endInteractiveTransaction(player);
  }).then(() => {
    const shouldClose = getFibersForPlayer(player).some((fiber) => !fiber.shouldRender);
    return shouldClose ? "cleanup" : "present";
  });
}
function sane(value, fallback, allowNonPositive = false) {
  return typeof value === "number" && Number.isFinite(value) && (allowNonPositive || value > 0) ? value : fallback;
}
function resolveScrolls(tree) {
  const rawScrolls = tree.props.jsonUIScrolls;
  const rawHeight = tree.props.jsonUIHeight;
  delete tree.props.jsonUIScrolls;
  delete tree.props.jsonUIHeight;
  const scrollsSource = Array.isArray(rawScrolls) && rawScrolls.length > 0 ? rawScrolls : [{
    axis: "y",
    x: 0,
    y: 0,
    width: CANONICAL_SCREEN.width,
    height: CANONICAL_SCREEN.height,
    extent: sane(rawHeight, CANONICAL_SCREEN.height)
  }];
  return scrollsSource.map((scroll) => ({
    axis: scroll?.axis === "x" ? "x" : "y",
    x: sane(scroll?.x, 0, true),
    y: sane(scroll?.y, 0, true),
    width: sane(scroll?.width, CANONICAL_SCREEN.width),
    height: sane(scroll?.height, CANONICAL_SCREEN.height),
    extent: sane(scroll?.extent, CANONICAL_SCREEN.height)
  }));
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/presenters/presentAction.ts
async function presentAction(player, tree) {
  const context = { mode: "action", buttonCallbacks: /* @__PURE__ */ new Map(), buttonIndex: 0 };
  const form = new ActionFormData();
  form.title(serializeScrollMetadata(resolveScrolls(tree), findBackground(tree)));
  serialize(tree, form, context);
  return form.show(player).then((response) => {
    if (response.canceled) {
      return "cleanup";
    }
    if (response.selection !== void 0) {
      const callback = context.buttonCallbacks.get(response.selection);
      if (callback) {
        return runInteractiveCallback(player, callback);
      }
    }
    return "none";
  });
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/presenters/presentModal.ts
import { ModalFormData } from "@minecraft/server-ui";
async function presentModal(player, tree, config) {
  const context = { mode: "modal", modalControls: /* @__PURE__ */ new Map(), modalControlIndex: 0 };
  const form = new ModalFormData();
  const { submit, exit } = collectFormButtons(tree);
  form.title(serializeModalTitle(resolveScrolls(tree), {
    ...formButtonTitleFields("submit", submit),
    ...formButtonTitleFields("exit", exit)
  }, findBackground(tree)));
  serialize(tree, form, context);
  return form.show(player).then((response) => {
    if (response.canceled) {
      if (isSwapPending(player)) {
        return "none";
      }
      if (config.onCancel) {
        return runInteractiveCallback(player, () => config.onCancel?.());
      }
      return "cleanup";
    }
    const values = collectValues(context, response.formValues);
    if (config.onSubmit) {
      return runInteractiveCallback(player, () => config.onSubmit?.(values));
    }
    return "none";
  });
}
function collectValues(context, formValues) {
  const values = {};
  if (!formValues) {
    return values;
  }
  for (const [ordinal, entry] of context.modalControls) {
    if (entry.name !== "") {
      values[entry.name] = formValues[ordinal];
    }
  }
  return values;
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/presenters/present.ts
async function present(player, tree) {
  const modalConfig = findModalConfig(tree);
  if (modalConfig) {
    return presentModal(player, tree, modalConfig);
  }
  return presentAction(player, tree);
}

// node_modules/@bedrock-core/ui-runtime/src/core/render/lifecycle.ts
function render(root, player) {
  registerNativeComponents();
  const userRoot = typeof root === "function" ? { type: root, props: {} } : root;
  const rootElement = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the expander invokes the wrapper with exactly these props
    type: DefaultTranslations,
    props: { player, children: userRoot }
  };
  if (hasLiveChain(player)) {
    cleanupComponentTree(player);
    if (hasLiveChain(player)) {
      setPlayerRoot(player, rootElement);
      setBuildRunner(player, () => {
        buildTree(rootElement, player);
      });
      requestSwap(player);
      uiManager2.closeAllForms(player);
      return;
    }
  }
  startInputLock(player);
  cleanupComponentTree(player);
  setPlayerRoot(player, rootElement);
  setBuildRunner(player, () => {
    buildTree(rootElement, player);
  });
  const token = beginPresentChain(player);
  const presentOnce = () => {
    if (!isChainCurrent(player, token)) {
      return;
    }
    const rootNow = getPlayerRoot(player);
    if (!rootNow) {
      endPresentChain(player, token);
      return;
    }
    if (consumeSwap(player)) {
      cleanupComponentTree(player);
    }
    let tree;
    try {
      tree = buildTree(rootNow, player);
    } catch (err) {
      console.error(`[ui-runtime] buildTree error: ${String(err)}`);
      endPresentChain(player, token);
      triggerCleanup(player);
      return;
    }
    present(player, tree).then((result) => {
      if (!isChainCurrent(player, token)) {
        return;
      }
      if (isSwapPending(player)) {
        presentOnce();
        return;
      }
      if (result === "present") {
        presentOnce();
        return;
      }
      endPresentChain(player, token);
      if (result === "cleanup") {
        triggerCleanup(player);
      }
    }).catch((err) => {
      console.error(`[ui-runtime] present error: ${String(err)}`);
      if (!isChainCurrent(player, token)) {
        return;
      }
      endPresentChain(player, token);
      try {
        triggerCleanup(player);
      } catch {
      }
    });
  };
  presentOnce();
}

// node_modules/@bedrock-core/ui-runtime/src/components/Image.ts
var imageWriter = (payload, form, ctx) => {
  emitHeader(payload, form, ctx);
};

// node_modules/@bedrock-core/ui-runtime/src/components/ItemRenderer.ts
import { ItemComponentTypes } from "@minecraft/server";
var itemRendererWriter = (payload, form, ctx, callbacks, props) => {
  emitButton(payload, form, ctx, callbacks, String(props?.aux ?? 0));
};

// node_modules/@bedrock-core/ui-runtime/src/components/Panel.ts
var Panel = ({ children, ...rest }) => ({
  type: "panel",
  props: {
    ...withControl(rest),
    children
  }
});
var panelWriter = (payload, form, ctx) => {
  emitLabel(payload, form, ctx);
};

// node_modules/@bedrock-core/ui-runtime/src/components/index.ts
var registered = false;
function registerNativeComponents() {
  if (registered) {
    return;
  }
  registered = true;
  registerComponent("button", { writer: buttonWriter });
  registerComponent("panel", { writer: panelWriter });
  registerComponent("text", { writer: textWriter });
  registerComponent(TEXT_SHADOW_TYPE, { writer: textWriter });
  registerComponent(TEXT_WRAP_TYPE, { writer: textWriter });
  registerComponent(TEXT_SHADOW_WRAP_TYPE, { writer: textWriter });
  registerComponent("image", { writer: imageWriter });
  registerComponent("item_renderer", { writer: itemRendererWriter });
  registerComponent("fragment", { transparent: true });
  registerComponent("context-provider", { transparent: true });
  registerComponent(SCROLL_SLOT_TYPE, { transparent: true });
  registerComponent(MODAL_FORM_SLOT_TYPE, { transparent: true });
  registerComponent(BACKGROUND_SLOT_TYPE, { transparent: true });
  registerComponent(MODAL_TOGGLE_SLOT_TYPE, { writer: formToggleWriter });
  registerComponent(MODAL_SLIDER_SLOT_TYPE, { writer: formSliderWriter });
  registerComponent(MODAL_DROPDOWN_SLOT_TYPE, { writer: formDropdownWriter });
  registerComponent(MODAL_INLINE_SELECT_SLOT_TYPE, { writer: formInlineSelectWriter });
  registerComponent(MODAL_INPUT_SLOT_TYPE, { writer: formInputWriter });
  registerComponent(MODAL_FORM_BUTTON_SLOT_TYPE, { writer: formButtonWriter });
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
import { Player as Player2 } from "@minecraft/server";
import { system as system22 } from "@minecraft/server";
import { system as system3 } from "@minecraft/server";
import { system as system4, world as world4 } from "@minecraft/server";
import { Player as Player22, system as system5, world as world5 } from "@minecraft/server";
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
    const relative2 = _MutVec3.from(v).subtract(this.copy().multiply(dot)).normalize();
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this.multiply(cosT);
    this.x += relative2.x * sinT;
    this.y += relative2.y * sinT;
    this.z += relative2.z * sinT;
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
    const plain2 = new _ColorJSON();
    plain2.OpenCloseObjectColor = "";
    plain2.OpenCloseArrayColor = "";
    plain2.NumberColor = "";
    plain2.StringColor = "";
    plain2.BooleanColor = "";
    plain2.NullColor = "";
    plain2.KeyColor = "";
    plain2.EscapeColor = "";
    plain2.FunctionColor = "";
    plain2.ClassColor = "";
    plain2.ClassStyle = "";
    plain2.CycleColor = "";
    return plain2;
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
var OutputType = /* @__PURE__ */ ((OutputType2) => {
  OutputType2[OutputType2["Chat"] = 0] = "Chat";
  OutputType2[OutputType2["ConsoleInfo"] = 1] = "ConsoleInfo";
  OutputType2[OutputType2["ConsoleWarn"] = 2] = "ConsoleWarn";
  OutputType2[OutputType2["ConsoleError"] = 3] = "ConsoleError";
  return OutputType2;
})(OutputType || {});
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
  static setTagsOutputVisibility(visible2) {
    loggingSettings.outputTags = visible2;
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
    const relative2 = _Vec3.from(v).subtract(this.multiply(dot)).normalize();
    return this.multiply(Math.cos(theta)).add(
      relative2.multiply(Math.sin(theta))
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
    const relative2 = _MutVec2.from(v).subtract(this.copy().multiply(dot)).normalize();
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    this.multiply(cosT);
    this.x += relative2.x * sinT;
    this.y += relative2.y * sinT;
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
    const relative2 = _Vec2.from(v).subtract(this.multiply(dot)).normalize();
    return this.multiply(Math.cos(theta)).add(
      relative2.multiply(Math.sin(theta))
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

// src/lib/log.ts
var OUTPUT_CONFIG = Logger.getOutputConfig();
for (const key of Object.keys(OUTPUT_CONFIG)) {
  const level = Number(key);
  OUTPUT_CONFIG[level] = (OUTPUT_CONFIG[level] ?? []).filter((output) => output !== OutputType.Chat);
}
var log3 = Logger.getLogger("NaLandia");
var logDb = Logger.getLogger("NaLandia", "db");
var logTerr = Logger.getLogger("NaLandia", "territories");
var logMod = Logger.getLogger("NaLandia", "moderation");
var logPerm = Logger.getLogger("NaLandia", "permissions");

// src/ui/sheets.ts
var BUTTON_BACK_MARKER = "§r";
var DIVIDER_TEXTURE = "textures/ui/ore-styled/divider/horizontal/default";
var PANE_TEXTURE = "textures/ui/om_content_bg";
var DESIGN_SPECS = {
  /* Hub, admin, DB, modération, rôles, joueurs, modules : cuir sombre à cadre
     or, tuiles fines serrées, texte compact. */
  console: {
    bg: "textures/ui/om_ornate_bg",
    banner: "textures/ui/om_header_band",
    row: "textures/ui/om_btn",
    rowHover: "textures/ui/om_btn_hover",
    rowPress: "textures/ui/om_btn_press",
    rowHeight: 32,
    rowGap: 5,
    scale: 1,
    titleScale: 1.1
  },
  /* Classes, Métiers, Le Monde, Mines, États : vert émeraude, TRÈS grand
     bandeau doré, GRANDES cartes espacées, texte plus gros. */
  cards: {
    bg: "textures/ui/om_sheet_bg",
    banner: "textures/ui/om_sheet_pane",
    row: "textures/ui/om_card",
    rowHover: "textures/ui/om_card_hover",
    rowPress: "textures/ui/om_card_press",
    rowHeight: 46,
    rowGap: 6,
    scale: 1.3,
    titleScale: 1.35
  },
  /* Fiches : bleu nuit à filet argent — bandeau doré + panneau de texte, et
     une tuile PROPRE (Ore UI), différente de celle du hub/admin. */
  parchment: {
    bg: "textures/ui/om_cards_bg",
    banner: "textures/ui/om_sheet_pane",
    row: "textures/ui/ore-styled/button/secondary/background",
    rowHover: "textures/ui/ore-styled/button/secondary/background_hover",
    rowPress: "textures/ui/ore-styled/button/secondary/background_pressed",
    rowHeight: 34,
    rowGap: 5,
    scale: 1,
    titleScale: 1.2
  }
};
var CARD_SECTIONS = [
  "Classes",
  "Classe",
  "Ma voie",
  "Confirmer",
  "États",
  "Le Monde",
  "Mines",
  "Métiers"
];
var PARCHMENT_SECTIONS = [
  "Clan",
  "Mon clan",
  "Bio du clan",
  "Membres du clan",
  "Membre",
  "Inviter",
  "Drapeau",
  "Dissoudre le clan",
  "Créer un clan",
  "Mes infos"
];
var SHEET_SECTIONS = [...CARD_SECTIONS, ...PARCHMENT_SECTIONS];
var TITLE_PREFIX = "NaLandia » ";
function sheetTitleFor(section) {
  return `${TITLE_PREFIX}${section}`;
}
function designForSection(section) {
  if (CARD_SECTIONS.includes(section)) return "cards";
  if (PARCHMENT_SECTIONS.includes(section)) return "parchment";
  return "console";
}
function designForTitle(title) {
  const clean = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
  return designForSection(clean.trim());
}

// node_modules/@bedrock-core/ui-runtime/src/jsx/jsx-runtime.ts
function renderJSX(tag, props) {
  return {
    type: tag,
    props: props || {}
  };
}
var jsx = renderJSX;
var jsxs = renderJSX;

// src/ui/theme.tsx
var RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";
var uiDesignEnabled = true;
function setUiDesign(enabled) {
  uiDesignEnabled = enabled;
}
function plain(text) {
  return text.replace(/§h/g, "").replace(/[■≡⬥✦╔╗╚╝█░▓━→←↔·]\s?/g, "").trim();
}
function windowTitle(section) {
  return `${TITLE_PREFIX}${section}`;
}
var DESIGNS = DESIGN_SPECS;
var ObservableString = class {
  value;
  constructor(initial, _options) {
    this.value = initial;
  }
  getData() {
    return this.value;
  }
  setData(data) {
    this.value = data;
  }
  subscribe(_cb) {
    return _cb;
  }
  unsubscribe(_cb) {
    return true;
  }
};
var ObservableNumber = class {
  value;
  constructor(initial, _options) {
    this.value = initial;
  }
  getData() {
    return this.value;
  }
  setData(data) {
    this.value = data;
  }
  subscribe(_cb) {
    return _cb;
  }
  unsubscribe(_cb) {
    return true;
  }
};
var ObservableBoolean = class {
  value;
  constructor(initial, _options) {
    this.value = initial;
  }
  getData() {
    return this.value;
  }
  setData(data) {
    this.value = data;
  }
  subscribe(_cb) {
    return _cb;
  }
  unsubscribe(_cb) {
    return true;
  }
};
function obString(initial) {
  return new ObservableString(initial);
}
function obNumber(initial) {
  return new ObservableNumber(initial);
}
function obBool(initial) {
  return new ObservableBoolean(initial);
}
var CLOSE_TEXTURE = "textures/ui/ore-styled/button/close/background";
var CLOSE_HOVER = "textures/ui/ore-styled/button/close/background_hover";
var CLOSE_PRESS = "textures/ui/ore-styled/button/close/background_pressed";
function BackArrow({ onBack }) {
  return /* @__PURE__ */ jsx(
    Button,
    {
      width: 22,
      height: 22,
      background: "textures/ui/om_btn_back",
      backgroundHover: "textures/ui/om_btn_back_hover",
      backgroundPressed: "textures/ui/om_btn_back_hover",
      onPress: onBack
    }
  );
}
function CloseCross({ onClose }) {
  return /* @__PURE__ */ jsx(
    Button,
    {
      width: 22,
      height: 22,
      background: CLOSE_TEXTURE,
      backgroundHover: CLOSE_HOVER,
      backgroundPressed: CLOSE_PRESS,
      onPress: onClose
    }
  );
}
function Banner({
  design,
  title,
  onBack,
  onClose
}) {
  const spec = DESIGNS[design];
  const section = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
  const clanHeader = section === "Mon clan";
  return /* @__PURE__ */ jsxs(
    Panel,
    {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: 6,
      background: spec.banner,
      children: [
        onBack ? /* @__PURE__ */ jsx(BackArrow, { onBack }) : /* @__PURE__ */ jsx(Panel, { width: 22, height: 22 }),
        clanHeader ? /* @__PURE__ */ jsx(Panel, { width: 28, height: 22 }) : null,
        /* @__PURE__ */ jsx(Panel, { flexGrow: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", children: /* @__PURE__ */ jsx(Text, { scale: spec.titleScale, maxLines: 1, overflow: "ellipsis", shadow: true, children: `§l§6${section}` }) }),
        clanHeader ? /* @__PURE__ */ jsx(Text, { scale: 0.8, maxLines: 1, children: "§eDrapeau" }) : null,
        onClose ? /* @__PURE__ */ jsx(CloseCross, { onClose }) : /* @__PURE__ */ jsx(Panel, { width: 22, height: 22 })
      ]
    }
  );
}
function AccentLine() {
  return /* @__PURE__ */ jsx(Panel, { width: 24, height: 2, background: "textures/ui/om_header_band", marginTop: 1 });
}
function GroupHeader({ text, scale }) {
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 1, marginTop: 3, children: [
    /* @__PURE__ */ jsx(Text, { scale, shadow: true, children: `§l§6${text}` }),
    /* @__PURE__ */ jsx(AccentLine, {})
  ] });
}
function ConsoleRow({ label, onPress }) {
  const spec = DESIGNS.console;
  return /* @__PURE__ */ jsx(
    Button,
    {
      width: "100%",
      height: spec.rowHeight,
      background: spec.row,
      backgroundHover: spec.rowHover,
      backgroundPressed: spec.rowPress,
      onPress,
      children: /* @__PURE__ */ jsxs(
        Panel,
        {
          width: "100%",
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 6,
          paddingRight: 8,
          children: [
            /* @__PURE__ */ jsx(Panel, { width: 2, height: "60%", background: "textures/ui/om_header_band", marginRight: 6 }),
            /* @__PURE__ */ jsx(Text, { scale: spec.scale, maxLines: 1, overflow: "ellipsis", shadow: true, children: label })
          ]
        }
      )
    }
  );
}
function CardRow({ label, onPress }) {
  const spec = DESIGNS.cards;
  return /* @__PURE__ */ jsx(
    Button,
    {
      width: "100%",
      height: spec.rowHeight,
      background: spec.row,
      backgroundHover: spec.rowHover,
      backgroundPressed: spec.rowPress,
      onPress,
      children: /* @__PURE__ */ jsxs(
        Panel,
        {
          width: "100%",
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 4,
          paddingRight: 10,
          children: [
            /* @__PURE__ */ jsx(Panel, { width: 4, height: "100%", background: "textures/ui/om_header_band", marginRight: 8 }),
            /* @__PURE__ */ jsx(Text, { scale: spec.scale, maxLines: 1, overflow: "ellipsis", shadow: true, children: label }),
            /* @__PURE__ */ jsx(Panel, { flexGrow: 1 }),
            /* @__PURE__ */ jsx(Panel, { width: 3, height: "55%", background: "textures/ui/om_header_band", marginLeft: 2 })
          ]
        }
      )
    }
  );
}
function ParchmentRow({ label, onPress }) {
  const spec = DESIGNS.parchment;
  return /* @__PURE__ */ jsx(
    Button,
    {
      width: "100%",
      height: spec.rowHeight,
      background: spec.row,
      backgroundHover: spec.rowHover,
      backgroundPressed: spec.rowPress,
      onPress,
      children: /* @__PURE__ */ jsxs(
        Panel,
        {
          width: "100%",
          height: "100%",
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 8,
          paddingRight: 8,
          children: [
            /* @__PURE__ */ jsx(Text, { scale: spec.scale, maxLines: 1, overflow: "ellipsis", shadow: true, children: label }),
            /* @__PURE__ */ jsx(Panel, { flexGrow: 1 }),
            /* @__PURE__ */ jsx(Panel, { width: 3, height: "55%", background: "textures/ui/om_header_band", marginLeft: 2 })
          ]
        }
      )
    }
  );
}
function Row({
  design,
  label,
  onPress
}) {
  if (design === "cards") return /* @__PURE__ */ jsx(CardRow, { label, onPress });
  if (design === "parchment") return /* @__PURE__ */ jsx(ParchmentRow, { label, onPress });
  return /* @__PURE__ */ jsx(ConsoleRow, { label, onPress });
}
function Sep() {
  return /* @__PURE__ */ jsx(Panel, { width: "100%", height: 6, background: DIVIDER_TEXTURE, marginTop: 2, marginBottom: 2 });
}
function useCloseOnUnmount(onClose) {
  useEffect(() => {
    return () => onClose();
  }, []);
}
function ActionsScreen(props) {
  const spec = DESIGNS[props.design];
  useCloseOnUnmount(props.onClose);
  const exit = useExit();
  const content = [];
  const navigation = [];
  const details = [];
  for (const el of props.elements) {
    switch (el.kind) {
      case "header": {
        const node = /* @__PURE__ */ jsx(GroupHeader, { text: el.text, scale: spec.scale * 1.1 });
        content.push(node);
        details.push(node);
        break;
      }
      case "label": {
        const node = /* @__PURE__ */ jsx(Text, { children: `§7${el.text}` });
        content.push(node);
        details.push(node);
        break;
      }
      case "body": {
        const node = /* @__PURE__ */ jsx(Text, { children: `§f${el.text}` });
        content.push(node);
        details.push(node);
        break;
      }
      case "divider": {
        const node = /* @__PURE__ */ jsx(Sep, {});
        content.push(node);
        details.push(node);
        break;
      }
      case "button": {
        if (el.text === BUTTON_BACK_MARKER) break;
        const onClick = el.onClick;
        const node = /* @__PURE__ */ jsx(
          Row,
          {
            design: props.design,
            label: el.text,
            onPress: () => {
              props.onAction(onClick);
              exit();
            }
          }
        );
        content.push(node);
        navigation.push(node);
        break;
      }
      case "field":
        break;
    }
  }
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", height: "100%", flexDirection: "column", padding: 4, gap: 3, children: [
    /* @__PURE__ */ jsx(Background, { texture: spec.bg }),
    /* @__PURE__ */ jsx(
      Banner,
      {
        design: props.design,
        title: props.title,
        onBack: props.onBack ? () => {
          props.onBack?.();
          exit();
        } : void 0,
        onClose: () => exit()
      }
    ),
    /* @__PURE__ */ jsx(Scroll, { flexGrow: 1, children: props.design === "console" ? /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "row", gap: 6, padding: 3, children: [
      /* @__PURE__ */ jsx(Panel, { width: 112, flexDirection: "column", gap: 4, padding: 3, background: PANE_TEXTURE, children: navigation }),
      /* @__PURE__ */ jsx(Panel, { flexGrow: 1, flexDirection: "column", gap: spec.rowGap, padding: 3, children: details })
    ] }) : /* @__PURE__ */ jsx(Panel, { width: "100%", flexDirection: "column", gap: spec.rowGap, padding: 3, children: content }) })
  ] });
}
function FieldsScreen(props) {
  const spec = DESIGNS.parchment;
  useCloseOnUnmount(props.onClose);
  const exit = useExit();
  const headerNodes = [];
  const fieldNodes = [];
  let submitLabel = "Valider";
  for (const el of props.elements) {
    if (el.kind === "field") {
      fieldNodes.push(/* @__PURE__ */ jsx(Panel, { width: "100%", children: el.render() }));
    } else if (el.kind === "button") {
      submitLabel = el.text;
    } else if (el.kind === "header") {
      headerNodes.push(/* @__PURE__ */ jsx(GroupHeader, { text: el.text, scale: 1.1 }));
    } else if (el.kind === "divider") {
      headerNodes.push(/* @__PURE__ */ jsx(Sep, {}));
    } else if (el.kind === "label" || el.kind === "body") {
      headerNodes.push(/* @__PURE__ */ jsx(Text, { children: `§7${el.text}` }));
    }
  }
  const onCancel = props.onFieldCancel;
  const showBack = props.onBack !== void 0;
  const onSubmit = props.onFieldSubmit;
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", height: "100%", flexDirection: "column", padding: 4, gap: 3, children: [
    /* @__PURE__ */ jsx(Background, { texture: spec.bg }),
    /* @__PURE__ */ jsx(Banner, { design: props.design, title: props.title }),
    /* @__PURE__ */ jsx(
      Form,
      {
        onSubmit: (values) => {
          onSubmit(values);
          exit();
        },
        onCancel: () => {
          onCancel();
          exit();
        },
        children: /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 4, padding: 6, background: PANE_TEXTURE, children: [
          /* @__PURE__ */ jsx(Panel, { width: "100%", flexDirection: "column", gap: 3, children: headerNodes }),
          /* @__PURE__ */ jsx(Panel, { width: "100%", flexDirection: "column", gap: 3, children: fieldNodes }),
          showBack ? /* @__PURE__ */ jsx(Form.Button, { type: "exit", label: "Retour" }) : null,
          /* @__PURE__ */ jsx(Form.Button, { type: "submit", label: submitLabel })
        ] })
      }
    )
  ] });
}
function FieldLabel({ label }) {
  return /* @__PURE__ */ jsx(Text, { children: `§7${label}` });
}
function FormToggleRow({
  name,
  label,
  initial
}) {
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 2, marginBottom: 2, children: [
    /* @__PURE__ */ jsx(FieldLabel, { label }),
    /* @__PURE__ */ jsx(Form.Toggle, { name, defaultValue: initial })
  ] });
}
function FormSliderRow({
  name,
  label,
  min,
  max,
  step,
  initial
}) {
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 2, marginBottom: 2, children: [
    /* @__PURE__ */ jsx(FieldLabel, { label }),
    /* @__PURE__ */ jsx(Form.Slider, { name, min, max, step, defaultValue: initial })
  ] });
}
function FormInputRow({
  name,
  label,
  placeholder,
  initial
}) {
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 2, marginBottom: 2, children: [
    /* @__PURE__ */ jsx(FieldLabel, { label }),
    /* @__PURE__ */ jsx(Form.Input, { name, placeholder, defaultValue: initial })
  ] });
}
function FormDropdownRow({
  name,
  label,
  options,
  initial
}) {
  return /* @__PURE__ */ jsxs(Panel, { width: "100%", flexDirection: "column", gap: 2, marginBottom: 2, children: [
    /* @__PURE__ */ jsx(FieldLabel, { label }),
    /* @__PURE__ */ jsx(Form.Dropdown, { name, defaultValue: options[initial] ?? "", children: options.map((text, index) => /* @__PURE__ */ jsx(Form.Option, { value: `${index}`, label: text })) })
  ] });
}
var OMForm = class {
  player;
  titleText;
  design;
  backAction;
  elements = [];
  mode = "actions";
  resolveShow;
  constructor(player, title, _hero, design) {
    this.player = player;
    this.titleText = title.replace(/§./g, "").trim();
    this.design = design ?? designForTitle(this.titleText);
  }
  /** Bannière de héros — désactivée (no-op conservé pour les appelants). */
  hero(_kind) {
    return this;
  }
  /** En-tête de section (or, gras). */
  header(text) {
    this.elements.push({ kind: "header", text: plain(text) });
    return this;
  }
  /** Paragraphe de texte. */
  body(text) {
    this.elements.push({ kind: "body", text: plain(text) });
    return this;
  }
  /** Ligne de texte discrète. */
  label(text) {
    this.elements.push({ kind: "label", text: plain(text) });
    return this;
  }
  /**
   * Entrée cliquable. Le libellé est aplati en UNE ligne (les labels
   * multi-lignes restent fragiles en JSON UI).
   */
  button(label, onClick, _options, _icon) {
    const flat = plain(label).replace(/\s*\n\s*/g, "  ·  ").trim();
    const wrapped = () => {
      try {
        onClick();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Action du menu « ${this.titleText} » échouée : ${message}`);
        this.player.sendMessage(
          `§c[NaLandia] L'action du menu « ${this.titleText} » a échoué : §f${message}`
        );
      }
    };
    this.elements.push({ kind: "button", text: flat, onClick: wrapped });
    return this;
  }
  divider() {
    this.elements.push({ kind: "divider", text: "" });
    return this;
  }
  spacer() {
    return this;
  }
  /**
   * Bouton RETOUR : une pastille-flèche blanche vers la gauche, en HAUT À
   * GAUCHE du bandeau de titre — ce n'est PAS une entrée de la liste.
   */
  back(onBack) {
    this.backAction = onBack;
    return this;
  }
  /** Ajoute un champ : bascule l'écran en mode `ModalFormData`. */
  addField(renderField, read) {
    const name = `f${this.elements.filter((el) => el.kind === "field").length}`;
    this.mode = "fields";
    this.elements.push({ kind: "field", name, render: () => renderField(name), read });
  }
  toggle(label, initial) {
    this.addField((name) => /* @__PURE__ */ jsx(FormToggleRow, { name, label, initial }), () => {
    });
    return this;
  }
  toggleOb(label, observable) {
    this.addField(
      (name) => /* @__PURE__ */ jsx(FormToggleRow, { name, label, initial: observable.getData() }),
      (value) => {
        if (typeof value === "boolean") observable.setData(value);
      }
    );
    return this;
  }
  slider(label, observable, min, max, options) {
    const current = Math.min(Math.max(observable.getData(), min), max);
    const step = options?.step ?? 1;
    this.addField(
      (name) => /* @__PURE__ */ jsx(FormSliderRow, { name, label, min, max, step, initial: current }),
      (value) => {
        if (typeof value === "number") observable.setData(value);
      }
    );
    return this;
  }
  dropdown(label, observable, items) {
    const labels = items.map(
      (item, index) => typeof item === "string" ? item : item.label || `Option ${index + 1}`
    );
    const initial = Math.min(Math.max(observable.getData(), 0), Math.max(labels.length - 1, 0));
    this.addField(
      (name) => /* @__PURE__ */ jsx(FormDropdownRow, { name, label, options: labels, initial }),
      (value) => {
        if (typeof value === "number") observable.setData(value);
      }
    );
    return this;
  }
  textField(label, observable, options) {
    const placeholder = options?.placeholder ?? "…";
    this.addField(
      (name) => /* @__PURE__ */ jsx(
        FormInputRow,
        {
          name,
          label,
          placeholder,
          initial: observable.getData()
        }
      ),
      (value) => {
        if (typeof value === "string") observable.setData(value);
      }
    );
    return this;
  }
  /** Compat : les formulaires JSX ont leur propre contrôle de fermeture. */
  closeButton() {
    return this;
  }
  isShowing() {
    return false;
  }
  closeIfShowing() {
  }
  /**
   * Affiche le menu. Différé de 2 ticks : un `render()` dans le même tick qu'une
   * fermeture est perdu en silence.
   */
  show() {
    return new Promise((resolve) => {
      this.resolveShow = resolve;
      system7.runTimeout(() => {
        try {
          this.present();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logMod.warn(`Menu « ${this.titleText} » : ${message}`);
          this.player.sendMessage(
            `§c[NaLandia] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`
          );
          this.close("ServerClosed");
        }
      }, 2);
    });
  }
  close(reason) {
    const resolve = this.resolveShow;
    this.resolveShow = void 0;
    resolve?.(reason);
  }
  present() {
    const props = {
      design: this.design,
      title: this.titleText,
      onBack: this.backAction,
      elements: this.elements,
      onClose: () => this.close("UserClosed"),
      onAction: (onClick) => {
        onClick();
        this.close("UserClosed");
      },
      onFieldSubmit: (values) => this.applyFields(values),
      onFieldCancel: () => {
        const back = this.backAction;
        if (back) back();
        this.close("UserClosed");
      }
    };
    const Screen = this.mode === "fields" ? FieldsScreen : ActionsScreen;
    render(/* @__PURE__ */ jsx(Screen, { ...props }), this.player);
  }
  /** Réinjecte les valeurs du `<Form>` dans les lecteurs de champs hérités. */
  applyFields(values) {
    const fields = this.elements.filter((el) => el.kind === "field");
    for (const field of fields) {
      const raw = values[field.name];
      if (raw !== void 0 && raw !== null) field.read(raw);
    }
    const submit = [...this.elements].reverse().find((el) => el.kind === "button");
    if (submit && submit.kind === "button") submit.onClick();
    this.close("UserClosed");
  }
};
function buildAndShow(player, title, build, design, hero) {
  const shortName = title.replace(/§./g, "").trim();
  return new Promise((resolve, reject) => {
    system7.runTimeout(() => {
      let form;
      try {
        form = new OMForm(player, title, hero, design);
        build(form);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu se construire : ${message}`);
        player.sendMessage(
          `§c[NaLandia] Le menu « ${shortName} » n'a pas pu se construire : §f${message}`
        );
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      form.show().then(resolve, (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logMod.warn(`Menu « ${shortName} » n'a pas pu s'afficher : ${message}`);
        player.sendMessage(
          `§c[NaLandia] Le menu « ${shortName} » n'a pas pu s'afficher : §f${message}`
        );
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    }, 2);
  });
}
function openWindow(player, section, build, hero) {
  return buildAndShow(player, sheetTitleFor(section), build, designForSection(section), hero);
}
function openWindowRaw(player, title, build) {
  return buildAndShow(player, title, build, designForTitle(title.replace(/§./g, "").trim()));
}

// src/db/menu.ts
function resetClassOf(db2, playerName) {
  return db2.delete(CLASSES_COLLECTION, playerName);
}
function summarize(doc) {
  const data = doc.data ?? {};
  if (typeof data.name === "string" && data.name !== "") {
    const extras = [];
    if (typeof data.level === "number") extras.push(`niv. ${data.level}`);
    if (typeof data.role === "string") extras.push(String(data.role));
    if (typeof data.reason === "string") extras.push(String(data.reason).slice(0, 30));
    if (typeof data.enabled === "boolean") extras.push(data.enabled ? "ON" : "OFF");
    if (typeof data.grade === "string" && data.grade !== "") extras.push(`grade ${data.grade}`);
    if (typeof data.class === "string" && data.class !== "") extras.push(`classe ${data.class}`);
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
    form.header(`§a§lBase de données`);
    form.label(
      `§7${stats.documents} documents · ${stats.bytes} octets
§7État : ${stats.dirty ? "§eà sauvegarder" : "§aà jour"}`
    );
    form.divider();
    for (const section of sections) {
      form.button(
        `${collectionLabel(section)} §7— ${stats.collections[section]} doc(s)`,
        () => {
          void openSectionMenu(db2, player, section);
        }
      );
    }
    form.divider();
    form.button(`§a§lForcer la sauvegarde`, () => {
      db2.save(true);
    });
    form.button(`§d§lRéinitialiser une classe`, () => {
      void openResetClassMenu(db2, player);
    });
  }).catch(
    (error) => console.warn(`[DB] Erreur menu : ${error instanceof Error ? error.message : String(error)}`)
  );
}
async function openResetClassMenu(db2, player) {
  const docs = db2.find(CLASSES_COLLECTION);
  if (docs.length === 0) {
    console.log("[DB] Aucune classe à réinitialiser.");
    return;
  }
  await openWindowRaw(player, windowTitle("Reset de classe"), (form) => {
    form.header(`§d§lRéinitialiser une classe`);
    form.label(`§7Le joueur choisira une nouvelle voie à la prochaine ouverture de §f/sn:classes§7.`);
    form.divider();
    for (const doc of docs) {
      form.button(`§f${doc.id} §7— §d${doc.data.classId ?? "?"}`, () => {
        if (resetClassOf(db2, doc.id)) {
          db2.save();
          console.log(`[DB] Classe de "${doc.id}" réinitialisée par ${player.name}.`);
        }
        void openResetClassMenu(db2, player);
      });
    }
  }).catch(
    (error) => console.warn(`[DB] Erreur menu reset classe : ${error instanceof Error ? error.message : String(error)}`)
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
    form.button(`§c§lVider la section`, () => {
      db2.clear(section);
      db2.save();
      console.warn(`[DB] Section "${section}" vidée par ${player.name}.`);
    });
  }).catch(
    (error) => console.warn(`[DB] Erreur section : ${error instanceof Error ? error.message : String(error)}`)
  );
}
var READONLY_KEYS = /* @__PURE__ */ new Set(["chunkKeys"]);
async function openDocumentMenu(db2, player, section, docId) {
  const doc = db2.findOne(section, docId);
  if (doc === void 0) {
    console.warn(`[DB] Document ${docId} introuvable (déjà supprimé ?).`);
    return;
  }
  const entries = Object.entries(doc.data).filter(([key]) => !READONLY_KEYS.has(key));
  await openWindowRaw(player, windowTitle(docId), (form) => {
    form.header(`§b§l${docId}`);
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
        form.toggleOb(`§e${key}`, toggle);
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
    form.button(`§a§lAppliquer`, () => {
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
        console.warn(`[DB] "${docId}" mis à jour (${Object.keys(patch).length} champ(s)).`);
      } else {
        console.warn(`[DB] "${docId}" : aucun changement (seuls les interrupteurs sont éditables).`);
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

// src/territories/ui.ts
import { world as world7 } from "@minecraft/server";
function extentLine(chunkCount) {
  const side = CLAN_RADIUS * 2 + 1;
  return `${chunkCount} / ${MAX_CHUNKS_PER_TERRITORY} chunks (extension max ${side}×${side})`;
}
function clanAtPlayer(manager, player) {
  const cx = Math.floor(player.location.x / 16);
  const cz = Math.floor(player.location.z / 16);
  const key = `${player.dimension.id}:${cx}:${cz}`;
  return manager.findByChunk(key);
}
function onlineInvitables(territory, exclude) {
  return world7.getAllPlayers().filter(
    (candidate) => candidate.id !== exclude.id && candidate.id !== territory.data.ownerId && !territory.data.members.some((m) => m.playerId === candidate.id)
  );
}
function say(player, message) {
  player.sendMessage(message);
}
function openCreateMenu(player, manager) {
  if (manager.findByMemberId(player.id) !== void 0 || manager.findByOwner(player.name) !== void 0) {
    say(player, "§e[Clans] Tu fais déjà partie d'un clan. Utilise §f/sn:menu §e> États pour le retrouver.");
    return;
  }
  const name = obString("");
  const colorIndex = obNumber(0);
  const cx = Math.floor(player.location.x / 16);
  const cz = Math.floor(player.location.z / 16);
  void openWindowRaw(player, windowTitle("Créer un clan"), (form) => {
    form.body(
      [
        `§a§lTon clan naîtra ici§r`,
        ``,
        `§eChunk fondateur : §fx=${cx}§7, §fz=${cz}`,
        `§eDimension : §f${player.dimension.id}`,
        ``,
        `§7Le clan protège ce chunk (casse, pose, coffres, PvP)`,
        `§7et s'étend en carré ${CLAN_RADIUS * 2 + 1}×${CLAN_RADIUS * 2 + 1} autour.`,
        ``,
        `§7Règles du nom :`,
        `§8· 3 à 24 caractères`,
        `§8· lettres, chiffres, espaces, _ et -`,
        `§8Un seul clan par joueur.`
      ].join("\n")
    );
    form.header(`§a§lFonder un clan`);
    form.textField("§eNom du clan", name, { placeholder: "3-24 caractères" });
    form.dropdown(
      "§eCouleur du drapeau",
      colorIndex,
      TERRITORY_COLORS.map((c, value) => ({ label: `${c.code}${c.id}`, value }))
    );
    form.button(`§a§lFonder mon clan !`, () => {
      const cleanName = name.getData().trim().replace(/\s+/g, " ");
      const chosen = TERRITORY_COLORS[colorIndex.getData()] ?? TERRITORY_COLORS[0];
      const result = manager.create(
        player.name,
        cleanName,
        chosen?.id ?? "rouge",
        player.dimension.id,
        player.location.x,
        player.location.z,
        player.id
      );
      if (!result.ok) {
        say(player, `§c[Clans] ${result.error}`);
        return;
      }
      say(
        player,
        `§a[Clans] Clan §r${chosen?.code}${result.territory.data.name} §r§afondé ! Ce chunk est ton territoire.`
      );
      const fresh = manager.findByOwner(player.name);
      if (fresh !== void 0) openMyClanMenu(player, manager, fresh);
    });
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openStatesMenu(player, manager) {
  const states = manager.all();
  void openWindow(player, "États", (form) => {
    const here = clanAtPlayer(manager, player);
    form.header(`§e§lÉtats de NaLandia`);
    form.label(
      states.length === 0 ? `§8Aucun État fondé pour l'instant — sois le premier :` : `§7${states.length} État(s) sur la carte — clique pour la fiche :`
    );
    form.divider();
    if (states.length > 0) {
      for (const state of states) {
        const color = getColor(state.data.color);
        form.button(
          `${color.code}${state.data.name}§r §7— par ${state.data.owner}`,
          () => showStateInfo(player, state, manager)
        );
      }
      form.divider();
    }
    if (here !== void 0) {
      const color = getColor(here.data.color);
      form.button(
        `§aTu es ici : §l${color.code}${here.data.name}`,
        () => showStateInfo(player, here, manager)
      );
    } else {
      form.button(`§7Tu es ici : §ozone libre`, () => {
        say(player, "§7[Clans] Ce chunk n'appartient à personne. §f/sn:create §7pour le revendiquer.");
      });
    }
    if (manager.findByMemberId(player.id) === void 0 && manager.findByOwner(player.name) === void 0) {
      form.divider();
      form.button(`§a§lFonder mon clan (/sn:create)`, () => openCreateMenu(player, manager));
    }
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu États : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function showStateInfo(player, territory, manager) {
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;
  void openWindowRaw(player, windowTitle("Clan"), (form) => {
    form.back(() => openStatesMenu(player, manager));
    form.label(
      [
        `${color.code}======================`,
        `§f§l${data.name}`,
        `${color.code}======================`
      ].join("\n")
    );
    form.label(
      [
        `§eChef        §f${data.owner}${isOwner ? " §a(toi)" : ""}`,
        `§eDrapeau     §r${color.code}${color.id}`,
        `§eFondé le    §f${formatDate(data.createdAt)}`,
        `§eTerritoire  §f${extentLine(data.chunkKeys.length)}`,
        `§eCapitale    §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
        `§eMembres     §f${data.members.length}`,
        ``,
        `§7${data.description ?? "Un nouvel État prend forme."}`
      ].join("\n")
    );
    form.divider();
    if (isOwner || myRank !== void 0) {
      form.button(`§6§lMon clan`, () => openMyClanMenu(player, manager, territory));
    }
  }).catch(
    (error) => console.warn(`[Clans] Erreur fiche État : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openMyClanMenu(player, manager, territory) {
  const fresh = manager.findOne(territory.id);
  if (fresh === void 0) {
    say(player, "§c[Clans] Ce clan n'existe plus.");
    return;
  }
  territory = fresh;
  const data = territory.data;
  const color = getColor(data.color);
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;
  const rankLabel = isOwner ? "§6Chef" : myRank === "officer" ? "§bOfficier" : "§7Membre";
  void openWindowRaw(player, windowTitle("Mon clan"), (form) => {
    form.back(() => openStatesMenu(player, manager));
    form.label(
      [
        `${color.code}======================`,
        `§f§l${data.name}`,
        `${color.code}======================`
      ].join("\n")
    );
    form.label(
      [
        `§eTon rang      §r${rankLabel}`,
        `§eTerritoire    §f${extentLine(data.chunkKeys.length)}`,
        `§eMembres       §f${data.members.length + 1} §7(chef inclus)`,
        ``,
        `§f${data.description ?? "Un nouvel État prend forme."}`
      ].join("\n")
    );
    form.divider();
    form.button(`§eModifier la bio`, () => openClanBioMenu(player, manager, territory));
    form.button(`§a§lRevendiquer ce chunk`, () => {
      claimHere(player, manager, territory);
    });
    form.button(`§b§lMembres`, () => openMembersMenu(player, manager, territory));
    if (isOwner) {
      form.button(`§6§lDrapeau`, () => openFlagMenu(player, manager, territory));
    }
    form.divider();
    if (isOwner) {
      form.button(`§c§lDissoudre le clan`, () => openDissolveMenu(player, manager, territory));
    } else {
      form.button(`§c§lQuitter le clan`, () => {
        const ok = manager.leave(territory.id, player.id);
        say(
          player,
          ok ? `§e[Clans] Tu as quitté §f${data.name}§e.` : "§c[Clans] Impossible de quitter le clan."
        );
      });
    }
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu Mon clan : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function claimHere(player, manager, territory) {
  const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
  const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
  const myRank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
  if (!isOwner && myRank !== "officer") {
    say(player, "§c[Clans] Seul le chef ou un officier peut étendre le territoire.");
    return;
  }
  const result = manager.addChunk(territory.id, key);
  if (result.ok) {
    say(
      player,
      `§a[Clans] Chunk revendiqué ! §f${territory.data.name} §r§a— ${extentLine(territory.data.chunkKeys.length)}`
    );
    openMyClanMenu(player, manager, territory);
  } else {
    say(player, `§c[Clans] ${result.reason ?? "Revendication impossible."}`);
  }
}
function openClanBioMenu(player, manager, territory) {
  const bio = obString(territory.data.description ?? "");
  void openWindowRaw(player, windowTitle("Bio du clan"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    form.header(`§6§lBio de ${territory.data.name}`);
    form.label("§7Une phrase courte qui représente ton État. 140 caractères maximum.");
    form.textField("§eDescription", bio, { placeholder: "Notre histoire commence ici…" });
    form.button("§aEnregistrer la bio", () => {
      manager.updateDescription(territory.id, bio.getData());
      player.sendMessage("§a[Clans] Bio mise à jour.");
      openMyClanMenu(player, manager, territory);
    });
  }).catch(
    (error) => console.warn(`[Clans] Erreur bio : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openMembersMenu(player, manager, territory) {
  const fresh = manager.findOne(territory.id);
  if (fresh === void 0) {
    say(player, "§c[Clans] Ce clan n'existe plus.");
    return;
  }
  territory = fresh;
  const data = territory.data;
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;
  const canManage = isOwner || myRank === "officer";
  void openWindowRaw(player, windowTitle("Membres du clan"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    form.header(`§b§l${data.name}§r §7— membres`);
    form.label(
      [
        `§eChef : §f${data.owner}`,
        ...data.members.map(
          (m) => `§8· §f${m.name} §7(${m.rank === "officer" ? "§bofficier" : "membre"}§7)`
        ),
        ...data.members.length === 0 ? [`§8- §o(aucun membre pour l'instant)`] : []
      ].join("\n")
    );
    form.divider();
    if (canManage) {
      form.button(`§a§lInviter un joueur`, () => openInviteMenu(player, manager, territory));
      for (const member of data.members) {
        const isOfficer = member.rank === "officer";
        form.button(
          `§f${member.name} §7— §o${isOfficer ? "officier" : "membre"}`,
          () => {
            openMemberActionsMenu(player, manager, territory, member.playerId, member.name);
          }
        );
      }
    }
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu Membres : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openMemberActionsMenu(player, manager, territory, memberId, memberName) {
  const fresh = manager.findOne(territory.id);
  if (fresh === void 0) return;
  const member = fresh.data.members.find((m) => m.playerId === memberId);
  if (member === void 0) {
    openMembersMenu(player, manager, fresh);
    return;
  }
  void openWindowRaw(player, windowTitle("Membre"), (form) => {
    form.back(() => openMembersMenu(player, manager, territory));
    form.header(`§f§l${memberName}`);
    form.label(`§7Rang actuel : ${member.rank === "officer" ? "§bofficier" : "membre"}`);
    form.divider();
    form.button(
      member.rank === "officer" ? `§e§lRétrograder en membre` : `§b§lPromouvoir officier`,
      () => {
        const nextRank = member.rank === "officer" ? "member" : "officer";
        const result = manager.setMemberRank(territory.id, memberId, nextRank);
        say(
          player,
          result.ok ? `§a[Clans] ${memberName} est ${nextRank === "officer" ? "désormais officier" : "redevenu membre"}.` : `§c[Clans] ${result.error ?? "Action impossible."}`
        );
        openMembersMenu(player, manager, territory);
      }
    );
    form.button(`§c§lExclure du clan`, () => {
      const result = manager.removeMember(territory.id, memberId);
      say(
        player,
        result.ok ? `§a[Clans] ${memberName} a été exclu du clan.` : `§c[Clans] ${result.error ?? "Action impossible."}`
      );
      openMembersMenu(player, manager, territory);
    });
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu membre : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openInviteMenu(player, manager, territory) {
  const invitables = onlineInvitables(territory, player);
  if (invitables.length === 0) {
    say(player, "§7[Clans] Aucun joueur en ligne à inviter (hors du clan).");
    return;
  }
  const pick = obNumber(0);
  void openWindowRaw(player, windowTitle("Inviter"), (form) => {
    form.header(`§a§lInviter dans ${territory.data.name}`);
    form.label(`§7Choisis un joueur en ligne :`);
    form.dropdown(
      "§eJoueur",
      pick,
      invitables.map((candidate, value) => ({ label: candidate.name, value }))
    );
    form.button(`§a§lInviter`, () => {
      const target = invitables[pick.getData()];
      if (target === void 0) {
        say(player, "§c[Clans] Ce joueur n'est plus en ligne.");
        return;
      }
      const result = manager.addMember(territory.id, target.id, target.name);
      say(
        player,
        result.ok ? `§a[Clans] ${target.name} a rejoint §f${territory.data.name}§a !` : `§c[Clans] ${result.error ?? "Invitation impossible."}`
      );
      if (result.ok) {
        try {
          target.sendMessage(`§a[Clans] Tu as rejoint le clan §f${territory.data.name}§a !`);
        } catch {
        }
      }
      openMembersMenu(player, manager, territory);
    });
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu invitation : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openFlagMenu(player, manager, territory) {
  const apply = (flagValue, label) => {
    const fresh = manager.findOne(territory.id);
    if (fresh === void 0) {
      say(player, "§c[Clans] Ce clan n'existe plus.");
      return;
    }
    fresh.data.color = flagValue;
    fresh.updatedAt = Date.now();
    manager.save();
    say(player, `§a[Clans] Drapeau changé : ${label}`);
    openMyClanMenu(player, manager, territory);
  };
  void openWindowRaw(player, windowTitle("Drapeau"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    const current = territory.data.color;
    form.header(`§6§lDrapeau de ${territory.data.name}`);
    form.label(`§7Actuel : §f${current.startsWith("flag:") ? current.slice(5) : current}`);
    form.divider();
    for (const candidate of TERRITORY_COLORS) {
      form.button(`${candidate.code}${candidate.id}`, () => apply(candidate.id, candidate.code + candidate.id));
    }
    form.divider();
    form.label(`§7— blasons personnalisés —
§8Dépose tes PNG dans §fRP/textures/ui/flags/§8 (1.png, 2.png…) puis choisis :`);
    for (let n = 1; n <= 8; n++) {
      const flagValue = `flag:${n}`;
      form.button(`§bBlason ${n}`, () => apply(flagValue, `Blason ${n}`));
    }
    form.divider();
    form.back(() => openMyClanMenu(player, manager, territory));
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu drapeau : ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openDissolveMenu(player, manager, territory) {
  void openWindowRaw(player, windowTitle("Dissoudre le clan"), (form) => {
    form.header(`§4§lDissoudre ${territory.data.name} ?`);
    form.label(
      [
        `§7Les §f${territory.data.chunkKeys.length}§7 chunk(s) redeviendront libres.`,
        `§7Les membres seront retirés du clan.`,
        ``,
        `§cAction irréversible.`
      ].join("\n")
    );
    form.divider();
    form.button(`§4§lOui, dissoudre définitivement`, () => {
      const ok = manager.remove(territory.id, player.name, player.id);
      say(
        player,
        ok ? `§e[Clans] §f${territory.data.name} §r§ea été dissous.` : "§c[Clans] Dissolution impossible."
      );
    });
    form.button(`§a§lAnnuler`, () => openMyClanMenu(player, manager, territory));
  }).catch(
    (error) => console.warn(`[Clans] Erreur menu dissolution : ${error instanceof Error ? error.message : String(error)}`)
  );
}

// src/mines/manager.ts
import { world as world8, system as system8, GameMode as GameMode2 } from "@minecraft/server";
import { BlockVolume } from "@minecraft/server";

// src/mines/generator.ts
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var Y_BEDROCK_MAX = 1;
var Y_STONE_MIN = 2;
var Y_STONE_MAX = 71;
var Y_CEIL_BEDROCK = 72;
var Y_POCKET_AIR_MIN = 5;
var Y_POCKET_AIR_MAX = 7;
var Y_SPAWN_FEET = 5;
var ORE_SPECS = [
  { block: "minecraft:coal_ore", tries: 8, veinMin: 4, veinMax: 9, yMin: Y_STONE_MIN, yMax: Y_STONE_MAX },
  { block: "minecraft:copper_ore", tries: 5, veinMin: 4, veinMax: 9, yMin: 10, yMax: 60 },
  { block: "minecraft:iron_ore", tries: 6, veinMin: 3, veinMax: 6, yMin: Y_STONE_MIN, yMax: 64 },
  { block: "minecraft:gold_ore", tries: 3, veinMin: 2, veinMax: 5, yMin: Y_STONE_MIN, yMax: 28 },
  { block: "minecraft:redstone_ore", tries: 3, veinMin: 4, veinMax: 7, yMin: Y_STONE_MIN, yMax: 20 },
  { block: "minecraft:lapis_ore", tries: 2, veinMin: 3, veinMax: 6, yMin: 6, yMax: 30 },
  { block: "minecraft:diamond_ore", tries: 2, veinMin: 1, veinMax: 4, yMin: Y_STONE_MIN, yMax: 14 },
  { block: "minecraft:emerald_ore", tries: 2, veinMin: 1, veinMax: 1, yMin: 20, yMax: 60 }
];
function rndOffset(rand) {
  return Math.floor(rand() * 3) - 1;
}
function planChunk(seed, cx, cz) {
  const rand = rng(hash(`nalania:mines#${seed}#${cx}:${cz}`));
  const ox = cx * 16;
  const oz = cz * 16;
  const veins = [];
  for (const spec of ORE_SPECS) {
    for (let t = 0; t < spec.tries; t++) {
      const size = spec.veinMin + Math.floor(rand() * (spec.veinMax - spec.veinMin + 1));
      const cells = [];
      let px = ox + Math.floor(rand() * 16);
      let py = spec.yMin + Math.floor(rand() * (spec.yMax - spec.yMin + 1));
      let pz = oz + Math.floor(rand() * 16);
      for (let b = 0; b < size; b++) {
        cells.push({ x: px, y: py, z: pz });
        px = Math.min(ox + 15, Math.max(ox, px + rndOffset(rand)));
        py = Math.min(spec.yMax, Math.max(spec.yMin, py + rndOffset(rand)));
        pz = Math.min(oz + 15, Math.max(oz, pz + rndOffset(rand)));
      }
      veins.push({ block: spec.block, cells });
    }
  }
  return { cx, cz, veins };
}
function clipBox(box, cx, cz) {
  const x0 = Math.max(box.x0, cx * 16);
  const x1 = Math.min(box.x1, cx * 16 + 15);
  const z0 = Math.max(box.z0, cz * 16);
  const z1 = Math.min(box.z1, cz * 16 + 15);
  if (x0 > x1 || z0 > z1 || box.y0 > box.y1) return null;
  return { x0, x1, y0: box.y0, y1: box.y1, z0, z1 };
}
var SPAWN_RADIUS = 8;
function spawnRingPositions() {
  const positions = [];
  const seen = /* @__PURE__ */ new Set();
  for (let a = 0; a < 72; a++) {
    const angle = a / 72 * Math.PI * 2;
    const x = Math.round(Math.cos(angle) * SPAWN_RADIUS);
    const z = Math.round(Math.sin(angle) * SPAWN_RADIUS);
    const key = `${x}:${z}`;
    if (!seen.has(key)) {
      seen.add(key);
      positions.push({ x, y: Y_POCKET_AIR_MIN, z });
    }
  }
  return positions;
}

// src/mines/manager.ts
var MINES_DIMENSION_ID = "nalania:mines";
var RETURN_PROP = "nalania:overworld_return";
var NIGHT_VISION_TICKS = 20 * 120;
var ORES_PUBLIC = [
  { label: "Charbon", color: "§8" },
  { label: "Cuivre", color: "§6" },
  { label: "Fer", color: "§f" },
  { label: "Or", color: "§e" },
  { label: "Redstone", color: "§c" },
  { label: "Lapis", color: "§9" },
  { label: "Émeraude", color: "§a" },
  { label: "Diamant", color: "§b" }
];
var worldSeed = 1337;
function setMinesSeed(seed) {
  worldSeed = seed >>> 0;
}
var MinesManager = class {
  /** Passe à true après le worldLoad (la dimension devient adressable). */
  loaded = false;
  /** État statique (fallback si aucun check live branché). */
  enabled = true;
  /**
   * Check live branché par main.ts (module « mines » de /sn:modules) :
   * permet au toggle du menu Modules d'agir instantanément.
   */
  enabledCheck;
  /** Chunks définitivement générés. */
  generated = /* @__PURE__ */ new Set();
  /** Chunks en attente (clé → tâche) : rejoués tant qu'ils échouent. */
  pending = /* @__PURE__ */ new Map();
  queueRunning = false;
  nightVisionLoopRegistered = false;
  /** Le module mines est-il actif ? (check live si branché) */
  isUsable() {
    return this.enabledCheck !== void 0 ? this.enabledCheck() : this.enabled;
  }
  markLoaded() {
    this.loaded = true;
  }
  /** La dimension minière (undefined tant que non chargée/inexistante). */
  dimension() {
    if (!this.loaded) return void 0;
    try {
      return world8.getDimension(MINES_DIMENSION_ID);
    } catch {
      return void 0;
    }
  }
  /** Le joueur est-il dans la dimension minière ? */
  isInMines(player) {
    return player.dimension.id === MINES_DIMENSION_ID;
  }
  /**
   * Va aux mines (depuis le monde normal) ou revient au monde normal à la
   * dernière position connue du joueur (retour exact).
   */
  toggle(player) {
    if (!this.isUsable()) return "§c[Mines] Le module Mines est désactivé (/sn:modules).";
    if (this.isInMines(player)) return this.exit(player);
    return this.enter(player);
  }
  /** Menu « Monde » : choix explicite de la destination. */
  goNormal(player) {
    if (!this.isInMines(player)) return "§7[Mines] Tu es déjà dans le monde normal.";
    return this.exit(player);
  }
  goMines(player) {
    if (this.isInMines(player)) return "§7[Mines] Tu es déjà dans la mine.";
    return this.enter(player);
  }
  /**
   * Dernière position connue du joueur dans le monde normal
   * (dimension !== mines), ou undefined.
   */
  lastOverworldLocation(player) {
    try {
      const raw = player.getDynamicProperty(RETURN_PROP);
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (typeof parsed.dimensionId === "string" && parsed.dimensionId !== MINES_DIMENSION_ID) {
          return parsed;
        }
      }
    } catch {
    }
    return void 0;
  }
  rememberOverworld(player) {
    try {
      player.setDynamicProperty(RETURN_PROP, JSON.stringify({
        dimensionId: player.dimension.id,
        x: player.location.x,
        y: player.location.y,
        z: player.location.z
      }));
    } catch {
    }
  }
  /**
   * Aller : mémorise le retour, téléporte EN PREMIER (c'est la présence du
   * joueur qui CHARGE les chunks de la dimension — sans lui, la file de
   * génération boucle sur des chunks jamais chargés et l'arrivée « différée »
   * ne vient jamais), puis met la plateforme en file. La sécurité résistance
   * du spawn + le secours anti-chute portent le joueur les ~2 s que dure
   * la pose de la plateforme.
   */
  enter(player) {
    const dimension = this.dimension();
    if (dimension === void 0) {
      return "§c[Mines] Dimension indisponible : vérifie que le pack déclare bien nalania:mines.";
    }
    this.rememberOverworld(player);
    this.teleportToSpawn(player, dimension);
    this.pendingArrivals.delete(player.id);
    this.ensureChunk(0, 0, dimension);
    this.ensureChunk(-1, 0, dimension);
    this.ensureChunk(0, -1, dimension);
    this.ensureChunk(-1, -1, dimension);
    this.pumpQueue();
    return "§b[Mines] Bienvenue dans la mine ! §7Retour : §f/sn:monde§7.";
  }
  /** Retour : dernière position connue dans le monde normal, sinon spawn. */
  exit(player) {
    const target = this.lastOverworldLocation(player);
    try {
      player.removeEffect("night_vision");
    } catch {
    }
    if (target !== void 0) {
      try {
        const dimension = world8.getDimension(target.dimensionId);
        player.teleport({ x: target.x, y: target.y, z: target.z }, { dimension });
        return "§a[Mines] Retour à ta dernière position dans le monde normal.";
      } catch {
      }
    }
    const overworld = world8.getDimension("minecraft:overworld");
    let spawn;
    try {
      spawn = world8.getDefaultSpawnLocation();
    } catch {
      spawn = { x: 0, y: 100, z: 0 };
    }
    player.teleport({ x: spawn.x + 0.5, y: spawn.y + 2, z: spawn.z + 0.5 }, { dimension: overworld });
    return "§a[Mines] Retour au spawn du monde (pas de position mémorisée).";
  }
  /**
   * Téléporte aux mines : au niveau de la plateforme, night vision SANS
   * particules, et courtes invulnérabilités (résistance + feu) le temps que
   * la génération finisse — sécurité no-op si les effets sont indisponibles.
   */
  teleportToSpawn(player, dimension) {
    player.teleport({ x: 0.5, y: Y_SPAWN_FEET, z: 0.5 }, { dimension });
    this.applyNightVision(player);
    for (const effect of ["resistance", "fire_resistance"]) {
      try {
        player.addEffect(effect, 20 * 10, { amplifier: 4, showParticles: false });
      } catch {
      }
    }
  }
  /**
   * Night vision sans particules. `showParticles: false` n'est pas honoré
   * par tous les runtimes pour cet effet : on tente avec l'option, sinon
   * on retente sans (l'effet passe quand même).
   */
  applyNightVision(player) {
    try {
      player.addEffect("night_vision", NIGHT_VISION_TICKS, { amplifier: 0, showParticles: false });
    } catch {
      try {
        player.addEffect("night_vision", NIGHT_VISION_TICKS, { amplifier: 0 });
      } catch {
      }
    }
  }
  /**
   * Boucle : ré-applique la night vision aux joueurs de la mine (toutes
   * les 30 s, avant l'expiration des 2 min) — plus jamais aveugle, et
   * toujours sans particules visibles en jeu.
   */
  registerNightVisionLoop() {
    if (this.nightVisionLoopRegistered) return;
    this.nightVisionLoopRegistered = true;
    system8.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      for (const player of world8.getAllPlayers()) {
        if (!this.isInMines(player)) continue;
        this.applyNightVision(player);
      }
    }, 20 * 30);
  }
  /**
   * File de téléportation différée (plus nécessaire pour l'aller — la
   * téléportation est immédiate — mais conservée pour les retours programmés
   * éventuels et la compat des appels internes).
   */
  pendingArrivals = /* @__PURE__ */ new Set();
  flushPendingArrivals() {
    if (this.pendingArrivals.size === 0) return;
    const dimension = this.dimension();
    if (dimension === void 0) return;
    for (const id of [...this.pendingArrivals]) {
      const player = world8.getAllPlayers().find((candidate) => candidate.id === id);
      if (player === void 0) {
        this.pendingArrivals.delete(id);
        continue;
      }
      try {
        this.teleportToSpawn(player, dimension);
        player.sendMessage("§b[Mines] La plateforme est prête — bienvenue dans la mine !");
      } catch {
        return;
      }
      this.pendingArrivals.delete(id);
    }
  }
  /**
   * Met un chunk en file de génération (idempotent). La tâche est REJOUÉE
   * tant que ses écritures échouent (chunks pas encore chargés) — plus
   * jamais de chunk « à moitié généré » marqué comme fait.
   */
  ensureChunk(cx, cz, dimension) {
    const key = `${cx}:${cz}`;
    if (this.generated.has(key) || this.pending.has(key)) return;
    const plan = planChunk(worldSeed, cx, cz);
    this.pending.set(key, {
      key,
      run: () => {
        if (!dimension.isChunkLoaded({ x: cx * 16 + 8, y: Y_SPAWN_FEET, z: cz * 16 + 8 })) {
          throw new Error("chunk pas encore chargé");
        }
        generateChunk(dimension, plan, cx, cz);
        this.generated.add(key);
        this.pending.delete(key);
      }
    });
  }
  /**
   * Exécute la file de génération — UNE tâche par tick (anti-lag). Un
   * fillBlocks par couche de l'opération : un chunk complet prend ~5 ticks
   * et le rayon exploré se remplit en quelques secondes sans figer le
   * serveur. Les échecs (chunk pas chargé) sont replacés en FIN de file ;
   * si TOUTE la file échoue, la pompe s'arrête (l'entretien la relancera
   * au prochain passage — pas de boucle infinie à vide).
   */
  pumpQueue() {
    if (this.queueRunning) return;
    this.queueRunning = true;
    const run = () => {
      const next = this.pending.values().next();
      if (next.done) {
        this.queueRunning = false;
        this.flushPendingArrivals();
        return;
      }
      try {
        next.value.run();
      } catch (error) {
        if (!next.value.logged) {
          next.value.logged = true;
          log3.warn(
            `Mines : chunk ${next.value.key} en attente de chargement (${error instanceof Error ? error.message : String(error)})`
          );
        }
        this.pending.delete(next.value.key);
        this.pending.set(next.value.key, next.value);
        if ([...this.pending.values()].every((task) => task.logged)) {
          this.queueRunning = false;
          this.flushPendingArrivals();
          return;
        }
        this.flushPendingArrivals();
        system8.run(run);
        return;
      }
      this.flushPendingArrivals();
      system8.run(run);
    };
    system8.run(run);
  }
  /** Force le traitement de la file (tests / appel immédiat). */
  kickQueue() {
    this.pumpQueue();
  }
  /**
   * Boucle d'entretien : génère les chunks autour des joueurs présents
   * dans la dimension + exécute la file (l'entretien alimente, la pompe
   * consomme une tâche par tick).
   */
  registerMaintenance(intervalTicks = 40) {
    this.registerNightVisionLoop();
    system8.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      const dimension = this.dimension();
      if (dimension === void 0) return;
      for (const player of world8.getAllPlayers()) {
        if (player.dimension.id !== MINES_DIMENSION_ID) continue;
        const pcx = Math.floor(player.location.x / 16);
        const pcz = Math.floor(player.location.z / 16);
        for (let dx = -3; dx <= 3; dx++) {
          for (let dz = -3; dz <= 3; dz++) {
            this.ensureChunk(pcx + dx, pcz + dz, dimension);
          }
        }
      }
      this.pumpQueue();
    }, intervalTicks);
  }
  /** Sécurité : chute dans le vide (faille) → retour à la plateforme. */
  registerFallRescue(intervalTicks = 20) {
    system8.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      for (const player of world8.getAllPlayers()) {
        if (player.dimension.id !== MINES_DIMENSION_ID) continue;
        if (player.location.y < 0) {
          const dimension = this.dimension();
          if (dimension === void 0) continue;
          player.teleport({ x: 0.5, y: Y_SPAWN_FEET, z: 0.5 }, { dimension });
          player.sendMessage("§e[Mines] Tu es tombé dans le vide : ramené à la plateforme.");
        }
      }
    }, intervalTicks);
  }
  /** Les créatifs et spectateurs ne déclenchent rien de spécial (compat). */
  static isSurvivalLike(player) {
    return player.getGameMode() === GameMode2.Survival || player.getGameMode() === GameMode2.Adventure;
  }
};
function fill(dimension, box, block) {
  dimension.fillBlocks(
    new BlockVolume(
      { x: box.x0, y: box.y0, z: box.z0 },
      { x: box.x1, y: box.y1, z: box.z1 }
    ),
    block,
    { ignoreChunkBoundErrors: true }
  );
}
function generateChunk(dimension, plan, cx, cz) {
  const full = {
    x0: cx * 16,
    x1: cx * 16 + 15,
    y0: 0,
    y1: Y_CEIL_BEDROCK,
    z0: cz * 16,
    z1: cz * 16 + 15
  };
  fill(dimension, { ...full, y0: 0, y1: Y_BEDROCK_MAX }, "minecraft:bedrock");
  fill(dimension, { ...full, y0: Y_STONE_MIN, y1: Y_STONE_MAX }, "minecraft:stone");
  fill(dimension, { ...full, y0: Y_CEIL_BEDROCK, y1: Y_CEIL_BEDROCK }, "minecraft:bedrock");
  for (const vein of plan.veins) {
    for (const cell of vein.cells) {
      const cellCx = Math.floor(cell.x / 16);
      const cellCz = Math.floor(cell.z / 16);
      if (cellCx !== cx || cellCz !== cz) continue;
      if (cell.y < Y_STONE_MIN || cell.y > Y_STONE_MAX) continue;
      try {
        const block = dimension.getBlock({ x: cell.x, y: cell.y, z: cell.z });
        if (block === void 0) continue;
        if (block.typeId !== "minecraft:stone") continue;
        block.setType(vein.block);
      } catch {
      }
    }
  }
  const pocket = {
    x0: -SPAWN_RADIUS,
    x1: SPAWN_RADIUS,
    y0: Y_STONE_MIN,
    y1: Y_POCKET_AIR_MAX,
    z0: -SPAWN_RADIUS,
    z1: SPAWN_RADIUS
  };
  const portion = clipBox(pocket, cx, cz);
  if (portion !== null) {
    fill(dimension, { ...portion, y0: Y_STONE_MIN, y1: Y_POCKET_AIR_MIN - 1 }, "minecraft:polished_deepslate");
    fill(dimension, { ...portion, y0: Y_POCKET_AIR_MIN, y1: Y_POCKET_AIR_MAX }, "minecraft:air");
  }
  for (const ring of spawnRingPositions()) {
    if (Math.floor(ring.x / 16) !== cx || Math.floor(ring.z / 16) !== cz) continue;
    try {
      dimension.getBlock({ x: ring.x, y: Y_POCKET_AIR_MIN, z: ring.z })?.setType("minecraft:stone_brick_wall");
    } catch {
    }
  }
  if (cx === 0 && cz === 0) {
    const r = SPAWN_RADIUS;
    for (const [lx, lz] of [[1, 1], [r - 1, 1], [1, r - 1], [r - 1, r - 1]]) {
      try {
        dimension.getBlock({ x: lx, y: Y_POCKET_AIR_MIN, z: lz })?.setType("minecraft:lantern");
      } catch {
      }
    }
  }
}

// src/mines/ui.ts
function openWorldMenu(player, mines2, back) {
  const inMines = mines2.isInMines(player);
  void openWindowRaw(player, windowTitle("Le Monde"), (form) => {
    if (back !== void 0) form.back(back);
    form.header(`§b§lLes portes du monde§r`);
    form.label(
      inMines ? `§7Tu es actuellement dans §b§lLa Mine§r` : `§7Tu es actuellement dans le §a§lMonde normal§r`
    );
    form.divider();
    form.header(`§l§aMONDE NORMAL§r`);
    form.label(
      [
        `§7La surface : biomes, constructions, tes clans…`,
        inMines ? `§eAller : §fte téléporte à ta DERNIÈRE position§e ici.` : `§aTu y es déjà.`
      ].join("\n")
    );
    form.button(`§a§lAller au monde normal`, () => {
      if (!inMines) {
        player.sendMessage("§7[Mines] Tu es déjà dans le monde normal.");
        return;
      }
      player.sendMessage(mines2.goNormal(player));
    });
    form.divider();
    form.header(`§l§bLA MINE§r`);
    form.label(
      [
        `§7Un monde §fentièrement massé dans la pierre§7, en profondeur :`,
        `§8- §f70 couches§8 à miner entre deux lits de bedrock`,
        `§8- à toi de creuser tes galeries, façon vrai minage`,
        `§8- minerais §fplus riches qu'en surface§8, sans excès`
      ].join("\n")
    );
    form.button(`§b§lDescendre dans la Mine`, () => {
      if (inMines) {
        player.sendMessage("§7[Mines] Tu es déjà dans la mine.");
        return;
      }
      player.sendMessage(mines2.goMines(player));
    });
    form.divider();
    form.label(
      `§8Strates : ${ORES_PUBLIC.map((ore) => `${ore.color}${ore.label}`).join("§8 - ")}`
    );
  }).catch(
    (error) => console.warn(`[Mines] Erreur menu monde : ${error instanceof Error ? error.message : String(error)}`)
  );
}

// src/territories/commands.ts
function registerCommands(manager, db2, modules2, permissions2, mines2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  const allowed = (player, perm) => {
    if (permissions2 === void 0) return true;
    return permissions2.can(player.name, perm, player.playerPermissionLevel >= 2);
  };
  system9.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:create",
        description: "Fonde ton clan sur le chunk où tu te trouves",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        if (!allowed(player, "territories.create")) {
          return { status: CustomCommandStatus.Failure, message: "§c[Clans] Tu n'as pas la permission de fonder un clan." };
        }
        system9.run(() => openCreateMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:info",
        description: "Liste les États (clans) de NaLandia",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Seuls les joueurs peuvent utiliser cette commande." };
        }
        system9.run(() => openStatesMenu(player, manager));
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:claim",
        description: "Revendique le chunk où tu te trouves pour ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan. Fonde-le avec §f/sn:create§e.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut étendre le territoire.");
            return;
          }
          const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
          const result = manager.addChunk(territory.id, key);
          player.sendMessage(
            result.ok ? `§a[Clans] Chunk revendiqué pour §f${territory.data.name}§a !` : `§c[Clans] ${result.reason ?? "Revendication impossible."}`
          );
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:clan",
        description: "Gère ton clan (extension, membres, drapeau)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan. Fonde-le avec §f/sn:create§e.");
            return;
          }
          openMyClanMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:unclaim",
        description: "Libère le chunk où tu te trouves (chef/officier)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut libérer un chunk.");
            return;
          }
          const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;
          const result = manager.removeChunk(territory.id, key);
          player.sendMessage(
            result.ok ? `§a[Clans] Chunk libéré. §7${territory.data.chunkKeys.length} chunk(s) restant(s).` : `§c[Clans] ${result.reason ?? "Action impossible."}`
          );
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:invite",
        description: "Invite un joueur en ligne dans ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "joueur", type: CustomCommandParamType.String }]
      },
      (origin, joueur) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        let sent = CustomCommandStatus.Success;
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan : fonde-le avec §f/sn:create§e.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut inviter.");
            return;
          }
          const target = world9.getAllPlayers().find(
            (candidate) => candidate.name.toLowerCase() === joueur.toLowerCase()
          );
          if (target === void 0) {
            player.sendMessage(`§c[Clans] "§f${joueur}§c" n'est pas en ligne.`);
            return;
          }
          const result = manager.addMember(territory.id, target.id, target.name);
          if (result.ok) {
            player.sendMessage(`§a[Clans] ${target.name} a rejoint §f${territory.data.name}§a !`);
            target.sendMessage(`§a[Clans] Tu as rejoint le clan §f${territory.data.name}§a !`);
          } else {
            player.sendMessage(`§c[Clans] ${result.error ?? "Invitation impossible."}`);
            sent = CustomCommandStatus.Failure;
          }
        });
        return { status: sent };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:leave",
        description: "Quitte ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'es membre d'aucun clan.");
            return;
          }
          const ok = manager.leave(territory.id, player.id);
          player.sendMessage(
            ok ? `§e[Clans] Tu as quitté §f${territory.data.name}§e.` : "§c[Clans] Impossible de quitter le clan (le chef doit le dissoudre : /sn:disband)."
          );
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    const rankCommand = (name, rank, verb) => {
      event.customCommandRegistry.registerCommand(
        {
          name,
          description: `${verb} un membre de ton clan (chef uniquement)`,
          permissionLevel: CommandPermissionLevel.Any,
          cheatsRequired: false,
          mandatoryParameters: [{ name: "membre", type: CustomCommandParamType.String }]
        },
        (origin, membre) => {
          const player = origin.sourceEntity;
          if (player === void 0 || player.typeId !== "minecraft:player") {
            return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
          }
          if (!enabled()) {
            return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
          }
          system9.run(() => {
            const territory = manager.findByOwner(player.name) ?? manager.findByMemberId(player.id);
            if (territory === void 0) {
              player.sendMessage("§e[Clans] Tu n'as pas de clan.");
              return;
            }
            const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
            if (!isOwner) {
              player.sendMessage("§c[Clans] Seul le chef du clan peut gérer les rangs.");
              return;
            }
            const member = territory.data.members.find(
              (m) => m.name.toLowerCase() === membre.toLowerCase()
            );
            if (member === void 0) {
              player.sendMessage(`§c[Clans] "§f${membre}§c" n'est pas membre de ton clan.`);
              return;
            }
            const result = manager.setMemberRank(territory.id, member.playerId, rank);
            player.sendMessage(
              result.ok ? rank === "officer" ? `§a[Clans] ${member.name} est désormais §bofficier§a.` : `§a[Clans] ${member.name} est redevenu §7membre§a.` : `§c[Clans] ${result.error ?? "Action impossible."}`
            );
          });
          return { status: CustomCommandStatus.Success };
        }
      );
    };
    rankCommand("sn:promote", "officer", "Promeut officier");
    rankCommand("sn:demote", "member", "Rétrograde membre");
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:ckick",
        description: "Exclut un membre de ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "membre", type: CustomCommandParamType.String }]
      },
      (origin, membre) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          const rank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
          if (!isOwner && rank !== "officer") {
            player.sendMessage("§c[Clans] Seul le chef ou un officier peut exclure.");
            return;
          }
          const member = territory.data.members.find(
            (m) => m.name.toLowerCase() === membre.toLowerCase()
          );
          if (member === void 0) {
            player.sendMessage(`§c[Clans] "§f${membre}§c" n'est pas membre de ton clan.`);
            return;
          }
          const result = manager.removeMember(territory.id, member.playerId);
          player.sendMessage(
            result.ok ? `§a[Clans] ${member.name} a été exclu du clan.` : `§c[Clans] ${result.error ?? "Action impossible."}`
          );
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:disband",
        description: "Dissout ton clan (chef uniquement)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          if (!isOwner) {
            player.sendMessage("§c[Clans] Seul le chef peut dissoudre le clan (pour partir : /sn:leave).");
            return;
          }
          openDissolveMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:flag",
        description: "Choisis le drapeau de ton clan (chef)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (!enabled()) {
          return { status: CustomCommandStatus.Failure, message: "Le module États est désactivé." };
        }
        system9.run(() => {
          const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
          if (territory === void 0) {
            player.sendMessage("§e[Clans] Tu n'as pas de clan.");
            return;
          }
          const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
          if (!isOwner) {
            player.sendMessage("§c[Clans] Seul le chef peut changer le drapeau.");
            return;
          }
          openFlagMenu(player, manager, territory);
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:setflag",
        description: "Change la couleur du drapeau de ton clan",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "couleur", type: CustomCommandParamType.String }]
      },
      (origin, couleur) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        const territory = manager.findByMemberId(player.id) ?? manager.findByOwner(player.name);
        if (territory === void 0) {
          return { status: CustomCommandStatus.Failure, message: "Tu ne fais partie d'aucun clan (/sn:create)." };
        }
        const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
        if (!isOwner) {
          return { status: CustomCommandStatus.Failure, message: "Seul le chef du clan peut changer le drapeau (/sn:clan)." };
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
        return { status: CustomCommandStatus.Success, message: `Drapeau changé : ${color.code}${color.id}` };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:mine",
        description: "Va dans la dimension minière / revient à ta dernière position",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (mines2 === void 0) {
          return { status: CustomCommandStatus.Failure, message: "Mines indisponibles." };
        }
        system9.run(() => {
          const message = mines2.toggle(player);
          player.sendMessage(message);
        });
        return { status: CustomCommandStatus.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:monde",
        description: "Choisis ton monde : normal (surface) ou Mine",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Réservé aux joueurs." };
        }
        if (mines2 === void 0) {
          return { status: CustomCommandStatus.Failure, message: "Mines indisponibles." };
        }
        system9.run(() => openWorldMenu(player, mines2));
        return { status: CustomCommandStatus.Success };
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
              system9.run(() => {
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
            console.log(`[DB] ${stats.documents} docs, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"} {${collections}}`);
            return { status: CustomCommandStatus.Success };
          }
          case "list": {
            if (arg1 === void 0) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db list <collection>" };
            }
            const docs = db2.find(arg1);
            if (docs.length === 0) {
              console.log(`[DB] Collection "${arg1}" vide ou inexistante.`);
              return { status: CustomCommandStatus.Success };
            }
            const preview = docs.slice(0, 10).map((doc) => `${doc.id}(${Math.round(JSON.stringify(doc).length / 1024 * 10) / 10}ko)`).join(", ");
            console.log(`[DB] ${docs.length} doc(s) dans "${arg1}" : ${preview}${docs.length > 10 ? " …" : ""}`);
            return { status: CustomCommandStatus.Success };
          }
          case "show": {
            if (arg1 === void 0 || arg2 === void 0) {
              return { status: CustomCommandStatus.Failure, message: "Usage : /sn:db show <collection> <id>" };
            }
            const doc = db2.findOne(arg1, arg2);
            if (doc === void 0) {
              console.warn(`[DB] "${arg2}" introuvable dans "${arg1}".`);
              return { status: CustomCommandStatus.Success };
            }
            console.log(ColorJSON.DEFAULT.stringify(doc));
            return { status: CustomCommandStatus.Success };
          }
          case "save": {
            const wrote = db2.save(true);
            console.log(wrote ? "[DB] Sauvegardée." : "[DB] Rien à sauvegarder.");
            return { status: CustomCommandStatus.Success };
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
import { world as world10, system as system10, GameMode as GameMode3, Player as Player3 } from "@minecraft/server";
function safeSend(player, message) {
  system10.run(() => {
    try {
      player.sendMessage(message);
    } catch {
    }
  });
}
var DENY_BREAK = "§c[Clans] Chunk protégé : destruction impossible.";
var DENY_PLACE = "§c[Clans] Chunk protégé : construction impossible.";
var DENY_INTERACT = "§c[Clans] Chunk protégé : interaction impossible.";
var DENY_COMBAT = "§c[Clans] Territoire de clan : ce joueur ne peut pas être attaqué ici.";
var DENY_ITEM = "§c[Clans] Chunk protégé : objet inutilisable ici.";
function isCreative(playerName) {
  const player = world10.getAllPlayers().find((candidate) => candidate.name === playerName);
  return player !== void 0 && player.getGameMode() === GameMode3.Creative;
}
function isProtectedForId(block, player, manager) {
  const key = chunkKeyFromPosition(block.dimension.id, block.location.x, block.location.z);
  return !manager.isAllowedFor(player.id, player.name, key);
}
function registerProtection(manager, modules2) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  world10.beforeEvents.playerBreakBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_BREAK);
    }
  });
  world10.afterEvents.playerPlaceBlock.subscribe((event) => {
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
    system10.run(() => {
      try {
        dimension.runCommand(`setblock ${x} ${y} ${z} air`);
      } catch {
      }
    });
    safeSend(player, DENY_PLACE);
  });
  world10.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    if (isProtectedForId(event.block, player, manager)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });
  world10.beforeEvents.itemUse.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.source;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_ITEM);
    }
  });
  world10.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (!manager.loaded || !enabled()) return;
    const player = event.player;
    if (isCreative(player.name)) return;
    const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
    if (!manager.isAllowedFor(player.id, player.name, key)) {
      event.cancel = true;
      safeSend(player, DENY_INTERACT);
    }
  });
  world10.beforeEvents.entityHurt.subscribe((event) => {
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
      safeSend(attacker, "§c[Clans] Chunk revendiqué : les créatures ici sont sous la protection du clan.");
    }
  });
  world10.beforeEvents.explosion.subscribe((event) => {
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
import { system as system11, world as world11 } from "@minecraft/server";
var NO_TERRITORY_MESSAGE = "§7Zone libre";
function registerAnnouncer(manager, modules2, intervalTicks = 10) {
  const enabled = () => modules2 === void 0 || modules2.isEnabled("territories");
  const lastKeyByPlayer = /* @__PURE__ */ new Map();
  world11.afterEvents.playerLeave.subscribe((event) => {
    lastKeyByPlayer.delete(event.playerName);
  });
  system11.runInterval(() => {
    if (!manager.loaded || !enabled()) return;
    for (const player of world11.getAllPlayers()) {
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
        `${color}⚑ ${territory.data.name}§r §7— clan de §f${territory.data.owner}`
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
    form.header(`§6§lRôles du serveur`);
    form.label(`§7${roles.length} rôle(s). Clique pour configurer :`);
    form.divider();
    form.button(`§a§lCréer un rôle`, () => openCreateRoleMenu(player, permissions2));
    for (const role of roles) {
      form.button(
        `${role.data.color}[${role.data.name}]§r §7— niv. ${role.data.level} · ${permissions2.membersWithRole(role.data.name).length} membre(s)`,
        () => openRoleConfigMenu(player, role, permissions2)
      );
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openCreateRoleMenu(player, permissions2) {
  const name = obString("");
  const colorIndex = obNumber(0);
  const level = obNumber(10);
  void openWindowRaw(player, windowTitle("Créer un rôle"), (form) => {
    form.header(`§a§lNouveau rôle`);
    form.divider();
    form.textField("§eNom (2-16 caractères)", name);
    form.dropdown(
      "§eCouleur",
      colorIndex,
      ROLE_COLORS.map((color, value) => ({ label: `${color.code}${color.id}`, value }))
    );
    form.slider("§eNiveau hiérarchique (100 = admin max)", level, 0, 100, { step: 5 });
    form.divider();
    form.button(`§a§lCréer le rôle`, () => {
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
    form.header(`${role.data.color}§l${role.data.name}§r §7(niveau ${role.data.level})`);
    form.label(
      `§7Membres : §f${permissions2.membersWithRole(role.data.name).length}
§7Prefix : §f${role.data.prefix}`
    );
    form.divider();
    form.button(
      `§e§lChanger la couleur`,
      () => openColorPicker(player, "Couleur du rôle", (colorId) => {
        const result = permissions2.setRoleColor(role.data.name, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      })
    );
    form.button(
      `§e§lChanger le prefix`,
      () => openPrefixMenu(player, `Prefix du rôle [${role.data.name}]`, (prefix) => {
        const result = permissions2.setRolePrefix(role.data.name, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      })
    );
    form.button(`§e§lChanger le niveau (actuel : ${role.data.level})`, () => openLevelMenu(player, role, permissions2));
    form.button(`§b§lVoir les membres`, () => openRoleMembersMenu(player, role, permissions2));
    form.button(`§c§lSupprimer ce rôle`, () => {
      const result = permissions2.deleteRole(role.data.name);
      player.sendMessage(result.ok ? "§a[Rôles] Rôle supprimé." : `§c[Rôles] ${result.error}`);
    });
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openLevelMenu(player, role, permissions2) {
  const level = obNumber(role.data.level);
  void openWindowRaw(player, windowTitle(`Niveau de [${role.data.name}]`), (form) => {
    form.slider("§eNiveau (100 = admin max)", level, 0, 100, { step: 5 });
    form.button(`§a§lValider`, () => {
      const result = permissions2.setRoleLevel(role.data.name, level.getData());
      player.sendMessage(result.ok ? "§a[Rôles] Niveau mis à jour." : `§c[Rôles] ${result.error}`);
    });
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
        });
      }
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openColorPicker(player, title, onPick) {
  void openWindow(player, title, (form) => {
    form.label("§7Choisis une couleur :");
    for (const color of ROLE_COLORS) {
      form.button(`${color.code}${color.id}`, () => onPick(color.id));
    }
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPrefixMenu(player, title, onDone) {
  const prefix = obString("");
  void openWindowRaw(player, windowTitle(title), (form) => {
    form.textField("§ePrefix (vide = défaut [Nom])", prefix);
    form.button(`§a§lValider`, () => onDone(prefix.getData()));
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/players-ui.ts
import { world as world12 } from "@minecraft/server";

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
function trackPlayerJoin(db2, playerId, playerName, grade = "", className = "") {
  const now = Date.now();
  const existing = findPlayerById(db2, playerId);
  const legacy = findPlayerByName(db2, playerName);
  if (existing !== void 0) {
    existing.data.name = playerName;
    existing.data.lastSeen = now;
    existing.data.sessions += 1;
    if (grade !== "") existing.data.grade = grade;
    if (className !== "") existing.data.class = className;
    else if (existing.data.class === void 0) existing.data.class = "";
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
        grade: grade !== "" ? grade : legacy.data.grade,
        class: className !== "" ? className : legacy.data.class ?? ""
      },
      playerId
    );
    db2.save();
    return promoted.id;
  }
  db2.insert(
    PLAYERS_COLLECTION,
    { playerId, name: playerName, firstSeen: now, lastSeen: now, sessions: 1, grade, class: className },
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
    const online = world12.getAllPlayers();
    form.header(`§b§lJoueurs`);
    form.label(
      `§aEn ligne : §f${online.length}
§7Connus (DB) : §f${db2 !== void 0 ? allKnownPlayers(db2).length : "?"}`
    );
    form.divider();
    form.label(`§a§lEn ligne§r §7(${online.length})`);
    if (online.length === 0) {
      form.label("§7Personne d'autre n'est connecté.");
    }
    for (const target of online) {
      const member = permissions2.getMember(target.name);
      const role = permissions2.getRole(member?.data.role ?? "");
      form.button(
        `${role?.data.color ?? "§7"}${target.name}§r §7— ${member?.data.role ?? "aucun rôle"}`,
        () => openPlayerConfigMenu(player, target.name, permissions2, db2)
      );
    }
    form.divider();
    form.label(`§7§lHors ligne / historique§r §7(index complet)`);
    form.button(
      `§a§lGérer un joueur hors ligne (saisir le pseudo)`,
      () => openPlayerLookupMenu(player, permissions2, db2)
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
          `§8${record.data.name}§r §7— ${record.data.grade !== "" ? role?.data.color + record.data.grade + "§7 · " : ""}${record.data.sessions} session(s) · vu à ${hh}`,
          () => openPlayerConfigMenu(player, record.data.name, permissions2, db2)
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
    form.button(`§b§lRechercher`, () => {
      const target = name.getData().trim();
      if (target !== "") openPlayerConfigMenu(player, target, permissions2, db2);
    });
    form.closeButton();
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}
function openPlayerConfigMenu(player, targetName, permissions2, db2) {
  const member = permissions2.getMember(targetName);
  const roleLabel = member === void 0 ? "§7aucun" : `${permissions2.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const isOnline = world12.getAllPlayers().some((candidate) => candidate.name === targetName);
  const record = db2 !== void 0 ? allKnownPlayers(db2).find((r) => r.data.name === targetName) : void 0;
  const classLabel = record?.data.class ? record.data.class : "§8pas encore choisie";
  void openWindow(player, targetName, (form) => {
    form.header(`§b§l${targetName}§r ${isOnline ? "§a(en ligne)" : "§8(hors ligne)"}`);
    form.label(
      `§7Rôle : ${roleLabel}
§7Classe : §f${classLabel}
§7Prefix perso : §f${prefixLabel}`
    );
    form.divider();
    form.button(
      `§e§lAttribuer / changer de rôle`,
      () => openAssignRoleMenu(player, targetName, permissions2, db2)
    );
    form.button(
      `§e§lPrefix personnalisé`,
      () => openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
        const result = permissions2.setCustomPrefix(targetName, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      })
    );
    if (db2 !== void 0 && record?.data.class) {
      form.button(`§d§lRéinitialiser la classe §7(${record.data.class})`, () => {
        if (resetClassOf(db2, targetName)) {
          db2.save();
          player.sendMessage(`§a[Classes] Classe de ${targetName} réinitialisée — il re-choisira librement.`);
        }
      });
    }
    if (member !== void 0) {
      form.button(`§c§lRetirer tous les rôles`, () => {
        permissions2.removeRole(targetName);
        player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
      });
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
      form.button(`${role.data.color}[${role.data.name}]§r §7— niv. ${role.data.level}`, () => {
        const result = permissions2.assignRole(targetName, role.data.name);
        player.sendMessage(
          result.ok ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.` : `§c[Rôles] ${result.error}`
        );
      });
    }
    void db2;
  }).catch((error) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/commands.ts
import { CustomCommandStatus as CustomCommandStatus2, CommandPermissionLevel as CommandPermissionLevel2, system as system13, PlayerPermissionLevel } from "@minecraft/server";

// src/ui/hub.ts
import { world as world16 } from "@minecraft/server";

// src/moderation/ui.ts
import { world as world14 } from "@minecraft/server";

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
import { world as world13, system as system12 } from "@minecraft/server";
function kickPlayer(playerName, reason) {
  const player = world13.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return false;
  try {
    player.dimension.runCommand(`kick "${playerName}" ${reason.replace(/"/g, "")}`);
    return true;
  } catch {
    return false;
  }
}
function registerEnforcement(sanctions2) {
  world13.afterEvents.playerSpawn.subscribe((event) => {
    if (!event.initialSpawn || !sanctions2.loaded) return;
    const player = event.player;
    const ban = sanctions2.getBan(player.name);
    if (ban === void 0) return;
    const expiry = ban.expiresAt === 0 ? "§4BANNI PERMANENTLEMENT" : `§4BANNI§7 (encore ${Math.max(1, Math.ceil((ban.expiresAt - Date.now()) / 6e4))} min)`;
    player.sendMessage(`§c[NaLandia] ${expiry}
§7Motif : §f${ban.reason}§7 — par §f${ban.by}`);
    system12.run(() => {
      kickPlayer(player.name, ban.reason);
    });
  });
}

// src/moderation/ui.ts
function resolveTargetId(targetName) {
  const online = world14.getAllPlayers().find((candidate) => candidate.name === targetName);
  return online?.id ?? null;
}
function openSanctionsMenu(player, sanctions2, permissions2) {
  const stats = sanctions2.stats();
  void openWindow(player, "Modération", (form) => {
    form.header(`§4§lModération`);
    form.label(
      `§7Bans actifs : §f${stats.bans}
§7Mutes actifs : §f${stats.mutes}
§7Warns au total : §f${stats.warns}`
    );
    form.divider();
    form.button(`§4§lBans actifs`, () => openBansList(player, sanctions2, permissions2));
    form.button(`§6§lMutes actifs`, () => openMutesList(player, sanctions2, permissions2));
    form.button(`§e§lSanctionner un joueur`, () => openSanctionForm(player, sanctions2));
    form.button(`§b§lHistorique d'un joueur`, () => openHistoryLookup(player, sanctions2));
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
      form.button(`§f${ban.data.name} §7— ${expiry} · §7par ${ban.data.by}`, () => {
        const result = sanctions2.unban(ban.data.name);
        player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
        openBansList(player, sanctions2, permissions2);
      });
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
      form.button(`§f${mute.data.name} §7— ${expiry} · §7par ${mute.data.by}`, () => {
        const result = sanctions2.unmute(mute.data.name);
        player.sendMessage(
          result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`
        );
        openMutesList(player, sanctions2, permissions2);
      });
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
    form.header(`§e§lSanctionner`);
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
    form.button(`§e§lAppliquer la sanction`, () => {
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
    form.button(`§b§lVoir l'historique`, () => {
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

// src/classes/manager.ts
var CLASS_CATALOG = [
  {
    id: "guerrier",
    name: "Guerrier",
    color: "§c",
    icon: "sword",
    description: "Route du combat au corps à corps"
  },
  {
    id: "mage",
    name: "Mage",
    color: "§5",
    icon: "compass",
    description: "Route de la magie et des potions"
  },
  {
    id: "archer",
    name: "Archer",
    color: "§a",
    icon: "tag",
    description: "Route de la précision et de la distance"
  }
];
var XP_PER_LEVEL = 100;
function classLevel(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}
function classProgress(xp) {
  return xp % XP_PER_LEVEL;
}
var ClassManager = class {
  constructor(db2) {
    this.db = db2;
  }
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  /** La sélection de classe du joueur, si elle existe. */
  selectionOf(playerName) {
    return this.db.findOne(CLASSES_COLLECTION, playerName);
  }
  /** La classe du joueur, si choisie. */
  classOf(playerName) {
    return this.selectionOf(playerName)?.data;
  }
  /**
   * Choix de classe (définitif). Renvoie ok:false si le joueur a déjà
   * une classe ou si l'id est inconnu.
   */
  selectClass(playerName, classId) {
    if (this.selectionOf(playerName) !== void 0) {
      return { ok: false, error: "Tu as déjà choisi ta classe (choix définitif)." };
    }
    const info = CLASS_CATALOG.find((candidate) => candidate.id === classId);
    if (info === void 0) return { ok: false, error: "Classe inconnue." };
    const doc = this.db.insert(CLASSES_COLLECTION, {
      classId: info.id,
      xp: 0,
      chosenAt: Date.now()
    }, playerName);
    return { ok: true, value: doc.data };
  }
  /** Ajoute de l'XP de classe (progression). Renvoie false si pas de classe. */
  addXp(playerName, amount) {
    const doc = this.selectionOf(playerName);
    if (doc === void 0 || amount <= 0) return false;
    doc.data.xp += amount;
    doc.updatedAt = Date.now();
    this.db.markDirty();
    return true;
  }
  /** Réinitialisation admin : le joueur pourra re-choisir. */
  clearClass(playerName) {
    return this.db.delete(CLASSES_COLLECTION, playerName);
  }
  /** Nombre total de choix par classe (stats admin /sn:db). */
  countsByClass() {
    const counts = {};
    for (const doc of this.db.find(CLASSES_COLLECTION)) {
      counts[doc.data.classId] = (counts[doc.data.classId] ?? 0) + 1;
    }
    return counts;
  }
};

// src/classes/ui.ts
function xpBar(xp, perLevel) {
  const filled = Math.floor(xp / perLevel * 10);
  return `§a[${"|".repeat(filled)}§8${".".repeat(10 - filled)}§a]§r`;
}
var CLASS_TRAITS = {
  guerrier: ["§c+ Dégâts au corps à corps", "§c+ Résistance au combat", "§7- Portée courte"],
  mage: ["§5+ Puissance magique", "§5+ Potions renforcées", "§7- Fragile de près"],
  archer: ["§a+ Précision à distance", "§a+ Déplacement rapide", "§7- Faible au mêlée"]
};
function banner(info) {
  return [
    `${info.color}======================`,
    `§f§l${info.name}`,
    `${info.color}======================`
  ].join("\n");
}
function classCard(player, classes2, info, _isAdmin, backTo) {
  void openWindowRaw(player, windowTitle("Classe"), (form) => {
    form.back(backTo);
    form.label(banner(info));
    form.label(
      [
        `§f${info.description}`,
        ``,
        ...CLASS_TRAITS[info.id],
        ``,
        `§8Ta route définitive de progression sur NaLandia.`
      ].join("\n")
    );
    form.divider();
    form.button(`§a§lChoisir la voie ${info.name}`, () => confirmClassChoice(player, classes2, info, backTo));
  }).catch(
    (error) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function myClassCard(player, classes2, info, xp, isAdmin) {
  const level = classLevel(xp);
  const progress = classProgress(xp);
  void openWindowRaw(player, windowTitle("Ma voie"), (form) => {
    form.back(() => openClassesMenu(player, classes2, isAdmin));
    form.label(banner(info));
    form.label(
      [
        `§f${info.description}`,
        ...CLASS_TRAITS[info.id],
        `§7Niveau : §f§l${level}§r`,
        `§7Progression : ${xpBar(progress, XP_PER_LEVEL)}`,
        `§7XP : §f${progress}§7/§f${XP_PER_LEVEL} §8(total : ${xp})`,
        `§8Les bonus de voie et le catalogue seront complétés prochainement.`
      ].join("\n")
    );
    form.divider();
    if (isAdmin) {
      form.button("§c§lRéinitialiser (admin) §7— re-choisir librement", () => {
        if (classes2.clearClass(player.name)) {
          player.sendMessage("§a[Classes] Voie réinitialisée — tu peux re-choisir.");
        }
        openClassesMenu(player, classes2, isAdmin);
      });
    }
  }).catch(
    (error) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function openClassesMenu(player, classes2, isAdmin = false) {
  void openWindow(player, "Classes", (form) => {
    form.header(`§d§lLes Voies de NaLandia`);
    form.divider();
    const selection = classes2.classOf(player.name);
    if (selection === void 0) {
      form.label(
        `§7Choisis ta §lroute§r§7. Ce choix est §lDÉFINITIF§r§7 :
il déterminera ta progression sur le serveur.`
      );
      form.divider();
      for (const info2 of CLASS_CATALOG) {
        form.button(
          `${info2.color}§l${info2.name}§r §7| ${info2.description}`,
          () => classCard(player, classes2, info2, isAdmin, () => openClassesMenu(player, classes2, isAdmin))
        );
      }
      return;
    }
    const info = CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);
    if (info === void 0) {
      form.label(`§cVoie inconnue (${selection.classId}) — contacte un admin.`);
      return;
    }
    form.label(`§7Ta voie actuelle`);
    form.body(`§f${info.description}
§7Une route unique, construite par tes actions.`);
    form.divider();
    form.button(
      `${info.color}§l${info.name}§r §7| niveau ${classLevel(selection.xp)}`,
      () => myClassCard(player, classes2, info, selection.xp, isAdmin)
    );
  }).catch(
    (error) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`)
  );
}
function confirmClassChoice(player, classes2, info, backTo) {
  void openWindowRaw(player, windowTitle("Confirmer"), (form) => {
    form.back(backTo);
    form.label(banner(info));
    form.label(
      [
        `Tu choisis la voie ${info.color}§l${info.name}§r§f ?`,
        `§7Ce choix est §lpermanent§r§7 : seul un admin`,
        `§7pourra le réinitialiser (via §f/sn:db§7).`
      ].join("\n")
    );
    form.divider();
    form.button(`§a§lJe confirme — ${info.name}`, () => {
      const result = classes2.selectClass(player.name, info.id);
      player.sendMessage(
        result.ok ? `§a[Classes] Bienvenue dans la voie ${info.color}§l${info.name}§r§a ! Ta progression commence maintenant.` : `§c[Classes] ${result.error}`
      );
    });
  }).catch(
    (error) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`)
  );
}

// src/jobs/manager.ts
var JOB_CATALOG = [
  { id: "mineur", name: "Mineur", description: "Extraire les ressources et révéler les strates.", color: "§b" },
  { id: "explorateur", name: "Explorateur", description: "Découvrir les mondes et les frontières de NaLandia.", color: "§e" },
  { id: "bâtisseur", name: "Bâtisseur", description: "Donner forme aux territoires et aux capitales.", color: "§6" }
];
var JOB_XP_PER_LEVEL = 50;
function jobLevel(xp) {
  return Math.floor(xp / JOB_XP_PER_LEVEL) + 1;
}
var JobManager = class {
  constructor(db2) {
    this.db = db2;
  }
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  /** Les métiers exercés par le joueur (vide = aucun). */
  jobsOf(playerName) {
    return this.db.find(JOBS_COLLECTION, (doc) => doc.data.playerName === playerName).map((doc) => doc.data);
  }
  /** Catalogue public, utilisé par le menu et les futures récompenses. */
  catalog() {
    return JOB_CATALOG;
  }
  /** Commence un métier. Plusieurs métiers peuvent être actifs. */
  startJob(playerName, jobId) {
    if (!JOB_CATALOG.some((job) => job.id === jobId) || this.hasJob(playerName, jobId)) return false;
    this.db.insert(JOBS_COLLECTION, {
      playerName,
      jobId,
      xp: 0,
      startedAt: Date.now()
    }, `${playerName}:${jobId}`);
    return true;
  }
  /** Exerce-t-il déjà ce métier ? */
  hasJob(playerName, jobId) {
    return this.jobDoc(playerName, jobId) !== void 0;
  }
  /** Document DB d'un métier précis (usage interne). */
  jobDoc(playerName, jobId) {
    return this.db.find(JOBS_COLLECTION, (doc) => doc.data.playerName === playerName && doc.data.jobId === jobId).at(0);
  }
  /** Ajoute de l'XP à un métier exercé. Renvoie false si le métier n'est pas pris. */
  addXp(playerName, jobId, amount) {
    const doc = this.jobDoc(playerName, jobId);
    if (doc === void 0 || amount <= 0) return false;
    doc.data.xp += amount;
    doc.updatedAt = Date.now();
    this.db.markDirty();
    return true;
  }
  /** Abandonne un métier (libère la place pour le futur catalogue). */
  quitJob(playerName, jobId) {
    const doc = this.jobDoc(playerName, jobId);
    if (doc === void 0) return false;
    return this.db.delete(JOBS_COLLECTION, doc.id);
  }
};

// src/jobs/ui.ts
function xpBar2(xp, perLevel) {
  const filled = Math.min(10, Math.floor(xp / perLevel * 10));
  return `§a[${"|".repeat(filled)}§8${".".repeat(10 - filled)}§a]§r`;
}
function openJobsMenu(player, jobs2) {
  void openWindow(player, "Métiers", (form) => {
    const mine = jobs2.jobsOf(player.name);
    form.header("§b§lAtelier des métiers");
    form.body(
      [
        "§7Les métiers sont des disciplines parallèles à ta classe.",
        "§7Chaque métier possède sa propre progression et son propre rythme.",
        `§7Disciplines actives : §f${mine.length}/${jobs2.catalog().length}`
      ].join("\n")
    );
    form.divider();
    if (mine.length > 0) {
      form.header("§e§lMétiers actifs");
      for (const job of mine) {
        const info = jobs2.catalog().find((candidate) => candidate.id === job.jobId);
        form.button(
          `${info?.color ?? "§f"}§l${info?.name ?? job.jobId}§r §7| niveau ${jobLevel(job.xp)} ${xpBar2(job.xp % JOB_XP_PER_LEVEL, JOB_XP_PER_LEVEL)}`,
          () => {
            if (jobs2.quitJob(player.name, job.jobId)) {
              player.sendMessage(`§e[Métiers] Tu quittes le métier ${info?.name ?? job.jobId}.`);
            }
            openJobsMenu(player, jobs2);
          }
        );
      }
      form.divider();
    }
    form.header("§6§lChoisir une discipline");
    for (const info of jobs2.catalog()) {
      if (jobs2.hasJob(player.name, info.id)) continue;
      form.button(`${info.color}§l${info.name}§r §7| ${info.description}`, () => {
        if (jobs2.startJob(player.name, info.id)) {
          player.sendMessage(`§a[Métiers] Métier commencé : ${info.name}.`);
        }
        openJobsMenu(player, jobs2);
      });
    }
    form.divider();
    form.header("§e§lOutils du parcours");
    form.button("§eVoir ma progression", () => {
      player.sendMessage("§e[Métiers] Ta progression détaillée est affichée sur chaque discipline active.");
    });
    form.button("§6Classement des métiers", () => {
      player.sendMessage("§6[Métiers] Le classement sera alimenté quand les actions de métier seront branchées.");
    });
  }).catch((error) => console.warn(`[Métiers] ${error instanceof Error ? error.message : String(error)}`));
}

// src/ui/admin.ts
import { world as world15 } from "@minecraft/server";

// src/modules/manager.ts
var MODULE_IDS = ["territories", "moderation", "mines"];
var MODULE_CATALOG = [
  {
    id: "territories",
    name: "États (clans)",
    description: "Clans, claims et protection de chunks (/sn:create, /sn:info)"
  },
  {
    id: "moderation",
    name: "Modération",
    description: "Bans, mutes, warns et historique (/sn:mod, /sn:ban...)"
  },
  {
    id: "mines",
    name: "Mines",
    description: "Dimension minière en pierre, riche mais équilibrée (/sn:monde)"
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
    form.header(`§6§lModules du serveur`);
    form.label(`§7${modules2.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);
    form.divider();
    for (const info of MODULE_CATALOG) {
      const enabled = modules2.isEnabled(info.id);
      form.button(
        `${enabled ? "§a[ON]" : "§8[OFF]"} §l${info.name}§r §7— ${info.description}`,
        () => {
          const next = !modules2.isEnabled(info.id);
          modules2.setEnabled(info.id, next);
          player.sendMessage(`§a[Modules] ${info.name} ${next ? "§aactivé" : "§cdésactivé"}§a.`);
          openModulesMenu(player, modules2, territories2);
        },
        void 0,
        enabled ? "check" : "close"
      );
    }
    if (MODULE_CATALOG.some((info) => info.id === "territories")) {
      form.divider();
      form.button(`§e§lVoir les États`, () => {
        if (territories2 !== void 0) openStatesMenu(player, territories2);
      });
      form.button(`§c§lDANGER : supprimer TOUS les États`, () => {
        if (territories2 !== void 0) openWipeTerritoriesMenu(player, modules2, territories2);
      });
    }
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
function openWipeTerritoriesMenu(player, modules2, territories2) {
  void openWindowRaw(player, windowTitle("Supprimer les États"), (form) => {
    form.header(`§4§lDANGER`);
    form.label(
      `Supprimer §lTOUS§r§4 les États (${territories2.all().length}) ?

§7Action irréversible !`
    );
    form.divider();
    form.button(`§4§lSUPPRIMER TOUT`, () => {
      let removed = 0;
      for (const territory of territories2.all()) {
        if (territories2.removeForced(territory.id)) removed++;
      }
      player.sendMessage(`§a[Modules] ${removed} État(s) supprimé(s).`);
      openModulesMenu(player, modules2, territories2);
    });
    form.button(`§a§lAnnuler`, () => openModulesMenu(player, modules2, territories2));
  }).catch((error) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

// src/ui/admin.ts
function openAdminMenu(player, deps) {
  const { permissions: permissions2, modules: modules2, territories: territories2, db: db2, classes: classes2 } = deps;
  if (!canUseAdminPanel(player, permissions2)) {
    player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
    return;
  }
  const stats = db2?.stats();
  const online = world15.getAllPlayers().length;
  const roleCount = permissions2.allRoles().length;
  const stateCount = territories2.all().length;
  const moduleCount = modules2.enabledCount();
  void openWindow(player, "Administration", (form) => {
    form.body(
      [
        `§6§lPanneau d'administration§r`,
        ``,
        `§eEn ligne : §f${online}`,
        `§eRôles : §f${roleCount}   §eÉtats : §f${stateCount}`,
        `§eModules actifs : §f${moduleCount}`,
        stats !== void 0 ? `§eBase de données : §f${stats.documents} documents§7 (${stats.bytes} octets, ${stats.dirty ? "§eà sauvegarder§7" : "§aà jour§7"})` : `§eBase de données : §8index indisponible`,
        ``,
        `§8Choisis une section à gauche.`
      ].join("\n")
    );
    form.header(`§6§lGestion`);
    form.button(`§6Rôles`, () => openRolesMenu(player, permissions2));
    form.button(`§bJoueurs`, () => openPlayersMenu(player, permissions2, db2));
    form.button(`§dModules`, () => openModulesMenu(player, modules2, territories2));
    if (db2 !== void 0) {
      form.button(`§aBase de données`, () => {
        void openDbMenu(db2, player);
      });
    }
    if (classes2 !== void 0) {
      form.button(`§dClasses (reset admin)`, () => openClassesMenu(player, classes2, true));
    }
  }).catch((error) => console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`));
}

// src/quests/manager.ts
var QUEST_CATALOG = [
  {
    id: "first_route",
    title: "Trouver sa voie",
    category: "origins",
    description: "Choisis une classe et engage ton aventure.",
    event: "choose_class",
    target: 1,
    reward: { classXp: 25 }
  },
  {
    id: "under_the_stone",
    title: "Sous la pierre",
    category: "mastery",
    description: "Entre dans la dimension minière et découvre ses strates.",
    event: "enter_mines",
    target: 1,
    reward: { classXp: 20 }
  },
  {
    id: "a_place_to_belong",
    title: "Un endroit à soi",
    category: "territory",
    description: "Fonde ou rejoins un clan pour avoir une place sur la carte.",
    event: "found_clan",
    target: 1,
    reward: { classXp: 30 }
  },
  {
    id: "learn_a_trade",
    title: "Le premier métier",
    category: "mastery",
    description: "Commence un métier et donne une direction à tes récoltes.",
    event: "start_job",
    target: 1,
    reward: { jobXp: 15 }
  }
];
function definitionOf(id) {
  return QUEST_CATALOG.find((quest) => quest.id === id);
}
var QuestManager = class {
  constructor(db2) {
    this.db = db2;
  }
  loaded = false;
  markLoaded() {
    this.loaded = true;
  }
  stateOf(playerName) {
    const existing = this.db.findOne(QUESTS_COLLECTION, playerName);
    if (existing !== void 0) return existing.data;
    const state = {
      playerName,
      active: [],
      progress: {},
      completed: [],
      claimed: []
    };
    this.db.insert(QUESTS_COLLECTION, state, playerName);
    return state;
  }
  questOf(id) {
    return definitionOf(id);
  }
  active(playerName) {
    const state = this.stateOf(playerName);
    return state.active.map(definitionOf).filter((quest) => quest !== void 0);
  }
  progressOf(playerName, questId) {
    return this.stateOf(playerName).progress[questId] ?? 0;
  }
  isCompleted(playerName, questId) {
    return this.stateOf(playerName).completed.includes(questId);
  }
  start(playerName, questId) {
    const quest = definitionOf(questId);
    if (quest === void 0) return { ok: false, error: "Quête inconnue." };
    const state = this.stateOf(playerName);
    if (state.claimed.includes(questId)) return { ok: false, error: "Cette quête est déjà terminée." };
    if (state.active.includes(questId)) return { ok: false, error: "Cette quête est déjà suivie." };
    state.active.push(questId);
    state.progress[questId] ??= 0;
    this.touch(state);
    return { ok: true, state };
  }
  /** Enregistre une action de gameplay et valide les quêtes concernées. */
  record(playerName, event, amount = 1) {
    if (amount <= 0) return [];
    const state = this.stateOf(playerName);
    const completedNow = [];
    for (const quest of QUEST_CATALOG) {
      if (quest.event !== event || state.claimed.includes(quest.id)) continue;
      if (!state.active.includes(quest.id)) state.active.push(quest.id);
      const before = state.progress[quest.id] ?? 0;
      const after = Math.min(quest.target, before + amount);
      state.progress[quest.id] = after;
      if (after >= quest.target && !state.completed.includes(quest.id)) {
        state.completed.push(quest.id);
        completedNow.push(quest);
      }
    }
    this.touch(state);
    return completedNow;
  }
  claim(playerName, questId) {
    const quest = definitionOf(questId);
    if (quest === void 0) return { ok: false, error: "Quête inconnue." };
    const state = this.stateOf(playerName);
    if (!state.completed.includes(questId)) return { ok: false, error: "La quête n'est pas encore terminée." };
    if (state.claimed.includes(questId)) return { ok: false, error: "Récompense déjà récupérée." };
    state.claimed.push(questId);
    state.active = state.active.filter((id) => id !== questId);
    this.touch(state);
    return { ok: true, state, reward: quest.reward };
  }
  touch(state) {
    const doc = this.db.findOne(QUESTS_COLLECTION, state.playerName);
    if (doc !== void 0) doc.updatedAt = Date.now();
    this.db.markDirty();
  }
};

// src/quests/ui.ts
function rewardLabel(questId, quests2) {
  const reward = quests2.questOf(questId)?.reward;
  if (reward?.classXp !== void 0) return `+${reward.classXp} XP de classe`;
  if (reward?.jobXp !== void 0) return `+${reward.jobXp} XP de métier`;
  return "Récompense à découvrir";
}
function openQuestMenu(player, quests2, classes2, jobs2) {
  void openWindow(player, "Quêtes", (form) => {
    const state = quests2.stateOf(player.name);
    const active = quests2.active(player.name);
    const completedCount = state.claimed.length;
    form.header("§6§lJournal de route");
    form.body(
      [
        "§7Chaque quête accompagne un système réel de NaLandia.",
        `§7Progression : §f${completedCount}/${QUEST_CATALOG.length}§7 récompense(s) récupérée(s).`,
        classes2?.classOf(player.name) !== void 0 ? `§7Voie actuelle : §f${classes2.classOf(player.name)?.classId}` : "§7Voie actuelle : §8à choisir",
        jobs2 !== void 0 ? `§7Métiers actifs : §f${jobs2.jobsOf(player.name).length}` : "",
        `§7Les pistes se déclenchent quand tu vis réellement l'action : classe, mine, clan ou métier.`
      ].filter((line) => line !== "").join("\n")
    );
    form.divider();
    if (active.length === 0) {
      form.label("§8Aucune quête suivie. Les prochaines aventures apparaîtront ici.");
    }
    for (const quest of active) {
      const progress = quests2.progressOf(player.name, quest.id);
      const ready = quests2.isCompleted(player.name, quest.id);
      form.button(
        `${ready ? "§a" : "§e"}${quest.title}§r §7${progress}/${quest.target} — ${rewardLabel(quest.id, quests2)}`,
        () => {
          if (!ready) {
            player.sendMessage(`§7[Quêtes] ${quest.description}`);
            return;
          }
          const result = quests2.claim(player.name, quest.id);
          if (!result.ok) {
            player.sendMessage(`§c[Quêtes] ${result.error}`);
            return;
          }
          if (result.reward?.classXp !== void 0 && classes2 !== void 0) {
            classes2.addXp(player.name, result.reward.classXp);
          }
          if (result.reward?.jobXp !== void 0 && jobs2 !== void 0) {
            const firstJob = jobs2.jobsOf(player.name)[0];
            if (firstJob !== void 0) jobs2.addXp(player.name, firstJob.jobId, result.reward.jobXp);
          }
          player.sendMessage(`§6[Quêtes] Récompense récupérée : §f${rewardLabel(quest.id, quests2)}§6.`);
          openQuestMenu(player, quests2, classes2, jobs2);
        }
      );
    }
    form.divider();
    form.header("§7Pistes disponibles");
    for (const quest of QUEST_CATALOG.filter((candidate) => !state.active.includes(candidate.id) && !state.claimed.includes(candidate.id))) {
      form.button(`§8Suivre : ${quest.title} §7— ${quest.description}`, () => {
        const result = quests2.start(player.name, quest.id);
        if (!result.ok) player.sendMessage(`§c[Quêtes] ${result.error}`);
        openQuestMenu(player, quests2, classes2, jobs2);
      });
    }
  }).catch((error) => console.warn(`[Quêtes] ${error instanceof Error ? error.message : String(error)}`));
}

// src/ui/hub.ts
function openHubMenu(player, deps) {
  const { permissions: permissions2, territories: territories2, sanctions: sanctions2, classes: classes2, db: db2 } = deps;
  const isOp = player.playerPermissionLevel >= 2;
  const isAdmin = canUseAdminPanel(player, permissions2);
  const isMod = permissions2.can(player.name, "mod.panel", isOp);
  const hasRole = permissions2.getMember(player.name) !== void 0;
  const online = world16.getAllPlayers().length;
  const stateCount = territories2.all().length;
  const knownCount = db2 !== void 0 ? allKnownPlayers(db2).length : 0;
  const myClan = territories2.findByMemberId(player.id) ?? territories2.findByOwner(player.name);
  const myClass = classes2?.classOf(player.name);
  const roleTag = hasRole ? permissions2.nameTagFor(player.name) : "§8aucun rôle";
  void openWindow(player, "Menu", (form) => {
    form.body(
      [
        `§6§lNaLandia§r`,
        ``,
        `§7Bienvenue, §f${player.name}§7 !`,
        `§7Ton rôle : ${roleTag}§r`,
        myClass !== void 0 ? `§7Ta classe : §d${myClass.classId}` : `§7Ta classe : §8pas encore choisie`,
        ``,
        `§7En ligne : §f${online}   §7États : §f${stateCount}   §7Joueurs connus : §f${knownCount}`,
        ``,
        `§8Choisis une section à gauche.`,
        myClan !== void 0 ? `§8Ton clan : §f${myClan.data.name}§r` : `§8Astuce : §f/sn:create§8 pour fonder ton clan ici.`
      ].join("\n")
    );
    form.button(`§6États`, () => openStatesMenu(player, territories2));
    form.button(`§eMes infos`, () => openMyInfoMenu(player, deps));
    if (deps.quests !== void 0) {
      form.button(`§6Quêtes`, () => openQuestMenu(player, deps.quests, classes2, deps.jobs));
    }
    if (deps.mines !== void 0 && deps.mines.isUsable()) {
      form.button(`§bMonde`, () => openWorldMenu(player, deps.mines, () => openHubMenu(player, deps)));
    }
    if (isMod) {
      form.divider();
      form.button(`§4Modération`, () => openSanctionsMenu(player, sanctions2, permissions2));
    }
    if (isAdmin) {
      form.button(`§6Admin`, () => openAdminMenu(player, deps));
    }
  }).catch((error) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}
function openMyInfoMenu(player, deps) {
  const { permissions: permissions2, territories: territories2, classes: classes2, jobs: jobs2, db: db2 } = deps;
  const member = permissions2.getMember(player.name);
  const roleLabel = member === void 0 ? "§8aucun" : `${permissions2.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}§r`;
  const myClan = territories2.findByMemberId(player.id) ?? territories2.findByOwner(player.name);
  const selection = classes2?.classOf(player.name);
  const myJobs = jobs2?.jobsOf(player.name) ?? [];
  const record = db2 !== void 0 ? allKnownPlayers(db2).find((r) => r.data.name === player.name) : void 0;
  const classLevelLabel = selection !== void 0 ? `§d${selection.classId} §7niv. ${Math.floor(selection.xp / 100) + 1}` : "§8non choisie";
  void openWindow(player, "Mes infos", (form) => {
    form.body(
      [
        `§f§l${player.name}§r`,
        ``,
        `§eRôle      ${roleLabel}`,
        `§eClasse    ${classLevelLabel}`,
        `§eClan      ${myClan !== void 0 ? `§a${myClan.data.name}` : "§8aucun"}`,
        `§eMétiers   ${myJobs.length > 0 ? `§f${myJobs.map((j) => j.jobId).join(", ")}` : "§8aucun"}`,
        `§eDons      §8bientôt disponible`,
        record !== void 0 ? `§7Sessions : §f${record.data.sessions}   §7Première visite : §f${formatDate(record.data.firstSeen)}` : `§7Sessions : §f?`
      ].join("\n")
    );
    form.header(`§e§lActions`);
    form.button(`§dMa classe`, () => {
      if (classes2 !== void 0) openClassesMenu(player, classes2, false);
    });
    if (jobs2 !== void 0) {
      form.button(`§6Métiers`, () => openJobsMenu(player, jobs2));
    }
    if (myClan !== void 0) {
      form.button(`§aMon clan`, () => openMyClanMenu(player, territories2, myClan));
    } else {
      form.button(`§aFonder un clan`, () => openCreateMenu(player, territories2));
    }
  }).catch((error) => console.warn(`[Mes infos] ${error instanceof Error ? error.message : String(error)}`));
}

// src/permissions/commands.ts
function canUseAdminPanel(player, permissions2) {
  return permissions2.levelOf(player.name) >= 100 || player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}
function registerAdminCommands(ctx) {
  system13.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:roles",
        description: "Gestion des rôles (admins)",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system13.run(() => {
          if (canUseAdminPanel(player, ctx.permissions)) {
            openRolesMenu(player, ctx.permissions);
            return;
          }
          const member = ctx.permissions.getMember(player.name);
          const roleTag = member === void 0 ? "§8aucun" : ctx.permissions.nameTagFor(player.name);
          player.sendMessage(
            `§e[Rôles] Ton rôle : ${roleTag}§r§e — la couleur vient de ton rôle (modifiable par un admin).`
          );
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:menu",
        description: "Ouvre le menu principal NaLandia",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system13.run(() => openHubMenu(player, ctx));
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
        system13.run(() => openAdminMenu(player, ctx));
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:classes",
        description: "Choisis ta classe (définitif) et suis ta progression",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system13.run(() => {
          if (ctx.classes === void 0) {
            player.sendMessage("§c[Classes] Module indisponible.");
            return;
          }
          const isAdmin = canUseAdminPanel(player, ctx.permissions);
          openClassesMenu(player, ctx.classes, isAdmin);
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:quests",
        description: "Ouvre le journal des quêtes",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system13.run(() => {
          if (ctx.quests === void 0) player.sendMessage("§c[Quêtes] Module indisponible.");
          else openQuestMenu(player, ctx.quests, ctx.classes, ctx.jobs);
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
    event.customCommandRegistry.registerCommand(
      {
        name: "sn:jobs",
        description: "Voir tes métiers et leur progression",
        permissionLevel: CommandPermissionLevel2.Any,
        cheatsRequired: false
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (player === void 0 || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus2.Failure, message: "Réservé aux joueurs." };
        }
        system13.run(() => {
          if (ctx.jobs === void 0) {
            player.sendMessage("§c[Métiers] Module indisponible.");
            return;
          }
          openJobsMenu(player, ctx.jobs);
        });
        return { status: CustomCommandStatus2.Success };
      }
    );
  });
}

// src/permissions/chat.ts
import { world as world17, system as system14 } from "@minecraft/server";
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
  world17.beforeEvents.chatSend.subscribe((event) => {
    if (!permissions2.loaded) return;
    const sender = event.sender;
    const isVanillaOp = sender.playerPermissionLevel >= 2;
    const mute = getMute?.(sender.name);
    if (mute !== void 0) {
      event.cancel = true;
      const remaining = mute.expiresAt === 0 ? "permanent" : `${Math.max(1, Math.ceil((mute.expiresAt - Date.now()) / 6e4))} min`;
      system14.run(() => {
        sender.sendMessage(
          `§c[Modération] Tu es muet (${remaining}). §7Motif : §f${mute.reason}§7 — par §f${mute.by}`
        );
      });
      return;
    }
    event.cancel = true;
    const message = sanitizeMessage(event.message);
    const formatted = formatChatMessage(permissions2, sender.name, message, isVanillaOp);
    system14.run(() => {
      for (const line of formatted.split("\n")) {
        world17.sendMessage(line);
      }
    });
  });
}

// src/moderation/commands.ts
import {
  CustomCommandParamType as CustomCommandParamType2,
  CustomCommandStatus as CustomCommandStatus3,
  CommandPermissionLevel as CommandPermissionLevel3,
  system as system15
} from "@minecraft/server";
import { world as world18 } from "@minecraft/server";
var NOT_PLAYER = "§c[Modération] Réservé aux joueurs.";
function requires(player, permissions2, perm) {
  return permissions2.can(player.name, perm, player.playerPermissionLevel >= 2);
}
function notifyTarget(targetName, message) {
  const target = world18.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (target !== void 0) system15.run(() => target.sendMessage(message));
}
function resolveTargetId2(targetName, db2) {
  const online = world18.getAllPlayers().find((candidate) => candidate.name === targetName);
  if (online !== void 0) return online.id;
  if (db2 !== void 0) return resolvePlayer(db2, targetName)?.data.playerId ?? null;
  return null;
}
function registerModerationCommands(deps) {
  const { sanctions: sanctions2, permissions: permissions2, db: db2 } = deps;
  system15.beforeEvents.startup.subscribe((event) => {
    const guardAndRun = (origin, action) => {
      const player = origin.sourceEntity;
      if (player === void 0 || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus3.Failure, message: NOT_PLAYER };
      }
      if (!requires(player, permissions2, "mod.panel")) {
        return { status: CustomCommandStatus3.Failure, message: "§c[Modération] Permission manquante (mod.panel)." };
      }
      system15.run(() => action(player));
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
      system15.run(() => action(player));
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
        system15.run(() => kickPlayer(target, reason));
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
        notifyTarget(target, `§6[Modération] Avertissement (${count}) : ${reason}`);
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

// src/main.ts
var db = new JsonDatabase(createBedrockStorage(), "nalania");
registerAutosave(db, 100);
var permissions = new PermissionManager(db);
var modules = new ModuleManager(db);
var territories = new TerritoryManager(db);
var sanctions = new SanctionsManager(db);
var classes = new ClassManager(db);
var jobs = new JobManager(db);
var quests = new QuestManager(db);
var mines = new MinesManager();
registerCommands(territories, db, modules, permissions, mines);
registerAdminCommands({ permissions, modules, territories, sanctions, db, classes, jobs, mines, quests });
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
  const player = world19.getAllPlayers().find((candidate) => candidate.name === playerName);
  if (player === void 0) return;
  try {
    player.nameTag = permissions.nameTagFor(playerName);
  } catch {
  }
}
function syncQuestEvents(player) {
  const events = [
    classes.classOf(player.name) !== void 0 ? "choose_class" : void 0,
    mines.isInMines(player) ? "enter_mines" : void 0,
    territories.findByMemberId(player.id) !== void 0 ? "found_clan" : void 0,
    jobs.jobsOf(player.name).length > 0 ? "start_job" : void 0
  ];
  for (const event of events) {
    if (event === void 0) continue;
    for (const quest of quests.record(player.name, event)) {
      player.sendMessage(
        `§6[Quêtes] Objectif terminé : §f${quest.title}§6. Ouvre §f/sn:quests§6 pour récupérer ta récompense.`
      );
    }
  }
}
world19.afterEvents.worldLoad.subscribe(() => {
  Timings.begin("worldLoad");
  db.load();
  permissions.markLoaded();
  modules.markLoaded();
  territories.markLoaded();
  sanctions.markLoaded();
  classes.markLoaded();
  jobs.markLoaded();
  quests.markLoaded();
  mines.markLoaded();
  mines.enabledCheck = () => modules.isEnabled("mines");
  mines.registerMaintenance();
  mines.registerFallRescue();
  permissions.bootstrapDefaultRoles();
  if (!permissions.hasAdmin()) {
    const operator = world19.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
    if (operator !== void 0) {
      permissions.bootstrapAdmin(operator.name);
      log3.info(`Bootstrap : ${operator.name} est promu Admin.`);
    }
  }
  for (const player of world19.getAllPlayers()) {
    permissions.ensureDefaultRole(player.name, player.id);
  }
  for (const player of world19.getAllPlayers()) {
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
  log3.info(`UI images : pack_id=${RP_PACK_ID} (doit matcher l'UUID du RP actif).`);
});
var worldReady = false;
system16.runInterval(() => {
  if (worldReady) return;
  if (world19.getAllPlayers().length === 0) return;
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
      const operator = world19.getAllPlayers().find((candidate) => canUseAdminPanel(candidate, permissions));
      if (operator !== void 0) permissions.bootstrapAdmin(operator.name);
    }
    for (const player of world19.getAllPlayers()) {
      permissions.ensureDefaultRole(player.name, player.id);
      applyNameTag(player.name);
    }
  }
  registerChatOnce();
  if (!protectionRegistered) {
    protectionRegistered = true;
    registerProtection(territories, modules);
    registerAnnouncer(territories, modules);
    mines.enabledCheck = () => modules.isEnabled("mines");
    mines.registerMaintenance();
    mines.registerFallRescue();
    log3.warn("Activation par fallback (worldLoad non reçu) : protection active.");
  }
  worldReady = true;
}, 40);
world19.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn) return;
  const player = event.player;
  permissions.ensureDefaultRole(player.name, player.id);
  quests.stateOf(player.name);
  trackPlayerJoin(
    db,
    player.id,
    player.name,
    permissions.roleOf(player.name)?.data.name ?? "",
    classes.classOf(player.name)?.classId ?? ""
  );
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
  player.sendMessage("§6[NaLandia]§r Bienvenue ! Menu : §f/sn:menu");
  if (classes.classOf(player.name) === void 0) {
    player.sendMessage("§d[Classes]§r Choisis ta route avec §f/sn:classes§r — c'est définitif !");
  } else {
    quests.record(player.name, "choose_class");
  }
  syncQuestEvents(player);
  player.onScreenDisplay.setTitle("§6NaLandia");
});
system16.runInterval(() => {
  if (!permissions.loaded) return;
  for (const player of world19.getAllPlayers()) {
    applyNameTag(player.name);
    syncQuestEvents(player);
  }
}, 100);
system16.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "sn:ui" || event.sourceEntity === void 0) return;
  if (event.sourceEntity.typeId !== "minecraft:player") return;
  const player = event.sourceEntity;
  const mode = event.message.trim().toLowerCase();
  if (mode === "on" || mode === "off") {
    setUiDesign(mode === "on");
    log3.info(`Design UI (héros + icônes) : ${mode.toUpperCase()}`);
    player.sendMessage(
      mode === "on" ? "§a[NaLandia] Design UI activé (icônes)." : "§e[NaLandia] Design UI désactivé (menus sans image — mode compatibilité)."
    );
  }
});
system16.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "sn:seed") return;
  const value = Number.parseInt(event.message.trim(), 10);
  if (Number.isFinite(value)) {
    setMinesSeed(value);
    log3.info(`Mines : graine fixée à ${value}.`);
  }
});
system16.runInterval(() => {
  const stats = db.stats();
  logDb.info(
    `${stats.documents} documents, ${stats.bytes} octets, ${stats.dirty ? "non sauvegardée" : "à jour"}`
  );
}, 600);
