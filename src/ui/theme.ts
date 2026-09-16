/**
 * Thème graphique commun à toutes les GUI OpenMontage.
 *
 * ⚠️ Tous les chemins d'icônes sont VÉRIFIÉS contre Mojang/bedrock-samples
 * (fichier .png existant dans resource_pack/textures/). Un chemin invalide
 * = bouton silencieusement sans icône — c'était la cause des icônes manquantes.
 */

import type { Player } from "@minecraft/server";
import {
  CustomForm,
  ObservableString,
  ObservableNumber,
  ObservableBoolean,
} from "@minecraft/server-ui";
import type { DataDrivenScreenClosedReason } from "@minecraft/server-ui";

/** Identifiant du Resource Pack OpenMontage (header.name de RP/manifest.json).
 *  Utilisé par CustomForm.image(src, pack) de l'API DDUI (bêta). */
export const RP_PACK_ID = "OpenMontage UI";

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
} as const;

/** Icônes vanilla vérifiées (chemins resource pack, sans .png). */
export const ICONS = {
  // --- items (textures/items/*.png vérifiés) ---
  sword: "textures/items/diamond_sword",
  book: "textures/items/book_normal",
  bookWritable: "textures/items/book_writable",
  compass: "textures/items/compass_item",
  map: "textures/items/map_filled",
  emerald: "textures/items/emerald",
  diamond: "textures/items/diamond",
  goldIngot: "textures/items/gold_ingot",
  ironIngot: "textures/items/iron_ingot",
  clock: "textures/items/clock_item",
  door: "textures/items/crimson_door",
  sign: "textures/items/sign_acacia",
  helmet: "textures/items/iron_helmet",
  chainHelmet: "textures/items/chainmail_helmet",
  pickaxe: "textures/items/iron_pickaxe",
  nameTag: "textures/items/name_tag",
  paper: "textures/items/paper",
  arrow: "textures/items/arrow",
  shears: "textures/items/shears",
  bannerPattern: "textures/items/banner_pattern",
  campfire: "textures/items/campfire",
  // --- ui (textures/ui/*.png vérifiés) ---
  banner: "textures/ui/banners_dark",
  iconSetting: "textures/ui/icon_setting",
  iconImport: "textures/ui/icon_import",
  iconTrash: "textures/ui/icon_trash",
  iconNew: "textures/ui/icon_new",
  iconTimer: "textures/ui/icon_timer",
  iconMap: "textures/ui/icon_map",
  iconMail: "textures/ui/icon_mail",
  iconLock: "textures/ui/icon_lock",
  iconMultiplayer: "textures/ui/icon_multiplayer",
  iconSteve: "textures/ui/icon_steve",
  iconCrafting: "textures/ui/icon_crafting",
  check: "textures/ui/check",
  boxExit: "textures/ui/box_exit",
  downloadBackup: "textures/ui/download_backup",
  autoSave: "textures/ui/auto_save",
  freeDownload: "textures/ui/free_download",
  bell: "textures/ui/icon_bell",
  armor: "textures/ui/icon_armor",
  random: "textures/ui/icon_random",
  expand: "textures/ui/icon_expand",
  // --- alias sémantiques (mêmes textures vérifiées) ---
  barrier: "textures/blocks/barrier",
  crown: "textures/items/iron_helmet",
  shield: "textures/ui/icon_armor",
  flag: "textures/ui/banners_dark",
  lock: "textures/ui/icon_lock",
  plus: "textures/ui/icon_new",
  wrench: "textures/items/shears",
  anvil: "textures/blocks/anvil_base",
  save: "textures/ui/download_backup",
  trash: "textures/ui/icon_trash",
  danger: "textures/ui/box_exit",
} as const;

/**
 * Fond de panneau custom (RP OpenMontage, généré par make_placeholder_pngs).
 * Affichable via CustomForm.image() avec RP_PACK_ID.
 */
export const OM_PANEL_TEXTURE = "textures/ui/om_actionbar_bg";

/** Construit un titre de fenêtre normalisé : "§l§aOM §r§8» §r§l<title>". */
export function windowTitle(section: string): string {
  return `§l§aOM §r§8» §r§l${section}`;
}

/** Ligne de séparation pour les body. */
export function divider(): string {
  return "§8─────────────────────";
}

// ---------------------------------------------------------------------------
// Moteur DDUI (CustomForm, bêta server-ui 2.3) — la vraie UI custom.
// Contrairement aux forms vanilla (ActionFormData...), les boutons ont des
// CALLBACKS DIRECTS (pas d'indexation fragile par position), et le layout
// est riche : headers, dividers, toggles, images du RP.
// ---------------------------------------------------------------------------

/** Texte lié ( champ éditable, label réactif). */
export function obString(initial: string): ObservableString {
  return new ObservableString(initial);
}

/** Nombre lié (slider, dropdown). */
export function obNumber(initial: number): ObservableNumber {
  return new ObservableNumber(initial);
}

/** Booléen lié (toggle). */
export function obBool(initial: boolean): ObservableBoolean {
  return new ObservableBoolean(initial);
}

/**
 * Booléen lié avec callback au changement — pour les toggles DDUI dont
 * l'effet doit être immédiat (ex : activer/désactiver un module).
 */
export function obToggle(
  initial: boolean,
  onChange: (value: boolean) => void,
): ObservableBoolean {
  const observable = new ObservableBoolean(initial);
  observable.subscribe(onChange);
  return observable;
}

/**
 * Ouvre une fenêtre DDUI (CustomForm) avec le titre OpenMontage et un
 * bouton de fermeture. Les composants sont ajoutés via le callback.
 */
export async function openWindow(
  player: Player,
  section: string,
  build: (form: CustomForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  const form = new CustomForm(player, windowTitle(section));
  build(form);
  form.closeButton();
  return form.show();
}

/** Fenêtre DDUI sans bouton fermer intégré (le menu gère ses retours). */
export async function openWindowRaw(
  player: Player,
  title: string,
  build: (form: CustomForm) => void,
): Promise<DataDrivenScreenClosedReason> {
  const form = new CustomForm(player, title);
  build(form);
  return form.show();
}
