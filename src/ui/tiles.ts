/**
 * CONTRAT DES MENUS À TUILES — NaLandia (source de vérité UNIQUE).
 *
 * Ce module est la seule description des menus à tuiles. Le pipeline
 * `scripts/build_ui.py` lit le bloc JSON ci-dessous (@ui-contract-begin/end)
 * pour GÉNÉRER les panneaux du Resource Pack : il n'existe donc aucune
 * seconde table à garder en accord — un seul côté peut diverger, et le test
 * `theme.test.ts` vérifie que le JSON généré colle encore à ce contrat.
 *
 * RÈGLES :
 *  - Les noms de sections sont ASCII VOLONTAIREMENT : le JSON UI compare le
 *    titre littéralement (`#title_text = 'NaLandia » Classes'`) et un accent
 *    a déjà fait retomber un menu entier sur le rendu vanilla sans erreur.
 *  - `indexed.actions` : L'ORDRE EST LE CONTRAT. Chaque tuile du panneau est
 *    posée à la main (collection_index) : le script envoie les boutons dans
 *    cet ordre exact, puis les boutons `data` (invisibles, texte transporté).
 *  - `generic` : panneau à factory — une tuile par bouton reçu, dans l'ordre.
 *    Le nombre de boutons est libre mais borné par PANEL_TILE_CAPACITY
 *    (hauteur de colonne) : les listes longues se paginent (pageSlice).
 *
 * Ce module n'importe RIEN : testable hors du jeu.
 */

export interface TileMenuLayout {
  /** Boutons affichés en tuiles, DANS L'ORDRE du panneau. */
  readonly actions: readonly string[];
  /** Boutons invisibles transportant du texte affiché ailleurs. */
  readonly data: readonly string[];
}

export interface TileContract {
  readonly indexed: Readonly<Record<string, TileMenuLayout>>;
  readonly generic: readonly string[];
}

const TILE_MENUS_JSON = (
  // @ui-contract-begin (extrait par scripts/build_ui.py — ne pas renommer)
  {
  "indexed": {
    "Classes": {
      "actions": ["class_0", "class_1", "class_2", "back"],
      "data": ["desc_0", "desc_1", "desc_2"]
    },
    "Mon clan": {
      "actions": ["bio", "claim", "members", "flag", "quit", "back"],
      "data": ["flag_id", "flag_name"]
    },
    "Menu": {
      "actions": ["states", "infos", "quests", "world", "moderation", "admin", "back"],
      "data": []
    },
    "Administration": {
      "actions": ["roles", "players", "modules", "db", "classes", "states", "back"],
      "data": []
    },
    "Nations": {
      "actions": ["clan_0", "clan_1", "clan_2", "prev", "next", "create", "back"],
      "data": []
    },
    "Mes infos": {
      "actions": ["classe", "jobs", "clan", "states", "quests", "gifts", "back"],
      "data": []
    },
    "Le Monde": {
      "actions": ["overworld", "mines", "ores", "where", "help", "close", "back"],
      "data": []
    }
  },
  "generic": [
    "Mines",
    "Moderation",
    "Bans",
    "Mutes",
    "Roles",
    "Joueurs",
    "Membres",
    "Membre",
    "Modules",
    "Metiers",
    "Quetes",
    "Drapeau",
    "Dissoudre",
    "Base de donnees"
  ]
  }
  // @ui-contract-end
) as const;

export const TILE_MENUS: TileContract = TILE_MENUS_JSON;

/** Toutes les sections à tuiles (menus dessinés par le Resource Pack). */
export type TileSection =
  | keyof typeof TILE_MENUS_JSON.indexed
  | (typeof TILE_MENUS_JSON.generic)[number];

/** Nombre de tuiles visibles dans la colonne d'un panneau générique. */
export const PANEL_TILE_CAPACITY = 8;

/** Vrai si la section possède un rendu à tuiles. */
export function isTileSection(section: string): section is TileSection {
  return (
    section in TILE_MENUS_JSON.indexed ||
    (TILE_MENUS_JSON.generic as readonly string[]).includes(section)
  );
}

/** Titre EXACT du formulaire — c'est lui que le JSON UI compare. */
export const TITLE_PREFIX = "NaLandia » ";

export function tileTitleFor(section: TileSection): string {
  return `${TITLE_PREFIX}${section}`;
}

/** Nombre total de boutons envoyés au formulaire pour une section. */
export function tileButtonCount(section: TileSection): number {
  const layout = (TILE_MENUS_JSON.indexed as Record<string, TileMenuLayout>)[section];
  if (layout === undefined) return 0;
  return layout.actions.length + layout.data.length;
}

/** Tous les index de collection qu'un panneau indexé doit déclarer. */
export function expectedTileIndexes(section: TileSection): number[] {
  return Array.from({ length: tileButtonCount(section) }, (_u, i) => i);
}

/**
 * Pagination des listes génériques : la colonne affiche PANEL_TILE_CAPACITY
 * tuiles, donc toute liste dynamique (joueurs, rôles, bans…) est découpée.
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
