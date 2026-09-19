/**
 * Menus Monde & Mines — TOUS DEUX EN TUILES (v2.8).
 *
 * - `/sn:monde` → « Le Monde » : DEUX GRANDES CARTES (monde normal en argent
 *   teinté émeraude, mine en argent teinté acier), cadre or, puis les outils
 *   rangés SOUS les cartes (strates, position, aide…) et la fermeture.
 * - Menu Mines (entrée du hub) : atelier minier, liste générique à gauche.
 *
 * v19.1 : la mine est un BLOC DE PIERRE PLEIN (plus de salles/galeries
 * pré-creusées) — le joueur creuse lui-même, comme un vrai minage.
 */

import type { Player } from "@minecraft/server";
import { openTileMenu } from "../ui/theme";
import type { MinesManager } from "./manager";
import { ORES_PUBLIC } from "./manager";

/** Phrase courte listant les strates (réutilisée par les deux menus). */
function oreLine(): string {
  return ORES_PUBLIC.map((ore) => `${ore.color}${ore.label}`).join("§8, ");
}

// ---------------------------------------------------------------------------
// /sn:monde — « Le Monde » (deux grandes cartes + outils dessous)
// ---------------------------------------------------------------------------

/**
 * Choix de monde. Le panneau est dessiné par le Resource Pack
 * (`om_world_panel`) : les index 0 et 1 sont les DEUX CARTES cliquables, les
 * index 2 à 5 les tuiles d'outils, l'index 6 la fermeture.
 *
 * Le retour depuis la mine téléporte à la DERNIÈRE position connue du joueur
 * dans le monde normal.
 */
export function openWorldMenu(player: Player, mines: MinesManager, back?: () => void): void {
  const inMines = mines.isInMines(player);
  const oreList = oreLine();

  const notifier = (message: string): void => {
    player.sendMessage(message);
  };

  openTileMenu(player, "Le Monde", (menu) => {
    menu.body(
      [
        inMines
          ? "§7Tu es actuellement dans §b§lLa Mine§r §7— clique une carte pour changer de monde."
          : "§7Tu es actuellement dans le §a§lMonde normal§r §7— clique une carte pour changer de monde.",
        `§8Strates : ${oreList}`,
      ].join("\n"),
    );

    // ---- Les deux grandes cartes (index 0 et 1) ----
    menu.action("overworld", inMines ? "§aAller au monde normal" : "§8Monde normal (tu y es)", () => {
      if (!inMines) {
        notifier("§7[Mines] Tu es déjà dans le monde normal.");
        return;
      }
      notifier(mines.goNormal(player));
    });
    menu.action("mines", inMines ? "§8La Mine (tu y es)" : "§bDescendre dans la Mine", () => {
      if (inMines) {
        notifier("§7[Mines] Tu es déjà dans la mine.");
        return;
      }
      notifier(mines.goMines(player));
    });

    // ---- Outils rangés sous les cartes ----
    menu.action("ores", "§6Strates et minerais", () =>
      notifier(`§7[Mines] À cette profondeur, cherche : ${oreList}§7.`),
    );
    menu.action("where", "§eOù suis-je ?", () => {
      const { x, y, z } = player.location;
      notifier(
        `§7[Mines] Position §f${Math.floor(x)}§7, §f${Math.floor(y)}§7, §f${Math.floor(z)}§7 — §f${player.dimension.id}§7.`,
      );
    });
    menu.action("help", "§7Aide minage", () =>
      notifier(
        "§7[Mines] §f/sn:mine§7 descend ou remonte instantanément. La mine est un bloc de pierre plein : à toi de creuser.",
      ),
    );
    menu.action("close", "§7Fermer", () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });

    // ---- Fermeture / retour (index 6) ----
    menu.action("back", back !== undefined ? "§7Retour au menu" : "§7Fermer", () => {
      if (back !== undefined) back();
    });
  });
}

// ---------------------------------------------------------------------------
// Menu Mines du hub
// ---------------------------------------------------------------------------

/**
 * Menu Mines (entrée hub) — LISTE GÉNÉRIQUE (panneau émeraude) : les actions
 * sont les tuiles de gauche, la présentation est dans le panneau de droite.
 *
 * @param back callback de retour (hub) — absent (commande /sn:mine), on
 *             indique simplement la commande.
 */
export function openMineMenu(player: Player, mines: MinesManager, back?: () => void): void {
  const inMines = mines.isInMines(player);

  openTileMenu(player, "Mines", (menu) => {
    menu.body(
      [
        "§6§lAtelier minier§r",
        "§7Un monde entièrement massé dans la pierre : §f70 couches§7 à creuser,",
        "§7entre deux lits de bedrock. Les minerais deviennent plus rares",
        "§7et plus précieux en profondeur.",
        "",
        "§fSurface §7: charbon et fer",
        "§fProfondeur §7: cuivre, or et redstone",
        "§fDernières couches §7: lapis, émeraude et diamant",
        "",
        `§7Strates : ${oreLine()}`,
      ].join("\n"),
    );

    menu.action("toggle", inMines ? "§aRevenir au monde normal" : "§bDescendre aux mines", () => {
      player.sendMessage(inMines ? mines.goNormal(player) : mines.goMines(player));
    });
    menu.action("world", "§bMenu Le Monde", () => openWorldMenu(player, mines, back));
    menu.action("where", "§eOù suis-je ?", () => {
      const { x, y, z } = player.location;
      player.sendMessage(
        `§7[Mines] Position §f${Math.floor(x)}§7, §f${Math.floor(y)}§7, §f${Math.floor(z)}§7 — §f${player.dimension.id}§7.`,
      );
    });
    menu.action("ores", "§6Strates et minerais", () =>
      player.sendMessage(`§7[Mines] Minerais par profondeur : ${oreLine()}§7.`),
    );
    menu.action("help", "§7Aide minage", () =>
      player.sendMessage(
        "§7[Mines] §f/sn:mine§7 descend ou remonte instantanément ; la mine se creuse à la pioche.",
      ),
    );
    menu.action("back", back !== undefined ? "§7Retour au menu" : "§7Fermer", () => {
      if (back !== undefined) back();
    });
  });
}
