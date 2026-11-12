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
  - "kit.config.ts"
  - "scripts/{start,build-start}.ts"
---

# Installable app (PWA)

- **Parts.** All ours, no PWA plugin: the service worker `src/service-worker/index.ts` (SvelteKit builds it; its own
  `tsconfig.json`, type-checked by `bun run check`), the manifest route `GET /manifest.webmanifest` (`lib/pwa/manifest.ts`:
  standalone, `start_url`/`scope` `/`, light palette, icons from `static/icons`, `description` in the browser's language),
  registration plus update toast (`components/app/pwa-update.svelte`; `serviceWorker.register` is off in `kit.config.ts`),
  `ThemeColor` (the `theme-color` tags follow the colour mode) and `GET /offline` (`csr = false`, light only like the guest
  pages, see `isScriptlessPath`). The three routes are public paths and `public` in the authz inventory. Registration
  needs HTTPS or localhost and does nothing in `bun dev`.
- **Caching rule: the worker never holds user data.** `lib/pwa/worker.ts` (pure, tested) is its whole behaviour; the
  worker file only wires it to the events. It precaches built static client files (`_app/immutable/**` js/css/woff2,
  `icons/*.png`, favicon, from `$app/manifest`) and the `/offline` page, nothing else, in a cache named after the build
  (`$app/env` `version`; every other cache, the old workbox ones included, is dropped on activate). Precached files come
  from the cache; navigations to app pages go to the network and get `/offline` only when it fails (`planFetch`). `/api`,
  `/g`, `/login`, `/setup`, `/offline`, `/sw.js`, the manifest, downloads, non-GET requests and every `fetch()` are not
  intercepted at all (`isAppNavigation`). No runtime cache.
- **Serving.** adapter-bun answers `build/client` files from its own routes before the hook and without
  `Cache-Control`, so `bun run build` copies SvelteKit's `service-worker.js` (one file, checked) to `build/server/sw.js`
  (`scripts/copy-service-worker.ts`) and `src/routes/sw.js` serves it as `/sw.js` (the address installed apps already
  have registered) with `no-cache`, an ETag (304) and the hook's headers. It is a 404 in `bun dev` and tests
  (`setServiceWorkerSource`). It is registered as `/sw.js` with `type: "module"` and scope `/`.
  `scripts/docker-smoke.sh` checks manifest, worker and offline page.
- **Update flow.** A new worker waits (no `skipWaiting` on install) until the person clicks "Reload" in the toast,
  which posts `SKIP_WAITING` (the message the workbox worker took too); the worker then claims the open pages and only
  that tab reloads (`controllerchange`). A first worker takes over silently. An update check runs hourly and when the
  app becomes visible again (at most once a minute).
- **Absolute asset paths.** `paths.relative` is `false` (pinned by `src/paths.test.ts`): the precached `/offline`
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
  service worker `fetch` handler for that one `POST` that keeps the file in the worker's
  storage until the page uploads it, which the rule above ("never holds user data") would have to allow as a narrow, deliberate exception.
  Neither is built.
