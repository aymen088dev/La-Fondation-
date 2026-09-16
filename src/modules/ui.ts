import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { MODULE_CATALOG } from "./manager";
import type { ModuleId, ModuleManager } from "./manager";
import type { TerritoryManager } from "../territories/manager";

/**
 * Menu principal des modules : état on/off de chaque feature.
 * Donnera aussi accès à la config spécifique de chaque module.
 */
export function openModulesMenu(player: Player, modules: ModuleManager, territories?: TerritoryManager): void {
  const form = new ActionFormData()
    .title("§lGestionnaire de modules")
    .body(`§7${modules.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);

  for (const info of MODULE_CATALOG) {
    const enabled = modules.isEnabled(info.id);
    form.button(`${enabled ? "§a✔" : "§c✘"} ${info.name}§r\n§7${info.description}`);
  }
  form.button("§4Fermer");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= MODULE_CATALOG.length) return;

      const index = response.selection;
      const info = MODULE_CATALOG[index];
      if (info === undefined) return;

      openModuleConfigMenu(player, info.id, modules, territories);
    })
    .catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

/** Panneau de contrôle d'un module : toggle + actions spécifiques. */
export function openModuleConfigMenu(
  player: Player,
  moduleId: ModuleId,
  modules: ModuleManager,
  territories?: TerritoryManager,
): void {
  const info = MODULE_CATALOG.find((candidate) => candidate.id === moduleId);
  if (info === undefined) return;

  const enabled = modules.isEnabled(moduleId);

  const form = new ActionFormData()
    .title(`${enabled ? "§a✔" : "§c✘"} ${info.name}`)
    .body(`§7${info.description}\n\n§7État : ${enabled ? "§aactivé" : "§cdésactivé"}`)
    .button(enabled ? "§cDésactiver le module" : "§aActiver le module");

  // Actions spécifiques aux territoires
  if (moduleId === "territories" && territories !== undefined) {
    const territoryCount = territories.all().length;
    form.button(`§eVoir les territoires §7(${territoryCount})`);
    form.button("§4Supprimer TOUS les territoires");
  }

  form.button("§8← Retour");

  form
    .show(player)
    .then(async (response) => {
      if (response.canceled || response.selection === undefined) return;

      const toggleIndex = 0;
      const isTerritoryModule = moduleId === "territories" && territories !== undefined;
      const listIndex = isTerritoryModule ? 1 : -1;
      const wipeIndex = isTerritoryModule ? 2 : -1;
      const backIndex = isTerritoryModule ? 3 : 1;

      if (response.selection === toggleIndex) {
        modules.setEnabled(moduleId, !enabled);
        player.sendMessage(
          `§a[Modules] ${info.name} ${!enabled ? "§aactivé" : "§cdésactivé"}§a.`,
        );
        openModulesMenu(player, modules, territories);
      } else if (isTerritoryModule && response.selection === listIndex) {
        const { openTerritoriesMenu } = await import("../territories/ui");
        openTerritoriesMenu(player, territories!);
      } else if (isTerritoryModule && response.selection === wipeIndex) {
        openWipeTerritoriesMenu(player, modules, territories!);
      } else if (response.selection === backIndex) {
        openModulesMenu(player, modules, territories);
      }
    })
    .catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

/** Confirmation de suppression massive des territoires. */
function openWipeTerritoriesMenu(player: Player, modules: ModuleManager, territories: TerritoryManager): void {
  new MessageFormData()
    .title("§4⚠ DANGER")
    .body(`Supprimer §lTOUS§r§4 les territoires (${territories.all().length}) ?\n\nAction irréversible !`)
    .button2("§4SUPPRIMER TOUT")
    .button1("§aAnnuler")
    .show(player)
    .then((response) => {
      if (response.selection !== 1) return;

      let removed = 0;
      for (const territory of territories.all()) {
        if (territories.removeForced(territory.id)) removed++;
      }
      player.sendMessage(`§a[Modules] ${removed} territoire(s) supprimé(s).`);
      openModulesMenu(player, modules, territories);
    })
    .catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
