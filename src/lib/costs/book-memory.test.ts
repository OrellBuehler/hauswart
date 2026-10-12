import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissHistoryHint, historyHintDismissed } from "./balance-hint";
import { forgetBook, loadRememberedBook, rememberBook } from "./book-memory";

function storage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const refusing = {
  getItem: () => {
    throw new Error("storage refused");
  },
  setItem: () => {
    throw new Error("storage refused");
  },
  removeItem: () => {
    throw new Error("storage refused");
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the remembered book", () => {
  it("is nothing before a choice was made", () => {
    vi.stubGlobal("localStorage", storage());
    expect(loadRememberedBook("u1")).toBeNull();
  });

  it("remembers a book, and every book, per person", () => {
    const store = storage();
    vi.stubGlobal("localStorage", store);
    rememberBook("u1", "b2");
    rememberBook("u2", "");
    expect(loadRememberedBook("u1")).toBe("b2");
    expect(loadRememberedBook("u2")).toBe("");
    expect(loadRememberedBook("u3")).toBeNull();
    expect(store.items.get("hauswart:cost-book:u2")).toBe("all");
  });

  it("forgets quietly, and says so in the log, when the browser refuses storage", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("localStorage", refusing);
    expect(loadRememberedBook("u1")).toBeNull();
    expect(() => rememberBook("u1", "b2")).not.toThrow();
    expect(() => forgetBook("u1")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("forgets a book on request, for that person only", () => {
    vi.stubGlobal("localStorage", storage());
    rememberBook("u1", "b2");
    rememberBook("u2", "b3");
    forgetBook("u1");
    expect(loadRememberedBook("u1")).toBeNull();
    expect(loadRememberedBook("u2")).toBe("b3");
  });
});

describe("the dismissed history hint", () => {
  it("is shown until the person hides it, and only for that person", () => {
    vi.stubGlobal("localStorage", storage());
    expect(historyHintDismissed("u1")).toBe(false);
    dismissHistoryHint("u1");
    expect(historyHintDismissed("u1")).toBe(true);
    expect(historyHintDismissed("u2")).toBe(false);
  });

  it("is shown again when the browser refuses storage", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("localStorage", refusing);
    expect(historyHintDismissed("u1")).toBe(false);
    expect(() => dismissHistoryHint("u1")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
