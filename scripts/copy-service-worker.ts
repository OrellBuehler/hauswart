// The adapter serves every file of build/client from routes of its own, before SvelteKit and its
// hook run, and sets no Cache-Control on them. The service worker must be revalidated on every
// update check (and by any CDN in front), so the build copies the one SvelteKit made
// (src/service-worker) to build/server/sw.js, where the route src/routes/sw.js serves it with the
// right headers as /sw.js. The original stays: the adapter's route table lists it.
import { copyFileSync, existsSync, readFileSync } from "node:fs";

const SOURCE = "build/client/service-worker.js";
const TARGET = "build/server/sw.js";

if (!existsSync(SOURCE)) {
  console.error(
    `${SOURCE} is missing: SvelteKit did not build src/service-worker.`,
  );
  process.exit(1);
}

// One file: the browser fetches nothing else for the worker, so nothing else needs fresh headers.
if (/^\s*import\b|\bimport\s*\(/m.test(readFileSync(SOURCE, "utf8"))) {
  console.error(
    `${SOURCE} imports other files: the worker must stay one file.`,
  );
  process.exit(1);
}

copyFileSync(SOURCE, TARGET);
