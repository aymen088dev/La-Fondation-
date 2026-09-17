import type { Player } from "@minecraft/server";
import { openTerritoriesMenu } from "../territories/ui";
import { windowTitle, openWindow, openWindowRaw } from "../ui/theme";
import { MODULE_CATALOG } from "./manager";
import type { ModuleId, ModuleManager } from "./manager";
import type { TerritoryManager } from "../territories/manager";

/**
 * Menu principal des modules : état on/off de chaque feature — DDUI
 * avec toggles réactifs persistés instantanément.
 */
export function openModulesMenu(player: Player, modules: ModuleManager, territories?: TerritoryManager): void {
  void openWindow(player, "Modules", (form) => {
    form.header(`§6■ §lModules du serveur`);
    form.label(`§7${modules.enabledCount()}/${MODULE_CATALOG.length} module(s) actif(s).`);
    form.divider();

    // Les modules passent par une liste de boutons ActionForm (un clic
    // bascule l'état) — plus fiable que les toggles liés et visuellement
    // équivalent avec l'état affiché dans le label.
    for (const info of MODULE_CATALOG) {
      const enabled = modules.isEnabled(info.id);
      form.button(
        `${enabled ? "§a✔" : "§c✘"} §l${info.name}§r §7— ${info.description}`,
        () => {
          const next = !modules.isEnabled(info.id);
          modules.setEnabled(info.id, next);
          player.sendMessage(`§a[Modules] ${info.name} ${next ? "§aactivé" : "§cdésactivé"}§a.`);
          openModulesMenu(player, modules, territories);
        },
        undefined,
        enabled ? "check" : "close",
      );
    }

    // Gestion spécifique des territoires (zones dangereuses).
    if (MODULE_CATALOG.some((info) => info.id === "territories")) {
      form.divider();
      form.button(`§e■ §lVoir les territoires`, () => {
        if (territories !== undefined) openTerritoriesMenu(player, territories);
      });
      form.button(`§c■ §lSupprimer TOUS les territoires`, () => {
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
    form.button(
      enabled ? `§c■ §lDésactiver ce module` : `§a■ §lActiver ce module`,
      () => {
        const next = !modules.isEnabled(moduleId);
        modules.setEnabled(moduleId, next);
        player.sendMessage(`§a[Modules] ${info.name} ${next ? "§aactivé" : "§cdésactivé"}§a.`);
        openModuleConfigMenu(player, moduleId, modules, _territories);
      },
      undefined,
      enabled ? "close" : "check",
    );
  }).catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * Confirmation de suppression massive des territoires — DDUI (cohérence du
 * thème : plus de MessageFormData vanilla mélangé au moteur custom).
 */
function openWipeTerritoriesMenu(player: Player, modules: ModuleManager, territories: TerritoryManager): void {
  void openWindowRaw(player, windowTitle("Supprimer les territoires"), (form) => {
    form.header(`§4⚠ §lDANGER`);
    form.label(
      `Supprimer §lTOUS§r§4 les territoires (${territories.all().length}) ?\n\n§7Action irréversible !`,
    );
    form.divider();
    form.button(`§4■ §lSUPPRIMER TOUT`, () => {
      let removed = 0;
      for (const territory of territories.all()) {
        if (territories.removeForced(territory.id)) removed++;
      }
      player.sendMessage(`§a[Modules] ${removed} territoire(s) supprimé(s).`);
      openModulesMenu(player, modules, territories);
    });
    form.button(`§a■ §lAnnuler`, () => openModulesMenu(player, modules, territories));
  }).catch((error: unknown) => console.warn(`[Modules] ${error instanceof Error ? error.message : String(error)}`));
}
