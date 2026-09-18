/**
 * Menu /sn:classes — DDUI, présentation « cartes de classe » (v18).
 *
 * Parcours :
 *  1. Catalogue : une entrée par classe (couleur de la classe) ;
 *  2. Clic → CARTE de classe : nom en beau texte blanc, bandeau couleur,
 *     description, points forts — puis confirmation (choix DÉFINITIF) ;
 *  3. Avec classe : carte de SA classe + progression (niveau, barre d'XP)
 *     + reset admin (ou reset depuis /sn:db).
 */

import type { Player } from "@minecraft/server";
import {
  CLASS_CATALOG,
  ClassManager,
  XP_PER_LEVEL,
  classLevel,
  classProgress,
} from "./manager";
import type { ClassInfo } from "./manager";
import { openWindow, openWindowRaw, windowTitle } from "../ui/theme";

/** Barre de progression ASCII (10 crans) colorée. */
function xpBar(xp: number, perLevel: number): string {
  const filled = Math.floor((xp / perLevel) * 10);
  return `§a${"█".repeat(filled)}§8${"░".repeat(10 - filled)}§r`;
}

/** Points forts affichés sur la carte de chaque classe. */
const CLASS_TRAITS: Record<string, string[]> = {
  guerrier: ["§c+ Dégâts au corps à corps", "§c+ Résistance au combat", "§7- Portée courte"],
  mage: ["§5+ Puissance magique", "§5+ Potions renforcées", "§7- Fragile de près"],
  archer: ["§a+ Précision à distance", "§a+ Déplacement rapide", "§7- Faible au mêlée"],
};

/** La carte d'une classe : nom blanc, bandeau couleur, traits. */
function classCard(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  isAdmin: boolean,
  backTo: () => void,
): void {
  void openWindowRaw(player, windowTitle(info.name), (form) => {
    form.header(`${info.color}━━━ §f§l${info.name} §r${info.color}━━━`);
    form.label(
      [
        `§f${info.description}`,
        ``,
        ...CLASS_TRAITS[info.id],
        ``,
        `§8Route définitive de ta progression sur NaLandia.`,
      ].join("\n"),
    );
    form.divider();
    form.button(`§a§lChoisir ${info.name}`, () => confirmClassChoice(player, classes, info, backTo));
    form.button(`§7§lRevoir les autres classes`, backTo);
    void isAdmin;
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** La carte de SA classe : progression + niveau. */
function myClassCard(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  xp: number,
  isAdmin: boolean,
): void {
  const level = classLevel(xp);
  const progress = classProgress(xp);

  void openWindowRaw(player, windowTitle(info.name), (form) => {
    form.header(`${info.color}━━━ §f§l${info.name} §r${info.color}━━━`);
    form.label(
      [
        `§f${info.description}`,
        ``,
        `§7Niveau : §f${level}`,
        `§7Progression : ${xpBar(progress, XP_PER_LEVEL)}`,
        `§7XP : §f${progress}§7/§f${XP_PER_LEVEL} §8(total : ${xp})`,
      ].join("\n"),
    );
    form.divider();
    form.label("§8Le catalogue et les bonus de classe seront complétés prochainement.");

    if (isAdmin) {
      form.button("§c§lRéinitialiser (admin) §7— re-choisir librement", () => {
        if (classes.clearClass(player.name)) {
          player.sendMessage("§a[Classes] Classe réinitialisée — tu peux re-choisir.");
        }
        openClassesMenu(player, classes, isAdmin);
      });
    }
    form.button(`§7§lRetour`, () => openClassesMenu(player, classes, isAdmin));
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/**
 * Ouvre le menu des classes.
 * @param isAdmin affiche le bouton de réinitialisation (réservé aux admins).
 */
export function openClassesMenu(player: Player, classes: ClassManager, isAdmin = false): void {
  void openWindow(player, "Classes", (form) => {
    form.header(`§d§lVoies de NaLandia`);
    form.divider();

    const selection = classes.classOf(player.name);

    // ----- État 1 : pas encore de classe → catalogue de cartes -----
    if (selection === undefined) {
      form.label(
        `§7Choisis ta §lroute§r§7. Ce choix est §lDÉFINITIF§r§7 :\nil déterminera ta progression sur le serveur.`,
      );
      form.divider();
      for (const info of CLASS_CATALOG) {
        form.button(`${info.color}${info.name} §7— ${info.description}`, () =>
          classCard(player, classes, info, isAdmin, () => openClassesMenu(player, classes, isAdmin)),
        );
      }
      return;
    }

    // ----- État 2 : classe choisie → carte de progression -----
    const info = CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);
    if (info === undefined) {
      form.label(`§cClasse inconnue (${selection.classId}) — contacte un admin.`);
      return;
    }
    form.label(`§7Ta voie actuelle :`);
    form.divider();
    form.button(
      `${info.color}${info.name} §7— niveau ${classLevel(selection.xp)}`,
      () => myClassCard(player, classes, info, selection.xp, isAdmin),
    );
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Confirmation avant le choix DÉFINITIF (l'écran courant est fermé par le bouton). */
function confirmClassChoice(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  backTo: () => void,
): void {
  void openWindowRaw(player, windowTitle("Confirmer"), (form) => {
    form.header(`${info.color}━━━ §f§l${info.name} §r${info.color}━━━`);
    form.label(
      [
        `Tu choisis la voie ${info.color}§l${info.name}§r§f ?`,
        ``,
        `§7Ce choix est §lpermanent§r§7 : seul un admin`,
        `§7pourra le réinitialiser (via §f/sn:db§7).`,
      ].join("\n"),
    );
    form.divider();
    form.button(`§a§lJe confirme — ${info.name}`, () => {
      const result = classes.selectClass(player.name, info.id);
      player.sendMessage(
        result.ok
          ? `§a[Classes] Bienvenue dans la voie ${info.color}§l${info.name}§r§a ! Ta progression commence maintenant.`
          : `§c[Classes] ${result.error}`,
      );
    });
    form.button(`§7§lRevoir les autres classes`, backTo);
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}
