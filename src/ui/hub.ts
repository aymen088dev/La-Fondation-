import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import { openTileMenu } from "./theme";
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
import { openWorldMenu } from "../mines/ui";
import type { MinesManager } from "../mines/manager";
import type { JsonDatabase } from "../db/database";
import { allKnownPlayers } from "../players";
import { openAdminMenu } from "./admin";
import { formatDate } from "../territories/manager";
import type { QuestManager } from "../quests/manager";
import { openQuestMenu } from "../quests/ui";

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
  /** Module Mines (dimension minière). */
  mines?: MinesManager;
  /** Journal et progression des quêtes. */
  quests?: QuestManager;
}

/**
 * Menu hub central (/sn:menu) — MENU À TUILES « console ».
 *
 * La section « États » porte le système de clans (fondation, extension,
 * membres). Le panneau est dessiné par `RP/ui/server_form.json` :
 *  - colonne de gauche : six sections (États, Mes infos, Quêtes, Monde,
 *    Modération, Admin) ;
 *  - panneau de droite : l'accueil (bienvenue, rôle, classe, clan, stats) ;
 *  - barre du bas : fermeture.
 *
 * Le hub et l'admin partagent volontairement la MÊME géométrie (fenêtre or,
 * six tuiles, panneau de droite) : ce sont les deux menus de navigation.
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

  // Capturés ici pour que les tuiles sachent si la section est disponible.
  const quests = deps.quests;
  const mines = deps.mines;
  const worldReady = mines !== undefined && mines.isUsable();

  openTileMenu(player, "Menu", (menu) => {
    // ---- Panneau de droite : accueil ----
    menu.body(
      [
        `§6§lNaLandia§r  §7— bienvenue, §f${player.name}§7 !`,
        `§7Rôle : ${roleTag}§r   §7Classe : ${
          myClass !== undefined ? `§d${myClass.classId}` : "§8non choisie"
        }§r`,
        `§7Clan : ${
          myClan !== undefined ? `§f${myClan.data.name}§r` : "§8aucun"
        }§r`,
        `§eEn ligne §f${online}   §eÉtats §f${stateCount}   §eJoueurs connus §f${knownCount}`,
        myClan === undefined ? `§8Astuce : §f/sn:create§8 pour fonder ton clan ici.` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );

    // ---- Colonne de gauche ----
    menu.action("states", `§6États`, () => openStatesMenu(player, territories));
    menu.action("infos", `§eMes infos`, () => openMyInfoMenu(player, deps));
    menu.action("quests", quests !== undefined ? `§6Quêtes` : `§8Quêtes`, () => {
      if (quests === undefined) {
        player.sendMessage("§8[NaLandia] Le module Quêtes n'est pas actif sur ce serveur.");
        return;
      }
      openQuestMenu(player, quests, classes, deps.jobs);
    });
    menu.action("world", worldReady ? `§bMonde` : `§8Monde`, () => {
      if (mines === undefined || !mines.isUsable()) {
        player.sendMessage("§8[NaLandia] Le module Monde n'est pas actif sur ce serveur.");
        return;
      }
      openWorldMenu(player, mines, () => openHubMenu(player, deps));
    });
    menu.action("moderation", isMod ? `§4Modération` : `§8Modération`, () => {
      if (!isMod) {
        player.sendMessage("§c[Modération] Réservé à l'équipe.");
        return;
      }
      openSanctionsMenu(player, sanctions, permissions);
    });
    menu.action("admin", isAdmin ? `§6Admin` : `§8Admin`, () => {
      if (!isAdmin) {
        player.sendMessage("§c[Admin] Il te faut le rôle Admin (ou être op).");
        return;
      }
      openAdminMenu(player, deps);
    });
  });
}

/**
 * « Mes infos » : la fiche du joueur (rôle, classe, clan, métiers, dons).
 * DESIGN DIFFÉRENCIÉ « fiche personnage » : bannière or du pseudo, rubrique
 * en deux colonnes de libellés, puis cartes d'action basses.
 * Actions rapides : classe, métiers, dons, clan.
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
  const classLevelLabel =
    selection !== undefined ? `§d${selection.classId} §7niv. ${Math.floor(selection.xp / 100) + 1}` : "§8non choisie";

  openTileMenu(player, "Mes infos", (menu) => {
    // ---- Fiche du joueur (panneau de droite) ----
    menu.body(
      [
        `§f§l${player.name}§r`,
        `§eRôle §r${roleLabel}`,
        `§eClasse §r${classLevelLabel}`,
        `§eClan §r${myClan !== undefined ? `§a${myClan.data.name}` : "§8aucun"}`,
        `§eMétiers §r${myJobs.length > 0 ? `§f${myJobs.map((j) => j.jobId).join(", ")}` : "§8aucun"}`,
        `§eDons §8bientôt`,
        `§7Sessions §f${record !== undefined ? record.data.sessions : "?"}`,
        record !== undefined ? `§7Vu le §f${formatDate(record.data.firstSeen)}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n"),
    );

    // ---- Actions (colonne de gauche) ----
    menu.action("classe", classes !== undefined ? `§dMa classe` : `§8Classe`, () => {
      if (classes === undefined) {
        player.sendMessage("§8[NaLandia] Le module Classes n'est pas actif.");
        return;
      }
      openClassesMenu(player, classes, false, () => openMyInfoMenu(player, deps));
    });
    menu.action("jobs", deps.jobs !== undefined ? `§6Métiers` : `§8Métiers`, () => {
      if (deps.jobs === undefined) {
        player.sendMessage("§8[NaLandia] Le module Métiers n'est pas actif.");
        return;
      }
      openJobsMenu(player, deps.jobs);
    });
    menu.action("clan", myClan !== undefined ? `§aMon clan` : `§aFonder un clan`, () => {
      if (myClan !== undefined) openMyClanMenu(player, territories, myClan);
      else openCreateMenu(player, territories);
    });
    menu.action("states", `§6États`, () => openStatesMenu(player, territories));
    menu.action("quests", deps.quests !== undefined ? `§6Quêtes` : `§8Quêtes`, () => {
      if (deps.quests === undefined) {
        player.sendMessage("§8[NaLandia] Le module Quêtes n'est pas actif.");
        return;
      }
      openQuestMenu(player, deps.quests, classes, deps.jobs);
    });
    menu.action("gifts", `§8Dons`, () =>
      player.sendMessage("§8[NaLandia] Le système de dons arrivera plus tard."),
    );

    menu.action("back", `§7Fermer`, () => {});
  });
}
