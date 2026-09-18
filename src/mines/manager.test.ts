import { describe, expect, it } from "bun:test";
import {
  rng,
  hash,
  planChunk,
  ORE_SPECS,
  averageOreCellsPerChunk,
  clipBox,
  spawnRingPositions,
  Y_STONE_MIN,
  Y_STONE_MAX,
  Y_GALLERY_AIR_MIN,
  Y_GALLERY_AIR_MAX,
} from "./generator";
import { MAX_CHUNKS_PER_TERRITORY } from "../territories/manager";

describe("Générateur des mines", () => {
  it("le RNG est déterministe : même graine → même séquence", () => {
    const a = rng(42);
    const b = rng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("le hachage est stable et sensible", () => {
    expect(hash("nalania:mines#1337#0:0")).toBe(hash("nalania:mines#1337#0:0"));
    expect(hash("nalania:mines#1337#0:0")).not.toBe(hash("nalania:mines#1337#0:1"));
  });

  it("le plan d'un chunk est déterministe (même graine → mêmes salles)", () => {
    const a = planChunk(1337, 3, -2);
    const b = planChunk(1337, 3, -2);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.veins).toEqual(b.veins);
    expect(a.corridorX).toEqual(b.corridorX);
  });

  it("les plans de chunks différents sont distincts", () => {
    const a = planChunk(1337, 0, 0);
    const b = planChunk(1337, 1, 0);
    expect(a.veins).not.toEqual(b.veins);
  });

  it("les salles sont intérieures au chunk et assez hautes", () => {
    for (const cx of [0, 1, -1, 5, -7]) {
      for (const cz of [0, 2, -3]) {
        const plan = planChunk(1337, cx, cz);
        for (const room of plan.rooms) {
          // Marge ≥ 1 du bord du chunk (continuité du mur de pierre).
          expect(room.x0).toBeGreaterThanOrEqual(cx * 16 + 1);
          expect(room.x1).toBeLessThanOrEqual(cx * 16 + 14);
          expect(room.z0).toBeGreaterThanOrEqual(cz * 16 + 1);
          expect(room.z1).toBeLessThanOrEqual(cz * 16 + 14);
          // Hauteur sous plafond : jamais plus haut que la couche plafond.
          expect(room.y1).toBeLessThan(72);
          // Au moins 4 blocs de haut (pas de tunnels à ramper).
          expect(room.y1 - room.y0 + 1).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("les galeries croisées traversent tout le chunk (continuité)", () => {
    const plan = planChunk(1337, 2, 2);
    expect(plan.corridorX.x0).toBe(32);
    expect(plan.corridorX.x1).toBe(47);
    expect(plan.corridorX.z0).toBe(39);
    expect(plan.corridorX.z1).toBe(41);
    expect(plan.corridorZ.z0).toBe(32);
    expect(plan.corridorZ.z1).toBe(47);
    // Hauteur de galerie : 6 blocs (marche + tête).
    expect(plan.corridorX.y1 - plan.corridorX.y0 + 1).toBe(6);
    expect(Y_GALLERY_AIR_MAX - Y_GALLERY_AIR_MIN + 1).toBe(6);
  });

  it("le budget de minerais est ÉQUILIBRÉ (plus que la surface, sans excès)", () => {
    const perChunk = averageOreCellsPerChunk();
    // Plus riche qu'un chunk d'overworld (~30-40 blocs de minerai visibles
    // en moyenne) mais très loin de l'ancien ~600 : fourchette 100..200.
    expect(perChunk).toBeGreaterThan(100);
    expect(perChunk).toBeLessThan(200);
  });

  it("chaque minerai a une bande de profondeur dans le corps de pierre", () => {
    for (const spec of ORE_SPECS) {
      expect(spec.yMin).toBeGreaterThanOrEqual(Y_STONE_MIN);
      expect(spec.yMax).toBeLessThanOrEqual(Y_STONE_MAX);
      expect(spec.tries).toBeGreaterThan(0);
      expect(spec.veinMin).toBeLessThanOrEqual(spec.veinMax);
    }
  });

  it("les diamants sont tout en bas (bande profonde)", () => {
    const diamond = ORE_SPECS.find((s) => s.block === "minecraft:diamond_ore");
    expect(diamond).toBeDefined();
    expect(diamond!.yMax).toBeLessThanOrEqual(14);
  });

  it("les veines restent dans leur chunk (marche bornée)", () => {
    const plan = planChunk(1337, -4, 7);
    for (const vein of plan.veins) {
      for (const cell of vein.cells) {
        expect(cell.x).toBeGreaterThanOrEqual(-64);
        expect(cell.x).toBeLessThanOrEqual(-49);
        expect(cell.z).toBeGreaterThanOrEqual(112);
        expect(cell.z).toBeLessThanOrEqual(127);
      }
    }
  });

  it("clipBox découpe correctement les boîtes par chunk", () => {
    const box = { x0: -8, x1: 8, y0: 5, y1: 10, z0: -8, z1: 8 };
    const p00 = clipBox(box, 0, 0);
    expect(p00).toEqual({ x0: 0, x1: 8, y0: 5, y1: 10, z0: 0, z1: 8 });
    const pneg = clipBox(box, -1, -1);
    expect(pneg).toEqual({ x0: -8, x1: -1, y0: 5, y1: 10, z0: -8, z1: -8 + 7 });
    expect(clipBox({ ...box, x0: 100, x1: 120 }, 0, 0)).toBeNull();
  });

  it("le muret du spawn est un cercle autour de l'origine", () => {
    const ring = spawnRingPositions();
    expect(ring.length).toBeGreaterThan(20);
    for (const pos of ring) {
      const dist = Math.hypot(pos.x, pos.z);
      expect(dist).toBeGreaterThan(6);
      expect(dist).toBeLessThan(10);
    }
  });

  it("la limite 3×3 du clan est bien de 9 chunks", () => {
    expect(MAX_CHUNKS_PER_TERRITORY).toBe(9);
  });
});
