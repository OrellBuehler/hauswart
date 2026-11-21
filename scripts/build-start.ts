// Bundles the production entry scripts/start.ts to build/start.js, next to the adapter's index.js.
const result = await Bun.build({
  entrypoints: ["scripts/start.ts"],
  outdir: "build",
  naming: "start.js",
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
