import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "../db/database";
import { MemoryStorageAdapter } from "../db/storage";
import {
  TerritoryManager,
  chunkKey,
  chunkKeyFromPosition,
  chunkCenter,
  parseChunkKey,
} from "./manager";

function makeManager(): TerritoryManager {
  const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
  db.load();
  return new TerritoryManager(db);
}

describe("Clés de chunks", () => {
  it("calcule la clé du chunk contenant une position (négatifs inclus)", () => {
    expect(chunkKeyFromPosition("minecraft:overworld", 5, -7)).toBe("minecraft:overworld:0:-1");
    expect(chunkKeyFromPosition("minecraft:overworld", 16, 0)).toBe("minecraft:overworld:1:0");
    expect(chunkKeyFromPosition("minecraft:overworld", -1, -1)).toBe("minecraft:overworld:-1:-1");
    expect(chunkKeyFromPosition("minecraft:the_nether", -33, 47)).toBe("minecraft:the_nether:-3:2");
  });

  it("décompose et recalcule le centre d'un chunk", () => {
    const key = chunkKey("minecraft:overworld", 12, -5);
    const parsed = parseChunkKey(key);
    expect(parsed).toEqual({ dimensionId: "minecraft:overworld", cx: 12, cz: -5 });

    const center = chunkCenter(key);
    expect(center.x).toBe(12 * 16 + 8);
    expect(center.z).toBe(-5 * 16 + 8);
  });
});

describe("TerritoryManager", () => {
  it("crée un territoire et l'applique au bon chunk", () => {
    const manager = makeManager();

    const result = manager.create("Aymen", "Fort Nord", "bleu", "minecraft:overworld", 10, 25);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.territory.data.owner).toBe("Aymen");
      expect(result.territory.data.chunkKeys).toEqual(["minecraft:overworld:0:1"]);
    }

    // Le chunk est protégé et Aymen y est autorisé
    expect(manager.isProtected("minecraft:overworld:0:1")).toBe(true);
    expect(manager.isAllowed("Aymen", "minecraft:overworld:0:1")).toBe(true);
    // Lina non
    expect(manager.isAllowed("Lina", "minecraft:overworld:0:1")).toBe(false);
    // Chunk voisin libre : tout le monde y est autorisé
    expect(manager.isAllowed("Lina", "minecraft:overworld:0:2")).toBe(true);
  });

  it("applique les règles de validation à la création", () => {
    const manager = makeManager();
    manager.create("Aymen", "Fort Nord", "bleu", "minecraft:overworld", 0, 0);

    // 1 territoire par joueur
    expect(manager.create("Aymen", "Autre", "rouge", "minecraft:overworld", 100, 100).ok).toBe(false);
    // Chunk déjà pris
    expect(manager.create("Lina", "Vol", "rouge", "minecraft:overworld", 5, 5).ok).toBe(false);
    // Nom trop court
    expect(manager.create("Lina", "ab", "rouge", "minecraft:overworld", 200, 200).ok).toBe(false);
    // Nom invalide
    expect(manager.create("Lina", "Mauvais<Nom>", "rouge", "minecraft:overworld", 200, 200).ok).toBe(false);
    // Nom en double (les ids de collection sont les noms)
    expect(manager.create("Lina", "Fort Nord", "rouge", "minecraft:overworld", 200, 200).ok).toBe(false);
    // Création valide après tout ça
    expect(manager.create("Lina", "Bastion Sud", "or", "minecraft:overworld", 200, 200).ok).toBe(true);
  });

  it("permet au propriétaire de supprimer son territoire, pas aux autres", () => {
    const manager = makeManager();
    manager.create("Aymen", "Fort Nord", "bleu", "minecraft:overworld", 0, 0);

    expect(manager.remove("Fort Nord", "Lina")).toBe(false);
    expect(manager.isProtected("minecraft:overworld:0:0")).toBe(true);

    expect(manager.remove("Fort Nord", "Aymen")).toBe(true);
    expect(manager.isProtected("minecraft:overworld:0:0")).toBe(false);
  });

  it("addChunk respecte le carré 3×3 autour du chunk fondateur", () => {
    const manager = makeManager();
    manager.create("Aymen", "Empire", "vert", "minecraft:overworld", 0, 0);

    // Dans le carré : ok
    expect(manager.addChunk("Empire", chunkKey("minecraft:overworld", 1, 0)).ok).toBe(true);
    // Doublon : refusé
    expect(manager.addChunk("Empire", chunkKey("minecraft:overworld", 1, 0)).ok).toBe(false);
    // Hors du carré : refusé
    expect(manager.addChunk("Empire", chunkKey("minecraft:overworld", 2, 0)).ok).toBe(false);
    expect(manager.addChunk("Empire", chunkKey("minecraft:overworld", 0, -2)).ok).toBe(false);
    // Autre dimension : refusé
    expect(manager.addChunk("Empire", chunkKey("minecraft:the_nether", 1, 0)).ok).toBe(false);
    // Coin du carré : ok
    expect(manager.addChunk("Empire", chunkKey("minecraft:overworld", -1, -1)).ok).toBe(true);
    expect(manager.findByOwner("Aymen")?.data.chunkKeys.length).toBe(3);
  });

  it("leave retire un membre mais pas le chef", () => {
    const manager = makeManager();
    manager.create("Aymen", "Empire", "vert", "minecraft:overworld", 0, 0);
    manager.addMember("Empire", "id-lina", "Lina");

    expect(manager.leave("Empire", "id-inconnu")).toBe(false);
    expect(manager.leave("Empire", "id-lina")).toBe(true);
    expect(manager.findByOwner("Aymen")?.data.members.length).toBe(0);
    // Le clan existe toujours après le départ du membre.
    expect(manager.findByOwner("Aymen")).not.toBeUndefined();
  });

  it("remove accepte le chef par id Bedrock (v3)", () => {
    const manager = makeManager();
    manager.create("Aymen", "Empire", "vert", "minecraft:overworld", 0, 0, "id-aymen");

    // Le pseudo a changé mais l'id Bedrock correspond : dissolution OK.
    expect(manager.remove("Empire", "AutrePseudo", "id-aymen")).toBe(true);
    expect(manager.findByOwner("Aymen")).toBeUndefined();
  });
});
