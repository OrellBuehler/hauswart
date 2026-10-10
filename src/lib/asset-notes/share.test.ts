import { describe, expect, it, vi } from "vitest";
import { shareOrCopy, type ShareEnv } from "./share";

const payload = { title: "Anliegen", text: "- Bremsen quietschen" };

function env(over: Partial<ShareEnv> = {}) {
  const share = vi.fn(async () => undefined);
  const writeText = vi.fn(async () => undefined);
  const full: ShareEnv = {
    share,
    clipboard: { writeText },
    preferShare: true,
    ...over,
  };
  return { env: full, share, writeText };
}

describe("shareOrCopy", () => {
  it("opens the share sheet where it is preferred and available", async () => {
    const { env: e, share, writeText } = env();
    await expect(shareOrCopy(payload, e)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(payload);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies on a device where sharing is not the natural thing", async () => {
    const { env: e, share, writeText } = env({ preferShare: false });
    await expect(shareOrCopy(payload, e)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.text);
    expect(share).not.toHaveBeenCalled();
  });

  it("copies when the browser has no share sheet", async () => {
    const { env: e, writeText } = env({ share: undefined });
    await expect(shareOrCopy(payload, e)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.text);
  });

  it("copies when the browser says it cannot share this", async () => {
    const { env: e, share, writeText } = env({ canShare: () => false });
    await expect(shareOrCopy(payload, e)).resolves.toBe("copied");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalled();
  });

  it("does not treat a closed share sheet as an error, and does not copy then", async () => {
    const abort = new DOMException("closed", "AbortError");
    const { env: e, writeText } = env({
      share: vi.fn(async () => {
        throw abort;
      }),
    });
    await expect(shareOrCopy(payload, e)).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when sharing fails for another reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env: e, writeText } = env({
      share: vi.fn(async () => {
        throw new DOMException("not allowed", "NotAllowedError");
      }),
    });
    await expect(shareOrCopy(payload, e)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(payload.text);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("throws when there is nowhere to put the text", async () => {
    const { env: e } = env({ share: undefined, clipboard: undefined });
    await expect(shareOrCopy(payload, e)).rejects.toThrow();
  });

  it("throws when the clipboard refuses", async () => {
    const { env: e } = env({
      preferShare: false,
      clipboard: {
        writeText: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
    });
    await expect(shareOrCopy(payload, e)).rejects.toThrow("denied");
  });
});
