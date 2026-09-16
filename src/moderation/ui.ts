import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { windowTitle, ICONS, openWindow, openWindowRaw, obString, obNumber } from "../ui/theme";
import type { SanctionsManager } from "./manager";
import { formatDuration } from "./manager";
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

/** Menu principal de modération. */
export function openSanctionsMenu(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const stats = sanctions.stats();

  void openWindow(player, "Modération", (form) => {
    form.header(`§4■ §lModération`);
    form.label(
      `§7Bans actifs : §f${stats.bans}\n§7Mutes actifs : §f${stats.mutes}\n§7Warns au total : §f${stats.warns}`,
    );
    form.divider();
    form.button(`§4■ Bans actifs`, () => openBansList(player, sanctions, permissions));
    form.button(`§6■ Mutes actifs`, () => openMutesList(player, sanctions, permissions));
    form.button(`§e■ Sanctionner un joueur`, () => openSanctionForm(player, sanctions));
    form.button(`§b■ Historique d'un joueur`, () => openHistoryLookup(player, sanctions));
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Liste des bans actifs : clic = déban. */
function openBansList(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const bans = sanctions.allBans();

  void openWindow(player, "Bans actifs", (form) => {
    if (bans.length === 0) {
      form.label("§7Aucun ban actif.");
      return;
    }
    form.label("§7Clique sur un ban pour le lever :");
    for (const ban of bans) {
      const expiry =
        ban.data.expiresAt === 0
          ? "§4permanent"
          : `§7(${formatDuration(Math.ceil((ban.data.expiresAt - Date.now()) / 60_000))})`;
      form.button(`§f${ban.data.name} ${expiry}\n§7par ${ban.data.by}`, () => {
        const result = sanctions.unban(ban.data.name);
        player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
        openBansList(player, sanctions, permissions);
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Liste des mutes actifs : clic = démute. */
function openMutesList(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const mutes = sanctions.allMutes();

  void openWindow(player, "Mutes actifs", (form) => {
    if (mutes.length === 0) {
      form.label("§7Aucun mute actif.");
      return;
    }
    form.label("§7Clique sur un mute pour le lever :");
    for (const mute of mutes) {
      const expiry =
        mute.data.expiresAt === 0
          ? "§cpermanent"
          : `§7(${formatDuration(Math.ceil((mute.data.expiresAt - Date.now()) / 60_000))})`;
      form.button(`§f${mute.data.name} ${expiry}\n§7par ${mute.data.by}`, () => {
        const result = sanctions.unmute(mute.data.name);
        player.sendMessage(
          result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`,
        );
        openMutesList(player, sanctions, permissions);
      });
    }
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}

/** Formulaire de sanction rapide (pseudo + type + durée + raison) — DDUI. */
function openSanctionForm(player: Player, sanctions: SanctionsManager): void {
  const target = obString("");
  const typeIndex = obNumber(3); // 0=kick, 1=ban, 2=mute, 3=warn
  const minutes = obNumber(60);
  const reason = obString("");

  void openWindowRaw(player, windowTitle("Sanctionner un joueur"), (form) => {
    form.header(`§e■ §lSanctionner`);
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
    form.button(`§e■ Appliquer la sanction`, () => {
      const name = target.getData().trim();
      const cleanReason = reason.getData().trim() || "non spécifiée";
      if (name === "") {
        player.sendMessage("§c[Modération] Pseudo vide.");
        return;
      }

      switch (typeIndex.getData()) {
        case 0: {
          import("./enforcement").then(({ kickPlayer }) => {
            const ok = kickPlayer(name, cleanReason);
            player.sendMessage(ok ? `§a[Modération] ${name} éjecté.` : `§c[Modération] ${name} hors ligne.`);
            if (ok) sanctions.log("kick", name, player.name, cleanReason);
          });
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
    form.button(`§b■ Voir l'historique`, () => {
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
          `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${new Date(entry.data.at).toLocaleString()})`,
        );
      }
    });
    form.closeButton();
  }).catch((error: unknown) =>
    console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`),
  );
}

// Ré-export pour compat.
export { ICONS };
