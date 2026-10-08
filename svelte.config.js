import adapter from "svelte-adapter-bun";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      precompress: true,
    }),
    // SvelteKit's own origin check for form posts is off: it rejects bearer uploads (multipart,
    // no Origin header) before bind() runs. hooks.server.ts refuses cross-site writes outside
    // /api/v1 instead (auth/origin.ts); inside /api/v1 bind() checks cookie requests.
    csrf: { trustedOrigins: ["*"] },
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
  },
};

export default config;
