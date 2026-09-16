import { describe, expect, it } from "bun:test";
import { migrateDatabase } from "./migrations";
import { DB_SCHEMA_VERSION } from "./types";
import type { DatabaseFile } from "./types";

/** Fabrique un fichier DB v2 minimal (pré-v3). */
function v2File(): DatabaseFile {
  return {
    schemaVersion: 2,
    name: "test",
    savedAt: 0,
    collections: {
      roles: [
        {
          id: "Modo",
          createdAt: 1,
          updatedAt: 1,
          data: { name: "Modo", color: "§9", prefix: "[Modo]", level: 60 },
        },
      ],
      members: [
        { id: "Aymen", createdAt: 1, updatedAt: 1, data: { name: "Aymen", role: "Modo" } },
      ],
      bans: [
        { id: "Griefer", createdAt: 2, updatedAt: 2, data: { name: "Griefer", reason: "grief", by: "Admin", at: 2, expiresAt: 0 } },
      ],
      warns: [
        { id: "w1", createdAt: 3, updatedAt: 3, data: { name: "Steve", reason: "spam", by: "Modo", at: 3 } },
      ],
    },
  };
}

describe("migrateDatabase v2 → v3", () => {
  it("ajoute perms[] aux rôles selon le niveau", () => {
    const file = migrateDatabase(v2File());
    const role = file.collections["roles"]?.[0]?.data as Record<string, unknown>;
    const perms = role["perms"] as string[];
    expect(Array.isArray(perms)).toBe(true);
    expect(perms).toContain("mod.ban");
    expect(perms).toContain("mod.kick");
    expect(perms).toContain("chat.color"); // base incluse à tous les niveaux
    expect(perms).toContain("territories.create");
  });

  it("n'écrase pas une perms[] existante", () => {
    const file = v2File();
    (file.collections["roles"]?.[0]?.data as Record<string, unknown>)["perms"] = ["mod.ban"];
    const migrated = migrateDatabase(file);
    const perms = (migrated.collections["roles"]?.[0]?.data as Record<string, unknown>)["perms"] as string[];
    expect(perms).toEqual(["mod.ban"]);
  });

  it("enrichit members avec playerId et firstSeen", () => {
    const file = migrateDatabase(v2File());
    const member = file.collections["members"]?.[0]?.data as Record<string, unknown>;
    expect(member["playerId"]).toBeNull();
    expect(member["firstSeen"]).toBe(1);
  });

  it("enrichit bans et warns avec playerId null", () => {
    const file = migrateDatabase(v2File());
    const ban = file.collections["bans"]?.[0]?.data as Record<string, unknown>;
    const warn = file.collections["warns"]?.[0]?.data as Record<string, unknown>;
    expect(ban["playerId"]).toBeNull();
    expect(warn["playerId"]).toBeNull();
  });

  it("met la version à jour et reste stable si déjà migré", () => {
    const file = migrateDatabase(v2File());
    expect(file.schemaVersion).toBe(DB_SCHEMA_VERSION);
    const before = JSON.stringify(file);
    expect(JSON.stringify(migrateDatabase(file))).toBe(before);
  });
});
