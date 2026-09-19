/**
 * Compat : les écrans importent leurs helpers depuis « ../ui/tiles » depuis
 * l'origine. L'implémentation vit désormais dans `labels.ts` — ce module ne
 * fait que réexporter, pour ne pas toucher aux 9 fichiers d'écrans.
 */
export { PANEL_TILE_CAPACITY, pageSlice, fitLabel, wrapLabel } from "./labels";
