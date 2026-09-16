import { MessageFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { ICONS, openWindow, obToggle } from "../ui/theme";
import { MODULE_CATALOG } from "./manager";
import type { ModuleId, ModuleManager } from "./manager";
import type { TerritoryManager } from "../territories/manager";

/**
 * Menu principal des modules : état on/off de chaque feature — DDUI
 * avec toggles réactifs persistés instantanément.
 */
export function openModulesMenu(player: Player, modules: ModuleManager, territories?: TerritoryManager): void {
  void openWindow(player, "Modules", (form) => {
    form.header(`§6■ §lModules`);
    form.label(`§7${modules.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);
    form.divider();

    for (const info of MODULE_CATALOG) {
      const enabled = modules.isEnabled(info.id);
      form.toggle(
        `${enabled ? "§a✔" : "§c✘"} §l${info.name}§r\n§7${info.description}`,
        obToggle(enabled, (value) => {
          modules.setEnabled(info.id, value);
          player.sendMessage(`§a[Modules] ${info.name} ${value ? "§aactivé" : "§cdésactivé"}§a.`);
        }),
      );
    }

    // Gestion spécifique des territoires (zones dangereuses).
    if (MODULE_CATALOG.some((info) => info.id === "territories")) {
      form.divider();
      form.button(`§e■ Voir les territoires`, () => {
        void import("../territories/ui").then(({ openTerritoriesMenu }) => {
          if (territories !== undefined) openTerritoriesMenu(player, territories);
        });
      });
      form.button(`§c■ Supprimer TOUS les territoires`, () => {
        if (territories !== undefined) openWipeTerritoriesMenu(player, modules, territories);
      });
    }
  }).catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

/** Panneau de contrôle d'un module : toggle + actions spécifiques. */
export function openModuleConfigMenu(
  player: Player,
  moduleId: ModuleId,
  modules: ModuleManager,
  _territories?: TerritoryManager,
): void {
  const info = MODULE_CATALOG.find((candidate) => candidate.id === moduleId);
  if (info === undefined) return;

  const enabled = modules.isEnabled(moduleId);

  void openWindow(player, info.name, (form) => {
    form.header(`§6■ §l${info.name}`);
    form.label(`§7${info.description}\n\n§7État : ${enabled ? "§aactivé" : "§cdésactivé"}`);
    form.divider();
    form.toggle(
      `§eModule activé`,
      obToggle(enabled, (value) => {
        modules.setEnabled(moduleId, value);
        player.sendMessage(`§a[Modules] ${info.name} ${value ? "§aactivé" : "§cdésactivé"}§a.`);
      }),
    );
  }).catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

/** Confirmation de suppression massive des territoires. */
function openWipeTerritoriesMenu(player: Player, modules: ModuleManager, territories: TerritoryManager): void {
  new MessageFormData()
    .title("§4⚠ DANGER")
    .body(`Supprimer §lTOUS§r§4 les territoires (${territories.all().length})?\n\nAction irréversible !`)
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

// Ré-export pour compat.
export { ICONS };
