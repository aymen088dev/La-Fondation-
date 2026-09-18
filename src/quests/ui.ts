import type { Player } from "@minecraft/server";
import { QuestManager, QUEST_CATALOG } from "./manager";
import { openWindow } from "../ui/theme";
import type { ClassManager } from "../classes/manager";
import type { JobManager } from "../jobs/manager";

function rewardLabel(questId: string, quests: QuestManager): string {
  const reward = quests.questOf(questId)?.reward;
  if (reward?.classXp !== undefined) return `+${reward.classXp} XP de classe`;
  if (reward?.jobXp !== undefined) return `+${reward.jobXp} XP de métier`;
  return "Récompense à découvrir";
}

/** Journal de quêtes : une page sobre, lisible et orientée progression. */
export function openQuestMenu(
  player: Player,
  quests: QuestManager,
  classes?: ClassManager,
  jobs?: JobManager,
): void {
  void openWindow(player, "Quêtes", (form) => {
    const state = quests.stateOf(player.name);
    const active = quests.active(player.name);
    const completedCount = state.claimed.length;
    form.header("§6§lJournal de route");
    form.body(
      [
        "§7Chaque quête accompagne un système réel de NaLandia.",
        `§7Progression : §f${completedCount}/${QUEST_CATALOG.length}§7 récompense(s) récupérée(s).`,
        classes?.classOf(player.name) !== undefined
          ? `§7Voie actuelle : §f${classes.classOf(player.name)?.classId}`
          : "§7Voie actuelle : §8à choisir",
        jobs !== undefined ? `§7Métiers actifs : §f${jobs.jobsOf(player.name).length}` : "",
        `§7Les pistes se déclenchent quand tu vis réellement l'action : classe, mine, clan ou métier.`,
      ].filter((line) => line !== "").join("\n"),
    );
    form.divider();

    if (active.length === 0) {
      form.label("§8Aucune quête suivie. Les prochaines aventures apparaîtront ici.");
    }

    for (const quest of active) {
      const progress = quests.progressOf(player.name, quest.id);
      const ready = quests.isCompleted(player.name, quest.id);
      form.button(
        `${ready ? "§a" : "§e"}${quest.title}§r §7${progress}/${quest.target} — ${rewardLabel(quest.id, quests)}`,
        () => {
          if (!ready) {
            player.sendMessage(`§7[Quêtes] ${quest.description}`);
            return;
          }
          const result = quests.claim(player.name, quest.id);
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
          player.sendMessage(`§6[Quêtes] Récompense récupérée : §f${rewardLabel(quest.id, quests)}§6.`);
          openQuestMenu(player, quests, classes, jobs);
        },
      );
    }

    form.divider();
    form.header("§7Pistes disponibles");
    for (const quest of QUEST_CATALOG.filter((candidate) => !state.active.includes(candidate.id) && !state.claimed.includes(candidate.id))) {
      form.button(`§8Suivre : ${quest.title} §7— ${quest.description}`, () => {
        const result = quests.start(player.name, quest.id);
        if (!result.ok) player.sendMessage(`§c[Quêtes] ${result.error}`);
        openQuestMenu(player, quests, classes, jobs);
      });
    }
  }).catch((error: unknown) => console.warn(`[Quêtes] ${error instanceof Error ? error.message : String(error)}`));
}
