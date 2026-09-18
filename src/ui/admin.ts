import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { openWindow } from "./theme";
import type { HubDeps } from "./hub";
import { openRolesMenu } from "../permissions/ui";
import { openPlayersMenu } from "../permissions/players-ui";
import { openModulesMenu } from "../modules/ui";
import { openDbMenu } from "../db/menu";
import { openClassesMenu } from "../classes/ui";
import { canUseAdminPanel } from "../permissions/commands";

/**
 * Menu Admin (/sn:admin et entrée « Admin » du hub) — layout SIDEBAR.
 *
 * Sidebar : Rôles · Joueurs · Modules · Base de données.
 * Panneau  : état du serveur (en ligne, rôles, modules, DB).
 *
 * Garde-fou : réservé aux admins (rôle Admin ou op).
 */
export function openAdminMenu(player: Player, deps: HubDeps): void {
  const { permissions, modules, territories, db, classes } = deps;

  if (!canUseAdminPanel(player, permissions)) {
    player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
    return;
  }

  const stats = db?.stats();
  const online = world.getAllPlayers().length;
  const roleCount = permissions.allRoles().length;
  const stateCount = territories.all().length;
  const moduleCount = modules.enabledCount();

  void openWindow(player, "Administration", (form) => {
    // ---- Panneau de droite : état du serveur ----
    form.body(
      [
        `§6§lPanneau d'administration§r`,
        ``,
        `§eEn ligne : §f${online}`,
        `§eRôles : §f${roleCount}   §eÉtats : §f${stateCount}`,
        `§eModules actifs : §f${moduleCount}`,
        stats !== undefined
          ? `§eBase de données : §f${stats.documents} documents§7 (${stats.bytes} octets, ${stats.dirty ? "§eà sauvegarder§7" : "§aà jour§7"})`
          : `§eBase de données : §8index indisponible`,
        ``,
        `§8Choisis une section à gauche.`,
      ].join("\n"),
    );

    // ---- Sidebar ----
    form.header(`§6§lGestion`);

    form.button(`§6Rôles`, () => openRolesMenu(player, permissions));
    form.button(`§bJoueurs`, () => openPlayersMenu(player, permissions, db));
    form.button(`§dModules`, () => openModulesMenu(player, modules, territories));
    if (db !== undefined) {
      form.button(`§aBase de données`, () => {
        void openDbMenu(db, player);
      });
    }
    if (classes !== undefined) {
      form.button(`§dClasses (reset admin)`, () => openClassesMenu(player, classes, true));
    }
  }).catch((error: unknown) => console.warn(`[Admin] ${error instanceof Error ? error.message : String(error)}`));
}
