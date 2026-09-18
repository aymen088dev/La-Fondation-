/**
 * Générateur PUR des mines — SANS dépendance @minecraft/server
 * (testable sous bun test). Le déterminisme (même graine → mêmes mines)
 * est la propriété clé : deux mondes avec la même graine produisent des
 * mines identiques.
 *
 * v19.1 — MINE SOLIDE (à la demande) :
 *  - PAS de salles, PAS de galeries pré-creusées : la dimension est un
 *    BLOC DE PIERRE PLEIN (y 2 → 71, 70 couches) entre deux lits de
 *    bedrock. C'est au joueur de creuser ses propres galeries à la pioche.
 *  - SEULE exception : la poche de spawn (plateforme 3 blocs de haut,
 *    éclairée) pour arriver dans un espace vivable.
 *  - minerais ÉQUILIBRÉS (~150 blocs/chunk, répartis par profondeur) :
 *    plus riches que la surface, sans excès.
 */

/** Petit RNG déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage FNV-1a 32 bits (pour la graine par chunk). */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Géométrie verticale de la dimension (BP/dimensions/nalania_mines.json)
// ---------------------------------------------------------------------------

/** Sol indestructible : y 0..1 (bedrock). */
export const Y_BEDROCK_MAX = 1;
/** Corps de pierre PLEIN : y 2..71 (70 couches à miner). */
export const Y_STONE_MIN = 2;
export const Y_STONE_MAX = 71;
/** Plafond indestructible : bedrock (une couche). */
export const Y_CEIL_BEDROCK = 72;
/** Sol de la poche de spawn : la pierre s'arrête à y 4 (marche sur y 5). */
export const Y_POCKET_FLOOR = 4;
/** Air de la poche de spawn : y 5..7 (3 blocs de haut). */
export const Y_POCKET_AIR_MIN = 5;
export const Y_POCKET_AIR_MAX = 7;
/** Position des pieds du joueur à l'arrivée. */
export const Y_SPAWN_FEET = 5;

// ---------------------------------------------------------------------------
// Minerais — ÉQUILIBRÉS (~150 blocs/chunk en moyenne, vs ~600 avant)
// ---------------------------------------------------------------------------

/** Spécification d'un minerai : bande Y, taille de veine, tentatives/chunk. */
export interface OreSpec {
  block: string;
  tries: number;
  veinMin: number;
  veinMax: number;
  yMin: number;
  yMax: number;
}

/** Répartition par profondeur : diamant/redstone tout en bas, cuivre au-dessus. */
export const ORE_SPECS: OreSpec[] = [
  { block: "minecraft:coal_ore", tries: 8, veinMin: 4, veinMax: 9, yMin: Y_STONE_MIN, yMax: Y_STONE_MAX },
  { block: "minecraft:copper_ore", tries: 5, veinMin: 4, veinMax: 9, yMin: 10, yMax: 60 },
  { block: "minecraft:iron_ore", tries: 6, veinMin: 3, veinMax: 6, yMin: Y_STONE_MIN, yMax: 64 },
  { block: "minecraft:gold_ore", tries: 3, veinMin: 2, veinMax: 5, yMin: Y_STONE_MIN, yMax: 28 },
  { block: "minecraft:redstone_ore", tries: 3, veinMin: 4, veinMax: 7, yMin: Y_STONE_MIN, yMax: 20 },
  { block: "minecraft:lapis_ore", tries: 2, veinMin: 3, veinMax: 6, yMin: 6, yMax: 30 },
  { block: "minecraft:diamond_ore", tries: 2, veinMin: 1, veinMax: 4, yMin: Y_STONE_MIN, yMax: 14 },
  { block: "minecraft:emerald_ore", tries: 2, veinMin: 1, veinMax: 1, yMin: 20, yMax: 60 },
];

// ---------------------------------------------------------------------------
// Plan d'un chunk (pur — exécutable par le manager)
// ---------------------------------------------------------------------------

export interface Vec3 { x: number; y: number; z: number; }

/** Boîte alignée aux axes (coordonnées monde inclusives). */
export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; }

/** Veine de minerai : bloc + liste de cellules (à ne peindre que sur pierre). */
export interface OreVein { block: string; cells: Vec3[]; }

/** Plan complet d'un chunk de mine : uniquement ses veines de minerais. */
export interface ChunkPlan {
  cx: number;
  cz: number;
  /** Veines de minerais (marche aléatoire bornée dans le chunk). */
  veins: OreVein[];
}

/** Détache un point du bord d'une veine (-1, 0 ou +1). */
function rndOffset(rand: () => number): number {
  return Math.floor(rand() * 3) - 1;
}

/**
 * Plan de génération d'un chunk : déterministe (même graine → même plan).
 * Le chunk est un bloc de pierre plein ; seul le mineraillage est planifié.
 */
export function planChunk(seed: number, cx: number, cz: number): ChunkPlan {
  const rand = rng(hash(`nalania:mines#${seed}#${cx}:${cz}`));
  const ox = cx * 16;
  const oz = cz * 16;

  // Veines de minerais (marche aléatoire bornée dans le corps de pierre).
  const veins: OreVein[] = [];
  for (const spec of ORE_SPECS) {
    for (let t = 0; t < spec.tries; t++) {
      const size = spec.veinMin + Math.floor(rand() * (spec.veinMax - spec.veinMin + 1));
      const cells: Vec3[] = [];
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

/**
 * Nombre MOYEN de cellules de minerai par chunk (pour tests d'équilibre).
 * Compte chaque veine à sa taille nominale (les marches aléatoires peuvent
 * répéter des cellules — l'exécution ne peint que la pierre, donc jamais
 * de surcomptage réel).
 */
export function averageOreCellsPerChunk(): number {
  let total = 0;
  for (const spec of ORE_SPECS) {
    const midVein = (spec.veinMin + spec.veinMax) / 2;
    total += spec.tries * midVein;
  }
  return Math.round(total);
}

/** Découpe une boîte à l'intérieur d'un chunk (null si aucune intersection). */
export function clipBox(box: Box, cx: number, cz: number): Box | null {
  const x0 = Math.max(box.x0, cx * 16);
  const x1 = Math.min(box.x1, cx * 16 + 15);
  const z0 = Math.max(box.z0, cz * 16);
  const z1 = Math.min(box.z1, cz * 16 + 15);
  if (x0 > x1 || z0 > z1 || box.y0 > box.y1) return null;
  return { x0, x1, y0: box.y0, y1: box.y1, z0, z1 };
}

// ---------------------------------------------------------------------------
// Poche de spawn (seul volume en air de la dimension)
// ---------------------------------------------------------------------------

/** Rayon de la plateforme d'arrivée (cercle (2r+1)×(2r+1) autour de 0,0). */
export const SPAWN_RADIUS = 8;

/** Contour circulaire de la plateforme (positions x,z du muret). */
export function spawnRingPositions(): Vec3[] {
  const positions: Vec3[] = [];
  const seen = new Set<string>();
  for (let a = 0; a < 72; a++) {
    const angle = (a / 72) * Math.PI * 2;
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
