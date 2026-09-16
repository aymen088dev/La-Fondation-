import { describe, expect, it } from "bun:test";
import { JsonDatabase } from "../db/database";
import { MemoryStorageAdapter } from "../db/storage";
import { PermissionManager } from "./manager";

function makePermissions(): PermissionManager {
  const db = new JsonDatabase(new MemoryStorageAdapter(), "test");
  db.load();
  return new PermissionManager(db);
}

describe("Permissions fines", () => {
  it("les perms par défaut suivent le niveau du rôle", () => {
    const permissions = makePermissions();
    expect(permissions.createRole("Joueur", "§f", 0).ok).toBe(true);
    expect(permissions.createRole("Modo", "§9", 60).ok).toBe(true);
    expect(permissions.createRole("Admin2", "§c", 100).ok).toBe(true);

    const joueur = permissions.roleOf("x");
    void joueur;

    const playerRole = permissions.getRole("Joueur")?.data;
    const modoRole = permissions.getRole("Modo")?.data;
    const adminRole = permissions.getRole("Admin2")?.data;

    expect(playerRole?.perms).toContain("territories.create");
    expect(playerRole?.perms).not.toContain("mod.ban");
    expect(modoRole?.perms).toContain("mod.ban");
    expect(modoRole?.perms).toContain("mod.kick");
    expect(adminRole?.perms).toContain("mod.ban");
  });

  it("can() respecte le niveau et la sémantique additive", () => {
    const permissions = makePermissions();
    permissions.createRole("Modo", "§9", 60);
    permissions.assignRole("Lina", "Modo");

    expect(permissions.can("Lina", "mod.ban")).toBe(true);
    expect(permissions.can("Lina", "mod.panel")).toBe(true);
    expect(permissions.can("Lina", "territories.create")).toBe(true);

    // Joueur sans rôle : rien.
    expect(permissions.can("Inconnu", "mod.ban")).toBe(false);
    expect(permissions.can("Inconnu", "territories.create")).toBe(false);

    // Op vanilla : bypass.
    expect(permissions.can("Inconnu", "mod.ban", true)).toBe(true);
  });

  it("un rôle niveau 0 peut recevoir mod.ban (sémantique additive)", () => {
    const permissions = makePermissions();
    permissions.createRole("Gardien", "§2", 0);
    permissions.assignRole("Bob", "Gardien");

    expect(permissions.can("Bob", "mod.ban")).toBe(false);
    expect(permissions.grantPermission("Gardien", "mod.ban").ok).toBe(true);
    expect(permissions.can("Bob", "mod.ban")).toBe(true);
    expect(permissions.revokePermission("Gardien", "mod.ban").ok).toBe(true);
    expect(permissions.can("Bob", "mod.ban")).toBe(false);
  });

  it("setRolePermissions filtre les ids inconnus", () => {
    const permissions = makePermissions();
    permissions.createRole("Test", "§f", 10);
    const result = permissions.setRolePermissions("Test", ["mod.ban", "hack.superman", "chat.color"]);
    expect(result.ok).toBe(true);
    expect(permissions.getRole("Test")?.data.perms).toEqual(["mod.ban", "chat.color"]);
  });

  it("un grade mémorise playerId et le role par id fonctionne", () => {
    const permissions = makePermissions();
    permissions.createRole("VIP", "§6", 10);
    permissions.assignRole("Aymen", "VIP", "bedrock-id-123");

    const member = permissions.getMember("Aymen");
    expect(member?.data.playerId).toBe("bedrock-id-123");

    expect(permissions.roleOfId("bedrock-id-123")?.data.name).toBe("VIP");
    expect(permissions.roleOfId("inconnu")).toBeUndefined();
  });

  it("roleCan : admin (>=100) a tout, même hors catalogue par défaut", () => {
    const permissions = makePermissions();
    permissions.createRole("Boss", "§c", 100);
    const role = permissions.getRole("Boss")?.data;
    expect(role !== undefined && permissions.roleCan(role, "mod.ban")).toBe(true);
  });

  it("les mutations en place sont bien persistées (touch → dirty → save)", () => {
    const storage = new MemoryStorageAdapter();
    const db = new JsonDatabase(storage, "test");
    db.load();
    const permissions = new PermissionManager(db);
    permissions.createRole("Test", "§f", 10);
    db.save();
    const afterCreate = storage.read() ?? "";
    expect(afterCreate).not.toContain("rouge");

    // Mutation en place : setRoleColor → touch() (dirty) → save() interne.
    // Sans touch(), le save interne serait parti sans rien écrire (bug).
    permissions.setRoleColor("Test", "rouge");
    const afterChange = storage.read() ?? "";
    expect(afterChange).toContain("§c"); // la nouvelle couleur EST stockée

    // Rechargement depuis le stockage : la couleur a survécu.
    const reloaded = new JsonDatabase(storage, "test");
    reloaded.load();
    expect(reloaded.findOne<{ color: string }>("roles", "Test")?.data.color).toBe("§c");
  });
});
