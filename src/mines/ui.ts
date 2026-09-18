/**
 * Menu Mines (/sn:mine depuis le hub, ou l'entrée « Mines » du hub).
 *
 * Sidebar : Aller aux mines / Revenir à la surface · Rappel des règles.
 * Panneau : présentation de la dimension minière (minerais abondants).
 */

import type { Player } from "@minecraft/server";
import { openWindow } from "../ui/theme";
import type { MinesManager } from "./manager";
import { MINES_HEIGHT, ORES_PUBLIC } from "./manager";

export function openMineMenu(player: Player, mines: MinesManager): void {
  void openWindow(player, "Mines", (form) => {
    const inMines = mines.isInMines(player);

    // ---- Panneau de droite : présentation ----
    form.body(
      [
        `§b§lLa dimension minière§r`,
        ``,
        `§7Un monde souterrain de pierre creusé de galeries,`,
        `§7bien plus riche en minerais que la surface :`,
        ``,
        ORES_PUBLIC.map((ore) => `${ore.color}${ore.label}`).join(`§7, `),
        ``,
        `§8Hauteur des galeries : §f${MINES_HEIGHT} blocs`,
        `§8Retour : §f/sn:mine§8 à nouveau, ou la commande depuis ici.`,
      ].join("\n"),
    );

    // ---- Sidebar ----
    if (inMines) {
      form.button(`§a§lRevenir à la surface`, () => {
        player.sendMessage(mines.toggle(player));
      });
    } else {
      form.button(`§b§lDescendre aux mines`, () => {
        player.sendMessage(mines.toggle(player));
      });
    }
    form.button(`§7§lRetour au menu`, () => {
      player.sendMessage("§7[Mines] Utilise §f/sn:menu§7 pour revenir au hub.");
    });
  }).catch((error: unknown) =>
    console.warn(`[Mines] ${error instanceof Error ? error.message : String(error)}`),
  );
}
