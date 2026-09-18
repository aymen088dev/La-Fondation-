/**
 * Menus Monde & Mines.
 *
 * - /sn:monde → « Le Monde » : DESIGN DIFFÉRENCIÉ façon « portes » — deux
 *   grandes cartes (Monde normal en vert doux, Mine en bleu acier) avec
 *   encarts « vous êtes ici », filet, liste des minerais. Volontairement
 *   différent du hub/admin.
 * - Menu Mines (entrée hub) : présentation de la dimension minière.
 *
 * v19.1 : la mine est un BLOC DE PIERRE PLEIN (plus de salles/galeries
 * pré-creusées) — le joueur creuse lui-même, comme un vrai minage.
 */

import type { Player } from "@minecraft/server";
import { openWindow, openWindowRaw, windowTitle } from "../ui/theme";
import type { MinesManager } from "./manager";
import { ORES_PUBLIC } from "./manager";

// ---------------------------------------------------------------------------
// /sn:monde — « Le Monde » (portes du monde)
// ---------------------------------------------------------------------------

/**
 * Choix de monde : deux cartes stylisées avec repère « vous êtes ici ».
 * Le retour depuis la mine téléporte à la DERNIÈRE position connue du
 * joueur dans le monde normal.
 */
export function openWorldMenu(player: Player, mines: MinesManager, back?: () => void): void {
  const inMines = mines.isInMines(player);

  void openWindowRaw(player, windowTitle("Le Monde"), (form) => {
    if (back !== undefined) form.back(back);

    form.header(`§b§lLes portes du monde§r`);
    form.label(
      inMines
        ? `§7Tu es actuellement : §b✦ dans §lLa Mine§r`
        : `§7Tu es actuellement : §a✦ dans le §lMonde normal§r`,
    );
    form.divider();

    // --- Carte 1 : Monde normal (vert doux) ---
    form.header(`§a▓▓▓ §l§aMONDE NORMAL§r §a▓▓▓`);
    form.label(
      [
        `§7La surface : biomes, constructions, tes clans…`,
        inMines
          ? `§eAller : §fte téléporte à ta DERNIÈRE position§e ici.`
          : `§a✔ Tu y es.`,
      ].join("\n"),
    );
    form.button(`§a§l⬥ Aller au monde normal`, () => {
      if (!inMines) {
        player.sendMessage("§7[Mines] Tu es déjà dans le monde normal.");
        return;
      }
      player.sendMessage(mines.goNormal(player));
    });

    form.divider();

    // --- Carte 2 : Mine (bleu acier) ---
    form.header(`§b▓▓▓ §l§bLA MINE§r §b▓▓▓`);
    form.label(
      [
        `§7Un monde §fentièrement massé dans la pierre§7, en profondeur :`,
        `§8· §f70 couches§8 à miner entre deux lits de bedrock`,
        `§8· à toi de creuser tes galeries, façon vrai minage`,
        `§8· minerais §fplus riches qu'en surface§8, sans excès`,
      ].join("\n"),
    );
    form.button(`§b§l⬥ Descendre dans la Mine`, () => {
      if (inMines) {
        player.sendMessage("§7[Mines] Tu es déjà dans la mine.");
        return;
      }
      player.sendMessage(mines.goMines(player));
    });

    form.divider();
    form.label(
      `§8Strates : ${ORES_PUBLIC.map((ore) => `${ore.color}${ore.label}`).join("§8 · ")}`,
    );
  }).catch((error: unknown) =>
    console.warn(`[Mines] Erreur menu monde : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// ---------------------------------------------------------------------------
// Menu Mines du hub
// ---------------------------------------------------------------------------

/**
 * Menu Mines (entrée hub) : présentation + aller/retour.
 * @param back callback de retour (hub) — absent (commande /sn:mine), on
 *             indique simplement la commande.
 */
export function openMineMenu(player: Player, mines: MinesManager, back?: () => void): void {
  const inMines = mines.isInMines(player);

  void openWindow(player, "Mines", (form) => {
    // ---- Panneau de droite : présentation ----
    form.body(
      [
        `§b§lLa dimension minière§r`,
        ``,
        `§7Un monde §fentièrement massé dans la pierre§7 :`,
        `§8· §f70 couches§8 à miner entre deux lits de bedrock`,
        `§8· creuse tes propres galeries, façon vrai minage`,
        `§8· minerais §fplus riches qu'en surface§8, équilibrés par profondeur`,
        ``,
        `§8Strates : §fcharbon§7 partout, §fcuivre/fer§7 puis §for/redstone§7,`,
        `§8et tout en bas §flapis, émeraude et diamant§8.`,
        ``,
        `§8Aller/retour : §f/sn:monde§8, ou le bouton ci-contre.`,
      ].join("\n"),
    );

    // ---- Sidebar ----
    if (back !== undefined) form.back(back);
    if (inMines) {
      form.button(`§a§lRevenir au monde normal`, () => {
        player.sendMessage(mines.goNormal(player));
      });
    } else {
      form.button(`§b§lDescendre aux mines`, () => {
        player.sendMessage(mines.goMines(player));
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[Mines] ${error instanceof Error ? error.message : String(error)}`),
  );
}
