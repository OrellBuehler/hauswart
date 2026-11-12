<script lang="ts">
  import { toast } from "svelte-sonner";
  import { dev } from "$app/env";
  import { SKIP_WAITING } from "#lib/pwa/worker.ts";
  import { m } from "#lib/paraglide/messages.js";

  const TOAST_ID = "pwa-update";
  /** Installed apps stay open for days: ask for a new worker now and then. */
  const CHECK_EVERY_MS = 60 * 60 * 1000;
  /** A suspended app gets no timer ticks: it also asks when it comes back to the front. */
  const MIN_GAP_AFTER_RESUME_MS = 60 * 1000;
  /** The page reloads once the new worker took over; if it has not by then, say so. */
  const APPLY_TIMEOUT_MS = 10_000;

  // The toast keeps its id from one state to the next; `action: undefined` drops the button.
  function failed() {
    toast.error(m.pwa_update_failed(), {
      id: TOAST_ID,
      duration: Infinity,
      action: undefined,
    });
  }

  function apply(waiting: ServiceWorker) {
    toast.loading(m.pwa_update_applying(), { id: TOAST_ID, action: undefined });
    setTimeout(failed, APPLY_TIMEOUT_MS);
    // The new worker takes over this page (and every other open one) once it is told to; only
    // this tab, whose person agreed, reloads.
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: SKIP_WAITING });
  }

  // Never reloads by itself: a new version only offers itself, so nothing typed gets lost.
  function offer(waiting: ServiceWorker) {
    toast.info(m.pwa_update_available(), {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: m.pwa_update_reload(),
        onClick: (event) => {
          // Keep the toast: it turns into the progress and error message.
          event.preventDefault();
          apply(waiting);
        },
      },
    });
  }

  // A worker that finished installing while another one controls this page is a new version. The
  // first worker of a page is no update: it takes over silently.
  function watch(registration: ServiceWorkerRegistration) {
    if (registration.waiting && navigator.serviceWorker.controller) {
      offer(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          offer(installing);
        }
      });
    });
  }

  function checkForUpdate(registration: ServiceWorkerRegistration) {
    if (!navigator.onLine) return;
    registration
      .update()
      .catch((err) => console.warn("service worker update check failed", err));
  }

  // Production builds only (SvelteKit does not bundle the worker in `bun dev`), and a secure
  // context, so plain HTTP never registers. /sw.js is src/service-worker, served by src/routes/sw.js.
  $effect(() => {
    if (dev || !window.isSecureContext || !("serviceWorker" in navigator)) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopListening: (() => void) | undefined;
    navigator.serviceWorker
      .register("/sw.js", { type: "module", scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        watch(registration);
        let lastCheck = Date.now();
        const check = () => {
          lastCheck = Date.now();
          checkForUpdate(registration);
        };
        timer = setInterval(check, CHECK_EVERY_MS);
        // A standalone app is suspended in the background, so the timer does not tick there.
        const onVisibility = () => {
          if (document.visibilityState !== "visible") return;
          if (Date.now() - lastCheck < MIN_GAP_AFTER_RESUME_MS) return;
          check();
        };
        document.addEventListener("visibilitychange", onVisibility);
        stopListening = () =>
          document.removeEventListener("visibilitychange", onVisibility);
      })
      .catch((err) => console.error("service worker registration failed", err));
    return () => {
      cancelled = true;
      clearInterval(timer);
      stopListening?.();
    };
  });
</script>
