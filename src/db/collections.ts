/**
 * Constantes centralisées de la base de données.
 *
 * SOURCE UNIQUE DE VÉRITÉ pour les noms de collections. Les managers
 * importent d'ici (avant : les noms étaient éparpillés dans chaque manager
 * et le menu DB les re-déclarait — risque de désynchronisation).
 */

/** Index des joueurs (identité stable Player.id). */
export const PLAYERS_COLLECTION = "players_index";
/** États (clans) revendiqués — collection historique "territories". */
export const TERRITORY_COLLECTION = "territories";
/** Rôles (id = nom du rôle). */
export const ROLES_COLLECTION = "roles";
/** Grades attribués (id = pseudo, playerId en v3). */
export const MEMBERS_COLLECTION = "members";
/** Bans actifs (id = pseudo). */
export const BANS_COLLECTION = "bans";
/** Mutes actifs (id = pseudo). */
export const MUTES_COLLECTION = "mutes";
/** Avertissements (historique complet). */
export const WARNS_COLLECTION = "warns";
/** Journal des infractions (bans, mutes, warns, kicks...). */
export const INFRACTIONS_COLLECTION = "infractions";
/** État des modules (feature flags). */
export const MODULES_COLLECTION = "modules";
/** Choix de classe des joueurs (id = pseudo, choix définitif). */
export const CLASSES_COLLECTION = "classes";
/** Métiers exercés (un document par joueur × métier). */
export const JOBS_COLLECTION = "jobs";
/** Progression des quêtes (un état par joueur). */
export const QUESTS_COLLECTION = "quests";

/** Métadonnées d'affichage des collections (menu /sn:db). */
export const COLLECTION_META: Record<string, { label: string; hint: string }> = {
  players_index: { label: "Joueurs", hint: "sessions, grade, première/dernière connexion" },
  territories: { label: "États (clans)", hint: "chunks, drapeau, membres" },
  roles: { label: "Rôles", hint: "couleur, prefix, niveau, permissions" },
  members: { label: "Grades attribués", hint: "rôle, prefix et couleur personnalisés" },
  bans: { label: "Bans", hint: "sanctions d'exclusion actives" },
  mutes: { label: "Mutes", hint: "sanctions de chat actives" },
  warns: { label: "Avertissements", hint: "compteur d'avertissements" },
  infractions: { label: "Journal", hint: "historique de toutes les actions de modération" },
  modules: { label: "Modules", hint: "activation des fonctionnalités" },
  classes: { label: "Classes", hint: "route choisie par le joueur (définitive) + XP" },
  jobs: { label: "Métiers", hint: "métiers exercés et leur progression" },
  quests: { label: "Quêtes", hint: "objectifs, progression et récompenses" },
};

/** Ordre d'affichage des sections connues (les inconnues suivent). */
export const SECTION_ORDER = Object.keys(COLLECTION_META);

/** Libellé lisible d'une collection (marqueur de section, icône portée par le bouton DDUI). */
export function collectionLabel(collection: string): string {
  const meta = COLLECTION_META[collection];
  return meta === undefined ? collection : `§f${meta.label}`;
}
