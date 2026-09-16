import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import type { Player } from "@minecraft/server";
import { windowTitle, ICONS } from "../ui/theme";
import type { SanctionsManager } from "./manager";
import { formatDuration } from "./manager";
import type { PermissionManager } from "../permissions/manager";

/** Garde-fou : niveau de modération requis (>= 60) ou op vanilla. */
export function isModerator(playerName: string, permissions: PermissionManager): boolean {
  return permissions.levelOf(playerName) >= 60;
}

/** Menu principal de modération. */
export function openSanctionsMenu(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const stats = sanctions.stats();

  new ActionFormData()
    .title(windowTitle("Modération"))
    .body(
      `§7Bans actifs : §f${stats.bans}\n` +
        `§7Mutes actifs : §f${stats.mutes}\n` +
        `§7Warns au total : §f${stats.warns}`,
    )
    .button("§4Bans actifs", ICONS.lock)
    .button("§6Mutes actifs", ICONS.bell)
    .button("§eSanctionner un joueur", ICONS.sword)
    .button("§bHistorique d'un joueur", ICONS.book)
    .button("§4Fermer", ICONS.barrier)
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;

      switch (response.selection) {
        case 0:
          openBansList(player, sanctions, permissions);
          break;
        case 1:
          openMutesList(player, sanctions, permissions);
          break;
        case 2:
          openSanctionForm(player, sanctions);
          break;
        case 3:
          openHistoryLookup(player, sanctions);
          break;
      }
    })
    .catch((error: unknown) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}

/** Liste des bans actifs : clic = déban. */
function openBansList(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const bans = sanctions.allBans();

  if (bans.length === 0) {
    player.sendMessage("§7[Modération] Aucun ban actif.");
    return;
  }

  const form = new ActionFormData().title("§4Bans actifs").body("§7Clique sur un ban pour le lever.");
  for (const ban of bans) {
    const expiry = ban.data.expiresAt === 0 ? "§4permanent" : `§7(${formatDuration(Math.ceil((ban.data.expiresAt - Date.now()) / 60_000))})`;
    form.button(`§f${ban.data.name} ${expiry}\n§7par ${ban.data.by}`);
  }
  form.button("§8← Retour");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= bans.length) return void openSanctionsMenu(player, sanctions, permissions);

      const ban = bans[response.selection];
      if (ban === undefined) return;

      const result = sanctions.unban(ban.data.name);
      player.sendMessage(result.ok ? `§a[Modération] ${ban.data.name} débanni.` : `§c[Modération] ${result.error}`);
      openBansList(player, sanctions, permissions);
    })
    .catch((error: unknown) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}

/** Liste des mutes actifs : clic = démute. */
function openMutesList(player: Player, sanctions: SanctionsManager, permissions: PermissionManager): void {
  const mutes = sanctions.allMutes();

  if (mutes.length === 0) {
    player.sendMessage("§7[Modération] Aucun mute actif.");
    return;
  }

  const form = new ActionFormData().title("§6Mutes actifs").body("§7Clique sur un mute pour le lever.");
  for (const mute of mutes) {
    const expiry = mute.data.expiresAt === 0 ? "§cpermanent" : `§7(${formatDuration(Math.ceil((mute.data.expiresAt - Date.now()) / 60_000))})`;
    form.button(`§f${mute.data.name} ${expiry}\n§7par ${mute.data.by}`);
  }
  form.button("§8← Retour");

  form
    .show(player)
    .then((response) => {
      if (response.canceled || response.selection === undefined) return;
      if (response.selection >= mutes.length) return void openSanctionsMenu(player, sanctions, permissions);

      const mute = mutes[response.selection];
      if (mute === undefined) return;

      const result = sanctions.unmute(mute.data.name);
      player.sendMessage(result.ok ? `§a[Modération] ${mute.data.name} peut parler.` : `§c[Modération] ${result.error}`);
      openMutesList(player, sanctions, permissions);
    })
    .catch((error: unknown) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}

/** Formulaire de sanction rapide (pseudo + type + durée + raison). */
function openSanctionForm(player: Player, sanctions: SanctionsManager): void {
  new ModalFormData()
    .title("Sanctionner un joueur")
    .textField("Pseudo du joueur", "Ex : Griefer_42")
    .dropdown("Type de sanction", ["§aKick", "§4Ban", "§6Mute", "§eWarn"], { defaultValueIndex: 3 })
    .slider("Durée en minutes (0 = permanent)", 0, 1440, { valueStep: 15, defaultValue: 60 })
    .textField("Raison", "Ex : grief zone spawn")
    .submitButton("Appliquer")
    .show(player)
    .then((response) => {
      if (response.canceled) return;

      const values = response.formValues ?? [];
      const strings = values.filter((value): value is string => typeof value === "string");
      const numbers = values.filter((value): value is number => typeof value === "number");

      const target = (strings[0] ?? "").trim();
      const typeIndex = numbers[0] ?? 3;
      const minutes = numbers[1] ?? 60;
      const reason = strings[1] ?? "non spécifiée";

      if (target === "") {
        player.sendMessage("§c[Modération] Pseudo vide.");
        return;
      }

      // types : 0=kick, 1=ban, 2=mute, 3=warn
      if (typeIndex === 0) {
        import("./enforcement").then(({ kickPlayer }) => {
          const ok = kickPlayer(target, reason);
          player.sendMessage(ok ? `§a[Modération] ${target} éjecté.` : `§c[Modération] ${target} hors ligne.`);
          if (ok) sanctions.log("kick", target, player.name, reason);
        });
      } else if (typeIndex === 1) {
        const result = sanctions.ban(target, player.name, reason, minutes);
        player.sendMessage(result.ok ? `§a[Modération] ${target} banni (${formatDuration(minutes)}).` : `§c[Modération] ${result.error}`);
      } else if (typeIndex === 2) {
        const result = sanctions.mute(target, player.name, reason, minutes);
        player.sendMessage(result.ok ? `§a[Modération] ${target} muet (${formatDuration(minutes)}).` : `§c[Modération] ${result.error}`);
      } else {
        const result = sanctions.warn(target, player.name, reason);
        player.sendMessage(result.ok ? `§a[Modération] ${target} averti.` : `§c[Modération] ${result.error}`);
      }
    })
    .catch((error: unknown) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}

/** Consultation d'historique par saisie de pseudo. */
function openHistoryLookup(player: Player, sanctions: SanctionsManager): void {
  new ModalFormData()
    .title("Historique")
    .textField("Pseudo du joueur", "Ex : Steve")
    .submitButton("Voir")
    .show(player)
    .then((response) => {
      if (response.canceled) return;
      const strings = (response.formValues ?? []).filter((value): value is string => typeof value === "string");
      const target = (strings[0] ?? "").trim();
      if (target === "") return;

      const entries = sanctions.historyOf(target, 15);
      if (entries.length === 0) {
        player.sendMessage(`§7[Modération] ${target} : casier vierge.`);
        return;
      }
      player.sendMessage(`§6[Modération] Historique de ${target} (${entries.length}) :`);
      for (const entry of entries) {
        player.sendMessage(
          `§7- §f${entry.data.kind} §7par §f${entry.data.by} §7— §f${entry.data.reason} §8(${new Date(entry.data.at).toLocaleString()})`,
        );
      }
    })
    .catch((error: unknown) => console.warn(`[Modération] ${error instanceof Error ? error.message : String(error)}`));
}
