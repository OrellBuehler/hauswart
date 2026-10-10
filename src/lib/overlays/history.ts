/**
 * Gives dialogs and sheets a history entry of their own, so the back gesture closes them instead of
 * leaving the page. The entry is a SvelteKit shallow-routing state (`{ overlay: id }` on the current
 * URL). Closing an overlay by hand pops its entry again, so the browser history ends up as it was.
 *
 * The stack below is the model of the entries we added. It stays right as long as `sync` is called
 * after every traversal the browser makes (popstate) and `navigated` after every navigation:
 * `page.state` is no help in between, SvelteKit resets it on `invalidateAll()`.
 *
 * Everything the browser or SvelteKit does is behind `OverlayEnv`, so the rules can be tested without
 * a browser.
 */
export type OverlayEnv = {
  /** Adds a history entry for the overlay and makes it the current one. */
  push(id: string): void;
  /** Gives the current history entry to another overlay. */
  replace(id: string): void;
  /** Moves through the history, like `history.go`. */
  go(delta: number): void;
  /** The overlay the entry belongs to that the browser just moved to (right after a popstate). */
  current(): string | undefined;
  /** True while a navigation runs; its entry handling is SvelteKit's. */
  navigating(): boolean;
  /** True shortly after a click on a link the router takes over: its navigation is about to start. */
  linkPending(): boolean;
  /** False while the browser's address and the router's page disagree, as when a traversal is undone. */
  stable(): boolean;
  /** Resolves once the next history traversal has been handled (or after a short timeout). */
  traversed(): Promise<void>;
  /** Runs `run` after the current task (or `delayMs` later), so everything the click did has happened. */
  defer(run: () => void, delayMs?: number): void;
};

type Entry = {
  id: string;
  close: () => void;
  owned: (owned: boolean) => void;
  /** The overlay is closed; its entry is popped as soon as it is the newest one. */
  released: boolean;
};

/** How often a held-back pop looks again at whether the link click turned into a navigation. */
const LINK_RECHECK_MS = 50;
/** How many traversals an opening overlay waits for while the router and the browser disagree. */
const MAX_STABLE_WAITS = 3;

export class OverlayHistory {
  readonly #env: OverlayEnv;
  /** Overlays that own a history entry, oldest first. The newest entry is the current one. */
  #stack: Entry[] = [];
  /** Overlays that opened while the history was moving; they get their entry afterwards. */
  #queue: Entry[] = [];
  #draining = false;
  #traversal: Promise<void> | null = null;
  #flushScheduled = false;

  constructor(env: OverlayEnv) {
    this.#env = env;
  }

  /** Called when an overlay opens. `owned` tells whether it has a history entry. */
  open(id: string, close: () => void, owned: (owned: boolean) => void): void {
    if (this.#find(id) || this.#queue.some((entry) => entry.id === id)) return;
    const entry: Entry = { id, close, owned, released: false };
    if (this.#traversal || this.#draining || !this.#env.stable()) {
      this.#queue.push(entry);
      this.#drain();
    } else {
      this.#attach(entry);
    }
  }

  /** Called when an overlay closes by any means, or goes away. */
  release(id: string): void {
    const queued = this.#queue.findIndex((entry) => entry.id === id);
    if (queued !== -1) {
      this.#queue.splice(queued, 1);
      return;
    }
    const entry = this.#find(id);
    if (!entry || entry.released) return;
    entry.released = true;
    this.#scheduleFlush();
  }

  /** Called after the browser moved through the history: the back button took entries away. */
  sync(): void {
    if (this.#traversal) return;
    const current = this.#env.current();
    const keep = current === undefined ? -1 : this.#lastIndex(current);
    for (const entry of this.#stack.splice(keep + 1)) {
      entry.owned(false);
      if (!entry.released) entry.close();
    }
    if (this.#stack.at(-1)?.released) this.#scheduleFlush();
  }

  /** True while the current history entry is one of ours. */
  hasEntry(): boolean {
    return this.#stack.length > 0;
  }

  /** Called after a navigation: the entries we added are behind the new page, not ours to pop. */
  navigated(): void {
    for (const entry of this.#stack.splice(0)) entry.owned(false);
  }

  #find(id: string): Entry | undefined {
    return this.#stack.find((entry) => entry.id === id);
  }

  #lastIndex(id: string): number {
    return this.#stack.findLastIndex((entry) => entry.id === id);
  }

  /** Waits until the history has stopped moving, then gives the queued overlays their entries. */
  #drain(): void {
    if (this.#draining) return;
    this.#draining = true;
    let waits = 0;
    const step = () => {
      const moving =
        this.#traversal ??
        (waits < MAX_STABLE_WAITS && !this.#env.stable()
          ? (waits++, this.#env.traversed())
          : null);
      if (moving) {
        void moving.then(step);
        return;
      }
      this.#draining = false;
      for (const entry of this.#queue.splice(0)) this.#attach(entry);
    };
    step();
  }

  #attach(entry: Entry): void {
    const top = this.#stack.at(-1);
    if (top?.released) {
      // an overlay closed in the same breath: it hands its entry over instead of popping it
      top.owned(false);
      this.#stack[this.#stack.length - 1] = entry;
      this.#env.replace(entry.id);
    } else {
      this.#stack.push(entry);
      this.#env.push(entry.id);
    }
    entry.owned(true);
  }

  #scheduleFlush(delayMs = 0): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    this.#env.defer(() => this.#flush(), delayMs);
  }

  #flush(): void {
    this.#flushScheduled = false;
    if (!this.#stack.at(-1)?.released) return;
    // A navigation takes the entries along: they are not ours to pop.
    const navigating = this.#env.navigating();
    if (!navigating && this.#env.linkPending()) {
      // a link inside the overlay was clicked: wait to see whether it navigates
      this.#scheduleFlush(LINK_RECHECK_MS);
      return;
    }
    let count = 0;
    while (this.#stack.at(-1)?.released) {
      this.#stack.pop()?.owned(false);
      count += 1;
    }
    if (navigating) return;
    this.#traversal = this.#env.traversed().then(() => {
      this.#traversal = null;
      this.sync();
    });
    this.#env.go(-count);
  }
}
