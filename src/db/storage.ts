/**
 * Adaptateurs de stockage pour la base de données locale.
 *
 * Le même code de DB fonctionne partout : seule la couche de stockage change
 * (mémoire pour les tests, Dynamic Properties dans Minecraft).
 */

export interface StorageAdapter {
  /** Nom lisible de l'adaptateur (logs/debug). */
  readonly name: string;
  /** Lit le contenu brut sérialisé, ou null si la base est vide. */
  read(): string | null;
  /** Écrit (remplace) le contenu brut sérialisé. */
  write(payload: string): void;
}

/** Adaptateur en mémoire — utilisé pour les tests. */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly name = "memory";
  private payload: string | null = null;

  read(): string | null {
    return this.payload;
  }

  write(payload: string): void {
    this.payload = payload;
  }
}

/**
 * Taille d'un morceau de chaîne stocké.
 * Bedrock limite une propriété string à 32 767 caractères : on garde une marge.
 */
export const CHUNK_SIZE = 30_000;

/** Découpe une chaîne en morceaux de CHUNK_SIZE caractères maximum. */
export function splitIntoChunks(payload: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    chunks.push(payload.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

/** Reconstitue la chaîne originale à partir de ses morceaux. */
export function joinChunks(chunks: string[]): string {
  return chunks.join("");
}
