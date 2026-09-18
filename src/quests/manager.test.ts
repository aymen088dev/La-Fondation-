import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "../db/database";
import { MemoryStorageAdapter } from "../db/storage";
import { QuestManager } from "./manager";

function makeDb(): JsonDatabase {
  const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
  db.load();
  return db;
}

describe("Système de quêtes", () => {
  it("démarre automatiquement une piste au premier événement", () => {
    const quests = new QuestManager(makeDb());
    quests.markLoaded();
    const completed = quests.record("Aymen", "choose_class");
    expect(completed.map((quest) => quest.id)).toContain("first_route");
    expect(quests.isCompleted("Aymen", "first_route")).toBe(true);
  });

  it("ne distribue la récompense qu'une seule fois", () => {
    const quests = new QuestManager(makeDb());
    quests.record("Aymen", "enter_mines");
    expect(quests.claim("Aymen", "under_the_stone").ok).toBe(true);
    expect(quests.claim("Aymen", "under_the_stone").ok).toBe(false);
  });

  it("conserve une progression partielle", () => {
    const quests = new QuestManager(makeDb());
    quests.start("Aymen", "first_route");
    // La cible initiale vaut 1 : un événement la termine et la progression
    // est gardée dans l'état du joueur jusqu'à la récupération.
    expect(quests.progressOf("Aymen", "first_route")).toBe(0);
    quests.record("Aymen", "choose_class");
    expect(quests.progressOf("Aymen", "first_route")).toBe(1);
  });
});
