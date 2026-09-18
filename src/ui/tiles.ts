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

/** Menus rendus en tuiles (les autres restent en formulaires natifs). */
export type TileSection = "Classes" | "Mon clan";

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
};

/** Toutes les sections à tuiles. */
export const TILE_SECTIONS: readonly TileSection[] = ["Classes", "Mon clan"];

/**
 * Noms des contrôles correspondants dans `RP/ui/server_form.json`. Le test
 * unitaire s'en sert pour retrouver le panneau d'un menu et vérifier qu'il
 * déclare bien tous les index de la collection `form_buttons`.
 */
export const TILE_PANELS: Record<TileSection, { controller: string; panel: string }> = {
  Classes: { controller: "om_classes_form", panel: "server_form.om_classes_panel" },
  "Mon clan": { controller: "om_clan_form", panel: "server_form.om_clan_panel" },
};

/** Vrai si la section possède un rendu à tuiles. */
export function isTileSection(section: string): section is TileSection {
  return (TILE_SECTIONS as readonly string[]).includes(section);
}

/** Titre EXACT du formulaire, celui sur lequel le JSON UI filtre. */
export function tileTitleFor(section: TileSection): string {
  return sheetTitleFor(section);
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
