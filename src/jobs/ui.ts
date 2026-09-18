/**
 * Menu /sn:jobs — DESIGN DIFFÉRENCIÉ « registre des métiers » (v19).
 *
 * Présentation en fiches à bannière (comme les voies de Classes) mais
 * avec une encre cuivrée : bandeau, métiers exercés avec barres d'XP.
 * Le catalogue est volontairement vide pour l'instant — les fondations
 * sont prêtes.
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
    // ---- Bannière du registre ----
    form.label(
      [
        `§6╔══════════════════════╗`,
        `§f§l        Métiers`,
        `§6╚══════════════════════╝`,
      ].join("\n"),
    );

    const mine = jobs.jobsOf(player.name);

    // ----- Métiers exercés (avec XP/niveau) -----
    if (mine.length > 0) {
      for (const job of mine) {
        const level = jobLevel(job.xp);
        const progress = job.xp % 50;
        form.label(
          `§6✦ §f${job.jobId} §7— niveau §f§l${level}§r\n` +
            `${xpBar(progress, 50)} §8(${progress}/50 XP)`,
        );
      }
      form.divider();
    } else {
      form.label(`§7Tu n'exerces aucun métier pour l'instant.`);
      form.divider();
    }

    // ----- Catalogue : volontairement vide (base à compléter plus tard) -----
    form.label(
      "§7Aucun métier n'est encore ouvert au recrutement.\n§8Le registre (bûcheron, mineur…) sera complété prochainement — les fondations sont prêtes.",
    );
  }).catch((error: unknown) => console.warn(`[Jobs] ${error instanceof Error ? error.message : String(error)}`));
}
