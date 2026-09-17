import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "../db/database";
import { MemoryStorageAdapter } from "../db/storage";
import { ClassManager, classLevel, classProgress, XP_PER_LEVEL } from "./manager";
import { JobManager, jobLevel, JOB_XP_PER_LEVEL } from "../jobs/manager";

function makeDb(): JsonDatabase {
  const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
  db.load();
  return db;
}

describe("Module Classes", () => {
  it("paliers de niveau : 100 XP par niveau, départ niveau 1", () => {
    expect(classLevel(0)).toBe(1);
    expect(classLevel(99)).toBe(1);
    expect(classLevel(100)).toBe(2);
    expect(classLevel(250)).toBe(3);
    expect(classProgress(250)).toBe(50);
    expect(XP_PER_LEVEL).toBe(100);
  });

  it("le premier choix est accepté, le second refusé (définitif)", () => {
    const classes = new ClassManager(makeDb());
    classes.markLoaded();

    expect(classes.selectClass("Aymen", "guerrier").ok).toBe(true);
    expect(classes.classOf("Aymen")?.classId).toBe("guerrier");

    const second = classes.selectClass("Aymen", "mage");
    expect(second.ok).toBe(false);
    expect(classes.classOf("Aymen")?.classId).toBe("guerrier");
  });

  it("refuse une classe inconnue", () => {
    const classes = new ClassManager(makeDb());
    expect(classes.selectClass("Bob", "nécromant").ok).toBe(false);
    expect(classes.classOf("Bob")).toBeUndefined();
  });

  it("l'XP n'est comptée que pour un joueur avec classe", () => {
    const classes = new ClassManager(makeDb());
    expect(classes.addXp("SansClasse", 10)).toBe(false);

    classes.selectClass("Aymen", "mage");
    expect(classes.addXp("Aymen", 150)).toBe(true);
    expect(classes.classOf("Aymen")?.xp).toBe(150);
    expect(classLevel(150)).toBe(2);
  });

  it("clearClass (admin) permet de re-choisir", () => {
    const classes = new ClassManager(makeDb());
    classes.selectClass("Aymen", "archer");
    expect(classes.clearClass("Aymen")).toBe(true);
    expect(classes.classOf("Aymen")).toBeUndefined();
    expect(classes.selectClass("Aymen", "mage").ok).toBe(true);
  });

  it("countsByClass compte les choix", () => {
    const classes = new ClassManager(makeDb());
    classes.selectClass("A", "guerrier");
    classes.selectClass("B", "guerrier");
    classes.selectClass("C", "mage");
    expect(classes.countsByClass()).toEqual({ guerrier: 2, mage: 1 });
  });

  it("les mutations d'XP en place sont persistées (markDirty → save)", () => {
    const storage = new MemoryStorageAdapter();
    const db = new JsonDatabase(storage, "test");
    db.load();
    const classes = new ClassManager(db);
    classes.selectClass("Aymen", "guerrier");
    classes.addXp("Aymen", 40);
    db.save();

    const reloaded = new JsonDatabase(storage, "test");
    reloaded.load();
    expect(reloaded.findOne<{ xp: number }>("classes", "Aymen")?.data.xp).toBe(40);
  });
});

describe("Module Métiers (base vide)", () => {
  it("paliers de niveau métier : 50 XP", () => {
    expect(jobLevel(0)).toBe(1);
    expect(jobLevel(49)).toBe(1);
    expect(jobLevel(50)).toBe(2);
    expect(JOB_XP_PER_LEVEL).toBe(50);
  });

  it("aucun métier par défaut : jobsOf est vide et addXp échoue", () => {
    const jobs = new JobManager(makeDb());
    jobs.markLoaded();
    expect(jobs.jobsOf("Aymen")).toEqual([]);
    expect(jobs.hasJob("Aymen", "bucheron")).toBe(false);
    expect(jobs.addXp("Aymen", "bucheron", 10)).toBe(false);
    expect(jobs.quitJob("Aymen", "bucheron")).toBe(false);
  });

  it("les fondations acceptent un métier exercé (simulé comme le fera le futur catalogue)", () => {
    const db = makeDb();
    const jobs = new JobManager(db);
    db.insert("jobs", { playerName: "Aymen", jobId: "bucheron", xp: 0, startedAt: Date.now() }, "Aymen:bucheron");
    expect(jobs.hasJob("Aymen", "bucheron")).toBe(true);
    expect(jobs.addXp("Aymen", "bucheron", 60)).toBe(true);
    expect(jobs.jobsOf("Aymen")[0]?.xp).toBe(60);
    expect(jobLevel(60)).toBe(2);
    expect(jobs.quitJob("Aymen", "bucheron")).toBe(true);
    expect(jobs.jobsOf("Aymen")).toEqual([]);
  });
});
