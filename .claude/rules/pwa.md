---
paths:
  - "src/lib/pwa/**"
  - "src/lib/server/pwa/**"
  - "src/service-worker/**"
  - "src/routes/{manifest.webmanifest,sw.js,offline}/**"
  - "src/lib/components/app/{pwa-update,theme-color}*.svelte"
  - "scripts/*service-worker*.ts"
  - "scripts/generate-pwa-icons.ts"
  - "scripts/docker-smoke.sh"
  - "vite.config.ts"
  - "svelte.config.js"
---

# Installable app (PWA)

- **Parts.** `@vite-pwa/sveltekit` (pinned, `generateSW`) only generates the service worker; the rest is ours:
  the manifest route `GET /manifest.webmanifest` (`lib/pwa/manifest.ts`: standalone, `start_url`/`scope` `/`, light
  palette, icons from `static/icons`, `description` in the browser's language), registration plus update toast
  (`components/app/pwa-update.svelte`), `ThemeColor` (the `theme-color` tags follow the colour mode) and `GET /offline`
  (`csr = false`, light only like the guest pages, see `isScriptlessPath`). The three routes are public paths and
  `public` in the authz inventory. Registration needs HTTPS or localhost and does nothing in `bun dev`.
- **Caching rule: the worker never holds user data.** `lib/pwa/options.ts` (tested) is its whole behaviour. It
  precaches built static client files (`_app/immutable/**` js/css/woff2, `icons/*.png`, favicon) and the `/offline`
  page, nothing else. Navigations to app pages are `NetworkOnly` and get `/offline` only when the network fails.
  `/api`, `/g`, `/login`, `/setup`, `/offline`, `/sw.js`, the manifest, downloads and every `fetch()` are not
  intercepted at all (`isAppNavigation`; workbox copies its source into the worker, so it must stay self-contained).
  No navigation fallback (`navigateFallback: undefined`, and the key must exist: the plugin otherwise fills in `/` and
  would serve pages from the cache), no runtime cache, no `_app/version.json`.
- **Serving.** adapter-bun answers `build/client` files before the hook and without `Cache-Control`, so `bun run
build` moves `sw.js` (runtime inlined, one file) to `build/server/sw.js` (`scripts/move-service-worker.ts`) and
  `src/routes/sw.js` serves it with `no-cache`, an ETag (304) and the hook's headers. It is a 404 in `bun dev` and
  tests (`setServiceWorkerSource`). `base`/`scope` are `/` explicitly: SvelteKit's relative Vite base would register
  `sw.js` next to the current page. `scripts/docker-smoke.sh` checks manifest, worker and offline page.
- **Update flow.** `registerType: "prompt"` plus `clientsClaim`. A new worker waits until the person clicks "Reload"
  in the toast; only that tab reloads (`onNeedReload` is a no-op so the plugin does not reload every tab; `apply`
  listens for `controllerchange` itself, which also covers a page that no worker controlled when it loaded). The
  offline page's `revision` is the build time. An update check runs hourly and when the app becomes visible again
  (at most once a minute).
- **Absolute asset paths.** `kit.paths.relative` is `false` (pinned by `src/paths.test.ts`): the precached `/offline`
  page is served as the fallback on any URL, and relative `./_app/…` links would miss the cache on nested paths.
  `docker-smoke.sh` checks that the offline page links no relative assets and that every precache URL answers 200.
- **Manifest extras and meta.** `shortcuts` (add expense `/costs/quick`, submit receipt `/costs/quick?mode=receipt`, new task, record defect,
  emergency, search, in that order because Android launchers show about four; names in the browser's language), `color_scheme_dark`,
  `categories`; `format-detection: telephone=no`. No `viewport-fit=cover` and the
  status bar stays `default` (iOS 26 draws an edge blur over `cover` pages), so safe-area insets are 0 except at the
  bottom where the shell adds them explicitly.
- **No share target** (`share_target`; Chromium only, Safari ignores it): a shared file arrives as a multipart `POST` navigation to an address of the app.
  Answering it takes either (a) a server route outside `/api/v1` (say `/costs/quick/share`): `isCrossSiteWrite` (`auth/origin.ts`) would refuse the
  request, so that one path needs its own exemption and its own guard (the session cookie is SameSite=Lax, which is no substitute for the origin
  check), and the route should only park the file for the signed-in person and open the quick page to confirm it, never book anything; or (b) a
  service worker `fetch` handler for that one `POST` (which means `injectManifest` instead of `generateSW`) that keeps the file in the worker's
  storage until the page uploads it, which the rule above ("never holds user data") would have to allow as a narrow, deliberate exception.
  Neither is built.
