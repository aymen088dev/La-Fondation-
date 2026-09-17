/**
 * Menu /sn:jobs — DDUI. Base des métiers, catalogue VIDE pour l'instant :
 * le menu affiche l'état (aucun métier disponible) et est prêt à lister
 * le futur catalogue + les métiers exercés (XP, niveaux, abandon).
 */

import type { Player } from "@minecraft/server";
import { JobManager, jobLevel } from "./manager";
import { openWindow } from "../ui/theme";

/** Barre de progression ASCII (10 crans). */
function xpBar(xp: number, perLevel: number): string {
  const filled = Math.floor((xp / perLevel) * 10);
  return `§a${"█".repeat(filled)}§8${"░".repeat(10 - filled)}§r`;
}

/** Ouvre le menu des métiers. */
export function openJobsMenu(player: Player, jobs: JobManager): void {
  void openWindow(player, "Métiers", (form) => {
    form.hero("jobs");
    form.header("§6■ §lMétiers");
    form.divider();

    const mine = jobs.jobsOf(player.name);

    // ----- Métiers exercés (avec XP/niveau) -----
    if (mine.length > 0) {
      form.label("§7Tes métiers :");
      for (const job of mine) {
        const level = jobLevel(job.xp);
        const progress = job.xp % 50;
        form.label(
          `§e■ §f${job.jobId} §7— niveau §f${level}\n` +
            `${xpBar(progress, 50)} §8(${progress}/50 XP)`,
        );
      }
      form.divider();
    }

    // ----- Catalogue : volontairement vide (base à compléter plus tard) -----
    form.label(
      "§7Aucun métier n'est encore disponible.\n§8Le catalogue (bûcheron, mineur…) sera ajouté prochainement — les fondations sont prêtes.",
    );
  }).catch((error: unknown) => console.warn(`[Jobs] ${error instanceof Error ? error.message : String(error)}`));
}
