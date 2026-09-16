import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { windowTitle, ICONS } from "../ui/theme";
import { TERRITORY_COLORS, getColor } from "./types";
import type { StoredDocument } from "../db";
import type { TerritoryData } from "./types";
import { chunkCenter, formatDate } from "./manager";
import type { TerritoryManager } from "./manager";

/**
 * Menu de création (/sn:create) : nom + couleur de drapeau.
 * Le chunk du joueur est revendiqué à la validation.
 *
 * ⚠️ On n'utilise QUE des champs saisissables (textField, dropdown) :
 * selon les versions, formValues indexe TOUS les contrôles (header,
 * label, divider inclus) ce qui décalait les indices et causait
 * l'erreur "nom entre 3 et 24 caractères" malgré un nom valide.
 */
export function openCreateMenu(player: Player, manager: TerritoryManager): void {
  const colorItems = TERRITORY_COLORS.map((color) => `${color.code}■ ${color.id}`);

  new ModalFormData()
    .title("Créer un territoire")
    .textField("Nom du territoire (3-24 caractères)", "Ex : Forteresse du Nord")
    .dropdown("Couleur du drapeau", colorItems, { defaultValueIndex: 0 })
    .submitButton("Revendiquer ce chunk !")
    .show(player)
    .then((response) => {
      if (response.canceled) return;

      // Robuste : on retrouve les valeurs par leur TYPE, peu importe
      // la façon dont le jeu indexe formValues.
      const values = response.formValues ?? [];
      const strings = values.filter((value): value is string => typeof value === "string");
      const numbers = values.filter((value): value is number => typeof value === "number");

      const name = (strings[0] ?? "").trim();
      const colorIndex = numbers[0] ?? 0;
      const color = TERRITORY_COLORS[colorIndex] ?? TERRITORY_COLORS[0];

      const result = manager.create(
        player.name,
        name,
        color.id,
        player.dimension.id,
        player.location.x,
        player.location.z,
      );

      if (!result.ok) {
        player.sendMessage(`§c[Territoires] ${result.error}`);
        return;
      }
      player.sendMessage(
        `§a[Territoires] Territoire §r${color.code}■ ${result.territory.data.name} §r§acrée ! Ce chunk est désormais sous ta bannière.`,
      );
    })
    .catch((error: unknown) => {
      console.warn(`[Territoires] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`);
    });
}

/** Menu liste (/sn:info) : tous les territoires, cliquables. */
export function openTerritoriesMenu(player: Player, manager: TerritoryManager): void {
  const territories = manager.all();

  if (territories.length === 0) {
    player.sendMessage("§7[Territoires] Aucun territoire pour l'instant. Sois le premier avec §f/sn:create§7 !");
    return;
  }

  const form = new ActionFormData()
    .title(windowTitle("Territoires"))
    .body(`§7${territories.length} territoire(s) revendiqué(s). Clique pour voir les infos.`);

  for (const territory of territories) {
    const color = getColor(territory.data.color);
    form.button(`${color.code}■ ${territory.data.name}§r\n§7par ${territory.data.owner}`, ICONS.flag);
  }
  form.button("§4Fermer", ICONS.barrier);

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= territories.length) return; // bouton Fermer

      const selected = territories[response.selection];
      if (selected !== undefined) showTerritoryInfo(player, selected, manager);
    })
    .catch((error: unknown) => {
      console.warn(`[Territoires] Erreur menu liste : ${error instanceof Error ? error.message : String(error)}`);
    });
}

/** Fiche détaillée d'un territoire, avec bouton Retour vers la liste. */
export function showTerritoryInfo(
  player: Player,
  territory: StoredDocument<TerritoryData>,
  manager: TerritoryManager,
): void {
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");

  const body = [
    `§ePropriétaire : §f${data.owner}`,
    `§eDrapeau : §r${color.code}■ ${color.id}`,
    `§eCréé le : §f${formatDate(data.createdAt)}`,
    `§eChunks contrôlés : §f${data.chunkKeys.length}`,
    `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
    "",
    `§7Ce territoire est protégé : seuls le propriétaire`,
    `§7peut y construire, y ouvrir des conteneurs ou y combattre.`,
  ].join("\n");

  new ActionFormData()
    .title(windowTitle(data.name))
    .body(body)
    .button("§fRetour à la liste", ICONS.arrow)
    .button("§4Fermer", ICONS.barrier)
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) openTerritoriesMenu(player, manager);
    })
    .catch((error: unknown) => {
      console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`);
    });
}
