// The adapter serves every file of build/client before SvelteKit and its hook run, and sets no
// Cache-Control on them. The service worker must be revalidated on every update check (and by any
// CDN in front), so the build moves it, with its precompressed copies, from build/client to
// build/server/sw.js, where the route src/routes/sw.js serves it with the right headers.
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";

const CLIENT = "build/client";
const TARGET = "build/server/sw.js";

if (!existsSync(`${CLIENT}/sw.js`)) {
  console.error(
    `${CLIENT}/sw.js is missing: the PWA plugin did not generate the service worker.`,
  );
  process.exit(1);
}

renameSync(`${CLIENT}/sw.js`, TARGET);
for (const copy of ["sw.js.br", "sw.js.gz"]) {
  rmSync(`${CLIENT}/${copy}`, { force: true });
}

// The runtime is inlined (src/lib/pwa/options.ts), so there must be no second file to import.
const leftovers = readdirSync(CLIENT).filter((name) =>
  name.startsWith("workbox-"),
);
if (leftovers.length > 0) {
  console.error(
    `${CLIENT} holds ${leftovers.join(", ")}: inlineWorkboxRuntime must stay on.`,
  );
  process.exit(1);
}
