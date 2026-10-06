// The markdown render worker is started with `new Worker(file)`, which the SvelteKit server
// build does not bundle. Bundle it on its own, next to the server entry.
const result = await Bun.build({
  entrypoints: ["src/lib/server/docs/markdown.worker.ts"],
  outdir: "build/server",
  naming: "markdown.worker.js",
  target: "bun",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
