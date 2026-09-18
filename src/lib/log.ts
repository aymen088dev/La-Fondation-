/**
 * Logging unifié NaLandia basé sur @bedrock-oss/bedrock-boost.
 *
 * Avantages sur console.log :
 *  - niveaux (debug/info/warn/error) filtrables à chaud EN JEU :
 *      /scriptevent log:level <0-5>      (0 = tout, 5 = rien)
 *      /scriptevent log:filter <tags>    (ex : "db,territories")
 *  - tags par module, formatage et horodatage cohérents
 *
 * Le module est initialisé paresseusement au premier getLogger (tôt,
 * en early execution — c'est supporté : simple subscription d'events).
 * Tout est logué en CONSOLE uniquement : rien dans le chat des joueurs.
 */

import { Logger, LogLevel, OutputType } from "@bedrock-oss/bedrock-boost";

/*
 * v18 — ZÉRO message technique dans le chat.
 *
 * Le Logger de bedrock-boost envoie PAR DÉFAUT chaque log dans le chat du
 * monde (OutputType.Chat est dans la config de tous les niveaux) : c'était
 * la source des « [DB] … documents, … octets » vus par les joueurs. On
 * retire la sortie Chat de TOUS les niveaux — les logs passent
 * exclusivement par la console (content log, /scriptevent log:*).
 */
const OUTPUT_CONFIG = Logger.getOutputConfig();
for (const key of Object.keys(OUTPUT_CONFIG)) {
  const level = Number(key) as LogLevel["level"];
  OUTPUT_CONFIG[level] = (OUTPUT_CONFIG[level] ?? []).filter((output) => output !== OutputType.Chat);
}

/** Logger principal (sans tag). */
export const log = Logger.getLogger("NaLandia");

/** Logger de la base de données (tag "db"). */
export const logDb = Logger.getLogger("NaLandia", "db");

/** Logger des territoires (tag "territories"). */
export const logTerr = Logger.getLogger("NaLandia", "territories");

/** Logger de la modération (tag "moderation"). */
export const logMod = Logger.getLogger("NaLandia", "moderation");

/** Logger des permissions/rôles (tag "permissions"). */
export const logPerm = Logger.getLogger("NaLandia", "permissions");

export { Logger, LogLevel };
