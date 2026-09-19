import type { Player } from "@minecraft/server";
import { world } from "@minecraft/server";
import {
  windowTitle,
  openWindowRaw,
  openTileMenu,
  obString,
  obNumber,
} from "../ui/theme";
import { fitLabel, pageSlice } from "../ui/tiles";
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
    say(player, "§e[Clans] Tu fais déjà partie d'un clan. Utilise §f/sn:menu §e> États pour le retrouver.");
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
        `§8- 3 à 24 caractères`,
        `§8- lettres, chiffres, espaces, _ et -`,
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

/** Nombre de nations affichées par page dans le menu États. */
export const STATES_PER_PAGE = 3;

/**
 * Menu « Nations » — MENU À TUILES paginé (liste des États/clans).
 *
 * Une nation par ligne de tuile (nom + chef + territoire), trois par page,
 * puis page précédente / page suivante et fondation. Le panneau est un
 * `form_buttons` classique, donc les clics restent natifs et le tactile
 * fonctionne comme sur un formulaire normal.
 *
 * ⚠️ Le titre est « Nations », SANS ACCENT : c'est lui que le panneau JSON UI
 * compare (`NaLandia » Nations`). La version accentuée (« États ») ne matchait
 * pas et le menu retombait entièrement sur le cadre vanilla.
 *
 * @param page page demandée (0 par défaut) — le menu est réouvert à chaque
 *             changement de page, la pagination vit donc dans l'argument.
 */
export function openStatesMenu(player: Player, manager: TerritoryManager, page = 0): void {
  const states = manager.all();
  const pageCount = Math.max(1, Math.ceil(states.length / STATES_PER_PAGE));
  const current = Math.min(Math.max(0, Math.trunc(page)), pageCount - 1);
  const slice = states.slice(current * STATES_PER_PAGE, current * STATES_PER_PAGE + STATES_PER_PAGE);
  const here = clanAtPlayer(manager, player);
  const canFound =
    manager.findByMemberId(player.id) === undefined && manager.findByOwner(player.name) === undefined;

  openTileMenu(player, "Nations", (menu) => {
    menu.body(
      [
        states.length === 0
          ? "§8Aucun État fondé pour l'instant."
          : `§7${states.length} État(s) sur la carte — page §f${current + 1}§7/§f${pageCount}`,
        here !== undefined
          ? `§7Tu es ici : ${getColor(here.data.color).code}§l${here.data.name}§r`
          : "§7Tu es ici : §ozone libre",
        here !== undefined
          ? `§8${extentLine(here.data.chunkKeys.length)}`
          : "§8Utilise §f/sn:create§8 pour fonder ton clan ici.",
      ].join("\n"),
    );

    // ---- Une tuile par nation de la page (UNE LIGNE par tuile) ----
    for (let slot = 0; slot < STATES_PER_PAGE; slot++) {
      const state = slice[slot];
      const key = `clan_${slot}`;
      if (state === undefined) {
        menu.action(key, "§8—", () => {});
        continue;
      }
      const color = getColor(state.data.color);
      // Nom + chef + taille : borné pour ne JAMAIS déborder de la tuile.
      const label = fitLabel(
        `${color.code}${state.data.name}§r §7— ${state.data.owner} §8(${state.data.chunkKeys.length} chunks)`,
        30,
      );
      menu.action(key, label, () => showStateInfo(player, state, manager));
    }

    // ---- Pagination ----
    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openStatesMenu(player, manager, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openStatesMenu(player, manager, current + 1);
    });

    // ---- Action contextuelle : fonder, ou fiche du clan où l'on se trouve ----
    if (canFound) {
      menu.action("create", `§aFonder un clan`, () => openCreateMenu(player, manager));
    } else if (here !== undefined) {
      menu.action("create", fitLabel(`§6${here.data.name} (ici)`, 26), () => showStateInfo(player, here, manager));
    } else {
      menu.action("create", "§8—", () => {});
    }

    menu.action("back", `§7Fermer`, () => {});
  });
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

  // Titre FIXE « Clan » : le JSON UI identifie la famille de style par le titre
  // (voir SHEET_SECTIONS dans ui/theme.ts) et le nom de l'État est déjà en grand
  // dans la bannière du parchemin juste en dessous.
  void openWindowRaw(player, windowTitle("Clan"), (form) => {
    form.back(() => openStatesMenu(player, manager));
    // En-tête sobre : nom de l'État en couleur du drapeau, sans glyphe.
    form.label(`${color.code}§l${data.name}§r`);
    form.label(
      [
        `§eChef        §f${data.owner}${isOwner ? " §a(toi)" : ""}`,
        `§eDrapeau     §r${color.code}${color.id}`,
        `§eFondé le    §f${formatDate(data.createdAt)}`,
        `§eTerritoire  §f${extentLine(data.chunkKeys.length)}`,
        `§eCapitale    §fx=${center.x}, z=${center.z} §7(${center.dimensionId})`,
        `§eMembres     §f${data.members.length}`,
        ``,
        `§7${data.description ?? "Un nouvel État prend forme."}`,
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

/**
 * Menu « Mon clan » — MENU À TUILES (v20).
 *
 * Composition demandée par le serveur, assurée par
 * `RP/ui/server_form.json` :
 *  - en haut à GAUCHE, l'emplacement de la future BANQUE (case vide encadrée) ;
 *  - en haut à DROITE, le DRAPEAU du clan (bannière de sa couleur) ;
 *  - au milieu, la BIO et l'identité du clan ;
 *  - en bas, toutes les actions rangées en barres.
 */
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

  // Le drapeau est transporté vers le JSON UI sous deux formes : un jeton
  // normalisé (pour choisir la bonne bannière) et son nom lisible.
  const flagToken = data.color.startsWith("flag:") ? "blason" : data.color;
  const flagName = data.color.startsWith("flag:")
    ? `Blason ${data.color.slice(5)}`
    : (color.id.charAt(0).toUpperCase() + color.id.slice(1));

  openTileMenu(player, "Mon clan", (menu) => {
    // ---- Bandeau central : identité + bio ----
    menu.body(
      [
        `${color.code}§l${data.name}§r §7— chef §f${data.owner}   §7rang §r${rankLabel}`,
        `§eDrapeau §r${color.code}${flagName}   §eTerritoire §f${extentLine(data.chunkKeys.length)}   §eMembres §f${data.members.length + 1}`,
        `§8Banque : emplacement réservé   §8|   §7${data.description ?? "Un nouvel État prend forme."}`,
      ].join("\n"),
    );

    // ---- Actions rangées en bas ----
    menu.action("bio", `§eModifier la bio`, () => openClanBioMenu(player, manager, territory));
    menu.action("claim", `§aRevendiquer ce chunk`, () => {
      claimHere(player, manager, territory);
    });
    menu.action("members", `§bMembres du clan`, () => openMembersMenu(player, manager, territory));
    menu.action("flag", isOwner ? `§6Modifier le drapeau` : `§8Drapeau (chef)`, () => {
      if (isOwner) {
        openFlagMenu(player, manager, territory);
        return;
      }
      say(player, "§c[Clans] Seul le chef peut changer le drapeau.");
    });
    menu.action("quit", isOwner ? `§cDissoudre le clan` : `§cQuitter le clan`, () => {
      if (isOwner) {
        openDissolveMenu(player, manager, territory);
        return;
      }
      const ok = manager.leave(territory.id, player.id);
      say(
        player,
        ok
          ? `§e[Clans] Tu as quitté §f${data.name}§e.`
          : "§c[Clans] Impossible de quitter le clan.",
      );
    });
    menu.action("back", `§7Retour aux États`, () => openStatesMenu(player, manager));

    // ---- Boutons invisibles : données lues par le JSON UI ----
    menu.data("flag_id", `FLAG:${flagToken}`);
    menu.data("flag_name", `${color.code}${flagName}`);
  });
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

function openClanBioMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  const bio = obString(territory.data.description ?? "");
  void openWindowRaw(player, windowTitle("Bio du clan"), (form) => {
    form.back(() => openMyClanMenu(player, manager, territory));
    form.header(`§6§lBio de ${territory.data.name}`);
    form.label("§7Une phrase courte qui représente ton État. 140 caractères maximum.");
    form.textField("§eDescription", bio, { placeholder: "Notre histoire commence ici…" });
    form.button("§aEnregistrer la bio", () => {
      manager.updateDescription(territory.id, bio.getData());
      player.sendMessage("§a[Clans] Bio mise à jour.");
      openMyClanMenu(player, manager, territory);
    });
  }).catch((error: unknown) =>
    console.warn(`[Clans] Erreur bio : ${error instanceof Error ? error.message : String(error)}`),
  );
}

// ---------------------------------------------------------------------------
// Membres
// ---------------------------------------------------------------------------

/**
 * Nombre de membres affichés par page.
 *
 * ⚠️ La colonne de tuiles des panneaux génériques accueille
 * `PANEL_TILE_CAPACITY` entrées (voir `src/ui/tiles.ts`) : ici 3 membres +
 * « inviter » + pagination + retour = 7 tuiles, donc jamais de débordement.
 */
export const MEMBERS_PER_PAGE = 3;

/**
 * Menu Membres — MENU À TUILES « Membres » (panneau bleu nuit), paginé.
 *
 * Le chef est écrit dans le panneau de droite ; chaque membre est une tuile
 * (clic = fiche du membre) ; « Inviter » est une tuile, la pagination aussi.
 */
export function openMembersMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
  page = 0,
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
  const { items, page: current, pageCount } = pageSlice(data.members, page, MEMBERS_PER_PAGE);

  openTileMenu(player, "Membres", (menu) => {
    menu.body(
      [
        `§b§l${data.name}§r §7— membres`,
        `§eChef : §f${data.owner}`,
        `§7Membres : §f${data.members.length}§7 — page §f${current + 1}§7/§f${pageCount}`,
        data.members.length === 0 ? "§8(aucun membre pour l'instant)" : "§8Un clic = fiche du membre.",
        canManage ? "§8Tu peux inviter, promouvoir ou exclure." : "§8Seuls le chef et les officiers gèrent.",
      ].join("\n"),
    );

    for (let slot = 0; slot < MEMBERS_PER_PAGE; slot++) {
      const member = items[slot];
      if (member === undefined) continue;
      menu.action(
        `member_${slot}`,
        `§f${member.name} §8— ${member.rank === "officer" ? "§bofficier" : "§7membre"}`,
        () => openMemberActionsMenu(player, manager, territory, member.playerId, member.name),
      );
    }

    if (canManage) {
      menu.action("invite", `§aInviter un joueur`, () => openInviteMenu(player, manager, territory));
    }
    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openMembersMenu(player, manager, territory, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openMembersMenu(player, manager, territory, current + 1);
    });
    menu.action("back", `§7Retour au clan`, () => openMyClanMenu(player, manager, territory));
  });
}

/** Actions sur un membre précis — MENU À TUILES « Membre » (panneau bleu). */
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

  const isOfficer = member.rank === "officer";

  openTileMenu(player, "Membre", (menu) => {
    menu.body(
      [
        `§f§l${memberName}§r`,
        `§7Clan : §f${fresh.data.name}`,
        `§7Rang actuel : ${isOfficer ? "§bofficier" : "§7membre"}`,
        "",
        "§8Le rang officier autorise à revendiquer des chunks",
        "§8et à gérer les membres du clan.",
      ].join("\n"),
    );

    menu.action(
      "rank",
      isOfficer ? `§eRétrograder en membre` : `§bPromouvoir officier`,
      () => {
        const nextRank = isOfficer ? "member" : "officer";
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
    menu.action("kick", `§cExclure du clan`, () => {
      const result = manager.removeMember(territory.id, memberId);
      say(
        player,
        result.ok
          ? `§a[Clans] ${memberName} a été exclu du clan.`
          : `§c[Clans] ${result.error ?? "Action impossible."}`,
      );
      openMembersMenu(player, manager, territory);
    });
    menu.action("back", `§7Retour aux membres`, () => openMembersMenu(player, manager, territory));
  });
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

/** Nombre de drapeaux proposés par page. */
export const FLAGS_PER_PAGE = 5;

/** Une entrée du catalogue de drapeaux (couleur du serveur ou blason importé). */
interface FlagEntry {
  /** Valeur stockée dans la DB (`rouge`, `flag:3`…). */
  value: string;
  label: string;
  code: string;
}

/**
 * Menu Drapeau — MENU À TUILES « Drapeau » (panneau émeraude), paginé.
 *
 * Couleurs prêtes à l'emploi (10) + blasons personnalisés (8) = 18 choix, donc
 * quatre pages de cinq. Les blasons sont des PNG posés dans
 * RP/textures/ui/flags/1.png … 8.png (l'utilisateur les importe lui-même : il
 * lui suffit de déposer ses fichiers). Tant que les fichiers ne sont pas là,
 * l'entrée affiche son numéro — le jeu rend un damier transparent si la
 * texture manque (sans crash).
 */
export function openFlagMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
  page = 0,
): void {
  const flags: FlagEntry[] = [
    ...TERRITORY_COLORS.map(
      (candidate): FlagEntry => ({ value: candidate.id, label: candidate.id, code: candidate.code }),
    ),
    ...Array.from({ length: 8 }, (_unused, index): FlagEntry => {
      const n = index + 1;
      return { value: `flag:${n}`, label: `Blason ${n}`, code: "§b" };
    }),
  ];
  const { items, page: current, pageCount } = pageSlice(flags, page, FLAGS_PER_PAGE);
  const active = territory.data.color;

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

  openTileMenu(player, "Drapeau", (menu) => {
    menu.body(
      [
        `§6§lDrapeau de ${territory.data.name}§r`,
        `§7Actuel : §f${active.startsWith("flag:") ? `blason ${active.slice(5)}` : active}`,
        "",
        `§7Page §f${current + 1}§7/§f${pageCount}`,
        "§8Blasons : dépose tes PNG dans §fRP/textures/ui/flags/§8",
        "§8(1.png … 8.png) puis choisis le numéro.",
      ].join("\n"),
    );

    for (let slot = 0; slot < FLAGS_PER_PAGE; slot++) {
      const flag = items[slot];
      if (flag === undefined) continue;
      const currentMark = flag.value === active ? "§a← §f" : "§f";
      menu.action(
        `flag_${slot}`,
        `${currentMark}${flag.code}${flag.label}`,
        () => apply(flag.value, `${flag.code}${flag.label}`),
      );
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openFlagMenu(player, manager, territory, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openFlagMenu(player, manager, territory, current + 1);
    });
    menu.action("back", `§7Retour au clan`, () => openMyClanMenu(player, manager, territory));
  });
}

/**
 * Confirmation de dissolution (définitif) — MENU À TUILES « Dissoudre ».
 * Utilisée par /sn:disband, par « Mon clan » et par la suppression massive des
 * États : c'est la même forme (confirmer / annuler / retour).
 */
export function openDissolveMenu(
  player: Player,
  manager: TerritoryManager,
  territory: StoredDocument<TerritoryData>,
): void {
  openTileMenu(player, "Dissoudre", (menu) => {
    menu.body(
      [
        `§4§lDissoudre ${territory.data.name} ?§r`,
        `§7Les §f${territory.data.chunkKeys.length}§7 chunk(s) redeviendront libres.`,
        "§7Les membres seront retirés du clan.",
        "",
        "§cAction irréversible.",
      ].join("\n"),
    );
    menu.action("confirm", `§4Oui, dissoudre définitivement`, () => {
      const ok = manager.remove(territory.id, player.name, player.id);
      say(
        player,
        ok
          ? `§e[Clans] §f${territory.data.name} §r§ea été dissous.`
          : "§c[Clans] Dissolution impossible.",
      );
    });
    menu.action("cancel", `§aAnnuler`, () => openMyClanMenu(player, manager, territory));
    menu.action("back", `§7Retour au clan`, () => openMyClanMenu(player, manager, territory));
  });
}

// Ré-export pour compat.
export { windowTitle };
