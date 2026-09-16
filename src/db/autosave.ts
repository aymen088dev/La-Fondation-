import { system } from "@minecraft/server";
import type { JsonDatabase } from "./database";

/**
 * Programme une sauvegarde automatique de la base à intervalle régulier.
 * N'écrit réellement que si la base a été modifiée (dirty tracking).
 *
 * @param db             La base à sauvegarder.
 * @param intervalTicks  Intervalle en ticks (20 ticks = 1 seconde). Défaut : 100 (5 s).
 * @returns Fonction pour désactiver l'autosave.
 */
export function registerAutosave(db: JsonDatabase, intervalTicks = 100): () => void {
  const runId = system.runInterval(() => {
    db.save();
  }, intervalTicks);

  return () => system.clearRun(runId);
}
