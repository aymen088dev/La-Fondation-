/**
 * Module Mines — dimension minière custom « nalania:mines ».
 *
 * La dimension est déclarée dans BP/dimensions/nalania_mines.json
 * (générateur « void », 384 blocs de haut) : le module la REMPLIT en
 * procédural déterministe (même graine → mêmes mines).
 *
 * v19 — « vraie mine » (cf. generator.ts) :
 *  - monde ENTIÈREMENT en pierre (70 couches entre deux lits de bedrock),
 *    ambiance souterraine permanente ;
 *  - galeries croisées praticables + grandes salles (pas de tunnels de
 *    2 blocs) ;
 *  - minerais PLUS nombreux qu'en surface mais équilibrés (~150 blocs
 *    par chunk, répartis par profondeur) ;
 *  - génération par fillBlocks (rapide), file anti-lag avec RETRY si les
 *    chunks ne sont pas encore chargés ;
 *  - arrivée SÉCURISÉE : la téléportation n'a lieu que la plateforme du
 *    spawn est prête (plus de chute dans le vide).
 */

import { world, system, GameMode } from "@minecraft/server";
import { BlockVolume } from "@minecraft/server";
import type { Player, Dimension } from "@minecraft/server";
import { log } from "../lib/log";
import {
  planChunk,
  clipBox,
  spawnRingPositions,
  Y_BEDROCK_MAX,
  Y_STONE_MIN,
  Y_STONE_MAX,
  Y_CEIL_BEDROCK,
  Y_GALLERY_AIR_MIN,
  Y_GALLERY_AIR_MAX,
  Y_SPAWN_FEET,
  ORE_SPECS,
  SPAWN_RADIUS,
} from "./generator";
import type { Box } from "./generator";

export {
  rng,
  hash,
  planChunk,
  ORE_SPECS,
  Y_STONE_MIN,
  Y_STONE_MAX,
  Y_GALLERY_AIR_MAX,
  averageOreCellsPerChunk,
} from "./generator";

/** Identifiant de la dimension minière (BP/dimensions/nalania_mines.json). */
export const MINES_DIMENSION_ID = "nalania:mines";

/** Propriété dynamique : position de retour dans le monde normal. */
const RETURN_PROP = "nalania:overworld_return";

/**
 * Liste publique des minerais (affichage du menu) — plus riche que la
 * surface, sans excès (~150 blocs/chunk, pondéré par la profondeur).
 */
export const ORES_PUBLIC: Array<{ label: string; color: string }> = [
  { label: "Charbon", color: "§8" },
  { label: "Cuivre", color: "§6" },
  { label: "Fer", color: "§f" },
  { label: "Or", color: "§e" },
  { label: "Redstone", color: "§c" },
  { label: "Lapis", color: "§9" },
  { label: "Émeraude", color: "§a" },
  { label: "Diamant", color: "§b" },
];

/** Graine du monde (stable dans la session). */
let worldSeed = 1337;
/** Graine configurable : /scriptevent sn:seed <n> (avant la 1re génération). */
export function setMinesSeed(seed: number): void {
  worldSeed = seed >>> 0;
}

/** Tâche de génération d'un chunk (préparée, puis exécutée en file). */
interface ChunkTask {
  key: string;
  run: () => void;
  /** Log d'échec déjà émis ? (évite le spam pendant le chargement) */
  logged?: boolean;
}

/**
 * Gestionnaire de la dimension minière.
 */
export class MinesManager {
  /** Passe à true après le worldLoad (la dimension devient adressable). */
  loaded = false;
  /** État statique (fallback si aucun check live branché). */
  enabled = true;
  /**
   * Check live branché par main.ts (module « mines » de /sn:modules) :
   * permet au toggle du menu Modules d'agir instantanément.
   */
  enabledCheck?: () => boolean;

  /** Chunks définitivement générés. */
  private readonly generated = new Set<string>();
  /** Chunks en attente (clé → tâche) : rejoués tant qu'ils échouent. */
  private readonly pending = new Map<string, ChunkTask>();
  private queueRunning = false;

  /**
   * La zone de spawn (plateforme à cheval sur les 4 chunks de l'origine)
   * est-elle entièrement générée ?
   */
  private isSpawnAreaReady(): boolean {
    for (const key of ["0:0", "-1:0", "0:-1", "-1:-1"]) {
      if (!this.generated.has(key)) return false;
    }
    return true;
  }

  /** Le module mines est-il actif ? (check live si branché) */
  isUsable(): boolean {
    return this.enabledCheck !== undefined ? this.enabledCheck() : this.enabled;
  }

  markLoaded(): void {
    this.loaded = true;
  }

  /** La dimension minière (undefined tant que non chargée/inexistante). */
  dimension(): Dimension | undefined {
    if (!this.loaded) return undefined;
    try {
      return world.getDimension(MINES_DIMENSION_ID);
    } catch {
      return undefined;
    }
  }

  /** Le joueur est-il dans la dimension minière ? */
  isInMines(player: Player): boolean {
    return player.dimension.id === MINES_DIMENSION_ID;
  }

  /**
   * Va aux mines (depuis le monde normal) ou revient au monde normal à la
   * dernière position connue du joueur (retour exact).
   */
  toggle(player: Player): string {
    if (!this.isUsable()) return "§c[Mines] Le module Mines est désactivé (/sn:modules).";
    if (this.isInMines(player)) return this.exit(player);
    return this.enter(player);
  }

  /** Menu « Monde » : choix explicite de la destination. */
  goNormal(player: Player): string {
    if (!this.isInMines(player)) return "§7[Mines] Tu es déjà dans le monde normal.";
    return this.exit(player);
  }

  goMines(player: Player): string {
    if (this.isInMines(player)) return "§7[Mines] Tu es déjà dans la mine.";
    return this.enter(player);
  }

  /**
   * Dernière position connue du joueur dans le monde normal
   * (dimension !== mines), ou undefined.
   */
  lastOverworldLocation(player: Player): { dimensionId: string; x: number; y: number; z: number } | undefined {
    try {
      const raw = player.getDynamicProperty(RETURN_PROP);
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as { dimensionId: string; x: number; y: number; z: number };
        if (typeof parsed.dimensionId === "string" && parsed.dimensionId !== MINES_DIMENSION_ID) {
          return parsed;
        }
      }
    } catch {
      // property absente/corrompue → fallback spawn
    }
    return undefined;
  }

  private rememberOverworld(player: Player): void {
    try {
      player.setDynamicProperty(RETURN_PROP, JSON.stringify({
        dimensionId: player.dimension.id,
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
      }));
    } catch {
      // property indisponible : le retour ramènera au spawn du monde
    }
  }

  /** Aller : mémorise le retour, prépare le spawn, téléporte quand prêt. */
  private enter(player: Player): string {
    const dimension = this.dimension();
    if (dimension === undefined) {
      return "§c[Mines] Dimension indisponible : vérifie que le pack déclare bien nalania:mines.";
    }

    this.rememberOverworld(player);

    // La plateforme doit être PRÊTE avant la téléportation (plus de chute
    // dans le vide). Elle est à cheval sur 4 chunks : tous sont mis en file.
    this.ensureChunk(0, 0, dimension);
    this.ensureChunk(-1, 0, dimension);
    this.ensureChunk(0, -1, dimension);
    this.ensureChunk(-1, -1, dimension);
    this.pumpQueue();
    if (!this.isSpawnAreaReady()) {
      this.pendingArrivals.add(player.id);
      return "§b[Mines] Préparation de la mine… §7tu arrives dès que la plateforme est prête.";
    }

    this.teleportToSpawn(player, dimension);
    return "§b[Mines] Bienvenue dans la mine ! §7Retour : §f/sn:monde§7.";
  }

  /** Retour : dernière position connue dans le monde normal, sinon spawn. */
  private exit(player: Player): string {
    const target = this.lastOverworldLocation(player);

    if (target !== undefined) {
      try {
        const dimension = world.getDimension(target.dimensionId);
        player.teleport({ x: target.x, y: target.y, z: target.z }, { dimension });
        return "§a[Mines] Retour à ta dernière position dans le monde normal.";
      } catch {
        // dimension inconnue → fallback spawn
      }
    }
    const overworld = world.getDimension("minecraft:overworld");
    let spawn: { x: number; y: number; z: number };
    try {
      spawn = world.getDefaultSpawnLocation();
    } catch {
      spawn = { x: 0, y: 100, z: 0 };
    }
    player.teleport({ x: spawn.x + 0.5, y: spawn.y + 2, z: spawn.z + 0.5 }, { dimension: overworld });
    return "§a[Mines] Retour au spawn du monde (pas de position mémorisée).";
  }

  /** Téléporte aux mines : plateforme du spawn, nuit + night vision. */
  private teleportToSpawn(player: Player, dimension: Dimension): void {
    player.teleport({ x: 0.5, y: Y_SPAWN_FEET, z: 0.5 }, { dimension });
    try {
      player.addEffect("night_vision", 20 * 120, { amplifier: 0, showParticles: false });
    } catch {
      // effet indisponible : on ignore
    }
  }

  /** Arrivées différées (plateforme pas encore prête au moment de /sn:mine). */
  private readonly pendingArrivals = new Set<string>();

  private flushPendingArrivals(): void {
    if (this.pendingArrivals.size === 0) return;
    const dimension = this.dimension();
    if (dimension === undefined) return;
    for (const id of [...this.pendingArrivals]) {
      const player = world.getAllPlayers().find((candidate) => candidate.id === id);
      if (player === undefined) {
        this.pendingArrivals.delete(id);
        continue;
      }
      try {
        this.teleportToSpawn(player, dimension);
        player.sendMessage("§b[Mines] La plateforme est prête — bienvenue dans la mine !");
      } catch {
        // joueur parti entre-temps : on réessaiera au prochain tick de pompe
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
  ensureChunk(cx: number, cz: number, dimension: Dimension): void {
    const key = `${cx}:${cz}`;
    if (this.generated.has(key) || this.pending.has(key)) return;

    const plan = planChunk(worldSeed, cx, cz);
    this.pending.set(key, {
      key,
      run: () => {
        // Garde : ne JAMAIS générer un chunk non chargé (les fillBlocks
        // seraient silencieux → chunk « fait » mais vide). On jette ici :
        // la tâche reste en file et sera rejouée.
        if (!dimension.isChunkLoaded({ x: cx * 16 + 8, y: Y_SPAWN_FEET, z: cz * 16 + 8 })) {
          throw new Error("chunk pas encore chargé");
        }
        generateChunk(dimension, plan, cx, cz);
        this.generated.add(key);
        this.pending.delete(key);
      },
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
  private pumpQueue(): void {
    if (this.queueRunning) return;
    this.queueRunning = true;

    const run = (): void => {
      const next = this.pending.values().next();
      if (next.done) {
        this.queueRunning = false;
        this.flushPendingArrivals();
        return;
      }
      try {
        next.value.run();
      } catch (error: unknown) {
        // Chunk pas encore chargé : replacé en fin de file, on tente les
        // suivants ; si tous échouent, on stoppe (l'entretien relancera).
        if (!next.value.logged) {
          next.value.logged = true;
          log.warn(
            `Mines : chunk ${next.value.key} en attente de chargement (${error instanceof Error ? error.message : String(error)})`,
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
        system.run(run);
        return;
      }
      this.flushPendingArrivals();
      system.run(run);
    };
    system.run(run);
  }

  /** Force le traitement de la file (tests / appel immédiat). */
  kickQueue(): void {
    this.pumpQueue();
  }

  /**
   * Boucle d'entretien : génère les chunks autour des joueurs présents
   * dans la dimension + exécute la file (l'entretien alimente, la pompe
   * consomme une tâche par tick).
   */
  registerMaintenance(intervalTicks = 40): void {
    system.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      const dimension = this.dimension();
      if (dimension === undefined) return;

      for (const player of world.getAllPlayers()) {
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
  registerFallRescue(intervalTicks = 20): void {
    system.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      for (const player of world.getAllPlayers()) {
        if (player.dimension.id !== MINES_DIMENSION_ID) continue;
        if (player.location.y < 0) {
          const dimension = this.dimension();
          if (dimension === undefined) continue;
          player.teleport({ x: 0.5, y: Y_SPAWN_FEET, z: 0.5 }, { dimension });
          player.sendMessage("§e[Mines] Tu es tombé dans le vide : ramené à la plateforme.");
        }
      }
    }, intervalTicks);
  }

  /** Les créatifs et spectateurs ne déclenchent rien de spécial (compat). */
  static isSurvivalLike(player: Player): boolean {
    return player.getGameMode() === GameMode.Survival || player.getGameMode() === GameMode.Adventure;
  }
}

// ---------------------------------------------------------------------------
// Application d'un plan de chunk (fillBlocks — rapide et fiable)
// ---------------------------------------------------------------------------

/** Remplit une boîte déjà découpée dans le chunk avec le bloc donné. */
function fill(dimension: Dimension, box: Box, block: string): void {
  dimension.fillBlocks(
    new BlockVolume(
      { x: box.x0, y: box.y0, z: box.z0 },
      { x: box.x1, y: box.y1, z: box.z1 },
    ),
    block,
    { ignoreChunkBoundErrors: true },
  );
}

/**
 * Génère un chunk de mine selon son plan :
 *  1. lits de bedrock (bas/haut) + corps de pierre massif ;
 *  2. creusement des salles et des galeries (air) ;
 *  3. pose des piliers de soutien (pierre) ;
 *  4. veines de minerais (bloc par bloc, UNIQUEMENT dans la pierre) ;
 *  5. éclairage (lanternes de salles, torches de galeries) ;
 *  6. plateforme du spawn (chunk 0,0 uniquement).
 */
function generateChunk(dimension: Dimension, plan: ReturnType<typeof planChunk>, cx: number, cz: number): void {
  const full: Box = {
    x0: cx * 16, x1: cx * 16 + 15,
    y0: 0, y1: Y_CEIL_BEDROCK,
    z0: cz * 16, z1: cz * 16 + 15,
  };

  // 1) Squelette : bedrock bas/haut, corps de pierre entre les deux.
  fill(dimension, { ...full, y0: 0, y1: Y_BEDROCK_MAX }, "minecraft:bedrock");
  fill(dimension, { ...full, y0: Y_STONE_MIN, y1: Y_STONE_MAX }, "minecraft:stone");
  fill(dimension, { ...full, y0: Y_CEIL_BEDROCK, y1: Y_CEIL_BEDROCK }, "minecraft:bedrock");

  // 2) Creusement : salles puis galeries (les boîtes sont déjà prévues
  //    pour rester dans le corps de pierre).
  for (const room of plan.rooms) fill(dimension, room, "minecraft:air");
  fill(dimension, clipBox(plan.corridorX, cx, cz) ?? plan.corridorX, "minecraft:air");
  fill(dimension, clipBox(plan.corridorZ, cx, cz) ?? plan.corridorZ, "minecraft:air");

  // 3) Piliers de soutien (rendus à la pose des salles, ils restent pierre).
  for (const pillar of plan.pillars) fill(dimension, pillar, "minecraft:stone");

  // 4) Veines de minerais : seulement les cellules du chunk courant,
  //    uniquement dans la pierre (ne perce JAMAIS une salle/galerie).
  const oreSet = new Set(ORE_SPECS.map((spec) => spec.block));
  for (const vein of plan.veins) {
    for (const cell of vein.cells) {
      const cellCx = Math.floor(cell.x / 16);
      const cellCz = Math.floor(cell.z / 16);
      if (cellCx !== cx || cellCz !== cz) continue;
      if (cell.y < Y_STONE_MIN || cell.y > Y_STONE_MAX) continue;
      try {
        const block = dimension.getBlock({ x: cell.x, y: cell.y, z: cell.z });
        if (block === undefined) continue;
        if (block.typeId !== "minecraft:stone") continue;
        if (oreSet.has(block.typeId)) continue;
        block.setType(vein.block);
      } catch {
        // position illisible (bord de monde) : on ignore
      }
    }
  }

  // 5) Éclairage.
  for (const lantern of plan.lanterns) {
    try {
      dimension.getBlock({ x: lantern.x, y: lantern.y, z: lantern.z })?.setType("minecraft:lantern");
    } catch {
      // ignore
    }
  }
  for (const torch of plan.torches) {
    try {
      dimension.getBlock({ x: torch.x, y: torch.y, z: torch.z })?.setType("minecraft:torch");
    } catch {
      // ignore
    }
  }

  // 6) Plateforme du spawn (à cheval sur les 4 chunks de l'origine) :
  //    chaque chunk ne pose QUE sa portion (clippée) — les 4 portions
  //    assemblées forment le disque complet. Le muret et les lanternes
  //    sont posés position par position (déjà clippés par construction).
  const spawnDisk: Box = {
    x0: -SPAWN_RADIUS, x1: SPAWN_RADIUS,
    y0: Y_STONE_MIN, y1: Y_GALLERY_AIR_MAX,
    z0: -SPAWN_RADIUS, z1: SPAWN_RADIUS,
  };
  const portion = clipBox(spawnDisk, cx, cz);
  if (portion !== null) {
    // Sous-sol renforcé puis air dégagé, uniquement sur la portion.
    fill(dimension, { ...portion, y0: Y_STONE_MIN, y1: Y_GALLERY_AIR_MIN - 1 }, "minecraft:polished_deepslate");
    fill(dimension, { ...portion, y0: Y_GALLERY_AIR_MIN, y1: Y_GALLERY_AIR_MAX }, "minecraft:air");
  }

  // Muret circulaire : chaque chunk pose les positions du muret qu'il
  // possède (le disque déborde sur les chunks négatifs de l'origine).
  for (const ring of spawnRingPositions()) {
    if (Math.floor(ring.x / 16) !== cx || Math.floor(ring.z / 16) !== cz) continue;
    try {
      dimension.getBlock({ x: ring.x, y: Y_GALLERY_AIR_MIN, z: ring.z })?.setType("minecraft:stone_brick_wall");
    } catch {
      // ignore
    }
  }

  if (cx === 0 && cz === 0) {
    // Lanternes d'angle du spawn (toutes dans le chunk 0,0).
    const r = SPAWN_RADIUS;
    for (const [lx, lz] of [[1, 1], [r - 1, 1], [1, r - 1], [r - 1, r - 1]] as Array<[number, number]>) {
      try {
        dimension.getBlock({ x: lx, y: Y_GALLERY_AIR_MIN, z: lz })?.setType("minecraft:lantern");
      } catch {
        // ignore
      }
    }
  }
}
