// bundles the cli into dist/cli: bun run build:cli
// split build: the guard entry (index.js) holds no bun: imports, so node can still print the guard message
import fs from "node:fs";

fs.rmSync("dist/cli", { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/cli/bin.ts"],
  target: "bun",
  outdir: "dist/cli",
  splitting: true,
  naming: { entry: "index.[ext]", chunk: "[name]-[hash].[ext]" },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const output of result.outputs) console.log(`  ${output.path}`);
