/**
 * Menu /sn:classes — DESIGN DIFFÉRENCIÉ « voies du personnage » (v19).
 *
 * Présentation en fiches verticales à bannière : bandeau large de la
 * couleur de la voie, NOM EN BEAU TEXTE BLANC centré, puis descriptif.
 * Volontairement différent du layout hub/admin (sidebar) : ici on déroule
 * une carte par classe, avec confirmation solennelle avant le choix
 * DÉFINITIF.
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
  return `§a[${"|".repeat(filled)}§8${".".repeat(10 - filled)}§a]§r`;
}

/** Points forts/faibles affichés sur la fiche de chaque voie. */
const CLASS_TRAITS: Record<string, string[]> = {
  guerrier: ["§c+ Dégâts au corps à corps", "§c+ Résistance au combat", "§7- Portée courte"],
  mage: ["§5+ Puissance magique", "§5+ Potions renforcées", "§7- Fragile de près"],
  archer: ["§a+ Précision à distance", "§a+ Déplacement rapide", "§7- Faible au mêlée"],
};

/** Grande bannière d'une voie : bandeaux couleur + NOM BLANC centré. */
function banner(info: ClassInfo): string {
  return [
    `${info.color}======================`,
    `§f§l${info.name}`,
    `${info.color}======================`,
  ].join("\n");
}

/** La fiche d'une voie : bannière, descriptif, traits, choix. */
function classCard(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  _isAdmin: boolean,
  backTo: () => void,
): void {
  // Titre FIXE « Classe » (et non le nom de la voie) : le JSON UI identifie la
  // famille de style par le titre, et le nom de la voie est déjà en grand dans
  // la bannière au-dessus du descriptif (voir SHEET_SECTIONS dans theme.ts).
  void openWindowRaw(player, windowTitle("Classe"), (form) => {
    form.back(backTo);
    form.label(banner(info));
    form.label(
      [
        `§f${info.description}`,
        ``,
        ...CLASS_TRAITS[info.id],
        ``,
        `§8Ta route définitive de progression sur NaLandia.`,
      ].join("\n"),
    );
    form.divider();
    form.button(`§a§lChoisir la voie ${info.name}`, () => confirmClassChoice(player, classes, info, backTo));
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** La fiche de SA voie : bannière + progression (niveau, barre d'XP). */
function myClassCard(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  xp: number,
  isAdmin: boolean,
): void {
  const level = classLevel(xp);
  const progress = classProgress(xp);

  // Titre FIXE « Ma voie » (même raison que la fiche de voie : le style est
  // porté par le titre, le nom de la voie est dans la bannière).
  void openWindowRaw(player, windowTitle("Ma voie"), (form) => {
    form.back(() => openClassesMenu(player, classes, isAdmin));
    form.label(banner(info));
    form.label(
      [
        `§f${info.description}`,
        ...CLASS_TRAITS[info.id],
        `§7Niveau : §f§l${level}§r`,
        `§7Progression : ${xpBar(progress, XP_PER_LEVEL)}`,
        `§7XP : §f${progress}§7/§f${XP_PER_LEVEL} §8(total : ${xp})`,
        `§8Les bonus de voie et le catalogue seront complétés prochainement.`,
      ].join("\n"),
    );
    form.divider();

    if (isAdmin) {
      form.button("§c§lRéinitialiser (admin) §7— re-choisir librement", () => {
        if (classes.clearClass(player.name)) {
          player.sendMessage("§a[Classes] Voie réinitialisée — tu peux re-choisir.");
        }
        openClassesMenu(player, classes, isAdmin);
      });
    }
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
    form.header(`§d§lLes Voies de NaLandia`);
    form.divider();

    const selection = classes.classOf(player.name);

    // ----- État 1 : pas encore de voie → catalogue de fiches -----
    if (selection === undefined) {
      form.label(
        `§7Choisis ta §lroute§r§7. Ce choix est §lDÉFINITIF§r§7 :\nil déterminera ta progression sur le serveur.`,
      );
      form.divider();
      for (const info of CLASS_CATALOG) {
        // Une classe forme une vraie fiche : nom, identité, puis action. Les
        // cartes restent entièrement natives et donc accessibles au tactile.
        form.header(`${info.color}§l${info.name}§r`);
        form.label(
          [
            `§f${info.description}`,
            `§7${CLASS_TRAITS[info.id].join("   ")}`,
          ].join("\n"),
        );
        form.button(
          `§6Voir la fiche de ${info.name}`,
          () => classCard(player, classes, info, isAdmin, () => openClassesMenu(player, classes, isAdmin)),
        );
        form.divider();
      }
      return;
    }

    // ----- État 2 : voie choisie → fiche de progression -----
    const info = CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);
    if (info === undefined) {
      form.label(`§cVoie inconnue (${selection.classId}) — contacte un admin.`);
      return;
    }
    form.label(`§7Ta voie actuelle`);
    form.body(`§f${info.description}\n§7Une route unique, construite par tes actions.`);
    form.divider();
    form.button(
      `${info.color}§l${info.name}§r §7| niveau ${classLevel(selection.xp)}`,
      () => myClassCard(player, classes, info, selection.xp, isAdmin),
    );
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Confirmation solennelle avant le choix DÉFINITIF. */
function confirmClassChoice(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  backTo: () => void,
): void {
  void openWindowRaw(player, windowTitle("Confirmer"), (form) => {
    form.back(backTo);
    form.label(banner(info));
    form.label(
      [
        `Tu choisis la voie ${info.color}§l${info.name}§r§f ?`,
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
    // Pas de seconde flèche ici : la confirmation n'a QUE l'icône de retour en
    // haut à gauche (annuler = revenir à la fiche) et le bouton de choix.
    // Deux fois le même retour était une incohérence de l'ancienne version.
  }).catch((error: unknown) =>
    console.warn(`[Classes] ${error instanceof Error ? error.message : String(error)}`),
  );
}
