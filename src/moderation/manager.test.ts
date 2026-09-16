import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "../db/database";
import { MemoryStorageAdapter } from "../db/storage";
import { SanctionsManager, formatDuration } from "./manager";

function makeSanctions(): SanctionsManager {
  const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
  db.load();
  return new SanctionsManager(db);
}

describe("formatDuration", () => {
  it("formate les durées", () => {
    expect(formatDuration(0)).toBe("permanent");
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(90)).toBe("1 h 30 min");
    expect(formatDuration(120)).toBe("2 h");
  });
});

describe("SanctionsManager", () => {
  it("ban, débannit et purge les bans expirés", () => {
    const sanctions = makeSanctions();

    expect(sanctions.ban("Griefer", "Admin", "grief spawn").ok).toBe(true);
    expect(sanctions.isBanned("Griefer")).toBe(true);
    expect(sanctions.getBan("Griefer")?.reason).toBe("grief spawn");

    // Ban expiré : purgé à la lecture
    sanctions.ban("Temporaire", "Admin", "test", 10);
    const ban = sanctions.db.findOne<{ expiresAt: number }>("bans", "Temporaire");
    if (ban !== undefined) ban.data.expiresAt = Date.now() - 1000;
    expect(sanctions.isBanned("Temporaire")).toBe(false);

    expect(sanctions.unban("Griefer").ok).toBe(true);
    expect(sanctions.isBanned("Griefer")).toBe(false);
    expect(sanctions.unban("Griefer").ok).toBe(false);
  });

  it("mute avec expiration et unmute", () => {
    const sanctions = makeSanctions();

    expect(sanctions.mute("Spamer", "Modo", "spam", 30).ok).toBe(true);
    expect(sanctions.isMuted("Spamer")).toBe(true);
    expect(sanctions.getMute("Spamer")?.expiresAt).toBeGreaterThan(Date.now());

    // Mute expiré
    const mute = sanctions.db.findOne<{ expiresAt: number }>("mutes", "Spamer");
    if (mute !== undefined) mute.data.expiresAt = Date.now() - 1000;
    expect(sanctions.isMuted("Spamer")).toBe(false);

    expect(sanctions.unmute("Spamer").ok).toBe(false); // déjà purgé
    sanctions.mute("Autre", "Modo", "test", 0);
    expect(sanctions.unmute("Autre").ok).toBe(true);
  });

  it("warns : comptage et pardon du dernier", () => {
    const sanctions = makeSanctions();

    sanctions.warn("Steve", "Admin", "insulte");
    sanctions.warn("Steve", "Admin", "spam");
    expect(sanctions.warnsOf("Steve").length).toBe(2);

    expect(sanctions.clearLastWarn("Steve")).toBe(true);
    expect(sanctions.warnsOf("Steve").length).toBe(1);
    expect(sanctions.warnsOf("Steve")[0]?.data.reason).toBe("insulte");
    expect(sanctions.clearLastWarn("Inconnu")).toBe(false);
  });

  it("historique journalise tout, du plus récent au plus ancien", () => {
    const sanctions = makeSanctions();

    sanctions.ban("Lina", "Admin", "test ban", 60);
    sanctions.mute("Lina", "Modo", "test mute", 30);
    sanctions.warn("Lina", "Admin", "test warn");

    const history = sanctions.historyOf("Lina");
    expect(history.length).toBe(3);
    expect(history[0]?.data.kind).toBe("warn"); // le plus récent
    expect(history[2]?.data.kind).toBe("ban");

    const stats = sanctions.stats();
    expect(stats.bans).toBe(1);
    expect(stats.mutes).toBe(1);
    expect(stats.warns).toBe(1);
  });

  it("refuse les pseudos vides", () => {
    const sanctions = makeSanctions();
    expect(sanctions.ban("", "Admin", "x").ok).toBe(false);
    expect(sanctions.mute("  ", "Admin", "x", 10).ok).toBe(false);
    expect(sanctions.warn("", "Admin", "x").ok).toBe(false);
  });
});
