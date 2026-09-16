import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "./database";
import { MemoryStorageAdapter, joinChunks, splitIntoChunks } from "./storage";

describe("JsonDatabase", () => {
  it("insère, retrouve, met à jour et supprime des documents", () => {
    const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
    db.load();

    const player = db.insert("players", { name: "Aymen", sessions: 1 }, "Aymen");
    expect(player.id).toBe("Aymen");
    expect(db.find("players").length).toBe(1);

    const updated = db.update<typeof player.data>("players", "Aymen", { sessions: 2 });
    expect(updated?.data.sessions).toBe(2);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(updated?.createdAt ?? 0);

    expect(db.findOne("players", "inconnu")).toBeUndefined();
    expect(db.delete("players", "Aymen")).toBe(true);
    expect(db.delete("players", "Aymen")).toBe(false);
    expect(db.find("players").length).toBe(0);
  });

  it("filtre les documents avec un prédicat", () => {
    const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
    db.load();

    db.insert("scores", { player: "Aymen", points: 42 });
    db.insert("scores", { player: "Lina", points: 99 });

    const top = db.find<{ player: string; points: number }>("scores", (doc) => doc.data.points > 50);
    expect(top.length).toBe(1);
    expect(top[0]?.data.player).toBe("Lina");
  });

  it("persiste les données dans le stockage et les recharge", () => {
    const storage = new MemoryStorageAdapter();
    const db = new JsonDatabase(storage, "test");
    db.load();
    db.insert("scores", { player: "Aymen", points: 42 });
    db.save();

    const reloaded = new JsonDatabase(storage, "test");
    reloaded.load();
    const docs = reloaded.find<{ player: string; points: number }>("scores");

    expect(docs.length).toBe(1);
    expect(docs[0]?.data.points).toBe(42);
    expect(reloaded.stats().documents).toBe(1);
  });

  it("refuse un id en double et gère upsert", () => {
    const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
    db.load();

    db.insert("players", { name: "Aymen", sessions: 1 }, "Aymen");
    expect(() => db.insert("players", { name: "Autre" }, "Aymen")).toThrow();

    // upsert : met à jour au lieu de doubler
    const upserted = db.upsert("players", "Aymen", { name: "Aymen", sessions: 5 });
    expect(upserted.data.sessions).toBe(5);
    expect(db.count("players")).toBe(1);

    // upsert : insère si absent
    db.upsert("players", "Lina", { name: "Lina", sessions: 1 });
    expect(db.count("players")).toBe(2);
  });

  it("ne sauvegarde que si la base a changé (dirty tracking)", () => {
    const storage = new MemoryStorageAdapter();
    const db = new JsonDatabase(storage, "test");
    db.load();

    expect(db.save()).toBe(false); // rien n'a changé
    db.insert("players", { name: "Aymen" });
    expect(db.stats().dirty).toBe(true);
    expect(db.save()).toBe(true);
    expect(db.stats().dirty).toBe(false);
    expect(db.save()).toBe(false); // toujours à jour
    expect(db.save(true)).toBe(true); // force = réécrit
  });

  it("count, clear et drop fonctionnent", () => {
    const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
    db.load();

    db.insert("scores", { player: "Aymen", points: 42 });
    db.insert("scores", { player: "Lina", points: 99 });
    db.insert("joueurs", { nom: "Aymen" });

    expect(db.count("scores")).toBe(2);
    expect(db.count<{ points: number }>("scores", (d) => d.data.points > 50)).toBe(1);

    expect(db.clear("scores")).toBe(2);
    expect(db.clear("scores")).toBe(0);
    expect(db.count("scores")).toBe(0);

    expect(db.drop("scores")).toBe(true);
    expect(db.drop("scores")).toBe(false);
    expect(db.stats().collections["scores"]).toBeUndefined();
  });

  it("tolère une base vide ou corrompue au chargement", () => {
    const storage = new MemoryStorageAdapter();
    const db = new JsonDatabase(storage, "test");
    db.load(); // vide : aucune erreur
    expect(db.stats().documents).toBe(0);

    storage.write("{ json invalide");
    const db2 = new JsonDatabase(storage, "test");
    db2.load(); // corrompue : warning, base vierge
    expect(db2.stats().documents).toBe(0);
  });
});

describe("Découpage en morceaux", () => {
  it("découpe et reconstitue fidèlement une grande chaîne", () => {
    const payload = "x".repeat(75_000) + "fin";
    expect(joinChunks(splitIntoChunks(payload))).toBe(payload);
    for (const chunk of splitIntoChunks(payload)) {
      expect(chunk.length).toBeLessThanOrEqual(30_000);
    }
  });
});
