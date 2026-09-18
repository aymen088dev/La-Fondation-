import { describe, expect, it } from "bun:test";
import { rng, hash } from "./generator";
import { MAX_CHUNKS_PER_TERRITORY } from "../territories/manager";

describe("Générateur des mines", () => {
  it("le RNG est déterministe : même graine → même séquence", () => {
    const a = rng(42);
    const b = rng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    // Et les valeurs sont bien dans [0,1)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("deux graines différentes donnent des séquences différentes", () => {
    const a = rng(1);
    const b = rng(2);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it("le hachage est stable et sensible", () => {
    expect(hash("nalania:mines:0:0#1337")).toBe(hash("nalania:mines:0:0#1337"));
    expect(hash("nalania:mines:0:0#1337")).not.toBe(hash("nalania:mines:0:1#1337"));
    expect(hash("abc")).not.toBe(hash("abd"));
  });

  it("la limite 3×3 du clan est bien de 9 chunks", () => {
    expect(MAX_CHUNKS_PER_TERRITORY).toBe(9);
  });
});
