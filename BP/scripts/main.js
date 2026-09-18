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

// src/ui/theme.ts
import { system as system7 } from "@minecraft/server";
import {
  ActionFormData as NativeActionForm,
  CustomForm as NativeCustomForm,
  FormCancelationReason,
  ObservableBoolean as NativeObservableBoolean,
  ObservableNumber as NativeObservableNumber,
  ObservableString as NativeObservableString
} from "@minecraft/server-ui";

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
  const clean2 = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
  return designForSection(clean2.trim());
}

// src/ui/tiles.ts
var TILE_MENUS = {
  /**
   * Classes : trois grandes cartes verticales (une par voie) + la barre de
   * retour. Les descriptions sont transportées par des boutons invisibles
   * placés SOUS les cartes dans la collection, afin que chaque texte reste
   * une ligne indépendante (pas de texte multi-lignes dans un bouton).
   */
  Classes: {
    actions: ["class_0", "class_1", "class_2", "back"],
    data: ["desc_0", "desc_1", "desc_2"]
  },
  /**
   * Mon clan : emplacement banque (haut gauche), drapeau (haut droite) puis
   * les actions en bas. Le drapeau est transporté par deux boutons invisibles :
   * son identifiant (pour choisir la bannière affichée) et son nom lisible.
   */
  "Mon clan": {
    actions: ["bio", "claim", "members", "flag", "quit", "back"],
    data: ["flag_id", "flag_name"]
  }
};
function tileTitleFor(section) {
  return sheetTitleFor(section);
}

// src/ui/theme.ts
var RP_PACK_ID = "33ca6e1c-4f30-46ae-8b56-1510382e3f61";
var uiDesignEnabled = true;
function setUiDesign(enabled) {
  uiDesignEnabled = enabled;
}
function windowTitle(section) {
  return `${TITLE_PREFIX}${section}`;
}
var ObservableString = class {
  constructor(value) {
    this.value = value;
  }
  getData() {
    return this.value;
  }
  setData(value) {
    this.value = value;
  }
  subscribe(callback) {
    return callback;
  }
  unsubscribe(_callback) {
    return true;
  }
};
var ObservableNumber = class {
  constructor(value) {
    this.value = value;
  }
  getData() {
    return this.value;
  }
  setData(value) {
    this.value = value;
  }
  subscribe(callback) {
    return callback;
  }
  unsubscribe(_callback) {
    return true;
  }
};
var ObservableBoolean = class {
  constructor(value) {
    this.value = value;
  }
  getData() {
    return this.value;
  }
  setData(value) {
    this.value = value;
  }
  subscribe(callback) {
    return callback;
  }
  unsubscribe(_callback) {
    return true;
  }
};
function obString(value) {
  return new ObservableString(value);
}
function obNumber(value) {
  return new ObservableNumber(value);
}
function obBool(value) {
  return new ObservableBoolean(value);
}
function clean(text) {
  return text.replace(/§h/g, "").replace(/[■≡⬥✦╔╗╚╝█░▓━→←↔·]/g, "").trim();
}
var OMForm = class {
  constructor(player, title, _hero, design) {
    this.player = player;
    this.titleText = title.replace(/§./g, "").trim();
    this.design = design ?? designForTitle(this.titleText);
  }
  elements = [];
  titleText;
  backAction;
  activeForm;
  resolveShow;
  design;
  hero(_kind) {
    return this;
  }
  image(path, width = 1) {
    this.elements.push({ kind: "image", path, width: Math.max(0.1, Math.min(1, width)) });
    return this;
  }
  header(text) {
    this.elements.push({ kind: "header", text: clean(text) });
    return this;
  }
  body(text) {
    this.elements.push({ kind: "body", text: clean(text) });
    return this;
  }
  label(text) {
    this.elements.push({ kind: "label", text: clean(text) });
    return this;
  }
  divider() {
    this.elements.push({ kind: "divider", text: "" });
    return this;
  }
  spacer() {
    this.elements.push({ kind: "label", text: " " });
    return this;
  }
  button(label, onClick, _options, _icon) {
    this.elements.push({ kind: "button", text: clean(label).replace(/\s*\n\s*/g, " "), onClick });
    return this;
  }
  back(onBack) {
    this.backAction = onBack;
    return this;
  }
  toggle(_label, initial) {
    const value = new NativeObservableBoolean(initial);
    this.elements.push({ kind: "field", add: (form) => form.toggle(_label, value) });
    return this;
  }
  toggleOb(label, observable) {
    const value = new NativeObservableBoolean(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.toggle(label, value) });
    return this;
  }
  slider(label, observable, min, max, options) {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.slider(label, value, min, max, { step: options?.step ?? 1 }) });
    return this;
  }
  dropdown(label, observable, items) {
    const value = new NativeObservableNumber(observable.getData());
    value.subscribe((next) => observable.setData(next));
    const data = items.map((item, index) => ({ label: typeof item === "string" ? item : item.label, value: typeof item === "string" ? index : item.value }));
    this.elements.push({ kind: "field", add: (form) => form.dropdown(label, value, data) });
    return this;
  }
  textField(label, observable, _options) {
    const value = new NativeObservableString(observable.getData());
    value.subscribe((next) => observable.setData(next));
    this.elements.push({ kind: "field", add: (form) => form.textField(label, value) });
    return this;
  }
  closeButton() {
    return this;
  }
  isShowing() {
    return this.resolveShow !== void 0;
  }
  closeIfShowing() {
    if (this.activeForm?.isShowing()) this.activeForm.close();
    this.activeForm = void 0;
    this.resolveShow = void 0;
  }
  show() {
    return new Promise((resolve) => {
      this.resolveShow = resolve;
      system7.runTimeout(() => {
        void this.present();
      }, 1);
    });
  }
  finish(reason) {
    const resolve = this.resolveShow;
    this.resolveShow = void 0;
    resolve?.(reason);
  }
  async present() {
    try {
      const form = new NativeCustomForm(this.player, this.titleText);
      this.activeForm = form;
      if (this.design === "cards") {
        form.image("textures/ui/om_header_band", RP_PACK_ID, { width: 1 });
        form.image("textures/ui/om_card", RP_PACK_ID, { width: 0.82 });
      } else if (this.design === "parchment") {
        form.image("textures/ui/om_sheet_pane", RP_PACK_ID, { width: 1 });
        form.image("textures/ui/om_content_bg", RP_PACK_ID, { width: 0.9 });
      } else {
        form.image("textures/ui/om_header_band", RP_PACK_ID, { width: 1 });
      }
      for (const element of this.elements) {
        if (element.kind === "button") {
          form.button(element.text, () => {
            if (form.isShowing()) form.close();
            element.onClick();
          });
        } else if (element.kind === "image") form.image(element.path, RP_PACK_ID, { width: element.width });
        else if (element.kind === "header") form.header(element.text);
        else if (element.kind === "body" || element.kind === "label") form.label(element.text);
        else if (element.kind === "divider") form.divider();
        else if (element.kind === "field") element.add(form);
      }
      if (this.backAction !== void 0) {
        form.button("Retour", () => {
          if (form.isShowing()) form.close();
          this.backAction?.();
        });
      }
      form.closeButton();
      const reason = await form.show();
      this.activeForm = void 0;
      this.finish(reason === "UserBusy" ? "UserBusy" : reason === "ServerClosed" ? "ServerClosed" : "UserClosed");
    } catch (error) {
      this.activeForm = void 0;
      const message = error instanceof Error ? error.message : String(error);
      logMod.warn(`Menu « ${this.titleText} » : ${message}`);
      this.player.sendMessage(`§c[NaLandia] Le menu « ${this.titleText} » n'a pas pu s'afficher : §f${message}`);
      this.finish("ServerClosed");
    }
  }
};
function buildAndShow(player, title, build, design, hero) {
  return new Promise((resolve, reject) => {
    system7.runTimeout(() => {
      try {
        const form = new OMForm(player, title, hero, design);
        build(form);
        form.show().then(resolve, reject);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 1);
  });
}
function openWindow(player, section, build, hero) {
  return buildAndShow(player, sheetTitleFor(section), build, designForSection(section), hero);
}
function openWindowRaw(player, title, build) {
  return buildAndShow(player, title, build, designForTitle(title.replace(/§./g, "").trim()));
}
function openTileMenu(player, section, build) {
  const actions = /* @__PURE__ */ new Map();
  const data = /* @__PURE__ */ new Map();
  let bodyText = "";
  const builder = {
    action(key, label, onClick) {
      actions.set(key, { label, onClick });
      return builder;
    },
    data(key, text) {
      data.set(key, text);
      return builder;
    },
    body(text) {
      bodyText = text;
      return builder;
    }
  };
  try {
    build(builder);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMod.warn(`Construction du menu « ${section} » : ${message}`);
    return;
  }
  scheduleTileForm(player, section, actions, data, bodyText, 0);
}
function scheduleTileForm(player, section, actions, data, bodyText, attempt) {
  system7.runTimeout(() => {
    void presentTileForm(player, section, actions, data, bodyText, attempt);
  }, attempt === 0 ? 1 : 10);
}
async function presentTileForm(player, section, actions, data, bodyText, attempt) {
  const layout = TILE_MENUS[section];
  const form = new NativeActionForm();
  form.title(tileTitleFor(section));
  if (bodyText.trim().length > 0) form.body(bodyText);
  for (const key2 of layout.actions) {
    form.button(actions.get(key2)?.label ?? "§8—");
  }
  for (const key2 of layout.data) {
    form.button(data.get(key2) ?? " ");
  }
  let selection;
  try {
    const response = await form.show(player);
    if (response.selection === void 0 && response.cancelationReason === FormCancelationReason.UserBusy && attempt < 3) {
      scheduleTileForm(player, section, actions, data, bodyText, attempt + 1);
      return;
    }
    selection = response.selection;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (attempt < 3) {
      scheduleTileForm(player, section, actions, data, bodyText, attempt + 1);
      return;
    }
    logMod.warn(`Menu « ${section} » : ${message}`);
    player.sendMessage(`§c[NaLandia] Le menu « ${section} » n'a pas pu s'afficher : §f${message}`);
    return;
  }
  if (selection === void 0) return;
  const key = layout.actions[selection];
  if (key === void 0) return;
  const action = actions.get(key);
  if (action === void 0) return;
  try {
    action.onClick();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logMod.warn(`Action « ${section}/${key} » : ${message}`);
  }
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
        form.header(`${color.code}§l${state.data.name}§r`);
        form.label(
          [
            `§7Dirigé par §f${state.data.owner}`,
            `§7Territoire §f${extentLine(state.data.chunkKeys.length)}`
          ].join("\n")
        );
        form.button(`§6Ouvrir la fiche de ${state.data.name}`, () => showStateInfo(player, state, manager));
        form.divider();
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
  const flagToken = data.color.startsWith("flag:") ? "blason" : data.color;
  const flagName = data.color.startsWith("flag:") ? `Blason ${data.color.slice(5)}` : color.id.charAt(0).toUpperCase() + color.id.slice(1);
  openTileMenu(player, "Mon clan", (menu) => {
    menu.body(
      [
        `${color.code}§l${data.name}§r`,
        `§eChef §f${data.owner}   §eRang §r${rankLabel}`,
        `§eDrapeau §r${color.code}${flagName}   §eTerritoire §f${extentLine(data.chunkKeys.length)}`,
        `§eMembres §f${data.members.length + 1}   §eBanque §8emplacement réservé`,
        `§8${data.description ?? "Un nouvel État prend forme."}`
      ].join("\n")
    );
    menu.action("bio", `§eModifier la bio`, () => openClanBioMenu(player, manager, territory));
    menu.action("claim", `§aRevendiquer ce chunk`, () => {
      claimHere(player, manager, territory);
    });
    menu.action("members", `§bMembres du clan`, () => openMembersMenu(player, manager, territory));
    menu.action("flag", isOwner ? `§6Modifier le drapeau` : `§8Drapeau (chef)`, () => {
      if (isOwner) {
        openFlagMenu(player, manager, territory);
        return;
      }
      say(player, "§c[Clans] Seul le chef peut changer le drapeau.");
    });
    menu.action("quit", isOwner ? `§cDissoudre le clan` : `§cQuitter le clan`, () => {
      if (isOwner) {
        openDissolveMenu(player, manager, territory);
        return;
      }
      const ok = manager.leave(territory.id, player.id);
      say(
        player,
        ok ? `§e[Clans] Tu as quitté §f${data.name}§e.` : "§c[Clans] Impossible de quitter le clan."
      );
    });
    menu.action("back", `§7Retour aux États`, () => openStatesMenu(player, manager));
    menu.data("flag_id", `FLAG:${flagToken}`);
    menu.data("flag_name", `${color.code}${flagName}`);
  });
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
    const clean2 = name.trim();
    if (clean2.length < 2 || clean2.length > 16) {
      return { ok: false, error: "Le nom du rôle doit faire entre 2 et 16 caractères." };
    }
    if (this.getRole(clean2) !== void 0) {
      return { ok: false, error: `Le rôle "${clean2}" existe déjà.` };
    }
    this.db.insert(
      ROLES_COLLECTION,
      { name: clean2, color, prefix: `[${clean2}]`, level, perms: defaultPermsForLevel(level) },
      clean2
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
    const clean2 = permIds.filter((id) => isPermId(id));
    role.data.perms = [...new Set(clean2)];
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
      const clean2 = name.getData().trim();
      const color = ROLE_COLORS[colorIndex.getData()] ?? ROLE_COLORS[0];
      if (clean2 === "") {
        player.sendMessage("§c[Rôles] Nom vide.");
        return;
      }
      const result = permissions2.createRole(clean2, color?.code ?? "§f", level.getData());
      player.sendMessage(
        result.ok ? `§a[Rôles] Rôle ${color?.code}[${clean2}]§r§a créé.` : `§c[Rôles] ${result.error}`
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
function classCard(player, classes2, info, allowChoose, backTo) {
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
    if (allowChoose) {
      form.button(`§a§lChoisir la voie ${info.name}`, () => confirmClassChoice(player, classes2, info, backTo));
    } else {
      form.label(
        `§8Cette voie reste consultable, mais ton choix est définitif :
§8seul un admin peut le réinitialiser.`
      );
    }
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
function openClassesMenu(player, classes2, isAdmin = false, back) {
  const selection = classes2.classOf(player.name);
  const current = selection === void 0 ? void 0 : CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);
  openTileMenu(player, "Classes", (menu) => {
    CLASS_CATALOG.forEach((info, index) => {
      const isCurrent = current?.id === info.id;
      menu.action(`class_${index}`, `§f§l${info.name}`, () => {
        if (selection === void 0) {
          classCard(player, classes2, info, true, () => openClassesMenu(player, classes2, isAdmin, back));
          return;
        }
        if (isCurrent) {
          myClassCard(player, classes2, info, selection.xp, isAdmin);
          return;
        }
        classCard(player, classes2, info, false, () => openClassesMenu(player, classes2, isAdmin, back));
      });
      menu.data(
        `desc_${index}`,
        [
          `${info.color}§l${info.name}§r`,
          `${info.description}`,
          CLASS_TRAITS[info.id].join("\n"),
          isCurrent ? `§6Voie actuelle  §7niveau §f${classLevel(selection?.xp ?? 0)}` : selection === void 0 ? `§aDisponible` : `§8Choix définitif`
        ].join("\n")
      );
    });
    menu.action("back", "§7Retour", () => {
      if (back !== void 0) back();
    });
    menu.body(
      selection === void 0 || current === void 0 ? [
        "§7Choisis ta §froute§7. Ce choix est §lDÉFINITIF§r§7.",
        `§8Trois voies, trois façons de jouer — clique une carte pour sa fiche.`
      ].join("\n") : [
        `§7Ta voie : ${current.color}§l${current.name}§r`,
        `§7Niveau §f${classLevel(selection.xp)}§7   §8|   §7XP §f${classProgress(selection.xp)}§7/§f${XP_PER_LEVEL}§7   §8|   §7total §f${selection.xp}`,
        `§8Clique ta carte pour ouvrir la progression.`
      ].join("\n")
    );
  });
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
        const jobName = info?.name ?? job.jobId;
        form.header(`${info?.color ?? "§f"}§l${jobName}§r`);
        form.label(
          [
            `§7Niveau §f${jobLevel(job.xp)}`,
            `§7Progression ${xpBar2(job.xp % JOB_XP_PER_LEVEL, JOB_XP_PER_LEVEL)}`
          ].join("\n")
        );
        form.button(`§cQuitter ${jobName}`, () => {
          if (jobs2.quitJob(player.name, job.jobId)) {
            player.sendMessage(`§e[Métiers] Tu quittes le métier ${jobName}.`);
          }
          openJobsMenu(player, jobs2);
        });
        form.divider();
      }
      form.divider();
    }
    form.header("§6§lChoisir une discipline");
    for (const info of jobs2.catalog()) {
      if (jobs2.hasJob(player.name, info.id)) continue;
      form.header(`${info.color}§l${info.name}§r`);
      form.label(`§7${info.description}`);
      form.button(`§aCommencer ${info.name}`, () => {
        if (jobs2.startJob(player.name, info.id)) {
          player.sendMessage(`§a[Métiers] Métier commencé : ${info.name}.`);
        }
        openJobsMenu(player, jobs2);
      });
      form.divider();
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
      form.header(`${ready ? "§a" : "§e"}§l${quest.title}§r`);
      form.label(
        [
          `§7${quest.description}`,
          `§7Progression §f${progress}/${quest.target}`,
          `§7Récompense §6${rewardLabel(quest.id, quests2)}`
        ].join("\n")
      );
      form.button(
        ready ? "§aRécupérer la récompense" : "§eVoir les détails",
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
      form.header(`§8${quest.title}`);
      form.label(`§8${quest.description}`);
      form.button("§6Suivre cette piste", () => {
        const result = quests2.start(player.name, quest.id);
        if (!result.ok) player.sendMessage(`§c[Quêtes] ${result.error}`);
        openQuestMenu(player, quests2, classes2, jobs2);
      });
      form.divider();
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
      if (classes2 !== void 0) openClassesMenu(player, classes2, false, () => openMyInfoMenu(player, deps));
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
