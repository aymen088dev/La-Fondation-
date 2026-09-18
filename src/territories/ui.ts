import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import {
  windowTitle,
  openWindow,
  openWindowRaw,
  obString,
  obNumber,
} from "../ui/theme";
import { TERRITORY_COLORS, getColor } from "./types";
import type { StoredDocument } from "../db";
import type { TerritoryData } from "./types";
import { chunkCenter, formatDate, MAX_CHUNKS_PER_TERRITORY, CLAN_RADIUS } from "./manager";
import type { TerritoryManager } from "./manager";

/**
 * Menus des clans / États de NaLandia.
 *
 * - /sn:create → « Créer un clan » : fonde le clan et revendique le chunk
 *   où l'on se trouve (chunk fondateur).
 * - /sn:menu → section « États » : liste des États + bouton « Infos » du
 *   clan dans lequel on se trouve actuellement.
 * - « Mon clan » : options de base (extension, membres, drapeau,
 *   quitter/dissoudre).
 */

// ---------------------------------------------------------------------------
// Helpers d'affichage
// ---------------------------------------------------------------------------

/** Ligne de statut d'extension : « 3 / 9 chunks (carré 3×3) ». */
function extentLine(chunkCount: number): string {
  const side = CLAN_RADIUS * 2 + 1;
  return `${chunkCount} / ${MAX_CHUNKS_PER_TERRITORY} chunks (extension max ${side}×${side})`;
}

/** Renvoie le nom du clan dans lequel se trouve le joueur, sinon undefined. */
function clanAtPlayer(manager: TerritoryManager, player: Player): StoredDocument<TerritoryData> | undefined {
  const cx = Math.floor(player.location.x / 16);
  const cz = Math.floor(player.location.z / 16);
  const key = `${player.dimension.id}:${cx}:${cz}`;
  return manager.findByChunk(key);
}

/** Liste des joueurs en ligne hors du clan donné (cibles d'invitation). */
function onlineInvitables(territory: StoredDocument<TerritoryData>, exclude: Player): Player[] {
  return world.getAllPlayers().filter(
    (candidate) =>
      candidate.id !== exclude.id &&
      candidate.id !== territory.data.ownerId &&
      !territory.data.members.some((m) => m.playerId === candidate.id),
  );
}

/** Fiche d'erreur utilisateur en chat (seuls messages hors menu). */
function say(player: Player, message: string): void {
  player.sendMessage(message);
}

// ---------------------------------------------------------------------------
// /sn:create — Créer un clan
// ---------------------------------------------------------------------------

/**
 * Menu de création (/sn:create) — formulaire à champs (ModalForm) :
 * infos du chunk fondateur, nom du clan, couleur du drapeau, validation.
 */
export function openCreateMenu(player: Player, manager: TerritoryManager): void {
  if (manager.findByMemberId(player.id) !== undefined || manager.findByOwner(player.name) !== undefined) {
    say(player, "§e[Clans] Tu fais déjà partie d'un clan. Utilise §f/sn:menu §e→ États pour le retrouver.");
    return;
  }

  const name = obString("");
  const colorIndex = obNumber(0);
  const cx = Math.floor(player.location.x / 16);
  const cz = Math.floor(player.location.z / 16);

  void openWindowRaw(player, windowTitle("Créer un clan"), (form) => {
    // ---- Infos du chunk fondateur (rendues en tête du formulaire) ----
    form.body(
      [
        `§a§lTon clan naîtra ici§r`,
        ``,
        `§eChunk fondateur : §fx=${cx}§7, §fz=${cz}`,
        `§eDimension : §f${player.dimension.id}`,
        ``,
        `§7Le clan protège ce chunk (casse, pose, coffres, PvP)`,
        `§7et s'étend en carré ${CLAN_RADIUS * 2 + 1}×${CLAN_RADIUS * 2 + 1} autour.`,
        ``,
        `§7Règles du nom :`,
        `§8· 3 à 24 caractères`,
        `§8· lettres, chiffres, espaces, _ et -`,
        ``,
        `§8Un seul clan par joueur.`,
      ].join("\n"),
    );

    // ---- Formulaire ----
    form.header(`§a§lFonder un clan`);
    form.textField("§eNom du clan", name, { placeholder: "3-24 caractères" });
    form.dropdown(
      "§eCouleur du drapeau",
      colorIndex,
      TERRITORY_COLORS.map((c, value) => ({ label: `${c.code}${c.id}`, value })),
    );
    form.button(`§a§lFonder mon clan !`, () => {
      const cleanName = name.getData().trim().replace(/\s+/g, " ");
      const chosen = TERRITORY_COLORS[colorIndex.getData()] ?? TERRITORY_COLORS[0];

      const result = manager.create(
        player.name,
        cleanName,
        chosen?.id ?? "rouge",
        player.dimension.id,
        player.location.x,
        player.location.z,
        player.id,
      );

      if (!result.ok) {
        say(player, `§c[Clans] ${result.error}`);
        return;
      }
      say(
        player,
        `§a[Clans] Clan §r${chosen?.code}${result.territory.data.name} §r§afondé ! Ce chunk est ton territoire.`,
      );
      // Suite logique : le clan est né, on ouvre directement ses options.
      const fresh = manager.findByOwner(player.name);
      if (fresh !== undefined) openMyClanMenu(player, manager, fresh);
    });
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu création : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// ---------------------------------------------------------------------------
// Menu « États » (/sn:menu → section, /sn:info)
// ---------------------------------------------------------------------------

/** Menu États : liste des clans (cliquables) + infos du clan où l'on se trouve. */
export function openStatesMenu(player: Player, manager: TerritoryManager): void {
  const states = manager.all();

  void openWindow(player, "États", (form) => {
    const here = clanAtPlayer(manager, player);

    form.header(`§e§lÉtats de NaLandia`);
    form.label(
      states.length === 0
        ? `§8Aucun État fondé pour l'instant — sois le premier :`
        : `§7${states.length} État(s) sur la carte — clique pour la fiche :`,
    );
    form.divider();

    if (states.length > 0) {
      for (const state of states) {
        const color = getColor(state.data.color);
        form.button(
          `${color.code}${state.data.name}§r §7— par ${state.data.owner}`,
          () => showStateInfo(player, state, manager),
        );
      }
      form.divider();
    }

    // Bouton contextuel : infos du clan où l'on se trouve (même libre).
    if (here !== undefined) {
      const color = getColor(here.data.color);
      form.button(`§aTu es ici : §l${color.code}${here.data.name}`, () =>
        showStateInfo(player, here, manager),
      );
    } else {
      form.button(`§7Tu es ici : §ozone libre`, () => {
        say(player, "§7[Clans] Ce chunk n'appartient à personne. §f/sn:create §7pour le revendiquer.");
      });
    }

    if (manager.findByMemberId(player.id) === undefined && manager.findByOwner(player.name) === undefined) {
      form.divider();
      form.button(`§a§lFonder mon clan (/sn:create)`, () => openCreateMenu(player, manager));
    }
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu États : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/**
 * Fiche d'un État/clan — DESIGN DIFFÉRENCIÉ « parchemin d'État » (v19) :
 * bannière couleur du drapeau, titre blanc centré, lignes en annuaire.
 */
export function showStateInfo(
  player: Player,
  territory: StoredDocument<TerritoryData>,
  manager: TerritoryManager,
): void {
  const data = territory.data;
  const color = getColor(data.color);
  const center = chunkCenter(data.chunkKeys[0] ?? "");
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;

  void openWindowRaw(player, windowTitle(data.name), (form) => {
    form.back(() => openStatesMenu(player, manager));
    form.label(
      [
        `${color.code}╔══════════════════════╗`,
        `§f§l        ${data.name}`,
        `${color.code}╚══════════════════════╝`,
      ].join("\n"),
    );
    form.label(
      [
        `§eChef        §f${data.owner}${isOwner ? " §a(toi)" : ""}`,
        `§eDrapeau     §r${color.code}${color.id}`,
        `§eFondé le    §f${formatDate(data.createdAt)}`,
        `§eTerritoire  §f${extentLine(data.chunkKeys.length)}`,
        `§eCapitale    §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
        `§eMembres     §f${data.members.length}`,
      ].join("\n"),
    );
    form.divider();

    // Si le joueur fait partie de ce clan → accès direct aux options.
    if (isOwner || myRank !== undefined) {
      form.button(`§6§lMon clan`, () => openMyClanMenu(player, manager, territory));
    }
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur fiche État : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// ---------------------------------------------------------------------------
// « Mon clan » — options de base
// ---------------------------------------------------------------------------

/** Menu « Mon clan » : extension, membres, drapeau, quitter/dissoudre. */
export function openMyClanMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  // Relecture fraîche (le doc peut avoir été supprimé entre-temps).
  const fresh = manager.findOne(territory.id);
  if (fresh === undefined) {
    say(player, "§c[Clans] Ce clan n'existe plus.");
    return;
  }
  territory = fresh;

  const data = territory.data;
  const color = getColor(data.color);
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;
  const rankLabel = isOwner ? "§6Chef" : myRank === "officer" ? "§bOfficier" : "§7Membre";

  void openWindowRaw(player, windowTitle("Mon clan"), (form) => {
    form.back(() => openStatesMenu(player, manager));
    form.label(
      [
        `${color.code}╔══════════════════════╗`,
        `§f§l        ${data.name}`,
        `${color.code}╚══════════════════════╝`,
      ].join("\n"),
    );
    form.label(
      [
        `§eTon rang      §r${rankLabel}`,
        `§eTerritoire    §f${extentLine(data.chunkKeys.length)}`,
        `§eMembres       §f${data.members.length + 1} §7(chef inclus)`,
      ].join("\n"),
    );
    form.divider();

    form.button(`§a§lRevendiquer ce chunk`, () => {
      claimHere(player, manager, territory);
    });
    form.button(`§b§lMembres`, () => openMembersMenu(player, manager, territory));
    if (isOwner) {
      form.button(`§6§lDrapeau`, () => openFlagMenu(player, manager, territory));
    }
    form.divider();

    if (isOwner) {
      form.button(`§c§lDissoudre le clan`, () => openDissolveMenu(player, manager, territory));
    } else {
      form.button(`§c§lQuitter le clan`, () => {
        const ok = manager.leave(territory.id, player.id);
        say(
          player,
          ok
            ? `§e[Clans] Tu as quitté §f${data.name}§e.`
            : "§c[Clans] Impossible de quitter le clan.",
        );
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu Mon clan : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Revendique le chunk où le joueur se trouve (adjacent + dans le carré 3×3). */
function claimHere(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  const key = `${player.dimension.id}:${Math.floor(player.location.x / 16)}:${Math.floor(player.location.z / 16)}`;

  // Garde de rang : officier ou chef uniquement.
  const isOwner = territory.data.ownerId === player.id || territory.data.owner === player.name;
  const myRank = territory.data.members.find((m) => m.playerId === player.id)?.rank;
  if (!isOwner && myRank !== "officer") {
    say(player, "§c[Clans] Seul le chef ou un officier peut étendre le territoire.");
    return;
  }

  // Le chunk courant doit être dans le carré 3×3 du chunk fondateur.
  const result = manager.addChunk(territory.id, key);
  if (result.ok) {
    say(
      player,
      `§a[Clans] Chunk revendiqué ! §f${territory.data.name} §r§a— ${extentLine(territory.data.chunkKeys.length)}`,
    );
    openMyClanMenu(player, manager, territory);
  } else {
    say(player, `§c[Clans] ${result.reason ?? "Revendication impossible."}`);
  }
}

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

/** Menu Membres : liste, invitations, promotions, exclusions. */
export function openMembersMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  const fresh = manager.findOne(territory.id);
  if (fresh === undefined) {
    say(player, "§c[Clans] Ce clan n'existe plus.");
    return;
  }
  territory = fresh;
  const data = territory.data;
  const isOwner = data.ownerId === player.id || data.owner === player.name;
  const myRank = data.members.find((m) => m.playerId === player.id)?.rank;
  const canManage = isOwner || myRank === "officer";

  void openWindowRaw(player, windowTitle("Membres du clan"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    form.header(`§b▓ §l${data.name}§r §7— membres`);
    form.label(
      [
        `§eChef : §f${data.owner}`,
        ...data.members.map(
          (m) =>
            `§8· §f${m.name} §7(${m.rank === "officer" ? "§bofficier" : "membre"}§7)`,
        ),
        ...(data.members.length === 0 ? [`§8· §o(aucun membre pour l'instant)`] : []),
      ].join("\n"),
    );
    form.divider();

    if (canManage) {
      form.button(`§a§lInviter un joueur`, () => openInviteMenu(player, manager, territory));
      for (const member of data.members) {
        const isOfficer = member.rank === "officer";
        form.button(
          `§f${member.name} §7— §o${isOfficer ? "officier" : "membre"}`,
          () => {
            // Mini-menu d'action sur ce membre (promouvoir / exclure).
            openMemberActionsMenu(player, manager, territory, member.playerId, member.name);
          },
        );
      }
    }
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu Membres : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Actions sur un membre précis (chef/officier uniquement). */
function openMemberActionsMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
  memberId: string,
  memberName: string,
): void {
  const fresh = manager.findOne(territory.id);
  if (fresh === undefined) return;
  const member = fresh.data.members.find((m) => m.playerId === memberId);
  if (member === undefined) {
    openMembersMenu(player, manager, fresh);
    return;
  }

  void openWindowRaw(player, windowTitle(memberName), (form) => {
    form.back(() => openMembersMenu(player, manager, territory));
    form.header(`§f§l${memberName}`);
    form.label(`§7Rang actuel : ${member.rank === "officer" ? "§bofficier" : "membre"}`);
    form.divider();

    form.button(
      member.rank === "officer" ? `§e§lRétrograder en membre` : `§b§lPromouvoir officier`,
      () => {
        const nextRank = member.rank === "officer" ? "member" : "officer";
        const result = manager.setMemberRank(territory.id, memberId, nextRank);
        say(
          player,
          result.ok
            ? `§a[Clans] ${memberName} est ${nextRank === "officer" ? "désormais officier" : "redevenu membre"}.`
            : `§c[Clans] ${result.error ?? "Action impossible."}`,
        );
        openMembersMenu(player, manager, territory);
      },
    );
    form.button(`§c§lExclure du clan`, () => {
      const result = manager.removeMember(territory.id, memberId);
      say(
        player,
        result.ok
          ? `§a[Clans] ${memberName} a été exclu du clan.`
          : `§c[Clans] ${result.error ?? "Action impossible."}`,
      );
      openMembersMenu(player, manager, territory);
    });
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu membre : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Invitation : dropdown des joueurs en ligne hors du clan + bouton Inviter. */
function openInviteMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  const invitables = onlineInvitables(territory, player);
  if (invitables.length === 0) {
    say(player, "§7[Clans] Aucun joueur en ligne à inviter (hors du clan).");
    return;
  }

  const pick = obNumber(0);
  void openWindowRaw(player, windowTitle("Inviter"), (form) => {
    form.header(`§a§lInviter dans ${territory.data.name}`);
    form.label(`§7Choisis un joueur en ligne :`);
    form.dropdown(
      "§eJoueur",
      pick,
      invitables.map((candidate, value) => ({ label: candidate.name, value })),
    );
    form.button(`§a§lInviter`, () => {
      const target = invitables[pick.getData()];
      if (target === undefined) {
        say(player, "§c[Clans] Ce joueur n'est plus en ligne.");
        return;
      }
      const result = manager.addMember(territory.id, target.id, target.name);
      say(
        player,
        result.ok
          ? `§a[Clans] ${target.name} a rejoint §f${territory.data.name}§a !`
          : `§c[Clans] ${result.error ?? "Invitation impossible."}`,
      );
      if (result.ok) {
        try {
          target.sendMessage(`§a[Clans] Tu as rejoint le clan §f${territory.data.name}§a !`);
        } catch {
          // parti entre-temps : la DB est déjà à jour
        }
      }
      openMembersMenu(player, manager, territory);
    });
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu invitation : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// ---------------------------------------------------------------------------
// Drapeau + dissolution (chef uniquement)
// ---------------------------------------------------------------------------

/**
 * Menu Drapeau : couleurs prêtes à l'emploi + blasons personnalisés.
 *
 * Les blasons personnalisés sont des PNG posés dans
 * RP/textures/ui/flags/1.png … 8.png (l'utilisateur les importe lui-même :
 * il lui suffit de déposer ses fichiers). Tant que les fichiers ne sont
 * pas là, les entrées correspondantes affichent leur numéro — le jeu
 * rend un damier transparent si la texture manque (sans crash).
 */
export function openFlagMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  const apply = (flagValue: string, label: string): void => {
    const fresh = manager.findOne(territory.id);
    if (fresh === undefined) {
      say(player, "§c[Clans] Ce clan n'existe plus.");
      return;
    }
    fresh.data.color = flagValue;
    fresh.updatedAt = Date.now();
    manager.save();
    say(player, `§a[Clans] Drapeau changé : ${label}`);
    openMyClanMenu(player, manager, territory);
  };

  void openWindowRaw(player, windowTitle("Drapeau"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    const current = territory.data.color;
    form.header(`§6§lDrapeau de ${territory.data.name}`);
    form.label(`§7Actuel : §f${current.startsWith("flag:") ? current.slice(5) : current}`);
    form.divider();

    for (const candidate of TERRITORY_COLORS) {
      form.button(`${candidate.code}${candidate.id}`, () => apply(candidate.id, candidate.code + candidate.id));
    }

    form.divider();
    form.label(`§7— blasons personnalisés —\n§8Dépose tes PNG dans §fRP/textures/ui/flags/§8 (1.png, 2.png…) puis choisis :`);
    for (let n = 1; n <= 8; n++) {
      const flagValue = `flag:${n}`;
      form.button(`§bBlason ${n}`, () => apply(flagValue, `Blason ${n}`));
    }

    form.divider();
    form.back(() => openMyClanMenu(player, manager, territory));
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu drapeau : ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Confirmation de dissolution (définitif). Utilisée par /sn:disband. */
export function openDissolveMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  void openWindowRaw(player, windowTitle("Dissoudre le clan"), (form) => {
    form.header(`§4§lDissoudre ${territory.data.name} ?`);
    form.label(
      [
        `§7Les §f${territory.data.chunkKeys.length}§7 chunk(s) redeviendront libres.`,
        `§7Les membres seront retirés du clan.`,
        ``,
        `§cAction irréversible.`,
      ].join("\n"),
    );
    form.divider();
    form.button(`§4§lOui, dissoudre définitivement`, () => {
      const ok = manager.remove(territory.id, player.name, player.id);
      say(
        player,
        ok
          ? `§e[Clans] §f${territory.data.name} §r§ea été dissous.`
          : "§c[Clans] Dissolution impossible.",
      );
    });
    form.button(`§a§lAnnuler`, () => openMyClanMenu(player, manager, territory));
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur menu dissolution : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// Ré-export pour compat.
export { windowTitle };
