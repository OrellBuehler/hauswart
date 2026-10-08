<script lang="ts">
  import { toast } from "svelte-sonner";
  import { m } from "$lib/paraglide/messages";

  const TOAST_ID = "pwa-update";
  /** Installed apps stay open for days: ask for a new worker now and then. */
  const CHECK_EVERY_MS = 60 * 60 * 1000;
  /** The page reloads once the new worker took over; if it has not by then, say so. */
  const APPLY_TIMEOUT_MS = 10_000;

  type Update = (reloadPage?: boolean) => Promise<void>;

  // The toast keeps its id from one state to the next; `action: undefined` drops the button.
  function failed() {
    toast.error(m.pwa_update_failed(), {
      id: TOAST_ID,
      duration: Infinity,
      action: undefined,
    });
  }

  async function apply(update: Update) {
    toast.loading(m.pwa_update_applying(), { id: TOAST_ID, action: undefined });
    const giveUp = setTimeout(failed, APPLY_TIMEOUT_MS);
    // The new worker takes over this page (and every other open one) once it is told to.
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );
    try {
      await update(true);
    } catch (err) {
      clearTimeout(giveUp);
      console.error("service worker update failed", err);
      failed();
    }
  }

  // Never reloads by itself: a new version only offers itself, so nothing typed gets lost.
  function offer(update: Update) {
    toast.info(m.pwa_update_available(), {
      id: TOAST_ID,
      duration: Infinity,
      action: {
        label: m.pwa_update_reload(),
        onClick: (event) => {
          // Keep the toast: it turns into the progress and error message.
          event.preventDefault();
          void apply(update);
        },
      },
    });
  }

  function checkForUpdate(registration: ServiceWorkerRegistration) {
    if (!navigator.onLine) return;
    registration
      .update()
      .catch((err) => console.warn("service worker update check failed", err));
  }

  // The plugin's virtual module registers /sw.js (production build only: it does nothing in
  // `bun dev`, where the plugin is off) and needs a secure context, so plain HTTP never registers.
  $effect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled) return;
        const update = registerSW({
          onNeedRefresh: () => offer(update),
          // The plugin would reload every open tab as soon as a new worker takes over, also those
          // whose person has not agreed (and a page that no worker controlled when it loaded).
          // `apply` reloads the one tab that asked for the update.
          onNeedReload: () => {},
          onRegisteredSW: (_url, registration) => {
            if (!registration) return;
            timer = setInterval(
              () => checkForUpdate(registration),
              CHECK_EVERY_MS,
            );
          },
          onRegisterError: (err) =>
            console.error("service worker registration failed", err),
        });
      })
      .catch((err) => console.error("service worker module failed", err));
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  });
</script>
