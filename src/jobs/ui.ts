/** Registre des métiers — MENU À TUILES (panneau émeraude, liste paginée). */
import type { Player } from "@minecraft/server";
import { JobManager, JOB_XP_PER_LEVEL, jobLevel } from "./manager";
import { openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";

/** Nombre de disciplines affichées par page. */
export const JOBS_PER_PAGE = 5;

function xpBar(xp: number, perLevel: number): string {
  const filled = Math.min(10, Math.floor((xp / perLevel) * 10));
  const bar = "|".repeat(filled);
  const empty = ".".repeat(10 - filled);
  return `§a[${bar}§8${empty}§a]§r`;
}

/**
 * Atelier des métiers — une tuile par discipline (catalogue), paginée.
 *
 * Un clic DÉMARRE la discipline si elle n'est pas exercée, la QUITTE sinon :
 * c'est le même geste dans les deux sens, l'état est écrit dans le libellé.
 */
export function openJobsMenu(player: Player, jobs: JobManager, page = 0): void {
  const catalog = jobs.catalog();
  const mine = jobs.jobsOf(player.name);
  const { items, page: current, pageCount } = pageSlice(catalog, page, JOBS_PER_PAGE);

  openTileMenu(player, "Metiers", (menu) => {
    menu.body(
      [
        "§b§lAtelier des métiers§r",
        "§7Les métiers sont des disciplines parallèles à ta classe :",
        "§7chacun a sa propre progression et son propre rythme.",
        "",
        `§7Disciplines actives : §f${mine.length}§7/${catalog.length}`,
        ...mine.map((job) => {
          const info = catalog.find((candidate) => candidate.id === job.jobId);
          return `§8- ${info?.color ?? "§f"}${info?.name ?? job.jobId}§8 niv. §f${jobLevel(job.xp)}§8 ${xpBar(
            job.xp % JOB_XP_PER_LEVEL,
            JOB_XP_PER_LEVEL,
          )}`;
        }),
        "",
        `§8Page §f${current + 1}§8/§f${pageCount}§8 — un clic démarre ou quitte la discipline.`,
      ].join("\n"),
    );

    for (let slot = 0; slot < JOBS_PER_PAGE; slot++) {
      const info = items[slot];
      if (info === undefined) continue;
      const active = mine.find((job) => job.jobId === info.id);
      menu.action(
        `job_${slot}`,
        active !== undefined
          ? `§cQuitter ${info.name} §7(niv. ${jobLevel(active.xp)})`
          : `§aCommencer ${info.name}`,
        () => {
          if (active !== undefined) {
            if (jobs.quitJob(player.name, info.id)) {
              player.sendMessage(`§e[Métiers] Tu quittes le métier ${info.name}.`);
            }
          } else if (jobs.startJob(player.name, info.id)) {
            player.sendMessage(`§a[Métiers] Métier commencé : ${info.name}.`);
          }
          openJobsMenu(player, jobs, current);
        },
      );
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openJobsMenu(player, jobs, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openJobsMenu(player, jobs, current + 1);
    });
    menu.action("back", `§7Fermer`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}
