import type { Player } from "@minecraft/server";
import { QuestManager, QUEST_CATALOG } from "./manager";
import { openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import type { ClassManager } from "../classes/manager";
import type { JobManager } from "../jobs/manager";

/** Nombre de pistes affichées par page. */
export const QUESTS_PER_PAGE = 5;

function rewardLabel(questId: string, quests: QuestManager): string {
  const reward = quests.questOf(questId)?.reward;
  if (reward?.classXp !== undefined) return `+${reward.classXp} XP de classe`;
  if (reward?.jobXp !== undefined) return `+${reward.jobXp} XP de métier`;
  return "Récompense à découvrir";
}

/** Une ligne de piste pour la liste, avec son état. */
interface QuestEntry {
  id: string;
  title: string;
  description: string;
  target: number;
  /** `active` : suivie (clic = détails / récupérer) ; `open` : à démarrer. */
  state: "active" | "open";
}

/**
 * Journal de quêtes — MENU À TUILES (panneau émeraude).
 *
 * Les pistes suivies viennent d'abord (celles qu'on peut récupérer sont
 * marquées §aRÉCUPÉRER), puis les pistes encore disponibles (clic = suivre).
 * Le tout est paginé, la progression est écrite dans le panneau de droite.
 */
export function openQuestMenu(
  player: Player,
  quests: QuestManager,
  classes?: ClassManager,
  jobs?: JobManager,
  page = 0,
): void {
  const state = quests.stateOf(player.name);
  const active = quests.active(player.name);

  const entries: QuestEntry[] = [
    ...active.map((quest): QuestEntry => ({
      id: quest.id,
      title: quest.title,
      description: quest.description,
      target: quest.target,
      state: "active",
    })),
    ...QUEST_CATALOG.filter(
      (candidate) => !state.active.includes(candidate.id) && !state.claimed.includes(candidate.id),
    ).map((quest): QuestEntry => ({
      id: quest.id,
      title: quest.title,
      description: quest.description,
      target: quest.target,
      state: "open",
    })),
  ];

  const { items, page: current, pageCount } = pageSlice(entries, page, QUESTS_PER_PAGE);
  const myClass = classes?.classOf(player.name);

  openTileMenu(player, "Quetes", (menu) => {
    menu.body(
      [
        "§6§lJournal de route§r",
        `§7Récompenses récupérées : §f${state.claimed.length}§7/§f${QUEST_CATALOG.length}`,
        myClass !== undefined ? `§7Voie actuelle : §f${myClass.classId}` : "§7Voie actuelle : §8à choisir",
        jobs !== undefined ? `§7Métiers actifs : §f${jobs.jobsOf(player.name).length}` : "",
        "",
        `§8Pistes suivies : §f${active.length}§8 — page §f${current + 1}§8/§f${pageCount}`,
        "§8Les pistes se déclenchent en vivant réellement l'action :",
        "§8classe, mine, clan ou métier.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    );

    for (let slot = 0; slot < QUESTS_PER_PAGE; slot++) {
      const entry = items[slot];
      if (entry === undefined) continue;

      if (entry.state === "open") {
        menu.action(`quest_${slot}`, `§8Suivre : §7${entry.title}`, () => {
          const result = quests.start(player.name, entry.id);
          if (!result.ok) player.sendMessage(`§c[Quêtes] ${result.error}`);
          openQuestMenu(player, quests, classes, jobs, current);
        });
        continue;
      }

      const progress = quests.progressOf(player.name, entry.id);
      const ready = quests.isCompleted(player.name, entry.id);
      menu.action(
        `quest_${slot}`,
        ready
          ? `§aRÉCUPÉRER : §f${entry.title}`
          : `§e${entry.title} §7(${progress}/${entry.target})`,
        () => {
          if (!ready) {
            player.sendMessage(`§7[Quêtes] ${entry.description} §8(${progress}/${entry.target})`);
            return;
          }
          const result = quests.claim(player.name, entry.id);
          if (!result.ok) {
            player.sendMessage(`§c[Quêtes] ${result.error}`);
            return;
          }
          if (result.reward?.classXp !== undefined && classes !== undefined) {
            classes.addXp(player.name, result.reward.classXp);
          }
          if (result.reward?.jobXp !== undefined && jobs !== undefined) {
            const firstJob = jobs.jobsOf(player.name)[0];
            if (firstJob !== undefined) jobs.addXp(player.name, firstJob.jobId, result.reward.jobXp);
          }
          player.sendMessage(`§6[Quêtes] Récompense récupérée : §f${rewardLabel(entry.id, quests)}§6.`);
          openQuestMenu(player, quests, classes, jobs, current);
        },
      );
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openQuestMenu(player, quests, classes, jobs, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openQuestMenu(player, quests, classes, jobs, current + 1);
    });
    menu.action("back", `§7Fermer`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}
