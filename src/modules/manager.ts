/**
 * État central des modules de l'add-on (feature flags persistés en DB).
 *
 * Chaque module peut être activé/désactivé et expose sa configuration.
 * Le gestionnaire GUI (/sn:modules) donne un contrôle total sur chacun.
 */

import type { JsonDatabase } from "../db/database";
import { MODULES_COLLECTION } from "../db/collections";

/** Collection DB des modules (id = id du module). */
export { MODULES_COLLECTION };

/** Identifiants des modules connus. */
export const MODULE_IDS = ["territories", "moderation"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleState {
  id: ModuleId;
  enabled: boolean;
}

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  description: string;
}

/** Catalogue des modules disponibles (affichage GUI). */
export const MODULE_CATALOG: ModuleInfo[] = [
  {
    id: "territories",
    name: "Territoires",
    description: "Revendication de chunks protégés (/sn:create, /sn:info)",
  },
  {
    id: "moderation",
    name: "Modération",
    description: "Bans, mutes, warns et historique (/sn:mod, /sn:ban...)",
  },
];

export class ModuleManager {
  /** Passe à true après le chargement DB (worldLoad). */
  loaded = false;

  constructor(private readonly db: JsonDatabase) {}

  markLoaded(): void {
    this.loaded = true;
  }

  /** Le module est-il activé ? (défaut : activé si absent de la DB) */
  isEnabled(id: ModuleId): boolean {
    const state = this.db.findOne<ModuleState>(MODULES_COLLECTION, id);
    return state === undefined ? true : state.data.enabled;
  }

  /** Active/désactive un module. */
  setEnabled(id: ModuleId, enabled: boolean): void {
    this.db.upsert<ModuleState>(MODULES_COLLECTION, id, { id, enabled });
    this.db.save();
  }

  /** Nombre de modules activés (affichage). */
  enabledCount(): number {
    return MODULE_IDS.filter((id) => this.isEnabled(id)).length;
  }
}
