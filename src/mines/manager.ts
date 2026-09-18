/**
 * Module Mines — dimension minière custom « nalania:mines ».
 *
 * La dimension est déclarée dans BP/dimensions/nalania_mines.json
 * (générateur « void », 384 blocs de haut) : le module la REMPLIT en
 * procédural déterministe (même graine → mêmes mines) :
 *  - plateforme d'arrivée en pierre polie + barrières ;
 *  - cavernes de pierre creusées de galeries et poches ;
 *  - BEAUCOUP plus de minerais que dans l'overworld (charbon, fer,
 *    cuivre, or, redstone, lapis, émeraude, diamant) ;
 *  - torches pour l'ambiance.
 *
 * La génération se fait PAR CHUNK, en file (budget de blocs par tick pour
 * ne jamais laguer le serveur), déclenchée quand un joueur s'approche.
 */

import { world, system, GameMode } from "@minecraft/server";
import type { Player, Dimension } from "@minecraft/server";
import { log } from "../lib/log";
import { rng, hash } from "./generator";

export { rng, hash } from "./generator";

/** Identifiant de la dimension minière (BP/dimensions/nalania_mines.json). */
export const MINES_DIMENSION_ID = "nalania:mines";

/** Y d'arrivée et couche du sol de la dimension minière. */
export const MINES_FLOOR_Y = 64;
/** Hauteur des cavernes creusées au-dessus du sol. */
export const MINES_HEIGHT = 24;
/** Taille du disque de spawn (plateforme d'arrivée autour de 0,0). */
export const MINES_SPAWN_RADIUS = 6;

/** Minerais : [bloc, veinSize, tentatives/chunk, yMin, yMax]. */
interface OreSpec { block: string; vein: number; tries: number; yMin: number; yMax: number; }
const ORES: OreSpec[] = [
  { block: "minecraft:coal_ore", vein: 10, tries: 26, yMin: MINES_FLOOR_Y, yMax: MINES_FLOOR_Y + MINES_HEIGHT },
  { block: "minecraft:iron_ore", vein: 8, tries: 22, yMin: MINES_FLOOR_Y, yMax: MINES_FLOOR_Y + MINES_HEIGHT },
  { block: "minecraft:copper_ore", vein: 9, tries: 18, yMin: MINES_FLOOR_Y, yMax: MINES_FLOOR_Y + MINES_HEIGHT },
  { block: "minecraft:gold_ore", vein: 7, tries: 12, yMin: MINES_FLOOR_Y + 4, yMax: MINES_FLOOR_Y + MINES_HEIGHT },
  { block: "minecraft:redstone_ore", vein: 8, tries: 12, yMin: MINES_FLOOR_Y, yMax: MINES_FLOOR_Y + 14 },
  { block: "minecraft:lapis_ore", vein: 7, tries: 9, yMin: MINES_FLOOR_Y + 2, yMax: MINES_FLOOR_Y + 18 },
  { block: "minecraft:emerald_ore", vein: 4, tries: 7, yMin: MINES_FLOOR_Y + 6, yMax: MINES_FLOOR_Y + MINES_HEIGHT },
  { block: "minecraft:diamond_ore", vein: 5, tries: 8, yMin: MINES_FLOOR_Y, yMax: MINES_FLOOR_Y + 12 },
];

/**
 * Liste publique des minerais de la dimension (affichage du menu).
 * « ×5 » = densité approximative par rapport à l'overworld.
 */
export const ORES_PUBLIC: Array<{ label: string; color: string }> = [
  { label: "Charbon ×5", color: "§8" },
  { label: "Fer ×5", color: "§f" },
  { label: "Cuivre ×4", color: "§6" },
  { label: "Or ×4", color: "§e" },
  { label: "Redstone ×4", color: "§c" },
  { label: "Lapis ×3", color: "§9" },
  { label: "Émeraude ×3", color: "§a" },
  { label: "Diamant ×3", color: "§b" },
];

/** Graine du monde (stable dans la session — Dynamic Properties interdit ici). */
let worldSeed = 1337;
/** Graine configurable : /scriptevent sn:seed <n> (avant la première génération). */
export function setMinesSeed(seed: number): void {
  worldSeed = seed >>> 0;
}

interface ChunkTask {
  cx: number;
  cz: number;
  steps: Array<() => void>;
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

  private readonly generated = new Set<string>();
  private readonly queue: ChunkTask[] = [];
  private queueRunning = false;

  constructor() {}

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
   * Téléporte le joueur aux mines (aller) ou le ramène dans l'overworld
   * à sa position d'entrée (retour). Renvoie le message de résultat.
   */
  toggle(player: Player): string {
    if (!this.isUsable()) return "§c[Mines] Le module Mines est désactivé (/sn:modules).";
    if (this.isInMines(player)) return this.exit(player);
    return this.enter(player);
  }

  /** Aller : mémorise le retour, téléporte au spawn des mines. */
  private enter(player: Player): string {
    const dimension = this.dimension();
    if (dimension === undefined) {
      return "§c[Mines] Dimension indisponible : vérifie que le pack déclare bien nalania:mines.";
    }

    // Mémorise la position de retour (dynamique property par joueur).
    try {
      player.setDynamicProperty("nalania:mines_return", JSON.stringify({
        dimensionId: player.dimension.id,
        x: player.location.x,
        y: player.location.y,
        z: player.location.z,
      }));
    } catch {
      // property indisponible : le retour ramènera au spawn du monde
    }

    const x = 0.5;
    const z = 0.5;
    // Le sol est généré par la file juste après l'arrivée : on téléporte
    // d'abord, la plateforme sera posée dans la même seconde (budget ticks).
    this.ensureChunk(0, 0, dimension);
    player.teleport({ x, y: MINES_FLOOR_Y + 1, z }, { dimension });
    try {
      player.addEffect("night_vision", 20 * 90, { amplifier: 0, showParticles: false });
    } catch {
      // effet indisponible : on ignore
    }
    this.scheduleChunkLoad(player);
    return `§a[Mines] Bienvenue dans les mines ! §7Retour : §f/sn:mine§7 à nouveau.`;
  }

  /** Retour : restaure la position mémorisée. */
  private exit(player: Player): string {
    let target: { dimensionId: string; x: number; y: number; z: number } | undefined;
    try {
      const raw = player.getDynamicProperty("nalania:mines_return");
      if (typeof raw === "string") target = JSON.parse(raw);
    } catch {
      target = undefined;
    }

    const dimension = target !== undefined ? world.getDimension(target.dimensionId) : undefined;
    if (dimension !== undefined && target !== undefined) {
      player.teleport({ x: target.x, y: target.y, z: target.z }, { dimension });
    } else {
      // Pas de position mémorisée : spawn de l'overworld.
      const overworld = world.getDimension("minecraft:overworld");
      player.teleport({ x: 0.5, y: 100, z: 0.5 }, { dimension: overworld });
    }
    return `§a[Mines] Tu es de retour à la surface.`;
  }

  /**
   * Programme la génération des chunks autour du joueur (rayon 2) —
   * chaque chunk est mis en file s'il n'est pas déjà généré.
   */
  private scheduleChunkLoad(player: Player): void {
    const dimension = this.dimension();
    if (dimension === undefined) return;

    const pcx = Math.floor(player.location.x / 16);
    const pcz = Math.floor(player.location.z / 16);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.ensureChunk(pcx + dx, pcz + dz, dimension);
      }
    }
  }

  /**
   * Met un chunk en file de génération (idempotent). La génération réelle
   * est étalée sur plusieurs ticks (budget BLOCKS_PER_TICK).
   */
  ensureChunk(cx: number, cz: number, dimension: Dimension): void {
    const key = `${dimension.id}:${cx}:${cz}`;
    if (this.generated.has(key)) return;

    const seed = hash(`${key}#${worldSeed}`);
    const random = rng(seed);
    const steps: Array<() => void> = [];

    // ---- Étape 1 : dalle de sol + plafond de pierre + colonnes ----
    steps.push(() => {
      const yF = MINES_FLOOR_Y;
      const yC = MINES_FLOOR_Y + MINES_HEIGHT;
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
          const wx = cx * 16 + x;
          const wz = cz * 16 + z;
          // Sol : pierre (2 couches) sur fond de deepslate.
          dimension.getBlock({ x: wx, y: yF, z: wz })?.setType("minecraft:stone");
          dimension.getBlock({ x: wx, y: yF - 1, z: wz })?.setType("minecraft:deepslate");
          // Plafond : pierre.
          dimension.getBlock({ x: wx, y: yC, z: wz })?.setType("minecraft:stone");
          dimension.getBlock({ x: wx, y: yC + 1, z: wz })?.setType("minecraft:bedrock");
        }
      }
    });

    // ---- Étape 2 : galeries creusées (2 couloirs croisés + salle centrale) ----
    steps.push(() => {
      const air = "minecraft:air";
      const clear = (x: number, y: number, z: number): void => {
        dimension.getBlock({ x, y, z })?.setType(air);
      };
      const yF = MINES_FLOOR_Y;

      // Couloir est-ouest et nord-sud (largeur 3, hauteur 3).
      for (let t = 0; t < 16; t++) {
        for (let w = -1; w <= 1; w++) {
          for (let h = 1; h <= 3; h++) {
            clear(cx * 16 + t, yF + h, cz * 16 + 8 + w);
            clear(cx * 16 + 8 + w, yF + h, cz * 16 + t);
          }
        }
      }
      // Salle centrale (5×5, hauteur 4) façon nœud de jonction.
      for (let x = 6; x <= 10; x++) {
        for (let z = 6; z <= 10; z++) {
          for (let h = 1; h <= 4; h++) {
            clear(cx * 16 + x, yF + h, cz * 16 + z);
          }
        }
      }
      // Poches aléatoires (creusent un peu plus).
      for (let p = 0; p < 4; p++) {
        const px = Math.floor(random() * 16);
        const pz = Math.floor(random() * 16);
        const py = yF + 1 + Math.floor(random() * (MINES_HEIGHT - 2));
        const r = 1 + Math.floor(random() * 2);
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              if (dx * dx + dy * dy + dz * dz <= r * r + 1) {
                clear(cx * 16 + px + dx, py + dy, cz * 16 + pz + dz);
              }
            }
          }
        }
      }
    });

    // ---- Étape 3 : veines de minerais (très généreuses) ----
    steps.push(() => {
      for (const ore of ORES) {
        for (let t = 0; t < ore.tries; t++) {
          const ox = cx * 16 + Math.floor(random() * 16);
          const oz = cz * 16 + Math.floor(random() * 16);
          const oy = ore.yMin + Math.floor(random() * (ore.yMax - ore.yMin));
          const count = 2 + Math.floor(random() * ore.vein);
          let px = ox;
          let py = oy;
          let pz = oz;
          for (let b = 0; b < count; b++) {
            const block = dimension.getBlock({ x: px, y: py, z: pz });
            if (block !== undefined && block.typeId === "minecraft:stone") {
              block.setType(ore.block);
            }
            px += Math.floor(random() * 3) - 1;
            py += Math.floor(random() * 3) - 1;
            pz += Math.floor(random() * 3) - 1;
          }
        }
      }
    });

    // ---- Étape 4 : torches (ambiance) + plateforme d'arrivée si (0,0) ----
    steps.push(() => {
      const yF = MINES_FLOOR_Y;
      // Torchères aux entrées des couloirs.
      const torches: Array<[number, number]> = [[8, 3], [8, 13], [3, 8], [13, 8]];
      for (const [tx, tz] of torches) {
        dimension.getBlock({ x: cx * 16 + tx, y: yF + 1, z: cz * 16 + tz })?.setType("minecraft:torch");
      }

      // Plateforme d'arrivée (seulement pour le chunk 0,0) : disque de
      // pierre polie autour de (0,0), air au-dessus, barrières.
      if (cx === 0 && cz === 0) {
        for (let x = -MINES_SPAWN_RADIUS; x <= MINES_SPAWN_RADIUS; x++) {
          for (let z = -MINES_SPAWN_RADIUS; z <= MINES_SPAWN_RADIUS; z++) {
            if (x * x + z * z <= MINES_SPAWN_RADIUS * MINES_SPAWN_RADIUS) {
              dimension.getBlock({ x, y: yF, z })?.setType("minecraft:polished_deepslate");
              for (let h = 1; h <= 4; h++) {
                dimension.getBlock({ x, y: yF + h, z })?.setType("minecraft:air");
              }
            }
          }
        }
        // Barrières basses autour du disque (sécurité anti-chute dans les
        // galeries adjacentes).
        for (let a = 0; a < 64; a++) {
          const angle = (a / 64) * Math.PI * 2;
          const bx = Math.round(Math.cos(angle) * MINES_SPAWN_RADIUS);
          const bz = Math.round(Math.sin(angle) * MINES_SPAWN_RADIUS);
          dimension.getBlock({ x: bx, y: yF + 1, z: bz })?.setType("minecraft:stone_brick_wall");
        }
        // Poteaux lumineux : 4 colonnes de lanternes.
        for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as Array<[number, number]>) {
          dimension.getBlock({ x: lx, y: yF + 1, z: lz })?.setType("minecraft:lantern");
          dimension.getBlock({ x: lx, y: yF + 2, z: lz })?.setType("minecraft:chain");
        }
      }
    });

    // Le chunk n'est marqué « généré » qu'après sa DERNIÈRE étape : si les
    // blocs ont échoué (chunks non chargés), la boucle d'entretien retentera.
    steps.push(() => {
      this.generated.add(key);
    });

    this.queue.push({ cx, cz, steps });
    this.pumpQueue();
  }

  /**
  * Exécute la file de génération — UNE étape par tick (anti-lag) : un
  * chunk complet prend 4 ticks (200 ms) ; le rayon exploré se remplit en
  * ~2,5 s sans jamais figer le serveur.
  */
  private pumpQueue(): void {
    if (this.queueRunning) return;
    this.queueRunning = true;

    const run = (): void => {
      if (this.queue.length === 0) {
        this.queueRunning = false;
        return;
      }
      const task = this.queue[0];
      const step = task.steps.shift();
      if (step !== undefined) {
        try {
          step();
        } catch (error: unknown) {
          log.warn(`Mines : étape de génération échouée (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      if (task.steps.length === 0) this.queue.shift();
      system.run(run);
    };
    system.run(run);
  }

  /**
   * Boucle d'entretien : régénère les chunks autour des joueurs présents
   * dans la dimension (si de nouveaux chunks sont explorés).
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
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            this.ensureChunk(pcx + dx, pcz + dz, dimension);
          }
        }
      }
    }, intervalTicks);
  }

  /** Sécurité : si un joueur tombe (faille), le ramène sur la plateforme. */
  registerFallRescue(intervalTicks = 20): void {
    system.runInterval(() => {
      if (!this.loaded || !this.isUsable()) return;
      for (const player of world.getAllPlayers()) {
        if (player.dimension.id !== MINES_DIMENSION_ID) continue;
        if (player.location.y < MINES_FLOOR_Y - 12) {
          player.teleport({ x: 0.5, y: MINES_FLOOR_Y + 1, z: 0.5 }, { dimension: this.dimension() });
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
