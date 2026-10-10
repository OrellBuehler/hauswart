import { getContext, onMount, setContext, untrack } from "svelte";
import { afterNavigate, goto, pushState, replaceState } from "$app/navigation";
import { navigating, page } from "$app/state";
import { OverlayHistory, type OverlayEnv } from "./history";

const TRAVERSAL_TIMEOUT_MS = 500;
const LINK_PENDING_MS = 1000;
const CONTEXT = Symbol("overlay-history");
const session = Math.random().toString(36).slice(2, 8);
let counter = 0;
let controller: OverlayHistory | undefined;
let linkClickedAt = Number.NEGATIVE_INFINITY;

// The router prevents the default of the links it takes over, and it does so before this listener
// (on the document) sees the click.
function noteLinkClick(event: MouseEvent) {
  if (event.defaultPrevented && event.target instanceof Element) {
    if (event.target.closest("a[href]")) linkClickedAt = performance.now();
  }
}

const env: OverlayEnv = {
  push: (id) => pushState("", { overlay: id }),
  replace: (id) => replaceState("", { overlay: id }),
  go: (delta) => window.history.go(delta),
  current: () => page.state.overlay,
  navigating: () => navigating.to !== null,
  linkPending: () => performance.now() - linkClickedAt < LINK_PENDING_MS,
  stable: () => window.location.href === page.url.href,
  traversed: () =>
    new Promise<void>((resolve) => {
      const done = () => {
        window.removeEventListener("popstate", onPop);
        clearTimeout(timer);
        resolve();
      };
      // SvelteKit's own popstate handler runs first and updates `page.state` synchronously
      const onPop = () => setTimeout(done, 0);
      const timer = setTimeout(done, TRAVERSAL_TIMEOUT_MS);
      window.addEventListener("popstate", onPop);
    }),
  defer: (run, delayMs = 0) => void setTimeout(run, delayMs),
};

function overlays(): OverlayHistory {
  if (!controller) {
    const created = new OverlayHistory(env);
    document.addEventListener("click", noteLinkClick);
    // SvelteKit's own popstate listener may be added after this one: let it set `page.state` first
    window.addEventListener("popstate", () => {
      setTimeout(() => created.sync(), 0);
    });
    controller = created;
  }
  return controller;
}

export type OverlayHistoryHandle = {
  /** The overlay has a history entry: links inside it should replace that entry instead of adding one. */
  readonly owned: boolean;
};

type Options = {
  open: () => boolean;
  close: () => void;
  /** Overlays that opt out keep the browser's default: back leaves the page. */
  enabled: () => boolean;
};

/**
 * Call once from the root component of a dialog or sheet. While `open()` is true (and `enabled()`)
 * the overlay owns a history entry: the back gesture calls `close()`, and closing it by hand pops the
 * entry again. An overlay that closes because of a navigation leaves the history to SvelteKit.
 */
export function useOverlayHistory(options: Options): OverlayHistoryHandle {
  const id = `${session}-${(counter += 1)}`;
  let owned = $state(false);
  // pushState needs the router, which is only there once the page has hydrated
  let ready = $state(false);

  onMount(() => {
    const timer = setTimeout(() => (ready = true), 0);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const wanted = ready && options.open() && options.enabled();
    untrack(() => {
      if (wanted) {
        overlays().open(id, options.close, (value) => (owned = value));
      } else {
        overlays().release(id);
      }
    });
  });

  afterNavigate(() => overlays().navigated());

  $effect(() => () => untrack(() => overlays().release(id)));

  const handle: OverlayHistoryHandle = {
    get owned() {
      return owned;
    },
  };
  setContext(CONTEXT, handle);
  return handle;
}

/** The handle of the nearest dialog or sheet root, for its content. */
export function getOverlayHistory(): OverlayHistoryHandle | undefined {
  return getContext<OverlayHistoryHandle | undefined>(CONTEXT);
}

type NavigateOptions = NonNullable<Parameters<typeof goto>[1]>;

/**
 * `goto` for a navigation that follows from an open dialog or sheet, such as the page of the thing
 * the dialog just created. The overlay's history entry is replaced by the new page instead of being
 * left behind, so the back button does not have to go through it.
 */
export function gotoFromOverlay(
  url: string | URL,
  options: NavigateOptions = {},
) {
  // eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an address they resolved
  return goto(url, {
    ...options,
    replaceState: options.replaceState || overlays().hasEntry(),
  });
}
