import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { openTileMenu } from "./theme";
import { openHubMenu } from "./hub";
import type { HubDeps } from "./hub";
import { openStatesMenu } from "../territories/ui";
import { openRolesMenu } from "../permissions/ui";
import { openPlayersMenu } from "../permissions/players-ui";
import { openModulesMenu } from "../modules/ui";
import { openDbMenu } from "../db/menu";
import { openClassesMenu } from "../classes/ui";
import { canUseAdminPanel } from "../permissions/commands";

/**
 * Menu Admin (/sn:admin et entrée « Admin » du hub) — MENU À TUILES.
 *
 * Même géométrie que le hub (demandé « hub et admin similaires ») : fenêtre
 * or, six tuiles en colonne à gauche, état du serveur dans le panneau de
 * droite, barre de retour en bas.
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

  openTileMenu(player, "Administration", (menu) => {
    // ---- Panneau de droite : état du serveur ----
    menu.body(
      [
        `§6§lPanneau d'administration§r`,
        `§eEn ligne §f${online}   §eRôles §f${roleCount}   §eÉtats §f${stateCount}`,
        `§eModules actifs §f${moduleCount}`,
        stats !== undefined
          ? `§eBase de données §f${stats.documents} documents §7(${stats.bytes} octets, ${stats.dirty ? "§eà sauvegarder§7" : "§aà jour§7"})`
          : `§eBase de données §8index indisponible`,
      ].join("\n"),
    );

    // ---- Colonne de gauche ----
    menu.action("roles", `§6Rôles`, () => openRolesMenu(player, permissions));
    menu.action("players", `§bJoueurs`, () => openPlayersMenu(player, permissions, db));
    menu.action("modules", `§dModules`, () => openModulesMenu(player, modules, territories));
    menu.action("db", db !== undefined ? `§aBase de données` : `§8Base de données`, () => {
      if (db === undefined) {
        player.sendMessage("§8[Admin] Aucune base de données branchée sur ce serveur.");
        return;
      }
      void openDbMenu(db, player);
    });
    menu.action("classes", classes !== undefined ? `§dClasses (reset)` : `§8Classes`, () => {
      if (classes === undefined) {
        player.sendMessage("§8[Admin] Le module Classes n'est pas actif.");
        return;
      }
      openClassesMenu(player, classes, true, () => openAdminMenu(player, deps));
    });
    menu.action("states", `§6États`, () => openStatesMenu(player, territories));

    // ---- Barre du bas ----
    menu.action("back", `§7Retour au menu`, () => openHubMenu(player, deps));
  });
}
