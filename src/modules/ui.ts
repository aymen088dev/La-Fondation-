import type { Player } from "@minecraft/server";
import { openStatesMenu } from "../territories/ui";
import { openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import { MODULE_CATALOG } from "./manager";
import type { ModuleId, ModuleManager } from "./manager";
import type { TerritoryManager } from "../territories/manager";

/**
 * Nombre de modules affichés par page : 3 modules + pagination + « voir les
 * États » + suppression massive + retour = 8 tuiles, soit la capacité exacte de
 * la colonne (`PANEL_TILE_CAPACITY` dans `src/ui/tiles.ts`).
 */
export const MODULES_PER_PAGE = 3;

/**
 * Menu principal des modules — LISTE GÉNÉRIQUE (panneau console).
 *
 * Un clic sur une tuile bascule l'état du module (ON/OFF affiché dans le
 * libellé), puis le menu est rouvert sur la même page : l'action est
 * immédiatement visible, sans quitter la liste.
 */
export function openModulesMenu(
  player: Player,
  modules: ModuleManager,
  territories?: TerritoryManager,
  page = 0,
): void {
  const { items, page: current, pageCount } = pageSlice(MODULE_CATALOG, page, MODULES_PER_PAGE);

  openTileMenu(player, "Modules", (menu) => {
    menu.body(
      [
        "§6§lModules du serveur§r",
        `§7${modules.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s) — page §f${current + 1}§7/§f${pageCount}`,
        "",
        "§8Un clic bascule l'état du module (persisté).",
        "§8Modules désactivés : leurs commandes répondent « désactivé ».",
      ].join("\n"),
    );

    for (let slot = 0; slot < MODULES_PER_PAGE; slot++) {
      const info = items[slot];
      if (info === undefined) continue;
      const enabled = modules.isEnabled(info.id);
      menu.action(`module_${slot}`, `${enabled ? "§a[ON] §f" : "§8[OFF] §7"}${info.name}`, () => {
        const next = !modules.isEnabled(info.id);
        modules.setEnabled(info.id, next);
        player.sendMessage(`§a[Modules] ${info.name} ${next ? "§aactivé" : "§cdésactivé"}§a.`);
        openModulesMenu(player, modules, territories, current);
      });
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openModulesMenu(player, modules, territories, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openModulesMenu(player, modules, territories, current + 1);
    });
    menu.action("states", `§eVoir les États`, () => {
      if (territories !== undefined) openStatesMenu(player, territories);
    });
    menu.action("wipe", `§4Supprimer TOUS les États`, () => {
      if (territories !== undefined) openWipeTerritoriesMenu(player, modules, territories);
    });
    menu.action("back", `§7Retour`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}

/**
 * Fiche d'un module — même panneau que la liste (« Modules »), recentrée sur
 * un module : description, état, et bascule.
 */
export function openModuleConfigMenu(
  player: Player,
  moduleId: ModuleId,
  modules: ModuleManager,
  territories?: TerritoryManager,
): void {
  const info = MODULE_CATALOG.find((candidate) => candidate.id === moduleId);
  if (info === undefined) return;

  const enabled = modules.isEnabled(moduleId);

  openTileMenu(player, "Modules", (menu) => {
    menu.body(
      [
        `§6§l${info.name}§r`,
        `§7${info.description}`,
        "",
        `§7État : ${enabled ? "§aactivé" : "§cdésactivé"}`,
      ].join("\n"),
    );
    menu.action("toggle", enabled ? `§cDésactiver ce module` : `§aActiver ce module`, () => {
      const next = !modules.isEnabled(moduleId);
      modules.setEnabled(moduleId, next);
      player.sendMessage(`§a[Modules] ${info.name} ${next ? "§aactivé" : "§cdésactivé"}§a.`);
      openModuleConfigMenu(player, moduleId, modules, territories);
    });
    menu.action("list", `§eTous les modules`, () => openModulesMenu(player, modules, territories));
    menu.action("back", `§7Retour`, () => openModulesMenu(player, modules, territories));
  });
}

/** Confirmation de suppression massive des États (clans) — tuiles. */
function openWipeTerritoriesMenu(
  player: Player,
  modules: ModuleManager,
  territories: TerritoryManager,
): void {
  const count = territories.all().length;

  openTileMenu(player, "Dissoudre", (menu) => {
    menu.body(
      [
        "§4§lDANGER§r",
        `§7Supprimer §lTOUS§r§7 les États (§f${count}§7) ?`,
        "",
        "§cAction irréversible : les chunks redeviennent libres",
        "§cet les membres perdent leur clan.",
      ].join("\n"),
    );
    menu.action("confirm", `§4SUPPRIMER TOUT`, () => {
      let removed = 0;
      for (const territory of territories.all()) {
        if (territories.removeForced(territory.id)) removed++;
      }
      player.sendMessage(`§a[Modules] ${removed} État(s) supprimé(s).`);
    });
    menu.action("cancel", `§aAnnuler`, () => openModulesMenu(player, modules, territories));
    menu.action("back", `§7Retour`, () => openModulesMenu(player, modules, territories));
  });
}
