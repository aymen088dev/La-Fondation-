import type { Player } from "@minecraft/server";
import { windowTitle, RP_PACK_ID, openWindow } from "./theme";
import { openTerritoriesMenu, showTerritoryInfo } from "../territories/ui";
import type { TerritoryManager } from "../territories/manager";
import { chunkKeyFromPosition } from "../territories/manager";
import { openColorPicker } from "../permissions/ui";
import type { PermissionManager } from "../permissions/manager";
import { canUseAdminPanel } from "../permissions/commands";
import type { ModuleManager } from "../modules/manager";
import { openSanctionsMenu } from "../moderation/ui";
import type { SanctionsManager } from "../moderation/manager";
import { openClassesMenu } from "../classes/ui";
import type { ClassManager } from "../classes/manager";
import { openJobsMenu } from "../jobs/ui";
import type { JobManager } from "../jobs/manager";
import type { JsonDatabase } from "../db/database";

export interface HubDeps {
  permissions: PermissionManager;
  modules: ModuleManager;
  territories: TerritoryManager;
  sanctions: SanctionsManager;
  /** Index joueurs (onglet hors ligne du menu Joueurs). */
  db?: JsonDatabase;
  /** Module Classes (route du joueur). */
  classes?: ClassManager;
  /** Module Métiers (base prête, catalogue à venir). */
  jobs?: JobManager;
}

/**
 * Menu hub central (/sn:menu) — DDUI CustomForm.
 * Le point d'entrée graphique de l'add-on : boutons à callbacks directs,
 * layout riche (headers, dividers). Les entrées n'apparaissent que pour
 * les personnes autorisées.
 */
export function openHubMenu(player: Player, deps: HubDeps): void {
  const { permissions, territories, sanctions, classes, jobs } = deps;

  const isOp = player.playerPermissionLevel >= 2;
  const isAdmin = canUseAdminPanel(player, permissions);
  const isMod = permissions.can(player.name, "mod.panel", isOp);
  const canCreate = permissions.can(player.name, "territories.create", isOp);
  const hasRole = permissions.getMember(player.name) !== undefined;
  const canSelfColor = permissions.can(player.name, "chat.color", isOp) || hasRole;

  void openWindow(player, "Menu", (form) => {
    form.hero("home");
    form.header(`§a■ §lOpenMontage`);
    form.divider();

    // Bandeau d'identité : le rôle du joueur, coloré (sans heure, sans date).
    form.label(
      hasRole
        ? `§7Salut §f${player.name}§7 ! Ton rôle : ${permissions.nameTagFor(player.name)}§r`
        : `§7Salut §f${player.name}§7 ! Tu n'as pas encore de rôle.`,
    );
    form.spacer();

    // ---- Section Monde ----
    form.header(`§a§lMonde`);
    form.button(
      `§a■ §lTerritoires§r\n§7${canCreate ? "créer, lister, explorer" : "lister, explorer"}`,
      () => openTerritoriesMenu(player, territories),
      { tooltip: "Revendique et explore les territoires" },
      "flag",
    );
    form.button(`§e■ §lInfos territoire§r\n§7le chunk où tu te trouves`, () => {
      const key = chunkKeyFromPosition(player.dimension.id, player.location.x, player.location.z);
      const here = territories.findByChunk(key);
      if (here === undefined) {
        player.sendMessage("§7[Territoires] Ce chunk est libre — personne le contrôle. §f/sn:create§7 pour le revendiquer !");
        return;
      }
      showTerritoryInfo(player, here, territories);
    }, undefined, "search");

    // ---- Section Progression ----
    form.header(`§d§lProgression`);
    if (canSelfColor) {
      form.button(`§b■ §lMon rôle§r\n§7couleur, prefix perso`, () =>
        openSelfRoleMenu(player, permissions),
        undefined,
        "tag",
      );
    }
    if (classes !== undefined) {
      const chosen = classes.classOf(player.name);
      form.button(
        chosen === undefined
          ? `§d■ §lClasses§r\n§7choisis ta route (définitif !)`
          : `§d■ §lMa classe§r\n§7voir ta progression`,
        () => openClassesMenu(player, classes, isAdmin),
        { tooltip: chosen === undefined ? "Choix définitif à la première connexion" : "Niveau, XP, progression" },
        chosen === undefined ? "plus" : "compass",
      );
    }
    if (jobs !== undefined) {
      form.button(`§6■ §lMétiers§r\n§7bûcheron, mineur… (à venir)`, () => openJobsMenu(player, jobs), undefined, "axe");
    }

    // ---- Section Gestion (modération uniquement — l'admin vit dans /sn:admin) ----
    if (isMod) {
      form.header(`§4§lGestion`);
      form.button(`§4■ §lModération§r\n§7bans, mutes, warns`, () =>
        openSanctionsMenu(player, sanctions, permissions),
        undefined,
        "shield",
      );
    }
    if (isAdmin) {
      form.divider();
      form.label("§8Panneau complet : §f/sn:admin§8 (rôles, joueurs, modules).");
    }
  }).catch((error: unknown) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}

/** Personnalisation de son propre rôle (couleur du nom). */
function openSelfRoleMenu(player: Player, permissions: PermissionManager): void {
  const member = permissions.getMember(player.name);
  if (member === undefined) {
    player.sendMessage("§7[OM] Tu n'as pas encore de rôle. Demande à un admin !");
    return;
  }

  player.sendMessage(`§a[OM] Ton rôle : ${permissions.nameTagFor(player.name)}§r§a — choisis ta couleur :`);
  openColorPicker(player, "Ta couleur de nom", (colorId) => {
    const result = permissions.setCustomColor(player.name, colorId);
    player.sendMessage(result.ok ? "§a[OM] Couleur mise à jour !" : `§c[OM] ${result.error}`);
  });
}

// Ré-exporte windowTitle pour compat avec les anciens imports.
export { windowTitle, RP_PACK_ID };
