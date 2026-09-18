import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { openWindow } from "./theme";
import { openStatesMenu, openCreateMenu, openMyClanMenu } from "../territories/ui";
import type { TerritoryManager } from "../territories/manager";
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
import { formatDate } from "../territories/manager";

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
 * Menu hub central (/sn:menu) — layout SIDEBAR. La section « États »
 * porte le système de clans (fondation, extension, membres).
 *
 * Grâce au JSON UI du RP (server_form.json), les BOUTONS d'un menu
 * ActionForm s'affichent dans la COLONNE DE GAUCHE et le TEXTE (body)
 * dans le grand panneau de droite :
 *  - sidebar : États · Mes infos · Modération (modo) · Admin (admin)
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
  const stateCount = territories.all().length;
  const knownCount = db !== undefined ? allKnownPlayers(db).length : 0;
  const myClan = territories.findByMemberId(player.id) ?? territories.findByOwner(player.name);
  const myClass = classes?.classOf(player.name);
  const roleTag = hasRole ? permissions.nameTagFor(player.name) : "§8aucun rôle";

  void openWindow(player, "Menu", (form) => {
    // ---- Panneau de droite : accueil ----
    form.body(
      [
        `§6§lNaLandia§r`,
        ``,
        `§7Bienvenue, §f${player.name}§7 !`,
        `§7Ton rôle : ${roleTag}§r`,
        myClass !== undefined ? `§7Ta classe : §d${myClass.classId}` : `§7Ta classe : §8pas encore choisie`,
        ``,
        `§8────────────────────`,
        `§7En ligne : §f${online}   §7États : §f${stateCount}   §7Joueurs connus : §f${knownCount}`,
        ``,
        `§8Choisis une section à gauche.`,
        myClan !== undefined
          ? `§8Ton clan : §f${myClan.data.name}§r`
          : `§8Astuce : §f/sn:create§8 pour fonder ton clan ici.`,
      ].join("\n"),
    );

    // ---- Sidebar (colonne de gauche) : section États = système de clans. ----
    form.button(`§6États`, () => openStatesMenu(player, territories));
    form.button(`§eMes infos`, () => openMyInfoMenu(player, deps));

    if (isMod) {
      form.divider();
      form.button(`§4Modération`, () => openSanctionsMenu(player, sanctions, permissions));
    }
    if (isAdmin) {
      form.button(`§6Admin`, () => openAdminMenu(player, deps));
    }
  }).catch((error: unknown) => console.warn(`[Hub] ${error instanceof Error ? error.message : String(error)}`));
}

/**
 * « Mes infos » : la fiche du joueur (rôle, classe, territoire, sessions).
 * Actions rapides : choisir/voir sa classe, gérer son territoire.
 * (La personnalisation de couleur — retirée : la couleur vient du rôle.)
 */
export function openMyInfoMenu(player: Player, deps: HubDeps): void {
  const { permissions, territories, classes, jobs, db } = deps;

  const member = permissions.getMember(player.name);
  const roleLabel =
    member === undefined
      ? "§8aucun"
      : `${permissions.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}§r`;
  const myClan = territories.findByMemberId(player.id) ?? territories.findByOwner(player.name);
  const selection = classes?.classOf(player.name);
  const myJobs = jobs?.jobsOf(player.name) ?? [];
  const record = db !== undefined ? allKnownPlayers(db).find((r) => r.data.name === player.name) : undefined;

  void openWindow(player, "Mes infos", (form) => {
    form.body(
      [
        `§b§l${player.name}§r`,
        ``,
        `§eRôle : ${roleLabel}`,
        `§eClasse : ${selection !== undefined ? `§d${selection.classId}§r §7(niv. ${Math.floor(selection.xp / 100) + 1})` : "§8non choisie"}`,
        `§eClan : ${myClan !== undefined ? `§a${myClan.data.name}` : "§8aucun"}`,
        myJobs.length > 0
          ? `§eMétiers : §f${myJobs.map((j) => j.jobId).join(", ")}`
          : `§eMétiers : §8aucun`,
        ``,
        `§8────────────────────`,
        record !== undefined
          ? `§7Sessions : §f${record.data.sessions}   §7Première visite : §f${formatDate(record.data.firstSeen)}`
          : `§7Sessions : §f?`,
      ].join("\n"),
    );

    form.header(`§e§lActions`);

    form.button(`§dMa classe`, () => {
      if (classes !== undefined) openClassesMenu(player, classes, false);
    });
    if (jobs !== undefined) {
      form.button(`§6Métiers`, () => openJobsMenu(player, jobs));
    }
    if (myClan !== undefined) {
      form.button(`§aMon clan`, () => openMyClanMenu(player, territories, myClan));
    } else {
      form.button(`§aFonder un clan`, () => openCreateMenu(player, territories));
    }
  }).catch((error: unknown) => console.warn(`[Mes infos] ${error instanceof Error ? error.message : String(error)}`));
}
