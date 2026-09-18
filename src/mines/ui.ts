/**
 * Menus Monde & Mines.
 *
 * - /sn:monde → « Le Monde » : DESIGN DIFFÉRENCIÉ façon « portes » — deux
 *   grandes cartes (Monde normal en vert doux, Mine en bleu acier), un
 *   filet, la liste des minerais. Volontairement différent du hub/admin.
 * - Menu Mines (entrée hub) : présentation de la dimension minière + aller.
 */

import type { Player } from "@minecraft/server";
import { openWindow, openWindowRaw, windowTitle } from "../ui/theme";
import type { MinesManager } from "./manager";
import { ORES_PUBLIC, Y_STONE_MIN, Y_STONE_MAX } from "./manager";

// ---------------------------------------------------------------------------
// /sn:monde — « Le Monde » (portes du monde)
// ---------------------------------------------------------------------------

/**
 * Choix de monde : deux cartes stylisées. Le retour depuis la mine
 * téléporte à la DERNIÈRE position connue du joueur dans le monde normal.
 */
export function openWorldMenu(player: Player, mines: MinesManager): void {
  const inMines = mines.isInMines(player);

  void openWindowRaw(player, windowTitle("Le Monde"), (form) => {
    form.header(`§b§lOù veux-tu aller ?§r`);
    form.label(
      inMines
        ? `§7Tu es actuellement dans §b§ola Mine§r§7.`
        : `§7Tu es actuellement dans le §a§lMonde normal§r§7.`,
    );
    form.divider();

    // --- Carte 1 : Monde normal (vert doux) ---
    form.header(`§a═══ §l§aMonde normal§r §a═══`);
    form.label(
      [
        `§7La surface, les biomes, tes constructions…`,
        inMines
          ? `§eRetour : §fte téléporte à ta dernière position§e ici.`
          : `§8Tu y es déjà.`,
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
    form.header(`§b═══ §l§bLa Mine§r §b═══`);
    form.label(
      [
        `§7Un monde §fentièrement creusé dans la pierre§7, en profondeur :`,
        `§8· galeries croisées §f6 blocs de haut§8, grandes salles éclairées`,
        `§8· minerais §fplus riches qu'en surface§8, sans excès`,
        `§8· profondeur minable : §fy ${Y_STONE_MIN} à ${Y_STONE_MAX}§8 (${Y_STONE_MAX - Y_STONE_MIN + 1} couches)`,
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
      `§8Minerais de la mine : ${ORES_PUBLIC.map((ore) => `${ore.color}${ore.label}`).join("§8, ")}`,
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
        `§7Un monde souterrain §fentièrement taillé dans la pierre§7 :`,
        `§8· galeries croisées de §f6 blocs de haut§8 (jamais de tunnels à ramper)`,
        `§8· grandes salles éclairées aux lanternes`,
        `§8· minerais §fplus riches qu'en surface§8, équilibrés par profondeur`,
        ``,
        `§8Strates : §fcharbon§7 partout, §fcuivre/fer§7 puis §for/redstone§7,`,
        `§8et tout en bas §flapis, émeraude et diamant§8.`,
        ``,
        `§8Aller/retour : §f/sn:monde§8, ou le bouton ci-contre.`,
      ].join("\n"),
    );

    // ---- Sidebar ----
    if (inMines) {
      form.button(`§a§lRevenir au monde normal`, () => {
        player.sendMessage(mines.goNormal(player));
      });
    } else {
      form.button(`§b§lDescendre aux mines`, () => {
        player.sendMessage(mines.goMines(player));
      });
    }
    if (back !== undefined) {
      form.button(`§7§lRetour au menu`, back);
    } else {
      form.button(`§7§lRetour au menu`, () => {
        player.sendMessage("§7[Menu] Utilise §f/sn:menu§7 pour revenir au hub.");
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[Mines] ${error instanceof Error ? error.message : String(error)}`),
  );
}
