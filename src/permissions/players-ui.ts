import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import { openColorPicker, openPrefixMenu } from "./ui";
import { windowTitle, ICONS, openWindow, openWindowRaw, obString } from "../ui/theme";
import { allKnownPlayers } from "../players";
import type { JsonDatabase } from "../db/database";

/** Confirmation avant une action (placeholder conservé pour compat). */
export function confirmDialog(_player: Player, _title: string, _body: string): Promise<boolean> {
  return Promise.resolve(true);
}

/**
 * Menu Joueurs (admin) — DDUI, deux onglets :
 *  - 🟢 En ligne : les joueurs connectés en ce moment
 *  - 📜 Hors ligne : tout l'index DB (firstSeen, sessions), gérable pareil
 */
export function openPlayersMenu(player: Player, permissions: PermissionManager, db?: JsonDatabase): void {
  void openWindow(player, "Joueurs", (form) => {
    const online = world.getAllPlayers();
    form.header(`§b■ §lJoueurs`);
    form.label(
      `§a● En ligne : §f${online.length}\n§7● Connus (DB) : §f${db !== undefined ? allKnownPlayers(db).length : "?"}`,
    );
    form.divider();

    // --- Onglet 1 : joueurs en ligne ---
    form.label(`§a§l● En ligne§r §7(${online.length})`);
    if (online.length === 0) {
      form.label("§7Personne d'autre n'est connecté.");
    }
    for (const target of online) {
      const member = permissions.getMember(target.name);
      const role = permissions.getRole(member?.data.role ?? "");
      form.button(
        `${role?.data.color ?? "§7"}${target.name}§r\n§7${member?.data.role ?? "aucun rôle"}`,
        () => openPlayerConfigMenu(player, target.name, permissions, db),
      );
    }

    form.divider();

    // --- Onglet 2 : joueurs hors ligne (index DB) ---
    form.label(`§7§l● Hors ligne / historique§r §7(index complet)`);
    form.button(`§a■ Gérer un joueur hors ligne (saisir le pseudo)`, () =>
      openPlayerLookupMenu(player, permissions, db),
    );
    if (db !== undefined) {
      const known = allKnownPlayers(db).filter(
        (record) => !online.some((target) => target.name === record.data.name),
      );
      for (const record of known.slice(0, 15)) {
        const role = permissions.getRole(record.data.grade);
        const lastSeen = new Date(record.data.lastSeen);
        const hh = `${String(lastSeen.getHours()).padStart(2, "0")}:${String(lastSeen.getMinutes()).padStart(2, "0")}`;
        form.button(
          `§8${record.data.name}§r\n§7${record.data.grade !== "" ? role?.data.color + record.data.grade + "§7 · " : ""}${record.data.sessions} session(s) · vu à ${hh}`,
          () => openPlayerConfigMenu(player, record.data.name, permissions, db),
        );
      }
      if (known.length > 15) form.label(`§8… et ${known.length - 15} autres (recherche par pseudo)`);
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Saisie d'un pseudo pour gérer un joueur (même hors ligne). */
export function openPlayerLookupMenu(player: Player, permissions: PermissionManager, db?: JsonDatabase): void {
  const name = obString("");

  void openWindowRaw(player, windowTitle("Gérer un joueur"), (form) => {
    form.label("§7Fonctionne même si le joueur n'est pas connecté.");
    form.textField("§ePseudo du joueur", name);
    form.button(`§b■ Rechercher`, () => {
      const target = name.getData().trim();
      if (target !== "") openPlayerConfigMenu(player, target, permissions, db);
    });
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Fiche de configuration d'un joueur (en ligne OU hors ligne). */
export function openPlayerConfigMenu(
  player: Player,
  targetName: string,
  permissions: PermissionManager,
  db?: JsonDatabase,
): void {
  const member = permissions.getMember(targetName);
  const roleLabel =
    member === undefined ? "§7aucun" : `${permissions.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const colorLabel = member?.data.customColor ?? "(défaut du rôle)";
  const isOnline = world.getAllPlayers().some((candidate) => candidate.name === targetName);

  void openWindow(player, targetName, (form) => {
    form.header(`§b■ §l${targetName}§r ${isOnline ? "§a●" : "§8●"}`);
    form.label(`§7Rôle : ${roleLabel}\n§7Prefix perso : §f${prefixLabel}\n§7Couleur perso : §f${colorLabel}`);
    form.divider();
    form.button(`§e■ Attribuer / changer de rôle`, () =>
      openAssignRoleMenu(player, targetName, permissions, db),
    );
    form.button(`§e■ Prefix personnalisé`, () =>
      openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
        const result = permissions.setCustomPrefix(targetName, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }),
    );
    form.button(`§e■ Couleur de nom personnalisée`, () =>
      openColorPicker(player, `Couleur de ${targetName}`, (colorId) => {
        const result = permissions.setCustomColor(targetName, colorId);
        player.sendMessage(result.ok ? "§a[Rôles] Couleur mise à jour." : `§c[Rôles] ${result.error}`);
      }),
    );
    if (member !== undefined) {
      form.button(`§c■ Retirer tous les rôles`, () => {
        permissions.removeRole(targetName);
        player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
      });
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Choix du rôle à attribuer à un joueur. */
function openAssignRoleMenu(
  player: Player,
  targetName: string,
  permissions: PermissionManager,
  db?: JsonDatabase,
): void {
  const roles = permissions.allRoles();

  if (roles.length === 0) {
    player.sendMessage("§c[Rôles] Aucun rôle existant. Crée-en un d'abord (/sn:roles).");
    return;
  }

  void openWindow(player, `Rôle de ${targetName}`, (form) => {
    form.label("§7Choisis le rôle à attribuer :");
    for (const role of roles) {
      form.button(`${role.data.color}[${role.data.name}]§r\n§7niveau ${role.data.level}`, () => {
        const result = permissions.assignRole(targetName, role.data.name);
        player.sendMessage(
          result.ok
            ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.`
            : `§c[Rôles] ${result.error}`,
        );
      });
    }
    void db;
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Ré-export pour la compatibilité des imports. */
export { ROLE_COLORS, ICONS };
