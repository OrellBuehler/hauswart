import { onMount, untrack } from "svelte";
import {
  afterNavigate,
  beforeNavigate,
  goto,
  refreshAll,
  type BeforeNavigate,
} from "$app/navigation";
import { navigating, page } from "$app/state";
import { OverlayHistory, type OverlayEnv } from "./history";
import { routerOptions } from "./link-options";

const TRAVERSAL_TIMEOUT_MS = 500;
const LINK_PENDING_MS = 1000;
const session = Math.random().toString(36).slice(2, 8);
let counter = 0;
let controller: OverlayHistory | undefined;
let linkClickedAt = Number.NEGATIVE_INFINITY;
let linkClicked: Element | null = null;

// The router prevents the default of the links it takes over, and it does so before this listener
// (on the document) sees the click.
function noteLinkClick(event: MouseEvent) {
  if (event.defaultPrevented && event.target instanceof Element) {
    const link = event.target.closest("a[href]");
    if (link) {
      linkClickedAt = performance.now();
      linkClicked = link;
    }
  }
}

// Shallow entries are written after an await inside `goto`, so every change to the history goes
// through one chain: a `go` never runs before the entry it is meant to pop exists.
let historyQueue: Promise<unknown> = Promise.resolve();
function inOrder(step: () => unknown): void {
  historyQueue = historyQueue.then(step).catch((err: unknown) => {
    console.error("overlay history step failed", err);
  });
}

// The current address as the browser has it, hash included: `""` would drop the hash, and the router
// and the browser would disagree about the page until the next navigation.
const env: OverlayEnv = {
  push: (id) =>
    inOrder(() =>
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- the page we are on
      goto(window.location.href, { shallow: true, state: { overlay: id } }),
    ),
  replace: (id) =>
    inOrder(() =>
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- the page we are on
      goto(window.location.href, {
        shallow: true,
        replace: true,
        state: { overlay: id },
      }),
    ),
  go: (delta) => inOrder(() => window.history.go(delta)),
  current: () => page.state.overlay,
  // our own shallow entries are navigations too now; only a real one takes the entries along
  navigating: () => navigating.to !== null && !navigating.shallow,
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

type Options = {
  open: () => boolean;
  close: () => void;
  /** Overlays that opt out keep the browser's default: back leaves the page. */
  enabled: () => boolean;
};

// Every overlay registers this, and the router hands all of them the same navigation object.
const handled = new WeakSet<object>();

/**
 * A click on a link inside an open dialog or sheet: the navigation waits until the overlay's history
 * entries are popped and starts again from the page below them. Navigating from the entry itself
 * (or replacing it) would give the new page the router's navigation index of the page below, and the
 * back button would then change the address without changing the page.
 */
function leaveOverlays(navigation: BeforeNavigate) {
  const { type, to } = navigation;
  if (type !== "link" || !to || handled.has(navigation)) return;
  if (!controller?.hasEntry()) return;
  handled.add(navigation);
  navigation.cancel();
  // the options on the link that was clicked, as the router would have used them
  const options =
    linkClicked instanceof HTMLAnchorElement &&
    performance.now() - linkClickedAt < LINK_PENDING_MS &&
    linkClicked.href === to.url.href
      ? routerOptions(linkClicked)
      : {};
  void (async () => {
    await overlays().popAll();
    try {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- the router resolved this address
      await goto(to.url, {
        ...options,
        // like the router: a link to the page you are on replaces instead of adding
        replace: options.replace ?? to.url.href === location.href,
      });
    } catch (err) {
      console.error("navigation from an overlay failed", err);
    }
  })();
}

/**
 * Call once from the root component of a dialog or sheet. While `open()` is true (and `enabled()`)
 * the overlay owns a history entry: the back gesture calls `close()`, and closing it by hand pops the
 * entry again. An overlay that closes because of a navigation leaves the history to SvelteKit, except
 * for a click on a link inside it, which pops the entries first (`leaveOverlays`).
 */
export function useOverlayHistory(options: Options): void {
  const id = `${session}-${(counter += 1)}`;
  // a shallow goto needs the router, which is only there once the page has hydrated
  let ready = $state(false);

  onMount(() => {
    const timer = setTimeout(() => (ready = true), 0);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const wanted = ready && options.open() && options.enabled();
    untrack(() => {
      if (wanted) {
        overlays().open(id, options.close);
      } else {
        overlays().release(id);
      }
    });
  });

  // the router keeps its callbacks in a Set: each overlay needs a function of its own, or the first
  // one to go away would take the registration of all the others with it
  // the entries of overlays are shallow navigations now, and they are ours, not a new page
  beforeNavigate((navigation) => {
    if (navigation.shallow) return;
    leaveOverlays(navigation);
  });
  afterNavigate(({ shallow }) => {
    if (shallow) return;
    overlays().navigated();
  });

  $effect(() => () => untrack(() => overlays().release(id)));
}

type NavigateOptions = NonNullable<Parameters<typeof goto>[1]>;

/**
 * `goto` for a navigation that follows from an open dialog or sheet, such as the page of the thing
 * the dialog just created. The overlay's history entries are popped first and the navigation starts
 * from the page below them, so the back button leads to that page with its own content. Do not
 * pass `replace`: the entries popped here stay in the browser's forward list until a push
 * drops them, and a replaced entry would leave a forward button that changes only the address.
 */
export async function gotoFromOverlay(
  url: string | URL,
  options: NavigateOptions = {},
): Promise<void> {
  await overlays().popAll();
  // eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an address they resolved
  return goto(url, options);
}

/**
 * `refreshAll()` for the action of a dialog or sheet that closes afterwards. Closing pops the overlay's history
 * entry, and the router drops an invalidation that is still loading when that popstate arrives, so the page would keep
 * showing the old data. This waits until the entry is gone, then invalidates.
 */
export async function invalidateAfterOverlay(): Promise<void> {
  await overlays().settled();
  await refreshAll();
}
