import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { ROLE_COLORS } from "./manager";
import type { PermissionManager } from "./manager";
import { openPrefixMenu } from "./ui";
import { windowTitle, openWindow, openWindowRaw, obString, openTileMenu } from "../ui/theme";
import { pageSlice } from "../ui/tiles";
import { allKnownPlayers } from "../players";
import type { JsonDatabase } from "../db/database";
import { resetClassOf } from "../db/menu";

/** Confirmation avant une action (placeholder conservé pour compat). */
export function confirmDialog(_player: Player, _title: string, _body: string): Promise<boolean> {
  return Promise.resolve(true);
}

/**
 * Nombre de joueurs affichés par page : 4 joueurs + recherche + pagination +
 * retour = 8 tuiles, soit exactement la capacité de la colonne
 * (`PANEL_TILE_CAPACITY` dans `src/ui/tiles.ts`).
 */
export const PLAYERS_PER_PAGE = 4;

/** Une entrée de la liste des joueurs (en ligne ou vu dans l'index). */
interface PlayerEntry {
  name: string;
  online: boolean;
  /** Libellé de gauche (rôle, sessions, dernière vue…). */
  detail: string;
}

/**
 * Menu Joueurs (admin) — LISTE GÉNÉRIQUE (panneau bleu nuit).
 *
 * Les joueurs EN LIGNE passent en premier (§a), puis l'index DB (§8), le tout
 * paginé : une tuile par joueur, un clic ouvre sa fiche. La recherche par
 * pseudo reste disponible pour un joueur que la liste ne montre pas.
 */
export function openPlayersMenu(
  player: Player,
  permissions: PermissionManager,
  db?: JsonDatabase,
  page = 0,
): void {
  const online = world.getAllPlayers();
  const known = db !== undefined ? allKnownPlayers(db) : [];
  const offline = known.filter((record) => !online.some((target) => target.name === record.data.name));

  const entries: PlayerEntry[] = [
    ...online.map((target): PlayerEntry => {
      const member = permissions.getMember(target.name);
      return { name: target.name, online: true, detail: member?.data.role ?? "aucun rôle" };
    }),
    ...offline.map((record): PlayerEntry => {
      const lastSeen = new Date(record.data.lastSeen);
      const hh = `${String(lastSeen.getHours()).padStart(2, "0")}:${String(lastSeen.getMinutes()).padStart(2, "0")}`;
      return {
        name: record.data.name,
        online: false,
        detail: `${record.data.sessions} sess. · vu à ${hh}`,
      };
    }),
  ];

  const { items, page: current, pageCount } = pageSlice(entries, page, PLAYERS_PER_PAGE);

  openTileMenu(player, "Joueurs", (menu) => {
    menu.body(
      [
        "§b§lJoueurs§r",
        `§aEn ligne : §f${online.length}§r   §7Connus (DB) : §f${db !== undefined ? known.length : "?"}`,
        "",
        `§7Page §f${current + 1}§7/§f${pageCount}`,
        "§8Une tuile par joueur — fiche, rôle, préfixe, classe.",
      ].join("\n"),
    );

    for (let slot = 0; slot < PLAYERS_PER_PAGE; slot++) {
      const entry = items[slot];
      if (entry === undefined) continue;
      menu.action(
        `player_${slot}`,
        `${entry.online ? "§a" : "§8"}${entry.name}§r §8— §7${entry.detail}`,
        () => openPlayerConfigMenu(player, entry.name, permissions, db),
      );
    }

    menu.action("lookup", `§eGérer un joueur (pseudo)`, () => openPlayerLookupMenu(player, permissions, db));
    menu.action("prev", current > 0 ? `§7Page précédente` : `§8—`, () => {
      if (current > 0) openPlayersMenu(player, permissions, db, current - 1);
    });
    menu.action("next", current < pageCount - 1 ? `§7Page suivante` : `§8—`, () => {
      if (current < pageCount - 1) openPlayersMenu(player, permissions, db, current + 1);
    });
    menu.action("back", `§7Fermer`, () => {
      /* appuyer sur une tuile ferme déjà le formulaire */
    });
  });
}

/** Saisie d'un pseudo pour gérer un joueur (même hors ligne). */
export function openPlayerLookupMenu(player: Player, permissions: PermissionManager, db?: JsonDatabase): void {
  const name = obString("");

  void openWindowRaw(player, windowTitle("Gérer un joueur"), (form) => {
    form.label("§7Fonctionne même si le joueur n'est pas connecté.");
    form.textField("§ePseudo du joueur", name);
    form.button(`§b§lRechercher`, () => {
      const target = name.getData().trim();
      if (target !== "") openPlayerConfigMenu(player, target, permissions, db);
    });
    form.closeButton();
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Fiche de configuration d'un joueur (en ligne OU hors ligne). */
export function openPlayerConfigMenu(
  player: Player,
  targetName: string,
  permissions: PermissionManager,
  db?: JsonDatabase,
): void {
  const member = permissions.getMember(targetName);
  const roleLabel =
    member === undefined ? "§7aucun" : `${permissions.getRole(member.data.role)?.data.color ?? "§7"}${member.data.role}`;
  const prefixLabel = member?.data.customPrefix ?? "(défaut du rôle)";
  const isOnline = world.getAllPlayers().some((candidate) => candidate.name === targetName);
  const record =
    db !== undefined
      ? allKnownPlayers(db).find((r) => r.data.name === targetName)
      : undefined;
  const classLabel = record?.data.class ? record.data.class : "§8pas encore choisie";

  void openWindow(player, targetName, (form) => {
    form.header(`§b§l${targetName}§r ${isOnline ? "§a(en ligne)" : "§8(hors ligne)"}`);
    form.label(
      `§7Rôle : ${roleLabel}\n§7Classe : §f${classLabel}\n§7Prefix perso : §f${prefixLabel}`,
    );
    form.divider();
    form.button(`§e§lAttribuer / changer de rôle`, () =>
      openAssignRoleMenu(player, targetName, permissions, db),
    );
    form.button(`§e§lPrefix personnalisé`, () =>
      openPrefixMenu(player, `Prefix perso de ${targetName}`, (prefix) => {
        const result = permissions.setCustomPrefix(targetName, prefix);
        player.sendMessage(result.ok ? "§a[Rôles] Prefix mis à jour." : `§c[Rôles] ${result.error}`);
      }),
    );
    if (db !== undefined && record?.data.class) {
      form.button(`§d§lRéinitialiser la classe §7(${record.data.class})`, () => {
        if (resetClassOf(db, targetName)) {
          db.save();
          player.sendMessage(`§a[Classes] Classe de ${targetName} réinitialisée — il re-choisira librement.`);
        }
      });
    }
    if (member !== undefined) {
      form.button(`§c§lRetirer tous les rôles`, () => {
        permissions.removeRole(targetName);
        player.sendMessage(`§a[Rôles] Rôles de ${targetName} retirés.`);
      });
    }
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Choix du rôle à attribuer à un joueur. */
function openAssignRoleMenu(
  player: Player,
  targetName: string,
  permissions: PermissionManager,
  db?: JsonDatabase,
): void {
  const roles = permissions.allRoles();

  if (roles.length === 0) {
    player.sendMessage("§c[Rôles] Aucun rôle existant. Crée-en un d'abord (/sn:roles).");
    return;
  }

  void openWindow(player, `Rôle de ${targetName}`, (form) => {
    form.label("§7Choisis le rôle à attribuer :");
    for (const role of roles) {
      form.button(`${role.data.color}[${role.data.name}]§r §7— niv. ${role.data.level}`, () => {
        const result = permissions.assignRole(targetName, role.data.name);
        player.sendMessage(
          result.ok
            ? `§a[Rôles] ${targetName} est maintenant ${role.data.color}[${role.data.name}]§r§a.`
            : `§c[Rôles] ${result.error}`,
        );
      });
    }
    void db;
  }).catch((error: unknown) => console.warn(`[Roles] ${error instanceof Error ? error.message : String(error)}`));
}

/** Ré-export pour la compatibilité des imports. */
export { ROLE_COLORS };
