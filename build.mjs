import { copyFileSync, mkdirSync } from "node:fs";

const shared = {
  target: "node",
  format: "cjs",
  // n8n-workflow is provided by n8n at runtime; everything else (including ipp) is bundled
  external: ["n8n-workflow"],
  sourcemap: "external",
};

const results = await Promise.all([
  Bun.build({
    ...shared,
    entrypoints: ["src/nodes/PrintIpp/PrintIpp.node.ts"],
    outdir: "dist/nodes/PrintIpp",
  }),
  Bun.build({
    ...shared,
    entrypoints: ["src/credentials/PrintIpp.credentials.ts"],
    outdir: "dist/credentials",
  }),
]);

for (const result of results) {
  if (!result.success) {
    for (const msg of result.logs) console.error(msg);
    process.exit(1);
  }
}

mkdirSync("dist/nodes/PrintIpp", { recursive: true });
copyFileSync(
  "src/nodes/PrintIpp/printipp.svg",
  "dist/nodes/PrintIpp/printipp.svg",
);
copyFileSync(
  "src/nodes/PrintIpp/PrintIpp.node.json",
  "dist/nodes/PrintIpp/PrintIpp.node.json",
);

console.log("Build complete.");
