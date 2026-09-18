/**
 * Système de quêtes NaLandia.
 *
 * Le moteur est volontairement événementiel : les modules de gameplay signalent
 * une action (`record`) et le manager s'occupe de la progression, de la
 * validation et de la récompense. Cela évite de coupler les quêtes aux menus.
 */
import type { JsonDatabase } from "../db";
import { QUESTS_COLLECTION } from "../db/collections";

export type QuestEvent = "choose_class" | "enter_mines" | "found_clan" | "start_job";

export interface QuestReward {
  classXp?: number;
  jobXp?: number;
}

export interface QuestDefinition {
  id: string;
  title: string;
  category: "origins" | "territory" | "mastery";
  description: string;
  event: QuestEvent;
  target: number;
  reward: QuestReward;
}

export interface QuestState {
  playerName: string;
  active: string[];
  progress: Record<string, number>;
  completed: string[];
  claimed: string[];
}

export type QuestResult =
  | { ok: true; state: QuestState }
  | { ok: false; error: string };

/** Première série de quêtes : courte, lisible et reliée aux systèmes existants. */
export const QUEST_CATALOG: readonly QuestDefinition[] = [
  {
    id: "first_route",
    title: "Trouver sa voie",
    category: "origins",
    description: "Choisis une classe et engage ton aventure.",
    event: "choose_class",
    target: 1,
    reward: { classXp: 25 },
  },
  {
    id: "under_the_stone",
    title: "Sous la pierre",
    category: "mastery",
    description: "Entre dans la dimension minière et découvre ses strates.",
    event: "enter_mines",
    target: 1,
    reward: { classXp: 20 },
  },
  {
    id: "a_place_to_belong",
    title: "Un endroit à soi",
    category: "territory",
    description: "Fonde ou rejoins un clan pour avoir une place sur la carte.",
    event: "found_clan",
    target: 1,
    reward: { classXp: 30 },
  },
  {
    id: "learn_a_trade",
    title: "Le premier métier",
    category: "mastery",
    description: "Commence un métier et donne une direction à tes récoltes.",
    event: "start_job",
    target: 1,
    reward: { jobXp: 15 },
  },
];

function definitionOf(id: string): QuestDefinition | undefined {
  return QUEST_CATALOG.find((quest) => quest.id === id);
}

export class QuestManager {
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  stateOf(playerName: string): QuestState {
    const existing = this.db.findOne<QuestState>(QUESTS_COLLECTION, playerName);
    if (existing !== undefined) return existing.data;
    const state: QuestState = {
      playerName,
      active: [],
      progress: {},
      completed: [],
      claimed: [],
    };
    this.db.insert(QUESTS_COLLECTION, state, playerName);
    return state;
  }

  questOf(id: string): QuestDefinition | undefined {
    return definitionOf(id);
  }

  active(playerName: string): QuestDefinition[] {
    const state = this.stateOf(playerName);
    return state.active.map(definitionOf).filter((quest): quest is QuestDefinition => quest !== undefined);
  }

  progressOf(playerName: string, questId: string): number {
    return this.stateOf(playerName).progress[questId] ?? 0;
  }

  isCompleted(playerName: string, questId: string): boolean {
    return this.stateOf(playerName).completed.includes(questId);
  }

  start(playerName: string, questId: string): QuestResult {
    const quest = definitionOf(questId);
    if (quest === undefined) return { ok: false, error: "Quête inconnue." };
    const state = this.stateOf(playerName);
    if (state.claimed.includes(questId)) return { ok: false, error: "Cette quête est déjà terminée." };
    if (state.active.includes(questId)) return { ok: false, error: "Cette quête est déjà suivie." };
    state.active.push(questId);
    state.progress[questId] ??= 0;
    this.touch(state);
    return { ok: true, state };
  }

  /** Enregistre une action de gameplay et valide les quêtes concernées. */
  record(playerName: string, event: QuestEvent, amount = 1): QuestDefinition[] {
    if (amount <= 0) return [];
    const state = this.stateOf(playerName);
    const completedNow: QuestDefinition[] = [];
    for (const quest of QUEST_CATALOG) {
      if (quest.event !== event || state.claimed.includes(quest.id)) continue;
      // Les quêtes de l'introduction peuvent être démarrées automatiquement
      // au premier événement ; les autres restent opt-in depuis le menu.
      if (!state.active.includes(quest.id)) state.active.push(quest.id);
      const before = state.progress[quest.id] ?? 0;
      const after = Math.min(quest.target, before + amount);
      state.progress[quest.id] = after;
      if (after >= quest.target && !state.completed.includes(quest.id)) {
        state.completed.push(quest.id);
        completedNow.push(quest);
      }
    }
    this.touch(state);
    return completedNow;
  }

  claim(playerName: string, questId: string): QuestResult & { reward?: QuestReward } {
    const quest = definitionOf(questId);
    if (quest === undefined) return { ok: false, error: "Quête inconnue." };
    const state = this.stateOf(playerName);
    if (!state.completed.includes(questId)) return { ok: false, error: "La quête n'est pas encore terminée." };
    if (state.claimed.includes(questId)) return { ok: false, error: "Récompense déjà récupérée." };
    state.claimed.push(questId);
    state.active = state.active.filter((id) => id !== questId);
    this.touch(state);
    return { ok: true, state, reward: quest.reward };
  }

  private touch(state: QuestState): void {
    const doc = this.db.findOne<QuestState>(QUESTS_COLLECTION, state.playerName);
    if (doc !== undefined) doc.updatedAt = Date.now();
    this.db.markDirty();
  }
}
