import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { TERRITORY_COLORS, getColor } from "./types";
import type { StoredDocument } from "../db";
import type { TerritoryData } from "./types";
import { chunkCenter, formatDate } from "./manager";
import type { TerritoryManager } from "./manager";

/**
 * Menu de création (/sn:create) : nom + couleur de drapeau.
 * Le chunk du joueur est revendiqué à la validation.
 */
export function openCreateMenu(player: Player, manager: TerritoryManager): void {
  const colorItems = TERRITORY_COLORS.map((color) => `${color.code}■ ${color.id}`);

  new ModalFormData()
    .title("Créer un territoire")
    .header("Revendiquer ce chunk")
    .textField("Nom du territoire (3-24 caractères)", "Ex : Forteresse du Nord")
    .divider()
    .label("Couleur du drapeau")
    .dropdown("Couleur", colorItems, { defaultValueIndex: 0 })
    .submitButton("Revendiquer !")
    .show(player)
    .then((response) => {
      if (response.canceled) return;

      const values = response.formValues ?? [];
      const name = String(values[0] ?? "").trim();
      const colorIndex = Number(values[1] ?? 0);
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
    .title("Territoires")
    .body(`§7${territories.length} territoire(s) revendiqué(s). Clique pour voir les infos.`);

  for (const territory of territories) {
    const color = getColor(territory.data.color);
    form.button(`${color.code}■ ${territory.data.name}§r\n§7par ${territory.data.owner}`);
  }
  form.button("§4Fermer");

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
    `§eCréé le : §f${formatDate(data.createdAt)}`,
    `§eChunks contrôlés : §f${data.chunkKeys.length}`,
    `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
    "",
    `§7Ce territoire est protégé : seuls le propriétaire`,
    `§7peut y construire, y ouvrir des conteneurs ou y combattre.`,
  ].join("\n");

  new ActionFormData()
    .title(`${color.code}■ ${data.name}`)
    .body(body)
    .button("§fRetour à la liste")
    .button("§4Fermer")
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection === 0) openTerritoriesMenu(player, manager);
    })
    .catch((error: unknown) => {
      console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`);
    });
}
