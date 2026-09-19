#!/usr/bin/env node
/**
 * Build script: bundle src/main.ts -> BP/scripts/main.js (format ESM, cible Minecraft Bedrock).
 * --watch : mode watch (rebuild à chaque modification).
 */
import { build, context } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outfile = join(root, "BP", "scripts", "main.js");
const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: [join(root, "src", "main.ts")],
  outfile,
  bundle: true,
  // Les modules @minecraft/* sont fournis par le jeu au runtime :
  // on ne les bundle pas, on garde les imports tels quels.
  external: ["@minecraft/*"],
  format: "esm",
  target: "es2022",
  charset: "utf8",
  sourcemap: false,
  logLevel: "info",
};

mkdirSync(dirname(outfile), { recursive: true });

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[watch] En attente de modifications de src/main.ts...");
} else {
  await build(options);
  console.log(`Build OK -> ${outfile}`);
}
