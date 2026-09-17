import type { Player } from "@minecraft/server";
import {
  windowTitle,
  openWindow,
  openWindowRaw,
  obString,
  obNumber,
  RP_PACK_ID,
} from "../ui/theme";
import { TERRITORY_COLORS, getColor } from "./types";
import type { StoredDocument } from "../db";
import type { TerritoryData } from "./types";
import { chunkCenter, formatDate } from "./manager";
import type { TerritoryManager } from "./manager";

/**
 * Menus territoires — DDUI CustomForm (boutons à callbacks directs, plus
 * d'indexation fragile par position dans formValues).
 */

/**
 * Menu de création (/sn:create) : nom + couleur de drapeau.
 * Le chunk du joueur est revendiqué à la validation.
 */
export function openCreateMenu(player: Player, manager: TerritoryManager): void {
  const name = obString("");
  const colorIndex = obNumber(0);

  void openWindowRaw(player, windowTitle("Créer un territoire"), (form) => {
    form.header(`§a■ §lRevendiquer ce chunk`);
    form.label(`§7Tu es en §fx=${Math.floor(player.location.x)}§7, §fz=${Math.floor(player.location.z)}§7 (§f${player.dimension.id}§7).`);
    form.divider();

    form.textField("§eNom du territoire (3-24 caractères)", name);
    form.dropdown(
      "§eCouleur du drapeau",
      colorIndex,
      TERRITORY_COLORS.map((color, value) => ({ label: `${color.code}■ ${color.id}`, value })),
    );
    form.divider();
    form.button(`§a■ §lRevendiquer ce chunk !`, () => {
      const cleanName = name.getData().trim().replace(/\s+/g, " ");
      const color = TERRITORY_COLORS[colorIndex.getData()] ?? TERRITORY_COLORS[0];

      const result = manager.create(
        player.name,
        cleanName,
        color?.id ?? "rouge",
        player.dimension.id,
        player.location.x,
        player.location.z,
        player.id,
      );

      if (!result.ok) {
        player.sendMessage(`§c[Territoires] ${result.error}`);
        return;
      }
      player.sendMessage(
        `§a[Territoires] Territoire §r${color?.code}■ ${result.territory.data.name} §r§acrée ! Ce chunk est sous ta bannière.`,
      );
    });
    form.closeButton();
  }).catch((error: unknown) =>
    console.warn(`[Territoires] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Menu liste (/sn:info) : tous les territoires, cliquables. */
export function openTerritoriesMenu(player: Player, manager: TerritoryManager): void {
  const territories = manager.all();

  if (territories.length === 0) {
    player.sendMessage("§7[Territoires] Aucun territoire pour l'instant. Sois le premier avec §f/sn:create§7 !");
    return;
  }

  void openWindow(player, "Territoires", (form) => {
    form.hero("territories");
    form.label(`§7${territories.length} territoire(s) revendiqué(s) :`);
    form.divider();

    for (const territory of territories) {
      const color = getColor(territory.data.color);
      form.button(
        `${color.code}■ ${territory.data.name}§r\n§7par ${territory.data.owner}`,
        () => showTerritoryInfo(player, territory, manager),
        undefined,
        "flag",
      );
    }
  }).catch((error: unknown) =>
    console.warn(`[Territoires] Erreur menu liste : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Fiche détaillée d'un territoire, avec bouton Retour vers la liste. */
export function showTerritoryInfo(
  player: Player,
  territory: StoredDocument<TerritoryData>,
  manager: TerritoryManager,
): void {
  void manager;
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");
  const isOwner = data.ownerId === player.id || data.owner === player.name;

  void openWindowRaw(player, windowTitle(data.name), (form) => {
    form.header(`${color.code}■ §l${data.name}`);
    form.label(
      [
        `§ePropriétaire : §f${data.owner}${isOwner ? " §a(toi)" : ""}`,
        `§eDrapeau : §r${color.code}■ ${color.id}`,
        `§eCréé le : §f${formatDate(data.createdAt)}`,
        `§eChunks contrôlés : §f${data.chunkKeys.length}`,
        `§eZone : §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
        `§eMembres : §f${data.members.length}`,
      ].join("\n"),
    );
    form.divider();
    form.label("§7Seuls le propriétaire et ses membres peuvent y construire, y ouvrir des conteneurs ou y combattre.");

    if (isOwner) {
      form.spacer();
      form.button(`§6■ §lChanger le drapeau (/sn:setflag)`, () => {
        player.sendMessage(
          `§7[Territoires] Couleurs : ${TERRITORY_COLORS.map((c) => `${c.code}${c.id}`).join("§7, ")}`,
        );
      });
      form.button(`§c■ §lSupprimer ce territoire`, () => {
        const ok = manager.remove(data.name, player.name);
        player.sendMessage(
          ok
            ? `§a[Territoires] ${data.name} supprimé.`
            : "§c[Territoires] Suppression impossible.",
        );
      }, undefined, "trash");
    }
  }).catch((error: unknown) =>
    console.warn(`[Territoires] Erreur fiche territoire : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// Ré-exports pour compat.
export { windowTitle, RP_PACK_ID };
