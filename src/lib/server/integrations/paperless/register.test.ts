import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntegration } from "$lib/server/connections/registry";
import { getDocumentProvider } from "$lib/server/documents/provider";
import { useTestDB } from "$lib/testing/db";
import { registerPaperless, registerPaperlessAdapter } from "./index";

describe("registering the Paperless adapter", () => {
  useTestDB();
  const offs: Array<() => void> = [];
  afterEach(() => offs.splice(0).forEach((off) => off()));

  it("makes the connection kind and the document provider available, and withdraws them", () => {
    expect(getIntegration("paperless")).toBeUndefined();
    expect(getDocumentProvider("paperless")).toBeUndefined();
    const off = registerPaperlessAdapter();
    expect(getIntegration("paperless")?.describe().capabilities).toEqual([
      "tags",
      "correspondents",
      "custom-fields",
      "groups",
      "storage-paths",
      "documents",
    ]);
    expect(getDocumentProvider("paperless")?.provider).toBe("paperless");
    off();
    expect(getIntegration("paperless")).toBeUndefined();
    expect(getDocumentProvider("paperless")).toBeUndefined();
  });

  it("startup also starts the sync, which stops with the returned function", () => {
    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(globalThis, "setInterval");
      const off = registerPaperless({ scheduler: { intervalMs: 1000 } });
      offs.push(off);
      expect(spy).toHaveBeenCalled();
      expect(getIntegration("paperless")).toBeDefined();
      off();
      expect(getIntegration("paperless")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
