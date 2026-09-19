/**
 * Contrat de présentation (tuiles/libellés) — module PUR, testable hors jeu.
 *
 * - Helpers de texte : pagination, bornage, découpe.
 * - THEMES : le libellé de section ↔ son identité visuelle côté RP
 *   (`scripts/build_server_form.py`). Le moteur appelle `themeForSection`
 *   pour ne JAMAIS inventer une texture inexistante.
 */

/** Nombre de tuiles visibles dans une colonne de liste. */
export const PANEL_TILE_CAPACITY = 8;

/** Thème visuel d'une section (dalles om_* vendues dans le RP). */
export interface MenuTheme {
  /** Nom du thème (textures om_menu_<nom>_{bg,card,card_hover,card_press}). */
  id: string;
}

/**
 * Section → thème. Les clés sont les TITRES réels passés à `openTileMenu`
 * ( sans accents, casse ignorée — voir `normalizeSection`).
 */
export const THEMES: Record<string, MenuTheme> = {
  menu: { id: "base" },
  administration: { id: "base" },
  nations: { id: "base" },
  "mes infos": { id: "base" },
  "le monde": { id: "mines" },
  mines: { id: "mines" },
  "mon clan": { id: "membres" },
  membres: { id: "membres" },
  membre: { id: "membre" },
  drapeau: { id: "drapeau" },
  dissoudre: { id: "dissoudre" },
  classes: { id: "metiers" },
  metiers: { id: "metiers" },
  quetes: { id: "quetes" },
  moderation: { id: "moderation" },
  bans: { id: "bans" },
  mutes: { id: "mutes" },
  roles: { id: "roles" },
  joueurs: { id: "joueurs" },
  modules: { id: "modules" },
  "base de donnees": { id: "modules" },
};

/** Thème de secours (sections inconnues / futures). */
export const DEFAULT_THEME: MenuTheme = { id: "base" };

/** Normalise un titre de section : sans accents, sans codes §, minuscule. */
export function normalizeSection(section: string): string {
  return section
    .replace(/§./g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Thème d'une section (jamais undefined : repli sûr). */
export function themeForSection(section: string): MenuTheme {
  return THEMES[normalizeSection(section)] ?? DEFAULT_THEME;
}

/**
 * Pagination des listes : découpe une liste dynamique (joueurs, rôles,
 * bans…) en pages de `perPage` entrées, avec bornage de l'index demandé.
 */
export function pageSlice<T>(
  items: readonly T[],
  page: number,
  perPage: number,
): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / Math.max(1, perPage)));
  const current = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  return {
    items: items.slice(current * perPage, current * perPage + perPage),
    page: current,
    pageCount,
  };
}

/** Borne un libellé à `max` caractères VISIBLES (codes § non comptés). */
export function fitLabel(text: string, max: number): string {
  const visible = text.replace(/§./g, "");
  if (visible.length <= max) return text;
  let kept = 0;
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const pair = text.slice(index, index + 2);
    if (/^§./.test(pair)) {
      out += pair;
      index++;
      continue;
    }
    if (kept >= max - 1) break;
    out += text[index];
    kept++;
  }
  return `${out}…`;
}

/** Découpe un texte en AU PLUS `lines` lignes de `width` caractères visibles. */
export function wrapLabel(text: string, width: number, lines: number): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  let cut = false;
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.replace(/§./g, "").length <= width) {
      current = candidate;
      continue;
    }
    if (current.length > 0) out.push(current);
    current = word;
    if (out.length === lines) {
      cut = true;
      break;
    }
  }
  if (current.length > 0 && out.length < lines) out.push(current);
  else if (current.length > 0) cut = true;
  const kept = out.slice(0, lines);
  if (cut && kept.length > 0) {
    const last = kept.length - 1;
    const trimmed = fitLabel(kept[last] as string, width - 1);
    kept[last] = trimmed.endsWith("…") ? trimmed : `${trimmed}…`;
  }
  return kept.join("\n");
}
