// The production entry (`build/start.js`, bundled by scripts/build-start.ts): applies `ORIGIN`
// (src/lib/server/public-origin.ts), then starts the adapter's server. The adapter itself has no
// `ORIGIN` setting; it reads the two headers this stamps onto every request it hands to SvelteKit
// (static files are answered before that and need no origin).
import {
  originAdapterEnv,
  parsePublicOrigin,
  stampPublicOrigin,
} from "../src/lib/server/public-origin.ts";

const origin = parsePublicOrigin(process.env.ORIGIN);

if (origin) {
  Object.assign(process.env, originAdapterEnv());
  delete process.env.PORT_HEADER;
  const serve = Bun.serve;
  Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) =>
    serve({
      ...options,
      fetch(request, server) {
        stampPublicOrigin(request.headers, origin);
        return options.fetch!.call(this, request, server);
      },
    } as Parameters<typeof Bun.serve>[0])) as typeof Bun.serve;
}

// the adapter's entry next to build/start.js (a computed address, so the bundler leaves it alone)
await import(new URL("./index.js", import.meta.url).href);
