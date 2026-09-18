/**
 * CONTRAT DE STYLE ENTRE LES MENUS ET LE MOTEUR JSX — NaLandia v20.
 *
 * ⚠️ CHANGEMENT D'ARCHITECTURE MAJEUR (v20) : le reskin JSON UI maison (deux
 * mises en page devinées via une comparaison de TITRE dans le JSON UI) est
 * REMPLACÉ par le runtime `@bedrock-core/ui`, qui sérialise l'arbre JSX du
 * script dans la chaîne du formulaire ; un « render pack » JSON UI le décode
 * et peint l'écran. Conséquence directe : la mise en page n'est PLUS devinée,
 * elle est CHOISIE par notre propre code au moment d'ouvrir le menu.
 *
 * Ce module est VOLONTAIREMENT SANS AUCUN IMPORT : c'est le seul endroit du
 * projet où l'on peut vérifier par des tests unitaires l'accord entre les menus
 * écrits en TypeScript et le design appliqué (importer `theme.tsx` tirerait
 * `@minecraft/server`, indisponible hors du jeu).
 *
 * Il reste TROIS familles visuelles (plus le mode « formulaire à champs »), et
 * chacune a sa propre silhouette — pas seulement une autre couleur :
 *   - `console`   → menus hub/admin et leurs sous-menus : barre de titre
 *                   (flèche retour à gauche) + colonne de tuiles fines ;
 *   - `cards`     → menus de contenu (Classes, Métiers, Le Monde, Mines,
 *                   États) : GRAND bandeau doré + grandes cartes empilées,
 *                   fond vert émeraude ;
 *   - `parchment` → fiches (Clan, Mon clan, Membres, Membre, Inviter,
 *                   Drapeau, Dissoudre/Créer un clan, Mes infos) : bandeau
 *                   doré + panneau de texte parchemin, fond bleu nuit.
 */

/**
 * Label (invisible) du bouton retour : un code de formatage SEUL, donc aucun
 * texte affiché — la pastille-flèche parle d'elle-même. Conservé pour que les
 * menus qui le passent explicitement restent lisibles.
 */
export const BUTTON_BACK_MARKER = "§r";

/**
 * Texture de la flèche retour (RP/textures/ui/om_btn_back.png). Le moteur la
 * pose dans une vraie pastille cliquable en haut à gauche du bandeau de titre
 * (états normal / survol), et non comme une entrée de liste.
 */
export const BACK_ARROW_ICON = "textures/ui/om_btn_back";

/** Familles visuelles disponibles. */
export type ScreenDesign = "console" | "cards" | "parchment";

/**
 * Silhouette + habillage d'une famille visuelle. Déclaré ICI (module sans
 * import) pour que les tests unitaires puissent vérifier que chaque texture
 * citée existe réellement dans le Resource Pack — une texture manquante rend
 * un cadre ou une carte invisible, sans aucune erreur en jeu.
 */
export interface DesignSpec {
  /** Fond plein écran. */
  bg: string;
  /** Texture du bandeau de titre. */
  banner: string;
  /** Texture des entrées (3 états). */
  row: string;
  rowHover: string;
  rowPress: string;
  /** Hauteur d'une entrée, en pixels. */
  rowHeight: number;
  /** Espacement vertical entre deux entrées. */
  rowGap: number;
  /** Échelle du texte des entrées. */
  scale: number;
  /** Échelle du titre du bandeau. */
  titleScale: number;
}

/** Texture du filet séparateur. */
export const DIVIDER_TEXTURE = "textures/ui/ore-styled/divider/horizontal/default";
/** Texture du panneau de texte des fiches / formulaires. */
export const PANE_TEXTURE = "textures/ui/om_content_bg";

/**
 * ⚠️ SOURCE DE VÉRITÉ des habillages. Toute texture citée doit exister dans
 * `RP/textures/` ; `theme.test.ts` le vérifie et échoue sinon.
 */
export const DESIGN_SPECS: Record<ScreenDesign, DesignSpec> = {
  /* Hub, admin, DB, modération, rôles, joueurs, modules : cuir sombre à cadre
     or, tuiles fines serrées, texte compact. */
  console: {
    bg: "textures/ui/om_ornate_bg",
    banner: "textures/ui/om_header_band",
    row: "textures/ui/om_btn",
    rowHover: "textures/ui/om_btn_hover",
    rowPress: "textures/ui/om_btn_press",
    rowHeight: 22,
    rowGap: 2,
    scale: 1,
    titleScale: 1.1,
  },
  /* Classes, Métiers, Le Monde, Mines, États : vert émeraude, TRÈS grand
     bandeau doré, GRANDES cartes espacées, texte plus gros. */
  cards: {
    bg: "textures/ui/om_sheet_bg",
    banner: "textures/ui/om_sheet_pane",
    row: "textures/ui/om_card",
    rowHover: "textures/ui/om_card_hover",
    rowPress: "textures/ui/om_card_press",
    rowHeight: 36,
    rowGap: 4,
    scale: 1.3,
    titleScale: 1.35,
  },
  /* Fiches : bleu nuit à filet argent — bandeau doré + panneau de texte, et
     une tuile PROPRE (Ore UI), différente de celle du hub/admin. */
  parchment: {
    bg: "textures/ui/om_cards_bg",
    banner: "textures/ui/om_sheet_pane",
    row: "textures/ui/ore-styled/button/secondary/background",
    rowHover: "textures/ui/ore-styled/button/secondary/background_hover",
    rowPress: "textures/ui/ore-styled/button/secondary/background_pressed",
    rowHeight: 24,
    rowGap: 3,
    scale: 1,
    titleScale: 1.2,
  },
};

/** Menus de contenu : grand bandeau + grandes cartes, fond émeraude. */
export const CARD_SECTIONS = [
  "Classes",
  "Classe",
  "Ma voie",
  "Confirmer",
  "États",
  "Le Monde",
  "Mines",
  "Métiers",
] as const;

/** Fiches : bandeau + panneau de texte, fond bleu nuit. */
export const PARCHMENT_SECTIONS = [
  "Clan",
  "Mon clan",
  "Membres du clan",
  "Membre",
  "Inviter",
  "Drapeau",
  "Dissoudre le clan",
  "Créer un clan",
  "Mes infos",
] as const;

/**
 * Toutes les sections qui ne sont PAS la famille `console`.
 * Conservé sous ce nom pour la compatibilité des appelants et des tests.
 */
export const SHEET_SECTIONS = [...CARD_SECTIONS, ...PARCHMENT_SECTIONS] as const;

/** Préfixe de titre normalisé, produit par `windowTitle()`. */
export const TITLE_PREFIX = "NaLandia » ";

/** Titre EXACT reçu par le moteur de formulaires pour une section donnée. */
export function sheetTitleFor(section: string): string {
  return `${TITLE_PREFIX}${section}`;
}

/** Famille visuelle d'une SECTION (nom court, sans préfixe). */
export function designForSection(section: string): ScreenDesign {
  if ((CARD_SECTIONS as readonly string[]).includes(section)) return "cards";
  if ((PARCHMENT_SECTIONS as readonly string[]).includes(section)) return "parchment";
  return "console";
}

/**
 * Famille visuelle d'un TITRE complet (« NaLandia » Section »). Tolère le
 * préfixe décoratif : les fiches à titre fixe comme les sous-menus du hub
 * passent par le même chemin.
 */
export function designForTitle(title: string): ScreenDesign {
  const clean = title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length) : title;
  return designForSection(clean.trim());
}
