import { beforeEach, describe, expect, it } from "vitest";
import { OverlayHistory, type OverlayEnv } from "./history";

type Timer = { at: number; order: number; run: () => void };

/** A browser history with a manual clock, wired the way `use-overlay-history.svelte.ts` wires the real one. */
class FakeBrowser implements OverlayEnv {
  entries: Array<{ overlay?: string }> = [{}];
  index = 0;
  navigatingNow = false;
  stableNow = true;
  goCalls: number[] = [];
  history!: OverlayHistory;
  #timers: Timer[] = [];
  #now = 0;
  #linkUntil = 0;
  #order = 0;
  #waiters: Array<() => void> = [];

  push(id: string) {
    this.entries.splice(this.index + 1);
    this.entries.push({ overlay: id });
    this.index += 1;
  }

  replace(id: string) {
    this.entries[this.index] = { overlay: id };
  }

  go(delta: number) {
    this.goCalls.push(delta);
    this.traverse(delta);
  }

  /** What the back button does. */
  userBack() {
    this.traverse(-1);
  }

  current() {
    return this.entries[this.index]?.overlay;
  }

  navigating() {
    return this.navigatingNow;
  }

  linkPending() {
    return this.#now < this.#linkUntil;
  }

  /** A click on a link the router takes over; its navigation is expected within `ms`. */
  linkClicked(ms = 1000) {
    this.#linkUntil = this.#now + ms;
  }

  stable() {
    return this.stableNow;
  }

  traversed() {
    return new Promise<void>((resolve) => {
      this.#waiters.push(resolve);
      // the real one gives up after a while
      this.defer(resolve, 500);
    });
  }

  defer(run: () => void, delayMs = 0) {
    this.#timers.push({ at: this.#now + delayMs, order: this.#order++, run });
  }

  traverse(delta: number) {
    this.defer(() => {
      this.index = Math.max(
        0,
        Math.min(this.entries.length - 1, this.index + delta),
      );
      this.popstate();
    });
  }

  popstate() {
    this.defer(() => this.history.sync());
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) this.defer(waiter);
  }

  /** Runs the next task only. */
  async step() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    this.#timers.sort((a, b) => a.at - b.at || a.order - b.order);
    const next = this.#timers.shift();
    if (!next) return;
    this.#now = Math.max(this.#now, next.at);
    next.run();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  /** Runs what is due within the next `ms` milliseconds. */
  async advance(ms: number) {
    const until = this.#now + ms;
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      this.#timers.sort((a, b) => a.at - b.at || a.order - b.order);
      if (!this.#timers.length || this.#timers[0].at > until) break;
      const next = this.#timers.shift()!;
      this.#now = Math.max(this.#now, next.at);
      next.run();
    }
    this.#now = until;
  }

  /** Runs everything that is due, in order, like the event loop would. */
  async settle() {
    for (let round = 0; round < 100; round++) {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      this.#timers.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = this.#timers.shift();
      if (!next) return;
      this.#now = Math.max(this.#now, next.at);
      next.run();
    }
    throw new Error("the fake event loop did not settle");
  }
}

type Overlay = { id: string; open: boolean; owned: boolean; closed: number };

describe("overlay history", () => {
  let browser: FakeBrowser;
  let history: OverlayHistory;

  const overlays = new Map<string, Overlay>();
  const open = (id: string) => {
    const overlay: Overlay = { id, open: true, owned: false, closed: 0 };
    overlays.set(id, overlay);
    history.open(
      id,
      () => {
        overlay.open = false;
        overlay.closed += 1;
        history.release(id);
      },
      (owned) => (overlay.owned = owned),
    );
    return overlay;
  };
  /** The overlay closes itself: a button, escape or a click outside. */
  const close = (id: string) => {
    overlays.get(id)!.open = false;
    history.release(id);
  };
  const state = () => ({
    at: browser.index,
    overlay: browser.current(),
    entries: browser.entries.length,
  });

  beforeEach(() => {
    overlays.clear();
    browser = new FakeBrowser();
    history = new OverlayHistory(browser);
    browser.history = history;
  });

  it("gives an open overlay an entry and takes it back when it closes", async () => {
    const a = open("a");
    await browser.settle();
    expect(state()).toEqual({ at: 1, overlay: "a", entries: 2 });
    expect(a.owned).toBe(true);

    close("a");
    await browser.settle();
    expect(state().at).toBe(0);
    expect(browser.goCalls).toEqual([-1]);
    expect(a.owned).toBe(false);
  });

  it("closes the overlay on the back button and leaves the history alone", async () => {
    const a = open("a");
    await browser.settle();
    browser.userBack();
    await browser.settle();
    expect(a.open).toBe(false);
    expect(a.closed).toBe(1);
    expect(a.owned).toBe(false);
    expect(browser.goCalls).toEqual([]);
    expect(state().at).toBe(0);
  });

  it("pops its entry when it closes within the same task as it opened", async () => {
    open("a");
    close("a");
    await browser.settle();
    expect(state().at).toBe(0);
    expect(browser.goCalls).toEqual([-1]);
  });

  it("closes nested overlays one back at a time", async () => {
    const sheet = open("sheet");
    const confirm = open("confirm");
    await browser.settle();
    expect(state()).toEqual({ at: 2, overlay: "confirm", entries: 3 });

    browser.userBack();
    await browser.settle();
    expect(confirm.open).toBe(false);
    expect(sheet.open).toBe(true);
    expect(browser.current()).toBe("sheet");

    browser.userBack();
    await browser.settle();
    expect(sheet.open).toBe(false);
    expect(state().at).toBe(0);
    expect(browser.goCalls).toEqual([]);
  });

  it("pops only the inner entry when the inner overlay closes by itself", async () => {
    const sheet = open("sheet");
    open("confirm");
    await browser.settle();
    close("confirm");
    await browser.settle();
    expect(sheet.open).toBe(true);
    expect(browser.goCalls).toEqual([-1]);
    expect(browser.current()).toBe("sheet");
  });

  it.each([
    ["inner first", ["confirm", "sheet"]],
    ["outer first", ["sheet", "confirm"]],
  ])(
    "pops both entries in one step when both close together (%s)",
    async (_name, order) => {
      open("sheet");
      open("confirm");
      await browser.settle();
      for (const id of order) close(id);
      await browser.settle();
      expect(browser.goCalls).toEqual([-2]);
      expect(state().at).toBe(0);
    },
  );

  it("knows whether the current entry is its own", async () => {
    expect(history.hasEntry()).toBe(false);
    open("a");
    await browser.settle();
    expect(history.hasEntry()).toBe(true);
    // closed, but not popped yet: still the current entry
    close("a");
    expect(history.hasEntry()).toBe(true);
    await browser.settle();
    expect(history.hasEntry()).toBe(false);
  });

  it("hands the entry to an overlay that opens in the same breath", async () => {
    open("create");
    await browser.settle();
    close("create");
    const reveal = open("reveal");
    await browser.settle();
    expect(browser.goCalls).toEqual([]);
    expect(state()).toEqual({ at: 1, overlay: "reveal", entries: 2 });
    expect(reveal.owned).toBe(true);
    expect(overlays.get("create")!.owned).toBe(false);

    close("reveal");
    await browser.settle();
    expect(state().at).toBe(0);
  });

  it("gives an entry to an overlay that opens while the previous one is being popped", async () => {
    open("a");
    await browser.settle();
    close("a");
    // the pop was issued, the browser has not moved yet
    await browser.step();
    expect(browser.goCalls).toEqual([-1]);
    expect(state().at).toBe(1);
    const b = open("b");
    expect(state().entries).toBe(2);
    await browser.settle();
    expect(browser.goCalls).toEqual([-1]);
    expect(state()).toEqual({ at: 1, overlay: "b", entries: 2 });
    expect(b.owned).toBe(true);
  });

  it("does not pop what a navigation took along", async () => {
    open("sheet");
    await browser.settle();
    browser.navigatingNow = true;
    close("sheet");
    await browser.settle();
    expect(browser.goCalls).toEqual([]);
    expect(overlays.get("sheet")!.owned).toBe(false);
  });

  it("waits for a link click to turn into a navigation before it pops", async () => {
    open("sheet");
    await browser.settle();
    browser.linkClicked();
    close("sheet");
    await browser.advance(300);
    // the click has not started a navigation yet, the pop is held back
    expect(browser.goCalls).toEqual([]);

    browser.navigatingNow = true;
    await browser.advance(100);
    expect(browser.goCalls).toEqual([]);
    expect(overlays.get("sheet")!.owned).toBe(false);
    await browser.settle();
    expect(browser.goCalls).toEqual([]);
  });

  it("pops after all when a clicked link never navigates", async () => {
    open("dialog");
    await browser.settle();
    browser.linkClicked();
    close("dialog");
    await browser.advance(500);
    expect(browser.goCalls).toEqual([]);

    await browser.settle();
    expect(browser.goCalls).toEqual([-1]);
    expect(state().at).toBe(0);
  });

  it("forgets its entries after a navigation", async () => {
    const a = open("a");
    await browser.settle();
    history.navigated();
    expect(a.owned).toBe(false);
    close("a");
    await browser.settle();
    expect(browser.goCalls).toEqual([]);
  });

  it("waits with a new entry until the browser and the router agree again", async () => {
    browser.stableNow = false;
    const a = open("a");
    await browser.step();
    expect(a.owned).toBe(false);
    expect(state().entries).toBe(1);

    browser.stableNow = true;
    browser.popstate();
    await browser.settle();
    expect(a.owned).toBe(true);
    expect(state()).toEqual({ at: 1, overlay: "a", entries: 2 });
  });

  it("still opens when the browser and the router never agree", async () => {
    browser.stableNow = false;
    const a = open("a");
    await browser.settle();
    expect(a.owned).toBe(true);
    expect(state().entries).toBe(2);
  });

  it("lets a queued overlay go before it ever got an entry", async () => {
    browser.stableNow = false;
    open("a");
    close("a");
    await browser.settle();
    expect(state().entries).toBe(1);
    expect(browser.goCalls).toEqual([]);
  });

  it("pops entries of overlays that closed below an open one once it goes", async () => {
    open("sheet");
    open("confirm");
    await browser.settle();
    close("sheet");
    await browser.settle();
    expect(browser.goCalls).toEqual([]);

    browser.userBack();
    await browser.settle();
    expect(overlays.get("confirm")!.open).toBe(false);
    // the entry of the closed sheet is current now and is popped as well
    expect(browser.goCalls).toEqual([-1]);
    expect(state().at).toBe(0);
  });

  it("ignores overlays it does not know and repeated calls", async () => {
    history.release("unknown");
    const a = open("a");
    history.open(
      "a",
      () => {},
      () => {},
    );
    await browser.settle();
    expect(state().entries).toBe(2);
    close("a");
    history.release("a");
    await browser.settle();
    expect(browser.goCalls).toEqual([-1]);
    expect(a.closed).toBe(0);
  });
});
