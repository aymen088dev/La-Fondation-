/**
 * Types du système de clans/États de NaLandia (revendication de chunks).
 * Historique : cette collection s'appelait "territoires" en v1-v17 — le
 * renommage est purement cosmétique, les données restent compatibles.
 */

/** Rôle d'un membre dans un clan. */
export type ClanRank = "member" | "officer";
export interface TerritoryColor {
  id: string;
  /** Code de couleur Minecraft (§) utilisé pour le drapeau dans les menus/chat. */
  code: string;
}

/** Les 10 couleurs de drapeau proposées dans le menu de création. */
export const TERRITORY_COLORS: TerritoryColor[] = [
  { id: "rouge", code: "§c" },
  { id: "vert", code: "§a" },
  { id: "bleu", code: "§9" },
  { id: "jaune", code: "§e" },
  { id: "or", code: "§6" },
  { id: "violet", code: "§5" },
  { id: "rose", code: "§d" },
  { id: "aqua", code: "§b" },
  { id: "blanc", code: "§f" },
  { id: "gris", code: "§7" },
];

/** Récupère une couleur par son identifiant (fallback : rouge). */
export function getColor(id: string): TerritoryColor {
  return TERRITORY_COLORS.find((color) => color.id === id) ?? TERRITORY_COLORS[0];
}

/** Rang d'un membre de clan ("officer" peut gérer, "member" construit). */
export interface TerritoryMember {
  /** Player.id Bedrock du membre. */
  playerId: string;
  /** Dernier pseudo connu du membre. */
  name: string;
  /** "officer" peut construire et étendre ; "member" peut construire. */
  rank: ClanRank;
}

/** Données persistées d'un clan (collection "territories" de la DB). */
export interface TerritoryData {
  name: string;
  /** Pseudo du propriétaire (compatibilité v1 / affichage). */
  owner: string;
  /** Player.id Bedrock du propriétaire (identité stable v2). */
  ownerId: string;
  /** Pseudo du propriétaire (résolution rapide, v2). */
  ownerName: string;
  /** Membres autorisés à construire (v2). */
  members: TerritoryMember[];
  /** Identifiant de la couleur du drapeau (voir TERRITORY_COLORS). */
  color: string;
  /** Clés des chunks contrôlés : `${dimensionId}:${cx}:${cz}`. */
  chunkKeys: string[];
  createdAt: number;
}
