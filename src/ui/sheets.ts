/**
 * CONTRAT DE STYLE ENTRE LE MOTEUR ET LE JSON UI — NaLandia v19.3.
 *
 * Ce module est VOLONTAIREMENT SANS AUCUN IMPORT : c'est le seul endroit du
 * projet où l'on peut vérifier, par des tests unitaires, l'accord entre les
 * menus écrits en TypeScript et le reskin JSON UI du Resource Pack. (Importer
 * theme.ts dans un test tirerait `@minecraft/server`, indisponible hors du
 * jeu.)
 *
 * POURQUOI CE CONTRAT : Bedrock n'expose qu'UN seul écran pour tous les menus
 * à boutons (`long_form`), donc le JSON UI ne peut pas savoir quel menu est
 * ouvert… sauf par le TITRE, seul canal que le script contrôle et que le JSON
 * UI peut comparer. C'est ce titre qui choisit la variante visuelle :
 *  - sections listées dans SHEET_SECTIONS → variante « FICHES » (grand cadre
 *    vert émeraude à double filet or/argent, panneaux à liseré doré) définie
 *    dans RP/ui/om_sheets.json ;
 *  - toutes les autres (hub, admin, modération, rôles, joueurs, base de
 *    données, modules, sanctions…) → variante « MENUS » cuir sombre à cadre
 *    or de RP/ui/server_form.json.
 *
 * ⚠️ Si une section est ajoutée ici sans être ajoutée dans le JSON (ou
 * inversement), ce menu retombe silencieusement sur le style des menus
 * classiques — c'était exactement le bug « tous les menus se ressemblent ».
 * `src/ui/theme.test.ts` compare les deux et échoue en cas de désynchro.
 */

/**
 * Label (invisible) du bouton retour : un code de formatage SEUL, donc aucun
 * texte affiché — la pastille-flèche parle d'elle-même.
 *
 * Le bouton retour est en fait reconnu par le JSON UI grâce à son **icône**
 * (BACK_ARROW_ICON) : c'est le seul discriminant fiable d'une entrée de
 * collection (RP/ui/server_form.json, `dynamic_button` → `back_slot` gated sur
 * `#form_button_texture`). Le libellé, lui, ne doit surtout PAS servir à la
 * détection : le comparer obligeait à renommer le binding `#form_button_text`,
 * ce qui vidait TOUS les libellés de boutons (bug v19.3).
 */
export const BUTTON_BACK_MARKER = "§r";

/**
 * Texture de la flèche retour (RP/textures/ui/om_btn_back.png).
 * C'est ELLE qui identifie l'entrée retour dans le JSON UI : toute entrée de
 * menu qui porte une icône est rendue en pastille-flèche, les autres en tuile
 * de bouton pleine largeur. Aucun autre bouton ne doit recevoir d'icône.
 */
export const BACK_ARROW_ICON = "textures/ui/om_btn_back";

/**
 * Sections dont le menu utilise la variante « FICHES ».
 * Les titres FIXES (Classe, Ma voie, Clan, Membre, Confirmer…) remplacent les
 * anciens titres dynamiques (nom de la voie, nom du clan, pseudo du membre) :
 * un titre variable ne pourrait pas être reconnu par le JSON UI, et le nom en
 * question s'affiche déjà en grand dans la bannière de la fiche.
 */
export const SHEET_SECTIONS = [
  "Classes",
  "Classe",
  "Ma voie",
  "Confirmer",
  "États",
  "Clan",
  "Mon clan",
  "Membres du clan",
  "Membre",
  "Inviter",
  "Drapeau",
  "Dissoudre le clan",
  "Créer un clan",
  "Le Monde",
  "Mines",
  "Métiers",
  "Mes infos",
] as const;

/**
 * Titre EXACT reçu par le JSON UI pour une section : `windowTitle()` de
 * theme.ts puis suppression des codes § par le moteur de formulaires.
 * Source unique, utilisée par les sélecteurs JSON et par le test de synchro.
 */
export function sheetTitleFor(section: string): string {
  return `NaLandia » ${section}`;
}
