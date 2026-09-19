/**
 * CONTRAT DES MENUS À TUILES — NaLandia.
 *
 * Les menus à tuiles n'utilisent PAS `CustomForm` (flux vertical imposé) mais
 * `ActionFormData` : une liste de boutons dont on connaît l'INDEX. Côté
 * Resource Pack, `RP/ui/server_form.json` remplace le rendu `long_form` par un
 * panneau dessiné à la main, où chaque tuile est cliquable et pointe vers
 * l'index de bouton correspondant (`collection_index`).
 *
 * Conséquence importante : l'ORDRE des boutons envoyés par le script est un
 * contrat. Ce module est la SOURCE DE VÉRITÉ de cet ordre, et il n'importe rien
 * (donc il est testable hors du jeu) :
 *
 *   - `actions` : boutons réellement affichés en tuiles, dans l'ordre ;
 *   - `data`    : boutons invisibles qui ne servent qu'à TRANSPORTER du texte
 *                 affiché ailleurs (description d'une carte, identifiant du
 *                 drapeau, nom du drapeau…). Le JSON UI les lit via
 *                 `#form_button_text` sur l'index correspondant.
 *
 * `theme.test.ts` vérifie que le JSON UI déclare bien exactement ces index :
 * si l'un des deux côtés change sans l'autre, les tuiles se décalent.
 */
import { sheetTitleFor } from "./sheets";

/**
 * Menus rendus en tuiles (les autres restent en formulaires natifs).
 *
 * ⚠️ TOUS LES NOMS DE SECTIONS SONT EN ASCII VOLONTAIREMENT : le titre du
 * formulaire est comparé littéralement dans le JSON UI (`#title_text`), et un
 * caractère accentué a déjà fait retomber un menu entier (« États ») sur le
 * cadre vanilla sans que rien ne le signale côté script. La section garde donc
 * un nom sans accent (« Nations ») même si l'interface, elle, peut écrire
 * « États » dans son texte.
 */
export type TileSection =
  /* Menus à emplacements INDEXÉS (mise en page dessinée à la main). */
  | "Classes"
  | "Mon clan"
  | "Menu"
  | "Administration"
  | "Nations"
  | "Mes infos"
  | "Le Monde"
  /* Menus à LISTE GÉNÉRIQUE : le panneau instancie une tuile par bouton reçu
     (factory `form_buttons`), donc leur nombre n'est pas figé — c'est le script
     qui décide, et l'ordre des boutons EST l'ordre des actions. */
  | "Mines"
  | "Moderation"
  | "Bans"
  | "Mutes"
  | "Roles"
  | "Joueurs"
  | "Membres"
  | "Membre"
  | "Modules"
  | "Metiers"
  | "Quetes"
  | "Drapeau"
  | "Dissoudre"
  | "Base de donnees";

export interface TileMenuLayout {
  actions: readonly string[];
  data: readonly string[];
}

export const TILE_MENUS: Record<TileSection, TileMenuLayout> = {
  /**
   * Classes : trois grandes cartes verticales (une par voie) + la barre de
   * retour. Les descriptions sont transportées par des boutons invisibles
   * placés SOUS les cartes dans la collection, afin que chaque texte reste
   * une ligne indépendante (pas de texte multi-lignes dans un bouton).
   */
  Classes: {
    actions: ["class_0", "class_1", "class_2", "back"],
    data: ["desc_0", "desc_1", "desc_2"],
  },
  /**
   * Mon clan : emplacement banque (haut gauche), drapeau (haut droite) puis
   * les actions en bas. Le drapeau est transporté par deux boutons invisibles :
   * son identifiant (pour choisir la bannière affichée) et son nom lisible.
   */
  "Mon clan": {
    actions: ["bio", "claim", "members", "flag", "quit", "back"],
    data: ["flag_id", "flag_name"],
  },
  /**
   * Hub : six sections en colonne à gauche, l'accueil (rôle, classe, clan,
   * statistiques) dans le panneau de droite. Les sections indisponibles pour
   * le joueur restent affichées en grisé plutôt que de décaler la colonne.
   */
  Menu: {
    actions: ["states", "infos", "quests", "world", "moderation", "admin", "back"],
    data: [],
  },
  /**
   * Admin : même géométrie que le hub (demandé « hub et admin similaires »),
   * donc même nombre de boutons — la dernière entrée est la barre de retour.
   */
  Administration: {
    actions: ["roles", "players", "modules", "db", "classes", "states", "back"],
    data: [],
  },
  /**
   * Nations : liste paginée des États/clans. Trois nations par page (plus de
   * place pour la fiche), puis page précédente, page suivante, et fondation.
   */
  Nations: {
    actions: ["clan_0", "clan_1", "clan_2", "prev", "next", "create", "back"],
    data: [],
  },
  /** Mes infos : fiche du joueur à droite, actions de navigation à gauche. */
  "Mes infos": {
    actions: ["classe", "jobs", "clan", "states", "quests", "gifts", "back"],
    data: [],
  },
  /**
   * Le Monde : deux GRANDES cartes (monde normal / mine) puis les repères et
   * les outils rangés SOUS les cartes, et la fermeture en bas.
   */
  "Le Monde": {
    actions: ["overworld", "mines", "ores", "where", "help", "close", "back"],
    data: [],
  },

  /* ------------------------------------------------------------------------
   * Menus à LISTE GÉNÉRIQUE : contrat VIDE, volontairement. Le panneau est une
   * factory : il rend une tuile par bouton envoyé, dans l'ordre, et l'index de
   * sélection EST l'index d'envoi. Rien à synchroniser ici, donc rien à casser.
   * ---------------------------------------------------------------------- */
  Mines: { actions: [], data: [] },
  Moderation: { actions: [], data: [] },
  Bans: { actions: [], data: [] },
  Mutes: { actions: [], data: [] },
  Roles: { actions: [], data: [] },
  Joueurs: { actions: [], data: [] },
  Membres: { actions: [], data: [] },
  Membre: { actions: [], data: [] },
  Modules: { actions: [], data: [] },
  Metiers: { actions: [], data: [] },
  Quetes: { actions: [], data: [] },
  Drapeau: { actions: [], data: [] },
  Dissoudre: { actions: [], data: [] },
  "Base de donnees": { actions: [], data: [] },
};

/** Toutes les sections à tuiles. */
export const TILE_SECTIONS: readonly TileSection[] = [
  "Classes",
  "Mon clan",
  "Menu",
  "Administration",
  "Nations",
  "Mes infos",
  "Le Monde",
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
  "Base de donnees",
];

/**
 * Noms des contrôles correspondants dans `RP/ui/server_form.json`. Le test
 * unitaire s'en sert pour retrouver le panneau d'un menu et vérifier qu'il
 * déclare bien tous les index de la collection `form_buttons`.
 */
export interface TilePanelSpec {
  controller: string;
  panel: string;
  size: [number, number];
  /**
   * `true` : la mise en page dessine des emplacements numérotés
   * (`collection_index`) — le contrat `actions` doit alors coller au pixel.
   * `false` : panneau à factory, une tuile par bouton reçu.
   */
  indexed: boolean;
  /**
   * Identifiant du THÈME visuel du menu (menus à liste seulement). Chaque menu
   * de liste a le sien : c'est ce qui lui donne sa fenêtre et ses cartes, donc
   * « des menus uniques » au lieu de trois familles partagées.
   */
  theme?: string;
}

/**
 * THÈMES DES MENUS À LISTE — chaque menu de liste possède sa propre déclinaison
 * (fenêtre `om_menu_<id>_bg` + cartes `om_menu_<id>_card*`), générée par
 * `scripts/make_ui_textures.py`. Aucun menu ne partage donc son cadre avec un
 * autre : la teinte d'accent est la seule chose qui change, ce qui garde le
 * thème or & argent cohérent tout en donnant une identité à chaque écran.
 *
 * `titleColor` est la couleur EXACTE écrite dans `server_form.json` : le test
 * unitaire compare les deux, donc une désynchronisation se voit tout de suite.
 */
export interface MenuTheme {
  id: string;
  titleColor: [number, number, number];
}

export const MENU_THEMES: Partial<Record<TileSection, MenuTheme>> = {
  Mines: { id: "mines", titleColor: [0.79, 0.73, 0.64] },
  Moderation: { id: "moderation", titleColor: [0.82, 0.62, 0.62] },
  Bans: { id: "bans", titleColor: [0.76, 0.59, 0.59] },
  Mutes: { id: "mutes", titleColor: [0.79, 0.67, 0.77] },
  Roles: { id: "roles", titleColor: [0.72, 0.68, 0.84] },
  Joueurs: { id: "joueurs", titleColor: [0.65, 0.75, 0.84] },
  Membres: { id: "membres", titleColor: [0.64, 0.78, 0.76] },
  Membre: { id: "membre", titleColor: [0.62, 0.75, 0.8] },
  Modules: { id: "modules", titleColor: [0.82, 0.75, 0.65] },
  Metiers: { id: "metiers", titleColor: [0.81, 0.71, 0.62] },
  Quetes: { id: "quetes", titleColor: [0.79, 0.77, 0.65] },
  Drapeau: { id: "drapeau", titleColor: [0.77, 0.68, 0.8] },
  Dissoudre: { id: "dissoudre", titleColor: [0.8, 0.6, 0.6] },
  "Base de donnees": { id: "base", titleColor: [0.71, 0.73, 0.77] },
};

/** Fenêtre (grand cadre) d'un thème de menu. */
export function menuFrameTexture(theme: MenuTheme): string {
  return `textures/ui/om_menu_${theme.id}_bg`;
}

/** Carte (tuile) d'un thème de menu, pour l'état demandé. */
export function menuCardTexture(theme: MenuTheme, state: "off" | "hover" | "press" = "off"): string {
  const suffix = state === "off" ? "" : `_${state}`;
  return `textures/ui/om_menu_${theme.id}_card${suffix}`;
}

export const TILE_PANELS: Record<TileSection, TilePanelSpec> = {
  Classes: { controller: "om_classes_root", panel: "server_form.om_classes_panel", size: [340, 236], indexed: true },
  "Mon clan": { controller: "om_clan_root", panel: "server_form.om_clan_panel", size: [288, 224], indexed: true },
  Menu: { controller: "om_hub_root", panel: "server_form.om_console_panel", size: [288, 196], indexed: true },
  Administration: {
    controller: "om_admin_root",
    panel: "server_form.om_console_panel",
    size: [288, 196],
    indexed: true,
  },
  Nations: { controller: "om_nations_root", panel: "server_form.om_list_emerald", size: [300, 216], indexed: true },
  "Mes infos": { controller: "om_info_root", panel: "server_form.om_sheet_blue", size: [300, 216], indexed: true },
  "Le Monde": { controller: "om_world_root", panel: "server_form.om_world_panel", size: [340, 236], indexed: true },

  /*
   * Menus à LISTE : un panneau COMMUN (`om_menu_panel`, la mécanique) et un
   * THÈME PAR MENU (les variables `$frame` / `$tile` / `$title_color` passées
   * par l'instance du contrôle). Chaque menu a donc sa propre fenêtre et ses
   * propres cartes colorées, sans dupliquer la mise en page.
   */
  Mines: { controller: "om_mines_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "mines" },
  Moderation: { controller: "om_moderation_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "moderation" },
  Bans: { controller: "om_bans_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "bans" },
  Mutes: { controller: "om_mutes_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "mutes" },
  Roles: { controller: "om_roles_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "roles" },
  Joueurs: { controller: "om_joueurs_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "joueurs" },
  Membres: { controller: "om_membres_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "membres" },
  Membre: { controller: "om_membre_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "membre" },
  Modules: { controller: "om_modules_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "modules" },
  Metiers: { controller: "om_metiers_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "metiers" },
  Quetes: { controller: "om_quetes_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "quetes" },
  Drapeau: { controller: "om_drapeau_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "drapeau" },
  Dissoudre: { controller: "om_dissoudre_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "dissoudre" },
  "Base de donnees": { controller: "om_base_root", panel: "server_form.om_menu_panel", size: [300, 236], indexed: false, theme: "base" },
};

/**
 * Nombre de tuiles que la colonne de gauche des panneaux génériques peut
 * afficher sans écraser le bas du cadre (hauteur de colonne 192 px, pas de
 * 23 px). C'est un BUDGET : un menu qui envoie plus de tuiles que ça en perd
 * silencieusement — les menus paginés s'y tiennent.
 */
export const PANEL_TILE_CAPACITY = 8;

/**
 * Pagination des listes à tuiles : ces panneaux affichent une poignée de
 * tuiles, donc toute liste dynamique (joueurs, rôles, bans, membres…) est
 * découpée en pages — le script envoie « page précédente / page suivante ».
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

/** Vrai si la section possède un rendu à tuiles. */
export function isTileSection(section: string): section is TileSection {
  return (TILE_SECTIONS as readonly string[]).includes(section);
}

/** Titre EXACT du formulaire, celui sur lequel le JSON UI filtre. */
export function tileTitleFor(section: TileSection): string {
  return sheetTitleFor(section);
}

/**
 * Borne un libellé de tuile à `max` caractères VISIBLES (codes § non comptés).
 *
 * Les tuiles du JSON UI ont une taille fixe : un texte trop long débordait de
 * sa case (« le texte et mis chelou », « sans dépasser la limite »). On coupe
 * donc à la source, proprement, avec des points de suspension.
 */
/**
 * Découpe un texte en AU PLUS `lines` lignes de `width` caractères VISIBLES
 * (codes § conservés mais non comptés). Sert aux zones de texte des cartes,
 * qui ont une taille fixe : « le texte sans dépasser la limite ».
 */
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
      // Il reste des mots qu'on ne peut pas placer : on le signale.
      cut = true;
      break;
    }
  }
  if (current.length > 0 && out.length < lines) out.push(current);
  else if (current.length > 0) cut = true;
  // Ce qui reste est coupé net : mieux vaut une ligne tronquée qu'un débordement.
  const kept = out.slice(0, lines);
  if (cut && kept.length > 0) {
    const last = kept.length - 1;
    const trimmed = fitLabel(kept[last] as string, width - 1);
    kept[last] = trimmed.endsWith("…") ? trimmed : `${trimmed}…`;
  }
  return kept.join("\n");
}

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

/** Index (dans `form_buttons`) du premier bouton porteur de données. */
export function dataIndexBase(section: TileSection): number {
  return TILE_MENUS[section].actions.length;
}

/** Tous les index de collection que le JSON UI doit déclarer. */
export function expectedTileIndexes(section: TileSection): number[] {
  return Array.from({ length: tileButtonCount(section) }, (_unused, index) => index);
}

/** Index du bouton d'action correspondant à une clé (ou -1). */
export function actionIndex(section: TileSection, key: string): number {
  return TILE_MENUS[section].actions.indexOf(key);
}

/** Index du bouton porteur de données correspondant à une clé (ou -1). */
export function dataIndex(section: TileSection, key: string): number {
  const offset = TILE_MENUS[section].data.indexOf(key);
  return offset === -1 ? -1 : dataIndexBase(section) + offset;
}

/** Nombre total de boutons envoyés au formulaire. */
export function tileButtonCount(section: TileSection): number {
  const layout = TILE_MENUS[section];
  return layout.actions.length + layout.data.length;
}
