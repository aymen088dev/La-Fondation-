import { world } from "@minecraft/server";
import { DB_STORAGE_PARTITION } from "./types";
import { splitIntoChunks } from "./storage";
import type { StorageAdapter } from "./storage";

/**
 * Adaptateur de stockage persistant pour Minecraft Bedrock,
 * basé sur les Dynamic Properties du monde.
 *
 * Les payloads volumineux sont découpés en morceaux de CHUNK_SIZE
 * caractères (limite Bedrock : 32 767 par propriété string).
 */
export function createBedrockStorage(partition: string = DB_STORAGE_PARTITION): StorageAdapter {
  const keyFor = (index: number): string => `${partition}:${index}`;
  const countKey = `${partition}:count`;

  return {
    name: `bedrock-dynamic-properties:${partition}`,

    read(): string | null {
      const count = world.getDynamicProperty(countKey);
      if (typeof count !== "number" || count <= 0) return null;

      const chunks: string[] = [];
      for (let i = 0; i < count; i++) {
        const chunk = world.getDynamicProperty(keyFor(i));
        chunks.push(typeof chunk === "string" ? chunk : "");
      }
      return chunks.join("");
    },

    write(payload: string): void {
      const chunks = splitIntoChunks(payload);

      // Supprime les morceaux devenus inutiles si la DB a rétréci
      const previous = world.getDynamicProperty(countKey);
      if (typeof previous === "number") {
        for (let i = chunks.length; i < previous; i++) {
          world.setDynamicProperty(keyFor(i), undefined);
        }
      }

      for (let i = 0; i < chunks.length; i++) {
        world.setDynamicProperty(keyFor(i), chunks[i]);
      }
      world.setDynamicProperty(countKey, chunks.length);
    },
  };
}
