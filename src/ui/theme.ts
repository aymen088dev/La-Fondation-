/**
 * Thème graphique commun à toutes les GUI OpenMontage.
 *
 * Les icônes pointent vers les textures vanilla du resource pack :
 * chemin relatif "textures/<...>" sans extension .png.
 */

/** Palette du thème. */
export const THEME = {
  /** Couleur principale (vert menthe). */
  primary: "§a",
  /** Couleur secondaire (or). */
  accent: "§6",
  /** Danger. */
  danger: "§c",
  /** Texte discret. */
  muted: "§7",
  /** Titre des fenêtres. */
  brand: "§l§aOM",
} as const;

/** Icônes vanilla réutilisables (chemins resource pack, sans .png). */
export const ICONS = {
  sword: "textures/items/diamond_sword",
  shield: "textures/items/shield_base",
  flag: "textures/items/banner_base",
  crown: "textures/items/golden_helmet",
  book: "textures/items/book_normal",
  compass: "textures/items/compass_item",
  map: "textures/items/map_filled",
  emerald: "textures/items/emerald",
  diamond: "textures/items/diamond",
  goldIngot: "textures/items/gold_ingot",
  ironIngot: "textures/items/iron_ingot",
  clock: "textures/items/clock_item",
  door: "textures/items/door_acacia_upper",
  sign: "textures/items/sign_acacia",
  bell: "textures/items/bell",
  anvil: "textures/items/anvil",
  hammer: "textures/items/iron_pickaxe",
  lock: "textures/items/name_tag",
  paper: "textures/items/paper",
  arrow: "textures/items/arrow",
  barrier: "textures/items/barrier",
  plus: "textures/items/fire_charge",
  wrench: "textures/items/shears",
} as const;

/** Construit un titre de fenêtre normalisé : "§l§aOM §r§8» §r§l<title>". */
export function windowTitle(section: string): string {
  return `§l§aOM §r§8» §r§l${section}`;
}

/** Ligne de séparation pour les body. */
export function divider(): string {
  return "§8─────────────────────";
}
