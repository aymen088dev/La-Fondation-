/**
 * Catalogue des permissions fines OpenMontage.
 *
 * Chaque capability du pack a un id stable (clé de sauvegarde DB) et un
 * libellé français (affichage). Les rôles héritent d'un set par défaut
 * selon leur niveau ; un rôle peut TOUJOURS se voir ajouter des perms
 * explicites (rôle niveau 0 autorisé à bannir, par exemple).
 *
 * Sémantique additive : permissions par défaut (selon le niveau) UNION
 * les permissions explicites du rôle. Rien n'est révocable du set par
 * défaut (pour ça, baisse le niveau du rôle).
 */

/** Toutes les permissions disponibles, avec leur libellé. */
export const PERMS = {
  // --- Territoires ---
  "territories.create": "Créer / revendiquer un territoire",
  // --- Modération ---
  "mod.panel": "Ouvrir le panneau de modération",
  "mod.kick": "Éjecter des joueurs",
  "mod.ban": "Bannir et débannir",
  "mod.mute": "Rendre muet / redonner la parole",
  "mod.warn": "Avertir les joueurs",
  "mod.history": "Consulter l'historique des sanctions",
  // --- Chat / personnalisation ---
  "chat.color": "Personnaliser la couleur de son nom",
  "chat.prefix": "Personnaliser son prefix",
} as const;

export type PermId = keyof typeof PERMS;

/** Liste des ids valides (garde-fou DB). */
export const ALL_PERM_IDS = Object.keys(PERMS) as PermId[];

/** Vérifie qu'une chaîne est un id de permission connu. */
export function isPermId(value: string): value is PermId {
  return Object.prototype.hasOwnProperty.call(PERMS, value);
}

/**
 * Permissions accordées par défaut selon le niveau hiérarchique du rôle :
 *  - 0..59   : joueur (territoire + personnalisation)
 *  - 60..99  : modérateur (tout le bloc mod.*)
 *  - 100+    : administrateur (tout)
 */
export function defaultPermsForLevel(level: number): PermId[] {
  const perms: PermId[] = ["territories.create", "chat.color", "chat.prefix"];

  if (level >= 60) {
    perms.push("mod.panel", "mod.kick", "mod.ban", "mod.mute", "mod.warn", "mod.history");
  }

  if (level >= 100) {
    // Admin : tout le catalogue (couvre les futures perms ajoutées au fichier).
    perms.push(...ALL_PERM_IDS.filter((id) => !perms.includes(id)));
  }

  return perms;
}

/** L'opérateur vanilla (PlayerPermissionLevel.Operator) bypass tout. */
export const OP_BYPASS = true;

/** Couleur affichée pour un opérateur vanilla sans rôle (grade [Admin]). */
export function vanillaOpColor(): string {
  return "§c";
}
