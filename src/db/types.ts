/**
 * Types partagés de la base de données locale.
 *
 * La DB est un simple objet JSON, organisé en "collections" de documents.
 * Chaque document possède un identifiant unique et des timestamps.
 */

/** Numéro de version du schéma de la DB (pour les migrations futures). */
export const DB_SCHEMA_VERSION = 1;

/** Préfixe de clé utilisé pour le stockage Bedrock (Dynamic Properties). */
export const DB_STORAGE_PARTITION = "openmontage_db";

/** Un document générique stocké dans une collection. */
export interface StoredDocument<T = Record<string, unknown>> {
  id: string;
  createdAt: number;
  updatedAt: number;
  data: T;
}

/** Représentation complète du fichier de base de données (sérialisé en JSON). */
export interface DatabaseFile {
  schemaVersion: number;
  name: string;
  savedAt: number;
  collections: Record<string, StoredDocument[]>;
}
