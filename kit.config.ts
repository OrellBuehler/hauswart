import type { Config } from "@sveltejs/kit/vite";

// The SvelteKit options vite.config.ts passes to sveltekit(), apart from the adapter. A module of
// their own so the tests that pin them (csrf, paths, csp) read exactly what the build uses.
export const kitOptions = {
  // SvelteKit's own origin check for form posts is off ("*" turns it off): it rejects bearer
  // uploads (multipart, no Origin header) before bind() runs. hooks.server.ts refuses cross-site
  // writes outside /api/v1 instead (auth/origin.ts); inside /api/v1 bind() checks cookie requests.
  csrf: { trustedOrigins: ["*"] },
  // Absolute asset links ("/_app/..."). The default renders "./_app/..." relative to the page,
  // which breaks the precached /offline page when the service worker serves it for a nested
  // address such as /tasks/12: its stylesheet would resolve to /tasks/_app/... (src/paths.test.ts).
  paths: { relative: false },
  // src/service-worker is served as /sw.js (src/routes/sw.js) and registered by
  // components/app/pwa-update.svelte, which also runs the update prompt.
  serviceWorker: { register: false },
  // SvelteKit adds nonces (hashes for prerendered pages) to its own inline scripts.
  csp: {
    mode: "auto",
    directives: {
      "default-src": ["self"],
      "script-src": ["self"],
      "style-src": ["self", "unsafe-inline"],
      "img-src": ["self", "data:", "blob:"],
      "font-src": ["self", "data:"],
      "connect-src": ["self"],
      // The service worker (/sw.js) and the manifest (/manifest.webmanifest) are same-origin.
      "worker-src": ["self"],
      "manifest-src": ["self"],
      "object-src": ["none"],
      "frame-ancestors": ["none"],
      "base-uri": ["self"],
      "form-action": ["self"],
    },
  },
} satisfies Config;
