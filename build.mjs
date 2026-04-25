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
		entrypoints: ["src/nodes/Printer/Printer.node.ts"],
		outdir: "dist/nodes/Printer",
	}),
	Bun.build({
		...shared,
		entrypoints: ["src/credentials/IppApi.credentials.ts"],
		outdir: "dist/credentials",
	}),
]);

for (const result of results) {
	if (!result.success) {
		for (const msg of result.logs) console.error(msg);
		process.exit(1);
	}
}

mkdirSync("dist/nodes/Printer", { recursive: true });
copyFileSync("src/nodes/Printer/printer.svg", "dist/nodes/Printer/printer.svg");
copyFileSync(
	"src/nodes/Printer/Printer.node.json",
	"dist/nodes/Printer/Printer.node.json",
);

console.log("Build complete.");
