/**
 * Menu /sn:classes — DDUI.
 *
 * Deux états dans le MÊME menu (il « change » tout seul, comme demandé) :
 * - sans classe : catalogue cliquable, choix DÉFINITIF (avec confirmation) ;
 * - avec classe : progression (niveau, barre d'XP) + reset admin.
 */

import type { Player } from "@minecraft/server";
import {
  CLASS_CATALOG,
  ClassManager,
  XP_PER_LEVEL,
  classLevel,
  classProgress,
} from "./manager";
import { openWindow, openWindowRaw, windowTitle } from "../ui/theme";

/** Barre de progression ASCII (10 crans) colorée. */
function xpBar(xp: number, perLevel: number): string {
  const filled = Math.floor((xp / perLevel) * 10);
  return `§a${"█".repeat(filled)}§8${"░".repeat(10 - filled)}§r`;
}

/**
 * Ouvre le menu des classes.
 * @param isAdmin affiche le bouton de réinitialisation (réservé aux admins).
 */
export function openClassesMenu(player: Player, classes: ClassManager, isAdmin = false): void {
  void openWindow(player, "Classes", (form) => {
    form.hero("classes");
    form.header("§d■ §lClasses");
    form.divider();

    const selection = classes.classOf(player.name);

    // ----- État 1 : pas encore de classe → catalogue de choix -----
    if (selection === undefined) {
      form.label("§7Choisis ta §lroute§r§7. Ce choix est §lDÉFINITIF§r§7 :\nil déterminera ta progression sur le serveur.");
      form.spacer();
      for (const info of CLASS_CATALOG) {
        form.button(
          `${info.color}■ §l${info.name}§r\n§7${info.description}`,
          () => confirmClassChoice(player, classes, info.id, info.name, info.color),
          undefined,
          info.icon,
        );
      }
      return;
    }

    // ----- État 2 : classe choisie → progression -----
    const info = CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);
    const level = classLevel(selection.xp);
    const progress = classProgress(selection.xp);
    const name = info?.name ?? selection.classId;
    const color = info?.color ?? "§f";

    form.label(
      `${color}■ §l${name}§r\n\n` +
        `§7Niveau : §f${level}\n` +
        `§7Progression : ${xpBar(progress, XP_PER_LEVEL)}\n` +
        `§7XP : §f${progress}§7/§f${XP_PER_LEVEL} §8(total : ${selection.xp})`,
    );
    form.divider();
    form.label("§8Le catalogue et les bonus de classe seront complétés prochainement.");

    if (isAdmin) {
      form.button("§c■ Réinitialiser (admin)\n§7le joueur pourra re-choisir", () => {
        if (classes.clearClass(player.name)) {
          player.sendMessage("§a[Classes] Classe réinitialisée — tu peux re-choisir.");
        }
        openClassesMenu(player, classes, isAdmin);
      }, undefined, "trash");
    }
  }).catch((error: unknown) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`));
}

/** Confirmation avant le choix DÉFINITIF (l'écran courant est fermé par le bouton). */
function confirmClassChoice(
  player: Player,
  classes: ClassManager,
  classId: string,
  className: string,
  color: string,
): void {
  void openWindowRaw(player, windowTitle("Confirmer la classe"), (form) => {
    form.header(`${color}⚠ §lChoix définitif`);
    form.label(
      `Tu choisis la classe ${color}§l${className}§r§f ?\n\n§7Ce choix est §lpermanent§r§7 : il faudra\nqu'un admin te réinitialise pour changer.`,
    );
    form.divider();
    form.button("§a■ §lConfirmer mon choix", () => {
      const result = classes.selectClass(player.name, classId);
      player.sendMessage(
        result.ok
          ? `§a[Classes] Bienvenue dans la voie ${color}§l${className}§r§a ! Ta progression commence maintenant.`
          : `§c[Classes] ${result.error}`,
      );
    }, undefined, "check");
    form.button("§7■ §lRevenir au choix", () => openClassesMenu(player, classes), undefined, "back");
  }).catch((error: unknown) => console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`));
}
