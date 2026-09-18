/**
 * Menu Classes — DESIGN DIFFÉRENCIÉ « trois voies » (v20).
 *
 * Le menu de choix lui-même n'est PLUS un formulaire vertical : c'est le
 * premier menu à TUILES du serveur. Le script envoie un `ActionFormData`
 * (titre + boutons dans un ordre fixe) et `RP/ui/server_form.json` le dessine
 * en trois GRANDES CARTES VERTICALES côte à côte — une par voie, chacune de la
 * couleur de sa classe, cadre or, nom en blanc et description en dessous.
 *
 * Les fiches (détail d'une voie, ma progression, confirmation) restent des
 * formulaires natifs : ce sont des écrans de LECTURE, ils n'ont pas besoin de
 * tuiles et gardent donc le confort des champs et du défilement natifs.
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
import { openTileMenu, openWindowRaw, windowTitle } from "../ui/theme";

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

/**
 * La fiche d'une voie : bannière, descriptif, traits, choix.
 * @param allowChoose false quand le joueur a déjà une voie (choix définitif) :
 *   on garde la fiche informative mais on retire le bouton de sélection.
 */
function classCard(
  player: Player,
  classes: ClassManager,
  info: ClassInfo,
  allowChoose: boolean,
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
    if (allowChoose) {
      form.button(`§a§lChoisir la voie ${info.name}`, () => confirmClassChoice(player, classes, info, backTo));
    } else {
      form.label(
        `§8Cette voie reste consultable, mais ton choix est définitif :\n§8seul un admin peut le réinitialiser.`,
      );
    }
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
 * Ouvre le menu des classes (TUILES : trois cartes verticales).
 *
 * L'ordre des trois cartes suit `CLASS_CATALOG`, et le JSON UI associe
 * l'index du bouton `class_N` à la carte de gauche à droite. Les descriptions
 * voyagent dans les boutons invisibles `desc_N`, donc chaque carte garde un
 * nom (sur la carte) et un texte (dans la zone basse de la carte) séparés.
 *
 * @param isAdmin affiche la réinitialisation dans la fiche de progression.
 * @param back écran à rouvrir avec la tuile « Retour » (le hub de départ).
 */
export function openClassesMenu(
  player: Player,
  classes: ClassManager,
  isAdmin = false,
  back?: () => void,
): void {
  const selection = classes.classOf(player.name);
  const current =
    selection === undefined
      ? undefined
      : CLASS_CATALOG.find((candidate) => candidate.id === selection.classId);

  openTileMenu(player, "Classes", (menu) => {
    // ---- Trois cartes : une par voie, dans l'ordre du catalogue ----
    CLASS_CATALOG.forEach((info, index) => {
      const isCurrent = current?.id === info.id;
      menu.action(`class_${index}`, `§f§l${info.name}`, () => {
        if (selection === undefined) {
          classCard(player, classes, info, true, () => openClassesMenu(player, classes, isAdmin, back));
          return;
        }
        if (isCurrent) {
          myClassCard(player, classes, info, selection.xp, isAdmin);
          return;
        }
        // Voie déjà fixée : la fiche reste consultable, sans re-choix.
        classCard(player, classes, info, false, () => openClassesMenu(player, classes, isAdmin, back));
      });

      menu.data(
        `desc_${index}`,
        [
          `${info.color}§l${info.name}§r`,
          `${info.description}`,
          CLASS_TRAITS[info.id].join("\n"),
          isCurrent
            ? `§6Voie actuelle  §7niveau §f${classLevel(selection?.xp ?? 0)}`
            : selection === undefined
              ? `§aDisponible`
              : `§8Choix définitif`,
        ].join("\n"),
      );
    });

    // ---- Barre de retour ----
    menu.action("back", "§7Retour", () => {
      if (back !== undefined) back();
    });

    // ---- Bandeau de texte central : état de la voie ----
    menu.body(
      selection === undefined || current === undefined
        ? [
            "§7Choisis ta §froute§7. Ce choix est §lDÉFINITIF§r§7.",
            `§8Trois voies, trois façons de jouer — clique une carte pour sa fiche.`,
          ].join("\n")
        : [
            `§7Ta voie : ${current.color}§l${current.name}§r`,
            `§7Niveau §f${classLevel(selection.xp)}§7   §8|   §7XP §f${classProgress(selection.xp)}§7/§f${XP_PER_LEVEL}§7   §8|   §7total §f${selection.xp}`,
            `§8Clique ta carte pour ouvrir la progression.`,
          ].join("\n"),
    );
  });
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
