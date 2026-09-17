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

import { Logger, LogLevel } from "@bedrock-oss/bedrock-boost";

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
