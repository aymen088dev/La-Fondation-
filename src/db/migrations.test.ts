import { describe, expect, it } from "bun:test";
import { migrateDatabase } from "./migrations";
import { DB_SCHEMA_VERSION } from "./types";
import type { DatabaseFile } from "./types";

/** Fabrique un fichier DB v1 minimal. */
function v1File(): DatabaseFile {
  return {
    schemaVersion: 1,
    name: "test",
    savedAt: 0,
    collections: {
      role_members: [
        { id: "Aymen", createdAt: 1, updatedAt: 1, data: { name: "Aymen", role: "Admin" } },
      ],
      players: [{ id: "Aymen", createdAt: 5, updatedAt: 9, data: { name: "Aymen", sessions: 3 } }],
      territories: [
        {
          id: "Fort",
          createdAt: 2,
          updatedAt: 2,
          data: { name: "Fort", owner: "Lina", color: "rouge", chunkKeys: ["minecraft:overworld:0:0"], createdAt: 2 },
        },
      ],
    },
  };
}

describe("migrateDatabase v1 → v2", () => {
  it("renomme role_members en members", () => {
    const file = migrateDatabase(v1File());
    expect(file.collections["role_members"]).toBeUndefined();
    expect(file.collections["members"]?.[0]?.id).toBe("Aymen");
    expect(file.collections["members"]?.[0]?.data.role).toBe("Admin");
  });

  it("convertit players en players_index avec id name:<pseudo>", () => {
    const file = migrateDatabase(v1File());
    const entry = file.collections["players_index"]?.[0];
    expect(entry?.id).toBe("name:Aymen");
    expect(entry?.data.playerId).toBeNull();
    expect(entry?.data.sessions).toBe(3);
    expect(entry?.data.firstSeen).toBe(5);
    expect(file.collections["players"]).toBeUndefined();
  });

  it("enrichit les territoires avec ownerId/ownerName/members", () => {
    const file = migrateDatabase(v1File());
    const territory = file.collections["territories"]?.[0]?.data as Record<string, unknown>;
    expect(territory["ownerName"]).toBe("Lina");
    expect(territory["ownerId"]).toBe("name:Lina");
    expect(Array.isArray(territory["members"])).toBe(true);
  });

  it("met la version à jour et reste stable si déjà migré", () => {
    const file = migrateDatabase(v1File());
    expect(file.schemaVersion).toBe(DB_SCHEMA_VERSION);
    const before = JSON.stringify(file);
    expect(JSON.stringify(migrateDatabase(file))).toBe(before);
  });

  it("fusionne sans doublon si members existe déjà", () => {
    const file = v1File();
    file.collections["members"] = [
      { id: "Zed", createdAt: 1, updatedAt: 1, data: { name: "Zed", role: "Modo" } },
    ];
    const migrated = migrateDatabase(file);
    const ids = migrated.collections["members"]?.map((doc) => doc.id);
    expect(ids).toContain("Zed");
    expect(ids).toContain("Aymen");
    expect(migrated.collections["members"]?.length).toBe(2);
  });
});
