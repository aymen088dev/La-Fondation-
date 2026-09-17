import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { windowTitle, RP_PACK_ID, openWindow } from "./theme";
import { openTerritoriesMenu, showTerritoryInfo, openCreateMenu } from "../territories/ui";
import type { TerritoryManager } from "../territories/manager";
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
import { allKnownPlayers } from "../players";
import { openAdminMenu } from "./admin";

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
 * Menu hub central (/sn:menu) — layout SIDEBAR.
 *
 * Grâce au JSON UI du RP (server_form.json), les BOUTONS d'un menu
 * ActionForm s'affichent dans la COLONNE DE GAUCHE et le TEXTE (body)
 * dans le grand panneau de droite. Le hub exploite ça :
 *  - sidebar : Territoires · Mes infos · Modération (modo) · Admin (admin)
 *  - panneau : accueil (bienvenue, ton rôle, stats du monde).
 */
export function openHubMenu(player: Player, deps: HubDeps): void {
  const { permissions, territories, sanctions, classes, db } = deps;

  const isOp = player.playerPermissionLevel >= 2;
  const isAdmin = canUseAdminPanel(player, permissions);
  const isMod = permissions.can(player.name, "mod.panel", isOp);
  const hasRole = permissions.getMember(player.name) !== undefined;

  // Stats pour le panneau d'accueil.
  const online = world.getAllPlayers().length;
  const territoryCount = territories.all().length;
  const knownCount = db !== undefined ? allKnownPlayers(db).length : 0;
  const myTerritory = territories.findByOwner(player.name);
  const myClass = classes?.classOf(player.name);
  const roleTag = hasRole ? permissions.nameTagFor(player.name) : "§8aucun rôle";

  void openWindow(player, "Menu", (form) => {
    // ---- Panneau de droite : accueil ----
    form.body(
      [
        `§a§l■ OpenMontage§r`,
        ``,
        `§7Bienvenue, §f${player.name}§7 !`,
        `§7Ton rôle : ${roleTag}§r`,
        myClass !== undefined ? `§7Ta classe : §d${myClass.classId}` : `§7Ta classe : §8pas encore choisie`,
        ``,
        `§8────────────────────`,
        `§7En ligne : §f${online}   §7Territoires : §f${territoryCount}   §7Joueurs connus : §f${knownCount}`,
        ``,
        `§8Choisis une section à gauche.`,
        myTerritory !== undefined
          ? `§8Ton territoire : ${myTerritory.data.name}§r`
          : `§8Astuce : §f/sn:create§8 pour revendiquer ce chunk.`,
      ].join("\n"),
    );

    // ---- Sidebar (colonne de gauche) ----
    form.header(`§a§l≡ Navigation`);

    form.button(`§a■ Territoires`, () => openTerritoriesMenu(player, territories), undefined, "flag");
    form.button(`§e■ Mes infos`, () => openMyInfoMenu(player, deps), undefined, "user");

    if (isMod) {
      form.divider();
      form.button(`§4■ Modération`, () => openSanctionsMenu(player, sanctions, permissions), undefined, "shield");
    }
    if (isAdmin) {
      form.button(`§6■ Admin`, () => openAdminMenu(player, deps), undefined, "crown");
    }
  }).catch((error: unknown) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * « Mes infos » : la fiche du joueur (rôle, classe, territoire, sessions).
 * Actions rapides : choisir/voir sa classe, personnaliser son rôle,
 * rejoindre son territoire.
 */
export function openMyInfoMenu(player: Player, deps: HubDeps): void {
  const { permissions, territories, classes, jobs, db } = deps;

  const member = permissions.getMember(player.name);
  const roleLabel =
    member === undefined
      ? "§8aucun"
      : `${permissions.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}§r`;
  const myTerritory = territories.findByOwner(player.name);
  const selection = classes?.classOf(player.name);
  const myJobs = jobs?.jobsOf(player.name) ?? [];
  const record = db !== undefined ? allKnownPlayers(db).find((r) => r.data.name === player.name) : undefined;

  void openWindow(player, "Mes infos", (form) => {
    form.body(
      [
        `§b§l■ ${player.name}§r`,
        ``,
        `§eRôle : ${roleLabel}`,
        `§eClasse : ${selection !== undefined ? `§d${selection.classId}§r §7(niv. ${Math.floor(selection.xp / 100) + 1})` : "§8non choisie"}`,
        `§eTerritoire : ${myTerritory !== undefined ? `§a${myTerritory.data.name}` : "§8aucun"}`,
        myJobs.length > 0
          ? `§eMétiers : §f${myJobs.map((j) => j.jobId).join(", ")}`
          : `§eMétiers : §8aucun`,
        ``,
        `§8────────────────────`,
        record !== undefined
          ? `§7Sessions : §f${record.data.sessions}   §7Première visite : §f${new Date(record.data.firstSeen).toLocaleDateString()}`
          : `§7Sessions : §f?`,
      ].join("\n"),
    );

    form.header(`§e§l≡ Actions`);

    form.button(`§d■ Ma classe`, () => {
      if (classes !== undefined) openClassesMenu(player, classes, false);
    }, undefined, "compass");
    if (jobs !== undefined) {
      form.button(`§6■ Métiers`, () => openJobsMenu(player, jobs), undefined, "axe");
    }
    if (member !== undefined) {
      form.button(`§b■ Couleur de mon nom`, () => {
        player.sendMessage(`§a[OM] Ton rôle : ${permissions.nameTagFor(player.name)}§r§a — choisis ta couleur :`);
        openColorPicker(player, "Ta couleur de nom", (colorId) => {
          const result = permissions.setCustomColor(player.name, colorId);
          player.sendMessage(result.ok ? "§a[OM] Couleur mise à jour !" : `§c[OM] ${result.error}`);
        });
      }, undefined, "tag");
    }
    if (myTerritory !== undefined) {
      form.button(`§a■ Mon territoire`, () => showTerritoryInfo(player, myTerritory, territories), undefined, "flag");
    } else {
      form.button(`§a■ Créer un territoire`, () => openCreateMenu(player, territories), undefined, "plus");
    }
  }).catch((error: unknown) => console.warn(`[Mes infos] ${error instanceof Error ? error.message : String(error)}`));
}

// Ré-exports pour compat avec les anciens imports.
export { windowTitle, RP_PACK_ID };
