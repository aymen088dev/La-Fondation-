import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { windowTitle, openWindowRaw, obString, obNumber, openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import type { SanctionsManager } from "./manager";
import { formatDuration } from "./manager";
import { kickPlayer } from "./enforcement";
import { formatDate } from "../territories/manager";
import type { PermissionManager } from "../permissions/manager";

/** Garde-fou : niveau de modération requis (>= 60) ou op vanilla. */
export function isModerator(playerName: string, permissions: PermissionManager): boolean {
  return permissions.levelOf(playerName) >= 60;
}

/** Résout le Player.id d'une cible (en ligne, sinon null). */
function resolveTargetId(targetName: string): string | null {
  const online = world.getAllPlayers().find((candidate) => candidate.name === targetName);
  return online?.id ?? null;
}

/** Nombre de sanctions affichées par page dans les listes à tuiles. */
export const SANCTIONS_PER_PAGE = 5;

/** Menu principal de modération — LISTE GÉNÉRIQUE (panneau console). */
export function openSanctionsMenu(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const stats = sanctions.stats();

  openTileMenu(player, "Moderation", (menu) => {
    menu.body(
      [
        "§4§lModération§r",
        `§7Bans actifs : §f${stats.bans}`,
        `§7Mutes actifs : §f${stats.mutes}`,
        `§7Warns au total : §f${stats.warns}`,
        "",
        "§8Les listes se parcourent page par page ;",
        "§8clique une entrée pour lever la sanction.",
      ].join("\n"),
    );

    menu.action("bans", `§4Bans actifs §7(${stats.bans})`, () => openBansList(player, sanctions, permissions, 0));
    menu.action("mutes", `§6Mutes actifs §7(${stats.mutes})`, () => openMutesList(player, sanctions, permissions, 0));
    menu.action("sanction", `§eSanctionner un joueur`, () => openSanctionForm(player, sanctions));
    menu.action("history", `§bHistorique d'un joueur`, () => openHistoryLookup(player, sanctions));
    menu.action("refresh", `§7Rafraîchir`, () => openSanctionsMenu(player, sanctions, permissions));
    menu.action("back", `§7Fermer`, () => {});
  });
}

/** Liste des bans actifs : clic = déban. Cinq par page. */
function openBansList(
  player: Player,
  sanctions: SanctionsManager,
  permissions: PermissionManager,
  page: number,
): void {
  const bans = sanctions.allBans();
  const { items, page: current, pageCount } = pageSlice(bans, page, SANCTIONS_PER_PAGE);

  openTileMenu(player, "Bans", (menu) => {
    menu.body(
      [
        "§4§lBans actifs§r",
        bans.length === 0
          ? "§7Aucun ban actif."
          : `§7${bans.length} ban(s) — page §f${current + 1}§7/§f${pageCount}`,
        "§8Clique une entrée pour lever le ban.",
      ].join("\n"),
    );

    for (let slot = 0; slot < SANCTIONS_PER_PAGE; slot++) {
      const ban = items[slot];
      if (ban === undefined) continue;
      const expiry =
        ban.data.expiresAt === 0
          ? "§4permanent"
          : `§7(${formatDuration(Math.ceil((ban.data.expiresAt - Date.now()) / 60_000))})`;
      menu.action(`ban_${slot}`, `§f${ban.data.name} §8— ${expiry}`, () => {
        const result = sanctions.unban(ban.data.name);
        player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
        openBansList(player, sanctions, permissions, current);
      });
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openBansList(player, sanctions, permissions, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openBansList(player, sanctions, permissions, current + 1);
    });
    menu.action("back", `§7Retour`, () => openSanctionsMenu(player, sanctions, permissions));
  });
}

/** Liste des mutes actifs : clic = démute. Cinq par page. */
function openMutesList(
  player: Player,
  sanctions: SanctionsManager,
  permissions: PermissionManager,
  page: number,
): void {
  const mutes = sanctions.allMutes();
  const { items, page: current, pageCount } = pageSlice(mutes, page, SANCTIONS_PER_PAGE);

  openTileMenu(player, "Mutes", (menu) => {
    menu.body(
      [
        "§6§lMutes actifs§r",
        mutes.length === 0
          ? "§7Aucun mute actif."
          : `§7${mutes.length} mute(s) — page §f${current + 1}§7/§f${pageCount}`,
        "§8Clique une entrée pour rendre la parole.",
      ].join("\n"),
    );

    for (let slot = 0; slot < SANCTIONS_PER_PAGE; slot++) {
      const mute = items[slot];
      if (mute === undefined) continue;
      const expiry =
        mute.data.expiresAt === 0
          ? "§cpermanent"
          : `§7(${formatDuration(Math.ceil((mute.data.expiresAt - Date.now()) / 60_000))})`;
      menu.action(`mute_${slot}`, `§f${mute.data.name} §8— ${expiry}`, () => {
        const result = sanctions.unmute(mute.data.name);
        player.sendMessage(
          result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`,
        );
        openMutesList(player, sanctions, permissions, current);
      });
    }

    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openMutesList(player, sanctions, permissions, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openMutesList(player, sanctions, permissions, current + 1);
    });
    menu.action("back", `§7Retour`, () => openSanctionsMenu(player, sanctions, permissions));
  });
}

/** Formulaire de sanction rapide (pseudo + type + durée + raison) — DDUI. */
function openSanctionForm(player: Player, sanctions: SanctionsManager): void {
  const target = obString("");
  const typeIndex = obNumber(3); // 0=kick, 1=ban, 2=mute, 3=warn
  const minutes = obNumber(60);
  const reason = obString("");

  void openWindowRaw(player, windowTitle("Sanctionner un joueur"), (form) => {
    form.header(`§e§lSanctionner`);
    form.textField("§ePseudo du joueur", target);
    form.dropdown(
      "§eType de sanction",
      typeIndex,
      [
        { label: "§aKick", value: 0 },
        { label: "§4Ban", value: 1 },
        { label: "§6Mute", value: 2 },
        { label: "§eWarn", value: 3 },
      ],
    );
    form.slider("§eDurée en minutes (0 = permanent)", minutes, 0, 1440, { step: 15 });
    form.textField("§eRaison", reason);
    form.divider();
    form.button(`§e§lAppliquer la sanction`, () => {
      const name = target.getData().trim();
      const cleanReason = reason.getData().trim() || "non spécifiée";
      if (name === "") {
        player.sendMessage("§c[Modération] Pseudo vide.");
        return;
      }

      switch (typeIndex.getData()) {
        case 0: {
          const ok = kickPlayer(name, cleanReason);
          player.sendMessage(ok ? `§a[Modération] ${name} éjecté.` : `§c[Modération] ${name} hors ligne.`);
          if (ok) sanctions.log("kick", name, player.name, cleanReason);
          break;
        }
        case 1: {
          const result = sanctions.ban(name, player.name, cleanReason, minutes.getData(), resolveTargetId(name));
          player.sendMessage(
            result.ok
              ? `§a[Modération] ${name} banni (${formatDuration(minutes.getData())}).`
              : `§c[Modération] ${result.error}`,
          );
          break;
        }
        case 2: {
          const result = sanctions.mute(name, player.name, cleanReason, minutes.getData(), resolveTargetId(name));
          player.sendMessage(
            result.ok
              ? `§a[Modération] ${name} muet (${formatDuration(minutes.getData())}).`
              : `§c[Modération] ${result.error}`,
          );
          break;
        }
        default: {
          const result = sanctions.warn(name, player.name, cleanReason, resolveTargetId(name));
          player.sendMessage(result.ok ? `§a[Modération] ${name} averti.` : `§c[Modération] ${result.error}`);
        }
      }
    });
    form.closeButton();
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Consultation d'historique par saisie de pseudo — DDUI. */
function openHistoryLookup(player: Player, sanctions: SanctionsManager): void {
  const target = obString("");

  void openWindowRaw(player, windowTitle("Historique"), (form) => {
    form.textField("§ePseudo du joueur", target);
    form.button(`§b§lVoir l'historique`, () => {
      const name = target.getData().trim();
      if (name === "") return;

      const entries = sanctions.historyOf(name, 15);
      if (entries.length === 0) {
        player.sendMessage(`§7[Modération] ${name} : casier vierge.`);
        return;
      }
      player.sendMessage(`§6[Modération] Historique de ${name} (${entries.length}) :`);
      for (const entry of entries) {
        player.sendMessage(
          `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${formatDate(entry.data.at)})`,
        );
      }
    });
    form.closeButton();
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}
