import { system } from "@minecraft/server";
import type { JsonDatabase } from "./database";

/**
 * Programme une sauvegarde automatique de la base à intervalle régulier.
 *
 * N'écrit que si la base a été modifiée (dirty tracking) et uniquement
 * après le premier chargement : avant worldLoad, écrire écraserait la DB
 * avec une base vide car les Dynamic Properties ne sont pas encore
 * lisibles (et donc la base pas encore rechargée).
 *
 * @param db             La base à sauvegarder.
 * @param intervalTicks  Intervalle en ticks (20 ticks = 1 seconde). Défaut : 100 (5 s).
 * @returns Fonction pour désactiver l'autosave.
 */
export function registerAutosave(db: JsonDatabase, intervalTicks = 100): () => void {
  const runId = system.runInterval(() => {
    if (!db.loaded) return;
    db.save();
  }, intervalTicks);

  return () => system.clearRun(runId);
}
