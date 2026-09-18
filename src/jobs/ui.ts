/** Registre des métiers : catalogue, métiers actifs et progression. */
import type { Player } from "@minecraft/server";
import { JobManager, JOB_XP_PER_LEVEL, jobLevel } from "./manager";
import { openWindow } from "../ui/theme";

function xpBar(xp: number, perLevel: number): string {
  const filled = Math.min(10, Math.floor((xp / perLevel) * 10));
  return `§a[${"|".repeat(filled)}§8${".".repeat(10 - filled)}§a]§r`;
}

export function openJobsMenu(player: Player, jobs: JobManager): void {
  void openWindow(player, "Métiers", (form) => {
    const mine = jobs.jobsOf(player.name);
    form.header("§b§lAtelier des métiers");
    form.body(
      [
        "§7Les métiers sont des disciplines parallèles à ta classe.",
        "§7Chaque métier possède sa propre progression et son propre rythme.",
        `§7Disciplines actives : §f${mine.length}/${jobs.catalog().length}`,
      ].join("\n"),
    );
    form.divider();

    if (mine.length > 0) {
      form.header("§e§lMétiers actifs");
      for (const job of mine) {
        const info = jobs.catalog().find((candidate) => candidate.id === job.jobId);
        form.button(
          `${info?.color ?? "§f"}§l${info?.name ?? job.jobId}§r §7| niveau ${jobLevel(job.xp)} ${xpBar(job.xp % JOB_XP_PER_LEVEL, JOB_XP_PER_LEVEL)}`,
          () => {
            if (jobs.quitJob(player.name, job.jobId)) {
              player.sendMessage(`§e[Métiers] Tu quittes le métier ${info?.name ?? job.jobId}.`);
            }
            openJobsMenu(player, jobs);
          },
        );
      }
      form.divider();
    }

    form.header("§6§lChoisir une discipline");
    for (const info of jobs.catalog()) {
      if (jobs.hasJob(player.name, info.id)) continue;
      form.button(`${info.color}§l${info.name}§r §7| ${info.description}`, () => {
        if (jobs.startJob(player.name, info.id)) {
          player.sendMessage(`§a[Métiers] Métier commencé : ${info.name}.`);
        }
        openJobsMenu(player, jobs);
      });
    }

    form.divider();
    form.header("§e§lOutils du parcours");
    form.button("§eVoir ma progression", () => {
      player.sendMessage("§e[Métiers] Ta progression détaillée est affichée sur chaque discipline active.");
    });
    form.button("§6Classement des métiers", () => {
      player.sendMessage("§6[Métiers] Le classement sera alimenté quand les actions de métier seront branchées.");
    });
  }).catch((error: unknown) => console.warn(`[Métiers] ${error instanceof Error ? error.message : String(error)}`));
}
